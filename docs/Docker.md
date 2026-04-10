# Docker — Container Setup

This document covers the full Docker implementation: what every file does, why each decision was made, and how all the pieces work together.

---

## Table of contents

1. [Overview](#1-overview)
2. [File structure](#2-file-structure)
3. [The base + override compose strategy](#3-the-base--override-compose-strategy)
4. [docker-compose.yml — shared base](#4-docker-composeyml--shared-base)
5. [docker-compose.dev.yml — development overrides](#5-docker-composedevyml--development-overrides)
6. [docker-compose.prod.yml — production overrides](#6-docker-composeprodyml--production-overrides)
7. [Dockerfile.dev](#7-dockerfiledev)
8. [Dockerfile.prod — multi-stage build](#8-dockerfileprod--multi-stage-build)
9. [Shell scripts](#9-shell-scripts)
10. [Boot sequence](#10-boot-sequence)
11. [Redis in Docker](#11-redis-in-docker)
12. [Environment variables and .env files](#12-environment-variables-and-env-files)
13. [.dockerignore](#13-dockerignore)
14. [Design decisions](#14-design-decisions)
15. [How to run](#15-how-to-run)
16. [Future improvements](#16-future-improvements)

---

## 1. Overview

The Docker setup does three things automatically every time a container starts:

1. Waits for PostgreSQL to be truly ready to accept queries
2. Runs any pending database migrations
3. Starts the Fastify API

There are two environments, **dev** (hot reload, source mounted as a volume) and **prod** (compiled TypeScript, multi-stage build). Each has its own Dockerfile and compose override file layered on top of a shared base.

---

## 2. File structure

```
task-api/
├── docker/
│   ├── wait-for-pg.sh           # polls pg_isready until Postgres accepts connections
│   └── entrypoint.sh            # orchestrates: wait → migrate → start
├── redis/
│   └── acl.conf                 # Redis ACL — prod user, restricted commands
├── Dockerfile.dev               # dev image — hot reload via tsx watch
├── Dockerfile.prod              # prod image — multi-stage, compiled output only
├── docker-compose.yml           # base — shared postgres + redis config
├── docker-compose.dev.yml       # dev overrides — hot reload, NODE_ENV=development
├── docker-compose.prod.yml      # prod overrides — compiled image, NODE_ENV=production
└── .dockerignore                # keeps node_modules, secrets, dist out of images
```

---

## 3. The base + override compose strategy

Three compose files work together via Docker's merge behaviour:

```
docker-compose.yml          ← foundation: postgres, redis, shared api config
      ↓  merged with
docker-compose.dev.yml      ← adds: Dockerfile.dev, volume mounts, NODE_ENV=development
      ↓  or merged with
docker-compose.prod.yml     ← adds: Dockerfile.prod, restart: always, NODE_ENV=production
```

Docker merges files left-to-right when you pass multiple `-f` flags. Keys in the right file override keys in the left file. List values (like `volumes`) are appended.

**Why a base file and not just two separate files?**

The postgres and redis service configurations, image, environment, healthcheck, volumes — are identical in dev and prod. Without a base file they would be duplicated in both `docker-compose.dev.yml` and `docker-compose.prod.yml`. Every change to a healthcheck interval, a postgres version, or a redis config path would need to happen in two places. The base file defines shared config once and both environments inherit it automatically.

**The base file is intentionally incomplete.** The `api` service has no `build` instruction and no `NODE_ENV`. It is never run alone, it always needs an override file:

```bash
# This is wrong — api service has no build target
docker compose -f docker-compose.yml up

# These are correct
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build
```

---

## 4. docker-compose.yml — shared base

```yaml
services:

  postgres:
    image: postgres:15-alpine
    container_name: task_api_postgres
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s

  redis:
    image: redis:7-alpine
    container_name: task_api_redis
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

  api:
    container_name: task_api_app
    env_file:
      - .env
    environment:
      POSTGRES_HOST: postgres
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
    ports:
      - "${PORT:-3000}:3000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

volumes:
  postgres_data:
```

**Healthcheck parameters explained:**

| Parameter | Value | Meaning |
|---|---|---|
| `interval` | 5s | Check every 5 seconds |
| `timeout` | 5s | Each check has 5 seconds to respond |
| `retries` | 10 | Fail after 10 consecutive failures (50s total) |
| `start_period` | 10s | Give Postgres 10s to initialise before counting failures |

`start_period` is critical — without it, if Postgres takes 8 seconds to boot (first run, data directory initialisation), all checks in that window count against the retry limit and the healthcheck fails before Postgres is actually broken.

**`depends_on` with `condition: service_healthy`:**

Plain `depends_on` only waits for the container to start. `service_healthy` waits for the healthcheck to pass — meaning Postgres is actually ready to accept queries, and Redis is actually responding to `PING`. The api container will not start until both pass. `wait-for-pg.sh` is a second layer of protection on top of this (see [section 9](#9-shell-scripts)).

**`env_file` vs `environment`:**

`env_file` loads all variables from `.env` — `JWT_SECRET`, `PORT`, `POSTGRES_USER`, etc. The `environment` block then overrides specific values. `DATABASE_URL` is overridden to use the `postgres` service hostname instead of `localhost`, because inside the Docker network containers reach each other by service name, not by `localhost`. `environment` always wins over `env_file` when the same key appears in both.

---

## 5. docker-compose.dev.yml — development overrides

```yaml
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile.dev
    restart: unless-stopped
    environment:
      NODE_ENV: development
    volumes:
      - .:/app
      - /app/node_modules
```

**The two volume mounts:**

```yaml
- .:/app              # mounts host source code into /app — tsx watch sees live changes
- /app/node_modules   # anonymous volume — protects the container's node_modules
```

Without the second line, the host's `node_modules` (built for macOS or Windows) overwrites the container's `node_modules` (built for Linux). This breaks any package that compiles native binaries. The anonymous volume tells Docker to keep the container's own copy at `/app/node_modules` without exposing it to the host, the host's `node_modules` physically cannot mount there.

**`restart: unless-stopped`:** restarts automatically if the container crashes, but respects a deliberate `docker compose down`. In development you want the server to come back if it crashes on a bad code change, but you don't want containers fighting you when you manually stop them.

---

## 6. docker-compose.prod.yml — production overrides

```yaml
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile.prod
    restart: always
    environment:
      NODE_ENV: production

  redis:
    volumes:
      - ./redis/acl.conf:/etc/redis/acl.conf
    command: redis-server --aclfile /etc/redis/acl.conf
```

**No volume mounts for the api service:** source code is baked into the image during the multi-stage build. Mounting volumes would override the compiled `dist/`, defeating the entire purpose of the build.

**`restart: always`:** unlike `unless-stopped`, `always` restarts under every circumstance including server reboots. In production the app must come back without manual intervention.

**Redis ACL in production:** the base compose file runs Redis with no authentication (fine for development). The prod override mounts `redis/acl.conf` into the container and passes it to `redis-server` via `command`. This disables the default user and restricts the `taskapi` user to exactly the commands the app needs.

**Differences at a glance:**

| | Dev | Prod |
|---|---|---|
| Dockerfile | `Dockerfile.dev` | `Dockerfile.prod` |
| `NODE_ENV` | `development` | `production` |
| `restart` | `unless-stopped` | `always` |
| Source volumes | Yes — hot reload | No — compiled into image |
| Redis auth | None | ACL file with restricted user |

---

## 7. Dockerfile.dev

```dockerfile
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache postgresql-client

COPY package*.json ./
RUN npm ci

COPY docker/wait-for-pg.sh /usr/local/bin/wait-for-pg
COPY docker/entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/wait-for-pg /usr/local/bin/entrypoint

COPY . .

ENTRYPOINT ["entrypoint"]
CMD ["npm", "run", "dev"]
```

**Layer order is intentional for build caching:**

`package*.json` and `npm ci` come before `COPY . .`. Docker rebuilds layers from the first changed layer downward. If you change source code but not `package.json`, Docker reuses the cached `npm ci` layer and only rebuilds the `COPY . .` layer. Installing dependencies only runs when `package.json` or `package-lock.json` actually changes.

**Why `postgresql-client`:** `wait-for-pg.sh` uses `pg_isready` to check whether Postgres is accepting queries. `pg_isready` is not in the base `node:20-alpine` image, it comes from `postgresql-client`, installed via `apk`.

**Why scripts go to `/usr/local/bin/`:** this is where system-wide executables live on Linux. Copying scripts there means they can be called by name (`wait-for-pg`, `entrypoint`) without a path prefix.

**Why `COPY . .` is here even though docker-compose mounts the volume:** the `COPY . .` makes the image self-contained if someone runs it without docker-compose. In normal dev usage, the volume mount from `docker-compose.dev.yml` takes over and overlays the image's `/app` with the host directory.

---

## 8. Dockerfile.prod — multi-stage build

```dockerfile
# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN cp -r src/db/migrations dist/db/migrations

# ── Stage 2: prod ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS prod

WORKDIR /app

RUN apk add --no-cache postgresql-client

COPY package*.json ./
RUN npm ci --omit=dev

COPY docker/wait-for-pg.sh /usr/local/bin/wait-for-pg
COPY docker/entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/wait-for-pg /usr/local/bin/entrypoint

COPY --from=builder /app/dist ./dist

ENTRYPOINT ["entrypoint"]
CMD ["node", "dist/index.js"]
```

**Why two stages:**

The builder stage needs the TypeScript compiler, `tsx`, `ts-node`, and all devDependencies to compile the code. None of that belongs in a production image, it adds size, attack surface, and noise.

Stage 2 starts from a fresh `node:20-alpine`. It only copies `dist/` from the builder via `COPY --from=builder`. The builder stage is completely discarded. The final image contains:

- Node.js runtime
- Production `npm` dependencies only (`--omit=dev`)
- Compiled JavaScript in `dist/`
- The two shell scripts

It does not contain: TypeScript source files, the TypeScript compiler, devDependencies, `node_modules/.bin/tsx`, or any build tooling.

**Why `cp -r src/db/migrations dist/db/migrations`:**

The migration runner reads `.sql` files at runtime. TypeScript compilation only processes `.ts` files — the `.sql` migration files in `src/db/migrations/` are not copied to `dist/` automatically. This line copies them explicitly so they are available at `dist/db/migrations/` when the production entrypoint runs `node dist/db/migrate.js`.

**Why `--omit=dev` and not `--only=prod`:**

`--only=prod` is deprecated as of npm v7. `--omit=dev` is the current equivalent. Since this project targets Node.js 20 (npm v10), `--omit=dev` is correct.

**Why `node:20-alpine` and not distroless:**

Distroless images (e.g. `gcr.io/distroless/nodejs20-debian12`) contain only the Node.js runtime with no shell, no `apk`, and no utilities. This is ideal for security, a smaller attack surface with no shell to exploit. However, `entrypoint.sh` is a shell script and requires `sh`. `wait-for-pg.sh` requires `pg_isready`. Neither exists in distroless.

The alternative would be rewriting `entrypoint.sh` as a TypeScript file — a `prestart.ts` that programmatically polls Postgres and runs migrations before starting the server. That is doable and is listed as a future improvement. For now, `node:20-alpine` gives a small image (~50MB) with the shell access the scripts need.

---

## 9. Shell scripts

### `docker/wait-for-pg.sh`

```sh
#!/bin/sh
HOST="${POSTGRES_HOST:-postgres}"
USER="${POSTGRES_USER:-postgres}"
MAX_TRIES=30
WAIT_SECONDS=2

echo "Waiting for PostgreSQL at $HOST..."

i=0
until pg_isready -h "$HOST" -U "$USER" -q; do
  i=$((i + 1))
  if [ "$i" -ge "$MAX_TRIES" ]; then
    echo "PostgreSQL not ready after $((MAX_TRIES * WAIT_SECONDS))s. Aborting."
    exit 1
  fi
  echo "attempt $i/$MAX_TRIES — retrying in ${WAIT_SECONDS}s"
  sleep "$WAIT_SECONDS"
done

echo "PostgreSQL is ready."
```

`MAX_TRIES=30` × `WAIT_SECONDS=2` gives Postgres 60 seconds. The `-q` flag suppresses `pg_isready`'s own output so all terminal output is controlled by the script.

**Why `pg_isready` and not `nc` (netcat):** Postgres opens its TCP port before it is ready to execute queries. `nc -z host 5432` returns success the moment the port is open, which can be seconds before Postgres has finished recovering from a crash or loading its data directory. `pg_isready` performs a real connection-level check that only returns success when Postgres is ready to accept queries. This is what you actually need before running migrations.

### `docker/entrypoint.sh`

```sh
#!/bin/sh
set -e

wait-for-pg

echo "Running migrations..."

if [ "$NODE_ENV" = "production" ]; then
  node dist/db/migrate.js
else
  npx tsx src/db/migrate.ts
fi

echo "Migrations completed"
echo "Starting application..."
exec "$@"
```

**`set -e`:** the script exits immediately if any command returns a non-zero exit code. If migrations crash, the container stops and you see the error. Without `set -e`, a migration failure would be logged and the server would start in a broken state with an incomplete schema.

**Why the migration command differs by environment:** in dev, TypeScript hasn't been compiled, the source lives in `src/`. `tsx` can run it directly. In prod, `dist/` was produced by the multi-stage build, `node` runs the compiled output.

**Why `exec "$@"`:** without `exec`, the shell stays as the parent process (PID 1) and Node.js runs as a child. When Docker sends `SIGTERM` (on `docker compose down`), it goes to the shell, not to Node.js. Node.js never receives the signal and shuts down ungracefully, potentially losing in-flight requests or leaving connections open.

`exec "$@"` replaces the shell process entirely with whatever command was passed as `CMD`. Docker's signals go directly to Node.js, which handles them cleanly.

---

## 10. Boot sequence

```
docker compose up
  │
  ├── postgres container starts
  │     └── healthcheck: pg_isready runs every 5s
  │           └── passes after Postgres is ready
  │
  ├── redis container starts
  │     └── healthcheck: redis-cli ping runs every 5s
  │           └── passes when Redis responds PONG
  │
  └── api container starts (only after both pass)
        └── entrypoint.sh runs
              │
              ├── wait-for-pg.sh
              │     └── pg_isready polls until Postgres accepts queries
              │           (second layer — Docker healthcheck already passed,
              │            but this guards against race conditions)
              │
              ├── migration runner
              │     ├── dev:  npx tsx src/db/migrate.ts
              │     └── prod: node dist/db/migrate.js
              │           └── reads _migrations table, runs new .sql files only
              │
              └── exec CMD
                    ├── dev:  npm run dev  (tsx watch src/index.ts)
                    └── prod: node dist/index.js
                          └── checkDbConnection()
                              checkRedisConnection()
                              app.listen()
```

The double Postgres check (Docker healthcheck + `wait-for-pg.sh`) is intentional. The healthcheck guarantees the container won't start at all if Postgres is unavailable. `wait-for-pg.sh` guards against a race condition where the healthcheck passed but Postgres briefly became unavailable in the window between the healthcheck and the migration script running.

---

## 11. Redis in Docker

Redis is defined in the base compose file and runs in both environments. Dev uses no authentication. Prod mounts the ACL file.

**Dev:**

```yaml
redis:
  image: redis:7-alpine
  container_name: task_api_redis
  ports:
    - "6379:6379"
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 5s
    timeout: 5s
    retries: 5
```

**Prod (additional config from `docker-compose.prod.yml`):**

```yaml
redis:
  volumes:
    - ./redis/acl.conf:/etc/redis/acl.conf
  command: redis-server --aclfile /etc/redis/acl.conf
```

The `command` override replaces the default `redis-server` command with one that loads the ACL file. Without this, the ACL file is mounted but never read.

**The ACL comment bug:** Redis ACL files do not support `#` comments, every line must start with the `user` keyword. A comment on line 1 causes Redis to abort startup with `ACL errors: should start with user keyword`. This only appears in production (where the ACL file is mounted) and not in development. See [`docs/Redis.md`](Redis.md) for the full ACL explanation.

---

## 12. Environment variables and .env files

**`.env`** — local development, gitignored, never committed:

```dotenv
PORT=3000
HOST=0.0.0.0
JWT_SECRET=your-long-random-secret-here-at-least-32-chars

POSTGRES_USER=postgres-user
POSTGRES_PASSWORD=postgres-password
POSTGRES_DB=your-postgres-db
DATABASE_URL=postgres://postgres-user:postgres-password@localhost:5432/your-postgres-db

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_USERNAME=
REDIS_PASSWORD=
```

**`.env.production`** — production values, also gitignored, different values:

```dotenv
# ...same structure but with real credentials...
REDIS_USERNAME=redis-user
REDIS_PASSWORD=your-strong-password
```

**`.env.test`** — test environment, also gitignored:

```dotenv
DATABASE_URL=postgres://postgres:postgres@localhost:5432/task_api_test
JWT_SECRET=test-jwt-secret-that-is-long-enough-for-validation
PORT=3001
HOST=0.0.0.0
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_USERNAME=
REDIS_PASSWORD=
```

**Why `DATABASE_URL` uses `localhost` in `.env` but `postgres` in Docker:**

When running locally (`npm run dev`), the API connects to Postgres at `localhost:5432`. When running in Docker, containers communicate over an internal network and reach each other by service name, `localhost` from inside the API container points to the API container itself, not to Postgres. Docker Compose overrides `DATABASE_URL` in the `environment` block to use `postgres` (the service name) as the hostname.

---

## 13. .dockerignore

```
node_modules/
.env
.env.*
!.env.example
dist/
*.log
.git/
.gitignore
Dockerfile*
docker-compose*.yml
docker/
.DS_Store
```

**`node_modules/`:** if it is copied into the build context, it overwrites the container's own `node_modules` built by `npm ci` inside the Dockerfile, which was built for the container's OS (Linux), not the host OS (macOS or Windows). This causes silent failures with native packages.

**`.env` and `.env.*`:** if these leak into an image pushed to a registry, your `JWT_SECRET` and database password are publicly exposed. The `!.env.example` negation un-ignores `.env.example` from the `.env.*` pattern, it contains no real secrets and is safe to include.

**`dist/`:** the prod Dockerfile compiles its own output during the build stage. Including a pre-existing `dist/` from the host would pollute the build context with potentially stale compiled files.

**`docker/`:** the shell scripts are already copied explicitly to `/usr/local/bin/` in the Dockerfiles. There is no need for them to also exist at `/app/docker/` inside the container.

---

## 14. Design decisions

**Why separate Dockerfiles instead of one with multiple targets**

A single `Dockerfile` with `AS dev` and `AS prod` targets is common. Two separate files (`Dockerfile.dev` and `Dockerfile.prod`) are more explicit, each file is self-contained and readable without needing to know about `--target` flags. The intent is clear from the compose file that references `dockerfile: Dockerfile.dev` or `dockerfile: Dockerfile.prod`.

**Why the anonymous volume for `node_modules` in dev**

The host's `node_modules` was installed for the host OS. The container's `node_modules` was installed for Linux inside the container. Mounting `.:app` without protecting `node_modules` causes the host's version to overwrite the container's version. The anonymous volume at `/app/node_modules` pins the container's copy in place — the host mount cannot reach it.

**Why `NODE_ENV` is set in compose files and not `.env`**

`NODE_ENV` describes what kind of environment the app is running in, it is not a secret and it is not developer-specific. Setting it in `.env` means every developer must remember to change it for production. Setting it in the compose file makes the environment definition part of the infrastructure configuration, where it belongs, and it cannot be accidentally wrong.

**Why no Adminer**

Adminer is a web-based database UI that teams often include for zero-setup database browsing. For a solo project, connecting an existing tool (TablePlus, pgAdmin, DBeaver, or `psql`) directly to `localhost:5432` is simpler and adds no container overhead.

---

## 15. How to run

```bash
# Copy env template
cp .env.example .env
# Fill in JWT_SECRET (must be 32+ chars) and any other values

# Development — hot reload, source mounted as volume
npm run docker:dev

# Production — compiled image
npm run docker:prod

# Stop containers (data preserved in volumes)
npm run docker:down

# Stop and wipe all data (start completely fresh)
docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v
```

The npm scripts are shortcuts for the full `-f` flag syntax:

```json
"docker:dev":  "docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build",
"docker:prod": "docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production up --build",
"docker:down": "docker compose -f docker-compose.yml -f docker-compose.dev.yml down"
```

---

## 16. Future improvements

**Distroless production image**

Replace `node:20-alpine` with `gcr.io/distroless/nodejs20-debian12` in `Dockerfile.prod`. Distroless images contain only the Node.js runtime — no shell, no package manager, no utilities. This reduces the attack surface significantly. The blocker is `entrypoint.sh` which requires a shell.

**`docker-compose.test.yml`**

A separate compose file for CI and local test runs: a clean test database, `NODE_ENV=test`, containers that exit when the test suite finishes. Completely isolated from dev and prod data:

```bash
docker compose -f docker-compose.yml -f docker-compose.test.yml up --abort-on-container-exit
```

**Redis persistence in production**

The current Redis setup is ephemeral, if the container restarts, all cached data is lost. This is fine since Redis is a cache (not a source of truth) and the TTL is 60 seconds anyway. For longer TTLs a Redis persistence configuration (`appendonly yes` or RDB snapshots) would prevent a cold cache after every restart.
