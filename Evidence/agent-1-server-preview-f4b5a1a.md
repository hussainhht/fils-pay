# Server preview update

- Baseline HEAD: f4b5a1af6eb8eeac3844b4dbdf6de7b7501ecf12.
- Environment: existing Ubuntu server at 68.183.82.221, Docker, nginx, PostgreSQL 16. Existing uncommitted local work was excluded.
- Checked running containers and database migration registry: 0085 was already applied. No migration, seed, database write, or service restart was performed.
- Built the committed source using ops/Dockerfile.production.node, including npm ci, npm run typecheck and both frontend builds; build passed. Tagged filspay-node:f4b5a1a and filspay-node:production; retained prior release image.
- Extracted frontend assets and switched /srv/filspay/current to /srv/filspay/releases/20261031-f4b5a1a. nginx -t and reload succeeded.
- External HTTP: /dashboard/login and /login returned 200, and each referenced JavaScript asset returned 200. /healthz returned 503, consistent with the previously inactive API. PostgreSQL container reports healthy; existing reporting and settlement remain running from prior images.
- Files changed locally: this report, context/INFRASTRUCTURE.md and context/CHANGELOG.md. Server: new release directory and image, current symlink and production image tag. Existing configuration and volumes preserved.
- No bug was investigated or fixed. Backend deployment, HTTPS, actual DB application query, authentication, payments, end-to-end flows, and automated workspace tests were not verified. The build typecheck passed. API activation requires an appropriate HTTPS origin and operational account setup; consult current configuration and deployment guidance. Production documentation's historical Resend prerequisite predates the latest login change.
