# Security tool scan

30 October 2026. Read-only. No packages were upgraded and no application files were edited. `govulncheck` was run with `GOFLAGS=-mod=readonly`; `apps/settlement/go.mod` and `go.sum` were unchanged afterward.

Tools that were not on the machine, and were not installed: k6, semgrep, trivy, gitleaks, OWASP ZAP. The two scans below are the ones that can be repeated from the lockfiles already in the repo.

## 1. `npm audit` (Node lockfile)

Working directory: `fils-pay`. Tooling: Node v22.23.2, npm 10.9.8.

```text
npm audit --omit=dev --json
npm audit --json
```

Production tree (`--omit=dev`): **5 advisories, 4 moderate, 1 high, 0 critical.** 114 production dependencies.

Full tree, including dev: **8 advisories, 5 moderate, 3 high, 0 critical.** 277 dependencies in the audit metadata.

Installed versions are from `package-lock.json`.

| Package | Installed | Audit severity | Advisory | Where it sits |
|---|---|---|---|---|
| sharp | 0.33.5 | high | [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) libvips CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591 (fixed in 0.35.0). [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) libheif (fixed in 0.35.4). [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) librsvg CVE-2026-96889 (fixed in 0.35.5). | Production. Image decoding for uploads. `npm audit` says the fix is `sharp@0.35.5`, a breaking bump. |
| fastify | 5.12.3 | moderate | [GHSA-4mh8-r7rc-xpvc](https://github.com/advisories/GHSA-4mh8-r7rc-xpvc) HTTP/2 trailer exception, fixed in 5.12.5. [GHSA-389g-gv7q-r4x8](https://github.com/advisories/GHSA-389g-gv7q-r4x8) header `propertyNames` case bypass, low, range `>=5.12.2 <5.12.6`. | Production API. `apps/api` does not enable HTTP/2 (`http2` is unset; `listen` is plain HTTP), so the trailer bug is not on the current request path. The header-schema bug is in range for 5.12.3. |
| fast-uri | 4.1.4 | moderate | Host confusion, scheme spoofing, path equivalence, mailto header injection, suffix-colon scheme injection. Representative: [GHSA-hrr3-gc8f-f4qj](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj), [GHSA-jvvf-x445-j334](https://github.com/advisories/GHSA-jvvf-x445-j334), [GHSA-w74x-v6f9-j3xg](https://github.com/advisories/GHSA-w74x-v6f9-j3xg), [GHSA-wjr9-j795-jxcr](https://github.com/advisories/GHSA-wjr9-j795-jxcr). Fixed in 4.1.5 / 4.2.3 depending on the advisory. | Production, via Fastify’s Ajv compiler. |
| react-router | 6.30.6 | moderate | [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6) open redirect via a backslash in `<Link>` / `useNavigate` (bypass of CVE-2025-68470). [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg) constructor injection in `deserializeErrors()` during SSR hydration. Both fixed in 7.18.0. | Production UI dependency of `react-router-dom@6.30.6`. `npm audit` says `--force` would install `react-router-dom@7.18.5`, a major bump. The SSR bug applies to server hydration; these apps are Vite SPAs. |
| react-router-dom | 6.30.6 | moderate | Same as `react-router`, which it depends on. | Merchant and admin front ends. |
| esbuild | 0.21.5 (nested under Vite) | moderate | [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) dev server will proxy arbitrary requests. Range `<=0.24.2`. The top-level esbuild is 0.28.2, which is outside that range. | Dev. Vite’s own esbuild. |
| vite | 5.4.21 | high | Several `server.fs` and `launch-editor` issues filed against `<=6.4.3`, including [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm) (high, Windows `fs.existsSync` bypass) and [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) (`server.fs.deny` bypass on Windows). | Dev server only. |
| source-map-js | 1.2.1 | high | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) event-loop hang on a crafted source map. Fixed in 1.2.2. Range `>=1.0.0 <1.2.2`, so 1.2.1 is inside it. | Dev / build tooling. |

`npm audit fix` without `--force` is what npm offers for the fastify / fast-uri set. sharp and react-router are the two it will not move without a breaking install. This scan did not apply either.

## 2. `govulncheck` (Go settlement module)

```text
cd apps/settlement
GOFLAGS=-mod=readonly go run golang.org/x/vuln/cmd/govulncheck@latest ./...
```

Host `go version` was go1.23.1. The tool module `golang.org/x/vuln@v1.9.0` required Go ≥ 1.26, so the runner downloaded a toolchain (go1.26.10) into the module cache and used that. Exit status 3, which is govulncheck’s “vulnerabilities found” code.

**Your code is affected by 3 vulnerabilities from 2 modules.** The scanner also reported 2 vulnerabilities in imported packages and 21 in required modules that this module’s call graph does not reach. Those were not expanded (`-show verbose` was not used).

| ID | Module | Found | Fixed | What the scanner traced |
|---|---|---|---|---|
| [GO-2026-6629](https://pkg.go.dev/vuln/GO-2026-6629) | `golang.org/x/text@v0.21.0` | v0.21.0 | v0.41.0 | Panic on crafted input in `x/text/secure/precis`. Trace: `internal/db/pool.go:32` `db.NewPool` → `pgxpool.NewWithConfig` → `precis.Profile.Bytes`. |
| [GO-2026-5970](https://pkg.go.dev/vuln/GO-2026-5970) | `golang.org/x/text@v0.21.0` | v0.21.0 | v0.39.0 | Infinite loop on invalid input in `x/text` normalization. Same pool-setup trace, into `norm.Form.Properties`, `Span`, and `Transform`. |
| [GO-2026-5004](https://pkg.go.dev/vuln/GO-2026-5004) | `github.com/jackc/pgx/v5@v5.7.2` | v5.7.2 | v5.9.2 | SQL injection via placeholder confusion with dollar-quoted string literals, inside `sanitize.SanitizeSQL`. Trace: `internal/settlement/batch.go:482` `RunDailyBatch` → `pgxpool.Pool.Query`. |

The traced query at `batch.go:482` is a fixed statement:

```sql
SELECT id FROM merchants WHERE status = 'active' AND test_mode = false ORDER BY id
```

It has no placeholders and no concatenated input. govulncheck still marks `Pool.Query` as reaching the vulnerable sanitizer. This one call site does not pass attacker-controlled SQL. The x/text findings are on the pool constructor’s call graph (connection setup), not on a checkout field. Both modules are still the versions in `apps/settlement/go.mod` (`pgx/v5 v5.7.2`, `golang.org/x/text v0.21.0`).

## Repeat

From a clean checkout, with network access for the advisory databases:

```text
cd fils-pay
npm audit --omit=dev
npm audit

cd apps/settlement
GOFLAGS=-mod=readonly go run golang.org/x/vuln/cmd/govulncheck@latest ./...
```

Advisory contents move when the npm and Go vuln databases move. The versions above are the ones those commands resolved on 30 October 2026.
