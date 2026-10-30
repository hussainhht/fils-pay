# Server deployment

The production templates are separate from the local development Compose stack.
They do not seed accounts, use public fixture credentials, or expose PostgreSQL.

## Current deployment (2026-10-30)

- Server: `dilmune@68.183.82.221`; SSH uses the owner's locally unlocked key.
- Merchant preview: `http://68.183.82.221/dashboard/login`.
- Admin preview: `http://68.183.82.221/login`.
- Release: `/srv/filspay/releases/20261030-1f88a47`.
- Active static release symlink: `/srv/filspay/current`.
- Compose project: `filspay`, file `ops/docker-compose.production.yml` in the release.
- nginx site: `/etc/nginx/sites-available/filspay`; previous default enabled link
  retained as `/etc/filspay/nginx-default.enabled`.
- Server-only configuration: `/etc/filspay/{database,migrate,api,reporting,settlement}.env`.
  The directory is root-only, and files have mode 0600. Never print or commit them.
- Database/worker containers are running. **The API is not activated** because
  production Resend configuration is missing; `/v1/*` and health routes return 503.
- This is an **HTTP frontend preview**, not a fully usable production payment app.
  No merchants, admins, fixture accounts, or financial data were seeded.

## Build and release layout

`Dockerfile.production.node` installs the locked dependencies, runs typecheck,
and builds both SPAs for same-origin API calls. Pass the public merchant origin
as the existing `VITE_WEB_BASE_URL` build argument so admin impersonation links
do not point at localhost. The current public IP preview uses the same origin
for both SPAs. nginx sends `/dashboard/*` and `/pay/*` to merchant assets, and
`/login`, `/merchants`, `/credits`, `/settlement`, `/adjustment-imports`, `/webhooks`
and `/security` to admin assets. Shared `/assets` paths resolve only real hashed
files; a missing asset returns 404, never SPA HTML.

Create a new release directory for updates. Package only application/build input
directories, excluding Git, credentials, `.env*`, local data, dependencies,
generated output and logs. Preserve remote configuration and Docker volumes.
Build images sequentially on this 1-vCPU/2-GiB server:

```sh
sudo docker build -f ops/Dockerfile.production.node \
  --build-arg VITE_WEB_BASE_URL=https://YOUR_PUBLIC_ORIGIN \
  -t filspay-node:production -t filspay-node:YOUR_RELEASE .
sudo docker build -f ops/Dockerfile.go \
  -t filspay-settlement:production -t filspay-settlement:YOUR_RELEASE .
```

Extract each SPA's `dist` from the built Node image into `public/web` and
`public/admin` in that release. Validate nginx, then switch the `current`
symlink to the new release and reload nginx. Keep the previous release/image
tags for rollback. Database rollback is a separate reviewed operation; never
remove a volume or run the destructive seed as a deployment shortcut.

## Finish API activation

1. Configure a domain and valid HTTPS at nginx before authenticated use.
   Keep `COOKIE_SECURE=true`, `NODE_ENV=production`, and `OTP_DEV_EXPOSE=false`.
2. Create/verify the email sender with Resend. Using `sudoedit /etc/filspay/api.env`
   on the server, add `OTP_EMAIL_FROM` and `OTP_RESEND_API_KEY`. Do not put a key
   in chat, a shell command, a URL, Git, or a deployment log.
3. Change `CHECKOUT_BASE_URL` in that file to the actual HTTPS merchant origin,
   rebuild admin assets with the same `VITE_WEB_BASE_URL`, and update nginx TLS.
4. Retain all existing encryption/signing/database secrets. Changing them breaks
   existing encrypted data or internal authentication. Do not enable disabled
   email/TOTP-only mode as an account bootstrap workaround.
5. Validate application configuration without printing environment values, then:

```sh
cd /srv/filspay/current
sudo docker compose -p filspay -f ops/docker-compose.production.yml up -d api
```

6. Check `/healthz`, `/readyz`, and an actual database query. Provision initial
   users through an approved onboarding/admin process; none were created by this
   deployment. Verify email OTP and tenant/admin separation with authorized test
   accounts before any financial journey. Never seed the public database.

Resend settings were not found in the local deployment environment or existing
server application configuration. Real provider delivery, production login,
browser journeys and external payment-provider integration remain unverified.

## Database and operations

PostgreSQL 16 has a persistent named volume and no published port. Migration
credentials use the bootstrap owner; API, reporting and settlement have separate
non-superuser roles. API has application DML privileges but no schema creation or
`schema_migrations` privilege. Reporting writes its projections/cursor and has
UPDATE privilege on outbox because its existing consumer requires a SHARE table
lock. Settlement grants cover the existing batch/ledger/cache paths. These are
operational grants, not new schema migrations; review grants when adding tables.

Apply only approved existing migrations, under backup/change procedures for any
database containing data:

```sh
sudo docker compose -p filspay -f ops/docker-compose.production.yml run --rm migrate </dev/null
```

The stdin redirect matters when executing through an SSH script. Preserve the
database volume, KYC volume and encryption-key backups together. An automated
off-host backup/restore schedule has not been configured by this deployment.

```sh
sudo docker compose -p filspay -f ops/docker-compose.production.yml ps
sudo docker compose -p filspay -f ops/docker-compose.production.yml logs --tail 50 reporting settlement
sudo nginx -t
```

Build/install/migration logs are under `/home/dilmune/logs/filspay-*.log`.
Do not log request bodies or dump container environments. Source containers are
only bound internally; API port 3000 is loopback-only when activated, and
settlement's authenticated 8091 endpoint is never publicly published.
