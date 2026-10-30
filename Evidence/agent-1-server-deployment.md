# Server deployment evidence

Date: 2026-10-30 (Asia/Bahrain). Baseline HEAD:
`1f88a47ee619e87728219ad531df4dc4e4cbad56`; initial worktree clean.

## Result

The compiled merchant and admin frontends are published at:

- `http://68.183.82.221/dashboard/login`
- `http://68.183.82.221/login`

**This is an HTTP frontend preview. The API and production sign-in are not
activated.** Existing production validation requires real Resend sender/API key;
neither was found in local deployment settings or the existing server application
configuration. Valid HTTPS and approved account provisioning are also needed
before production authentication can be accepted. The user selected the IP for
now. No OTP bypass, test-mode public backend, development OTP exposure or
TOTP-only account bootstrap was introduced.

PostgreSQL 16 and private reporting/settlement workers are running. The database
was initialized using all 79 existing migrations, with zero merchants/admins
and no seeded financial data. No real payment, refund, email or payout was sent.

## Authorization and environment

The user requested SSH deployment to `dilmune@68.183.82.221`, installed the
specified public key, and unlocked its private key locally through ssh-agent.
The private key/passphrase was not read into reports or sent to the server.
SSH host verification was retained. No git commit, stage, merge or push was run.

Server before deployment: Ubuntu 24.04.5 LTS, 1 vCPU, approximately 2 GiB RAM,
2 GiB swap, 44 GiB free disk, passwordless sudo for the deployment account.
No Docker, Node or nginx application runtime was installed. Existing system/
DigitalOcean provisioning services and `/opt/dilmune` files were preserved.
Existing firewall already allowed 22/80/443; no new public port was opened.

Installed distribution packages: Docker 29.1.3, Compose 2.40.3, nginx 1.24.0.
These are host runtime dependencies, not new application npm/Go dependencies.

Release: `/srv/filspay/releases/20261030-1f88a47` (baseline plus uncommitted new
deployment templates). `/srv/filspay/current` points to that release. Production
images are additionally tagged `20261030-1f88a47` for identification/rollback;
Compose uses `filspay-node:production` and `filspay-settlement:production`.

## Changes and protection boundaries

- `ops/Dockerfile.production.node`: Node 22 locked install, typecheck, web/admin
  builds with same-origin API URLs and the public merchant origin for admin links.
- `ops/docker-compose.production.yml`: separate deployment stack, server-only env
  files, private PostgreSQL/settlement, explicit migration job, persistent data,
  restart policy and API binding restricted to loopback. No seed service.
- `ops/nginx.production.conf`: static SPA routes, real hashed asset resolution,
  API proxy, generic 503 when the API is unavailable, MIME/referrer headers.
  Both existing routers work without application/base-path changes.
- `ops/PRODUCTION.md`: complete server locations, activation requirements,
  maintenance/migration commands and rollback/backup limits. Also copied remotely.
- `ops/README.md`: points to the separate production runbook.
- Relevant infrastructure, ops, testing, known-limit and changelog context updated.

No payment/ledger/settlement logic, partner route, money package, migration file,
schema definition or application dependency changed. Existing migrations were
applied only to the new remote deployment database. No development database was
copied or modified and no destructive seed/truncation ran.

The source archive explicitly excluded `.env*`, dependencies, builds, logs,
local data, tests, Git, and unrelated evidence. Credential/private-key filename
checks found none in the uploaded archive. Configuration secrets were generated
on the server only, never copied from development or printed in commands/results.
They remain under root-only `/etc/filspay`, in mode-0600 files. Existing keys
are not overwritten by normal release changes.

## Database and network

PostgreSQL has no host-published port. Service access uses separate API,
reporting and settlement non-superuser roles; migration uses the bootstrap owner.
The API role has application DML privileges, no schema creation permission and
no `schema_migrations` privilege. Reporting has projection/cursor writes and
UPDATE privilege on outbox because its existing SHARE lock requires it.
Settlement grants cover the existing batch, export, ledger, cache and outbox
paths. These operational grants must be reviewed when future migrations add tables.

Verified API role check returned:

```json
{"current_user":"filspay_api","can_create_schema":false,"is_superuser":false}
```

Only SSH and nginx port 80 were newly relevant public listeners. PostgreSQL and
settlement 8091 remain inside Docker networking. API, when activated, binds only
`127.0.0.1:3000`. Current API/health requests receive generic 503 JSON from nginx.
The previous nginx default-enabled link is retained in `/etc/filspay` for recovery.

## Commands and actual outcomes

| Check/action | Actual outcome |
| --- | --- |
| SSH with unlocked accepted key | Connected as `dilmune`; sudo works. |
| Distribution runtime install; service enable/start | Docker/Compose/nginx installed and enabled successfully. |
| Sanitized source package/upload | Successful, approximately 3 MB; no local env/keys/data uploaded. |
| Production Node image `npm ci`, source typecheck, Vite web/admin builds | Passed on server. Test files intentionally excluded from deployment source. |
| Local full `npm.cmd run typecheck` | Passed including all workspace, DB and script TypeScript. |
| Existing Go settlement Dockerfile build | Passed; no Go source changes. |
| Production Compose `config --quiet` | Passed. |
| Fresh Postgres startup and migration job | Healthy PostgreSQL 16; 79 applied, zero previously applied. |
| Service role setup | Transaction committed, separate non-superuser roles created; no passwords output. |
| Reporting and settlement `up -d` | Both stay running. Reporting initializes its cursor; settlement logs internal listener on 8091 and processes zero merchants on empty data. |
| nginx configuration test and reload | Passed. Initial unprivileged release-link creation failed safely; succeeded with sudo. |
| Public merchant/admin/deep routes | 200 for `/dashboard/login`, `/login`, `/dashboard/transactions`, `/merchants`. |
| Public compiled assets | Both applications' JS return 200 `application/javascript`; both CSS return 200 `text/css`. |
| Public missing asset | `/assets/missing.js` returns 404, not HTML fallback. |
| Public health/API before activation | `/healthz` and `/v1/auth/me` return intended 503. |
| One-off API-role DB query | Connected; non-superuser/no schema CREATE verified. |
| One-off production config validation | Correctly blocked: `resend requires OTP_EMAIL_FROM (single email address) and OTP_RESEND_API_KEY`. |
| Application tests/financial flows on remote | Not run; no provider, account or payment fixture introduced on public server. Prior local audit results are separate evidence. |

When piping multi-command scripts through SSH, the first interactive Compose
`run` consumed the remaining stdin. Its migrations completed, verified by DB
query; role provisioning was then executed separately and confirmed. Operational
runbook commands redirect migration stdin to `/dev/null` to avoid recurrence.

Build/install/migration logs are retained under `/home/dilmune/logs/filspay-*.log`;
these commands did not dump runtime environments or credential values.

## Remaining work and verification limits

1. Configure the verified Resend sender/API key securely in `/etc/filspay/api.env`.
   The public backend is deliberately off until configuration is valid.
2. Provide a domain/valid HTTPS, preserve secure cookies, and set the public
   checkout/admin-link origins correctly before using authenticated functions.
3. Provision initial accounts through an approved process; none were seeded.
   Verify both OTP login planes and tenant/role separation with authorized users.
4. Start the API and verify actual `/healthz`, `/readyz`, DB-backed calls and
   application journeys. The current 503 responses are **not** API readiness.
5. Configure off-host encrypted backup/restore, operational alerts, production
   provider acceptance and any tighter service-role grants needed for future scope.
6. Browser automation was unavailable in this session; HTTP, MIME/assets, builds,
   DB/config and private worker checks were performed instead. No TLS certificate,
   real email delivery, real payment-provider integration or production financial
   acceptance was verified.

No product-code bug status changes are claimed by this deployment workstream;
all seven registry statuses have zero newly classified issues here. Missing
deployment credentials/HTTPS are explicit activation blockers, not silently
reclassified code defects. This report does not claim a complete production app.
