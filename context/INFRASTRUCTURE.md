# Infrastructure, Docker & Environment Configuration — FilsPay

> **Scope:** Docker Compose topology, service specifications, container definitions, environment variable catalog, resource limits, and developer tooling.

---

## 1. Local Infrastructure Topology (`ops/docker-compose.yml`)

The platform's local runtime architecture is orchestrated using Docker Compose. All backend services and the database communicate over an isolated bridge network:

```text
+---------------------------------------------------------------------------------+
|                              Docker Network (ops)                               |
|                                                                                 |
|  +---------------------+        +--------------------+                          |
|  | postgres:16-alpine  |<-------|      migrate       | (one-off schema runner)  |
|  | Port 5432           |        +--------------------+                          |
|  | filspay_pgdata      |<-------|        seed        | (profile 'seed', opt-in) |
|  +----------^----------+        +--------------------+                          |
|             |                                                                   |
|             |                   +--------------------+                          |
|             +-------------------|     settlement     | (Go daemon, port 8091)   |
|             |                   +----------^---------+                          |
|             |                              | (internal HTTP RPC)                |
|             +-------------------|         api        | (Fastify gateway)        |
|             |                   +----------+---------+                          |
|             |                              |                                    |
|             +-------------------|     reporting      | (Outbox worker)          |
|                                 +--------------------+                          |
+--------------------------------------------|------------------------------------+
                                             | Port 3000
                                             v
                           +-----------------------------------+
                           |     Host Machine (Vite Proxy)     |
                           |  node ops/preview.mjs             |
                           |  - apps/web   (:5173 -> :3000)    |
                           |  - apps/admin (:5174 -> :3000)    |
                           +-----------------------------------+
```

### Service Specifications
1. **`postgres`:**
   - Image: `postgres:16-alpine`.
   - Host Port: `127.0.0.1:${FILSPAY_POSTGRES_PORT:-5432}:5432`.
   - Healthcheck: `pg_isready -U filspay -d filspay` (interval: 2s, retries: 20).
   - Volume: `filspay_pgdata`.
2. **`migrate`:**
   - Dockerfile: `ops/Dockerfile.node`.
   - Command: `npm run migrate`.
   - Blocks downstream services until completed successfully.
3. **`seed` (Profile: `seed`):**
   - Command: `npm run seed`.
   - Requires explicit `--profile seed` and `ALLOW_DESTRUCTIVE_SEED=1`.
4. **`api`:**
   - Dockerfile: `ops/Dockerfile.node`.
   - Command: `node --import tsx apps/api/src/index.ts`.
   - Host Port: `127.0.0.1:${FILSPAY_API_PORT:-3000}:3000`.
5. **`settlement`:**
   - Dockerfile: `ops/Dockerfile.go`.
   - Command: `./settlement daemon`.
   - Internal Port: 8091 (internal network only, not exposed to host).
6. **`reporting`:**
   - Dockerfile: `ops/Dockerfile.node`.
   - Command: `node --import tsx apps/reporting/src/index.ts worker`.

---

## 2. Environment Variables Catalog

All environment variables used across services, their consumers, defaults, and security constraints:

| Variable | Consumed By | Default / Fallback | Purpose & Invariants |
|---|---|---|---|
| `DATABASE_URL` | All services | — | PostgreSQL connection URI (e.g. `postgres://user:pass@host:5432/filspay`). **Required.** |
| `PGCONN_SETTLEMENT` | `apps/settlement` | Unset | Optional override connection string for Go settlement worker. *(Note BUG-080: precedence bug).* |
| `PORT` | `apps/api` | `3000` | Port Fastify binds to inside the container. |
| `FILSPAY_API_PORT` | `docker-compose` | `3000` | Host port mapped to API container. |
| `FILSPAY_POSTGRES_PORT` | `docker-compose` | `5432` | Host port mapped to PostgreSQL container. |
| `NODE_ENV` | All TS services | `development` | `development`, `test`, or `production`. Governs strict token and secret checks. |
| `SETTLEMENT_INTERNAL_TOKEN` | `api`, `settlement` | `dev-token` (dev) | Shared bearer token authenticating Fastify calls to settlement `:8091`. **Required in production.** |
| `SETTLEMENT_INTERNAL_URL` | `apps/api` | `http://settlement:8091` | Base URL of settlement internal RPC server. |
| `WEBHOOK_SECRET_ENCRYPTION_KEY` | `apps/api` | Dev fallback | Base64-encoded **32 raw bytes** (AES-256-GCM key) used to encrypt webhook endpoint secrets. |
| `ACQUIRER_CALLBACK_SIGNING_SECRET` | `apps/api` | — | Platform secret used to verify incoming acquirer HMAC signatures. **Required in production.** |
| `ACQUIRER_CALLBACK_REQUIRE_SIGNATURE` | `apps/api` | `false` (dev) | When `true`, rejects unsigned incoming callbacks with 401. Enforced true in production. |
| `FEATURE_REFUNDS` | `apps/api` | `false` | Enables `/v1/refunds` and `/v1/merchants/:id/refunds`. If false, returns `501 Not Implemented`. |
| `FEATURE_ASYNC_CLOSE` | `apps/settlement` | `0` | Settlement flag for asynchronous batch closure pipelines. |
| `ALLOW_DESTRUCTIVE_SEED` | `db/seed/index.ts`| `0` | Must equal `1` to allow truncation and seeding of fixture tables. |
| `CHECKOUT_BASE_URL` | `apps/api` | `http://localhost:5173` | Host URL used when constructing payment link redirect URLs. |
| `KYC_UPLOAD_DIR` | `apps/api` | `./data/kyc` | Local filesystem path where merchant verification documents are written. |
| `SHARP_CACHE` | `apps/api` | `1` | Controls sharp thumbnail caching. Set to `0` to prevent OOM in low-memory containers. |

*Never commit `.env` files containing production secrets to version control.*

---

## 3. Developer Workflows & Commands

### 1. Generating Local Environment
Run once to create an ignored `ops/.env.docker` containing cryptographically secure random keys:
```bash
node ops/setup-env.mjs
```

### 2. Starting Infrastructure Stack
Builds and starts PostgreSQL, runs migrations, boots the API, settlement daemon, and reporting worker:
```bash
docker compose -f ops/docker-compose.yml up --build -d
```

### 3. Running Frontends (Preview Proxy)
Starts Vite development servers on the host with reverse proxies to the Dockerized API:
```bash
node ops/preview.mjs
# Web portal:   http://localhost:5173/dashboard/login
# Admin console: http://localhost:5174/login
```

### 4. Viewing Logs
```bash
docker compose -f ops/docker-compose.yml logs -f api settlement reporting
```

---

## 4. Resource Sizing & Production Constraints

- **API Memory Limits:** The API container is sized for 0.5 vCPU and 512 MB memory. Image processing of large KYC documents can trigger out-of-memory kernel kills (`OOMKilled`). Ensure `SHARP_CACHE=0` is configured in production or increase the container limit.
- **Connection Pools:** Fastify manages a `pg.Pool` capped by default at 5 connections (`PG_POOL_MAX`). Settlement manages a separate `pgxpool`.
- **Database Permissions:** In development, all services share the `filspay` superuser role. Production environments use least-privilege roles per service.
