'use strict';

const s = require('../../scripts/security-summary');

const npmReport = {
  vulnerabilities: {
    'node-forge': {
      name: 'node-forge', severity: 'high', fixAvailable: false,
      via: [{ title: 'RSA signature verification flaw', url: 'https://github.com/advisories/GHSA-xxxx' }],
    },
    lodash: { name: 'lodash', severity: 'moderate', fixAvailable: true, via: ['other-pkg'] },
  },
};

const trivyReport = {
  Results: [
    {
      Target: 'package-lock.json',
      Vulnerabilities: [
        { VulnerabilityID: 'CVE-1', PkgName: 'express', InstalledVersion: '1.0.0', FixedVersion: '1.0.1', Severity: 'CRITICAL', Title: 'RCE' },
        { VulnerabilityID: 'CVE-2', PkgName: 'zlib', InstalledVersion: '1.0', Severity: 'HIGH', Title: 'No fix yet' },
      ],
    },
    { Target: 'Dockerfile', Misconfigurations: [{ ID: 'DS026', Severity: 'LOW', Title: 'No healthcheck', Status: 'FAIL' }] },
    { Target: 'infra/jenkins/Dockerfile', Misconfigurations: [{ ID: 'DS002', Severity: 'HIGH', Title: 'Root user', Status: 'FAIL' }, { ID: 'X', Severity: 'HIGH', Status: 'PASS' }] },
    { Target: 'src/config.js', Secrets: [{ RuleID: 'aws-access-key-id', Severity: 'CRITICAL', Title: 'AWS key', StartLine: 3 }] },
  ],
};

describe('security summary', () => {
  test('normalizes npm "moderate" to MEDIUM', () => {
    expect(s.normSeverity('moderate')).toBe('MEDIUM');
    expect(s.normSeverity('weird')).toBe('UNKNOWN');
  });

  test('parses npm audit findings with advisory titles', () => {
    const f = s.fromNpmAudit(npmReport, 'development');
    expect(f).toHaveLength(2);
    expect(f[0]).toMatchObject({ pkg: 'node-forge', severity: 'HIGH', fixAvailable: false, id: 'GHSA-xxxx', scope: 'development' });
    expect(f[1].title).toMatch(/other-pkg/);
    expect(s.fromNpmAudit(null)).toEqual([]);
  });

  test('parses Trivy vulnerabilities, secrets and failed misconfigs only', () => {
    const f = s.fromTrivy(trivyReport, 'trivy fs');
    expect(f.map((x) => x.type)).toEqual(['vulnerability', 'vulnerability', 'misconfig', 'misconfig', 'secret']);
    expect(f.find((x) => x.id === 'DS002').scope).toBe('lab');
    expect(s.fromTrivy({})).toEqual([]);
  });

  test('applies the risk-based policy', () => {
    const decisions = Object.fromEntries(s.fromTrivy(trivyReport, 't').map((f) => [f.id, s.classify(f)]));
    expect(decisions).toEqual({ 'CVE-1': 'BLOCK', 'CVE-2': 'REVIEW', DS026: 'INFO', DS002: 'REVIEW', 'aws-access-key-id': 'BLOCK' });
    const devOnly = s.fromNpmAudit(npmReport, 'development')[0];
    expect(s.classify({ ...devOnly, fixAvailable: true })).toBe('REVIEW');
  });

  test('summary fails the gate on blocking findings and renders markdown', () => {
    const summary = s.summarize([...s.fromTrivy(trivyReport, 'trivy fs'), ...s.fromTrivy(trivyReport, 'trivy fs')]);
    expect(summary.findings).toHaveLength(5); // de-duplicated
    expect(summary.passed).toBe(false);
    expect(summary.findings[0].severity).toBe('CRITICAL');
    const md = s.toMarkdown(summary, { version: '1.0.0' });
    expect(md).toContain('FAILED');
    expect(md).toContain('| trivy fs |');
  });

  test('clean scan passes', () => {
    const summary = s.summarize(s.fromNpmAudit({ vulnerabilities: {} }));
    expect(summary.passed).toBe(true);
    expect(s.toMarkdown(summary)).toContain('_None._');
  });
});
