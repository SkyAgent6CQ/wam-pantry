# Security approach and findings

## How the Security stage works

| Scanner | What it checks | Output |
|---|---|---|
| `npm audit --omit=dev` | Known vulnerabilities in **production** dependencies (shipped in the image) | `reports/security/npm-audit.json` |
| `npm audit` (all) | Same, including dev tooling (Jest, ESLint, SonarQube scanner) for visibility | `npm-audit-dev.json` |
| `trivy fs` | Lockfile dependencies, hard-coded secrets, misconfigurations in Dockerfiles/IaC | `trivy-fs.json` |
| `trivy image` | OS packages (Alpine) + Node runtime inside the built image | `trivy-image.json` |

`scripts/security-summary.js` normalizes all four reports into one list, de-duplicates, classifies every finding and
writes `summary.md`, `summary.json` and an HTML page published in Jenkins ("Security Summary").

### Policy

| Decision | Rule | Why |
|---|---|---|
| **BLOCK** | HIGH/CRITICAL vulnerability with a fix available in a shipped dependency or the image | There is an upgrade path; shipping it would be negligent |
| **BLOCK** | Any hard-coded secret | Leaked credentials cannot be "fixed later" |
| **BLOCK** | HIGH/CRITICAL misconfiguration in the application `Dockerfile` | It defines the production runtime |
| **REVIEW** | HIGH/CRITICAL with no upstream fix; dev-only dependencies; local lab tooling (`infra/`, `monitoring/`) | Tracked and documented with mitigation, but blocking would stop all delivery without reducing risk |
| **INFO** | MEDIUM/LOW | Handled in routine dependency updates |

Suppressions go in `.trivyignore`, and every entry needs a reason and a review date. There are currently none.

## Findings log

| Date | Finding | Severity | Where | Decision / mitigation |
|---|---|---|---|---|
| 2026-10-04 | `node-forge` RSA PKCS#1 v1.5 signature verification accepts extra nested DigestAlgorithm elements ([GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv)) | HIGH | Dev dependency only: pulled in by `@sonar/scan` (SonarQube scanner) | **REVIEW / accepted.** Not in the production image (`npm ci --omit=dev`). The scanner only talks to our own SonarQube container on a private Docker network, so the forged-signature attack path does not apply. No fix available yet; re-check each build (the pipeline reports it automatically). |
| 2026-10-04 | Production dependencies (`npm audit --omit=dev`) | none found | express, helmet, jsonwebtoken, bcryptjs, prom-client, express-rate-limit | PASS |
| _add your run_ | Trivy image results (Alpine base / Node runtime) | | | Fill in from the "Security Summary" report in Jenkins |
| _add your run_ | Trivy misconfig: Jenkins container runs as root (`infra/`) | | Lab tooling | **REVIEW / accepted**: required to use the host Docker socket in a single-machine lab. In real infrastructure use dedicated build agents or rootless Docker/Kaniko. |

## Preventive controls in the application

- **Authentication:** bcrypt password hashing, JWTs signed with a 32+ character secret from Jenkins credentials, with an issuer claim and expiry.
- **User enumeration:** login responses are identical and constant-time for unknown emails versus wrong passwords.
- **Authorization:** role checks for admin routes, and ownership checks on booking cancellation.
- **Input validation and request limits:**
  - Every payload is validated.
  - The email check is linear-time, so there's no regex ReDoS risk.
  - Request bodies are capped at 20 KB.
- **Rate limiting:** applied per IP on `/api`.
- **HTTP headers:** helmet security headers, and `x-powered-by` is disabled.
- **Error handling:** unhandled errors return a generic 500, and the details go to logs only.
- **Configuration:** staging and production refuse to start without strong secrets, and chaos endpoints are disabled in production.
- **Container hardening:**
  - Non-root user, read-only root filesystem, all Linux capabilities dropped, `no-new-privileges`.
  - Memory and CPU limits.
  - npm removed from the runtime image, and Alpine packages upgraded at build time.
- **Secrets handling:**
  - Secrets live only in Jenkins credentials and `infra/.env`, which is git-ignored.
  - Jenkins masks them in logs.
