'use strict';

/**
 * Security stage gate. Reads the raw scanner output (npm audit + Trivy fs +
 * Trivy image), normalizes findings, applies the security policy, writes a
 * human-readable report (reports/security/summary.md + index.html) and exits
 * non-zero when the policy is violated.
 *
 * Policy (risk-based, documented in docs/SECURITY.md):
 *   BLOCK  - any HIGH/CRITICAL vulnerability in a shipped (production) dependency or the image
 *            that has a fix available -> we must upgrade before release
 *   BLOCK  - any hard-coded secret found in the repository or image
 *   BLOCK  - HIGH/CRITICAL misconfiguration in the production Dockerfile
 *   REVIEW - HIGH/CRITICAL with no fix yet, dev-only dependencies, local-lab infra
 *            misconfigurations: reported and tracked, not blocking
 *   INFO   - MEDIUM/LOW: reported for routine patching
 */
const fs = require('node:fs');
const path = require('node:path');

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
const SERIOUS = new Set(['CRITICAL', 'HIGH']);
// Misconfigurations in these paths belong to local lab tooling (Jenkins/monitoring
// containers), not the shipped application, and are accepted risks.
const LAB_PATHS = [/^infra\//, /^monitoring\//];

const normSeverity = (s) => {
  const up = String(s || 'UNKNOWN').toUpperCase();
  return up === 'MODERATE' ? 'MEDIUM' : (SEVERITY_ORDER.includes(up) ? up : 'UNKNOWN');
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** npm audit v7+ JSON -> findings. `scope` is 'production' or 'development'. */
function fromNpmAudit(report, scope = 'production') {
  if (!report?.vulnerabilities) return [];
  return Object.values(report.vulnerabilities).map((v) => {
    const advisory = (v.via || []).find((x) => typeof x === 'object');
    return {
      tool: 'npm audit',
      type: 'vulnerability',
      id: advisory?.url?.split('/').pop() || v.name,
      target: `npm:${v.name}`,
      pkg: v.name,
      severity: normSeverity(v.severity),
      title: advisory?.title || `Vulnerable via ${(v.via || []).filter((x) => typeof x === 'string').join(', ')}`,
      fixAvailable: Boolean(v.fixAvailable),
      scope,
    };
  });
}

/** Trivy JSON -> findings (vulnerabilities, secrets, misconfigurations). */
function fromTrivy(report, tool) {
  if (!report?.Results) return [];
  return report.Results.flatMap((r) => [
    ...(r.Vulnerabilities || []).map((v) => ({
      tool, type: 'vulnerability', id: v.VulnerabilityID, target: r.Target, pkg: `${v.PkgName}@${v.InstalledVersion}`,
      severity: normSeverity(v.Severity), title: v.Title || v.VulnerabilityID, fixAvailable: Boolean(v.FixedVersion),
      fixedVersion: v.FixedVersion || null, scope: 'production',
    })),
    ...(r.Secrets || []).map((s) => ({
      tool, type: 'secret', id: s.RuleID, target: `${r.Target}:${s.StartLine}`, pkg: '-',
      severity: normSeverity(s.Severity), title: s.Title, fixAvailable: true, scope: 'production',
    })),
    ...(r.Misconfigurations || []).filter((m) => m.Status !== 'PASS').map((m) => ({
      tool, type: 'misconfig', id: m.ID || m.AVDID, target: r.Target, pkg: '-',
      severity: normSeverity(m.Severity), title: m.Title, fixAvailable: true,
      scope: LAB_PATHS.some((re) => re.test(r.Target)) ? 'lab' : 'production',
    })),
  ]);
}

/** Applies the policy; each finding gets a decision of BLOCK, REVIEW or INFO. */
function classify(finding) {
  if (finding.type === 'secret') return 'BLOCK';
  if (!SERIOUS.has(finding.severity)) return 'INFO';
  if (finding.scope !== 'production') return 'REVIEW';
  if (finding.type === 'vulnerability' && !finding.fixAvailable) return 'REVIEW';
  return 'BLOCK';
}

function dedupe(findings) {
  const seen = new Map();
  findings.forEach((f) => {
    const key = `${f.type}|${f.id}|${f.pkg}|${f.target}`;
    if (!seen.has(key)) seen.set(key, f);
  });
  return [...seen.values()];
}

function summarize(findings) {
  const all = dedupe(findings).map((f) => ({ ...f, decision: classify(f) }));
  const counts = {};
  all.forEach((f) => {
    counts[f.tool] = counts[f.tool] || Object.fromEntries(SEVERITY_ORDER.map((s) => [s, 0]));
    counts[f.tool][f.severity] += 1;
  });
  const bySeverity = (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
  return {
    findings: all.sort(bySeverity),
    counts,
    blocking: all.filter((f) => f.decision === 'BLOCK'),
    review: all.filter((f) => f.decision === 'REVIEW'),
    passed: all.every((f) => f.decision !== 'BLOCK'),
  };
}

function toMarkdown(summary, meta = {}) {
  const row = (f) => `| ${f.decision} | ${f.severity} | ${f.type} | ${f.tool} | ${f.id} | ${f.pkg} | ${f.title.replaceAll('|', '/')} | ${f.fixedVersion || (f.fixAvailable ? 'yes' : 'no fix yet')} |`;
  const notable = summary.findings.filter((f) => f.decision !== 'INFO');
  return [
    `# Security scan summary${meta.version ? ` — ${meta.version}` : ''}`,
    '',
    `**Gate result:** ${summary.passed ? 'PASSED' : 'FAILED'} — ${summary.blocking.length} blocking, ${summary.review.length} for review, ${summary.findings.length} total findings.`,
    '',
    '## Findings by tool and severity',
    '',
    `| Tool | ${SEVERITY_ORDER.join(' | ')} |`,
    `|---|${SEVERITY_ORDER.map(() => '---').join('|')}|`,
    ...Object.entries(summary.counts).map(([tool, c]) => `| ${tool} | ${SEVERITY_ORDER.map((s) => c[s]).join(' | ')} |`),
    '',
    '## Blocking and review items (HIGH/CRITICAL, secrets)',
    '',
    notable.length ? '| Decision | Severity | Type | Tool | ID | Package | Issue | Fix |' : '_None._',
    notable.length ? '|---|---|---|---|---|---|---|---|' : '',
    ...notable.map(row),
    '',
    '_Policy: BLOCK = fixable HIGH/CRITICAL in shipped code or image, any secret, HIGH/CRITICAL misconfig in the app Dockerfile. '
      + 'REVIEW = no upstream fix yet, dev-only dependency, or local lab tooling (documented in docs/SECURITY.md)._',
    '',
  ].join('\n');
}

function toHtml(markdown) {
  const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Security summary</title>
<style>body{font-family:system-ui,sans-serif;margin:2rem;max-width:1100px}pre{white-space:pre-wrap;font-size:13px;line-height:1.45}</style>
</head><body><pre>${esc(markdown)}</pre></body></html>`;
}

function main() {
  const dir = process.argv[2] || path.join(process.cwd(), 'reports', 'security');
  const findings = [
    ...fromNpmAudit(readJson(path.join(dir, 'npm-audit.json')), 'production'),
    ...fromNpmAudit(readJson(path.join(dir, 'npm-audit-dev.json')), 'development')
      .map((f) => ({ ...f, tool: 'npm audit (dev)' })),
    ...fromTrivy(readJson(path.join(dir, 'trivy-fs.json')), 'trivy fs'),
    ...fromTrivy(readJson(path.join(dir, 'trivy-image.json')), 'trivy image'),
  ];
  const summary = summarize(findings);
  const md = toMarkdown(summary, { version: process.env.VERSION });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'summary.md'), md);
  fs.writeFileSync(path.join(dir, 'index.html'), toHtml(md));
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(md);
  if (!summary.passed) {
    console.error(`Security gate FAILED: ${summary.blocking.length} blocking finding(s).`);
    process.exit(1);
  }
  console.log('Security gate PASSED.');
}

if (require.main === module) main();

module.exports = { fromNpmAudit, fromTrivy, classify, summarize, toMarkdown, normSeverity };
