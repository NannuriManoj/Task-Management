# Docker Setup — Task Management API

This document covers everything about how Docker is implemented in this project — what files exist, why each decision was made, and how to run the project.

---

## Table of Contents

1. [Overview](#overview)
2. [File Structure](#file-structure)
3. [Design Decisions](#design-decisions)
4. [Dockerfile.dev](#dockerfiledev)
5. [Dockerfile.prod](#dockerfileprod)
6. [Shell Scripts](#shell-scripts)
7. [docker-compose.yml](#docker-composeyml)
8. [docker-compose.dev.yml](#docker-composedevyml)
9. [docker-compose.prod.yml](#docker-composeprodyml)
9. [.env.example](#envexample)
10. [.dockerignore](#dockerignore)
11. [How to Run](#how-to-run)
12. [Boot Sequence](#boot-sequence)
13. [Future Improvements](#future-improvements)

---

## Overview

The Docker setup for this project does three things automatically every time a container starts:

1. Waits for PostgreSQL to be truly ready
2. Runs any pending database migrations
3. Starts the Fastify API

There are two environments — **dev** (hot reload) and **prod** (compiled output). Each has its own Dockerfile and compose file.

---

## File Structure

```
task-api/
├── docker/
│   ├── wait-for-pg.sh           # polls postgres until ready to accept queries
│   └── entrypoint.sh            # orchestrates: wait → migrate → start
├── Dockerfile.dev               # dev image — hot reload with tsx watch
├── Dockerfile.prod              # prod image — multi-stage, compiled output
├── docker-compose.yml           # base — shared postgres config, volumes
├── docker-compose.dev.yml       # dev overrides — Dockerfile.dev, hot reload, NODE_ENV=development
├── docker-compose.prod.yml      # prod overrides — Dockerfile.prod, NODE_ENV=production
├── .env.example                 # safe template — commit this, not .env
└── .dockerignore                # keeps secrets and unnecessary files out of images
```

The two shell scripts live inside `docker/` to keep all Docker-related files grouped together. The Dockerfiles and compose files live at the project root — this is the standard convention that Docker tooling and most developers expect.

---

## Design Decisions

### Why `node:20-alpine` and not distroless?

Distroless images (e.g. `gcr.io/distroless/nodejs20-debian12`) are leaner and more secure — they contain only the Node.js runtime with no shell or utilities. However, our `entrypoint.sh` is a shell script and requires:

- `sh` to execute
- `pg_isready` to check if PostgreSQL is ready

Distroless has neither. Using it would require rewriting the entrypoint logic entirely in JavaScript/TypeScript — a `prestart.ts` that polls Postgres and runs migrations programmatically. That's doable but adds complexity that isn't justified for this project right now.

`node:20-alpine` gives us a small image (~50MB), a shell, and the ability to install `postgresql-client` for `pg_isready`. It's the right balance here.

> Distroless + JS entrypoint is a planned future improvement for production hardening.

---

### Why two separate Dockerfiles instead of one with multiple stages?

A single `Dockerfile` with `AS dev` and `AS prod` targets is common, but two separate files (`Dockerfile.dev` and `Dockerfile.prod`) are clearer for a learning project:

- Each file is self-contained and readable on its own
- No need to remember `--target` flags when building
- `docker-compose.yml` references `dockerfile: Dockerfile.dev` explicitly — the intent is obvious

---

### Why a multi-stage build in `Dockerfile.prod`?

The production image uses two stages:

```
Stage 1 — builder
  installs ALL deps (including devDeps)
  compiles TypeScript → dist/

Stage 2 — prod
  fresh node:20-alpine
  installs ONLY production deps
  copies ONLY dist/ from builder
```

The builder stage is completely discarded. The final image contains no TypeScript compiler, no `tsx`, no source code, and no devDependencies. This results in a smaller, cleaner, and more secure production image.

---

### Why `--omit=dev` and not `--only=prod`?

`--only=prod` is deprecated as of npm v7. The current equivalent is `--omit=dev`. Since this project runs on Node.js 20 (npm v10), `--omit=dev` is the correct flag.

---

### Why `postgresql-client` is installed in the image?

Our `wait-for-pg.sh` uses `pg_isready` — a PostgreSQL utility that checks whether the server is ready to accept queries. The base `node:20-alpine` image does not include it, so we install `postgresql-client` via `apk`.

The alternative is checking the port with `nc` (netcat), but PostgreSQL opens its port before it's fully ready to accept queries. `pg_isready` checks at the query level, which is what we actually need.

---

### Why `exec "$@"` in `entrypoint.sh`?

Without `exec`, the shell stays as the parent process and Node.js runs as a child. When Docker sends a `SIGTERM` signal (e.g. on `docker compose down`), it goes to the shell — not to Node. Node never receives it and shuts down ungracefully.

`exec "$@"` replaces the shell process entirely with Node. Docker's signals go directly to Node, which can handle them cleanly.

---

### Why `NODE_ENV` is set in `docker-compose.yml` and not `.env`?

`NODE_ENV` describes the environment the app is running in — it's not a secret or a developer-specific config value. Putting it in `.env` means every developer has to remember to change it when deploying to production, which is error-prone.

`docker-compose.yml` is the environment definition. Setting `NODE_ENV` there makes the intent explicit and impossible to accidentally override.

---

### Why no Adminer?

Adminer is a web-based database UI. It's useful in team projects where you want zero-setup DB browsing for every developer who clones the repo. For a solo project, connecting an existing tool (pgAdmin, TablePlus, DBeaver, or psql) to `localhost:5432` is simpler and adds no extra container overhead.

---

### Why the base + override approach for compose files?

We use three compose files:

```
docker-compose.yml          # base — shared config
docker-compose.dev.yml      # dev overrides
docker-compose.prod.yml     # prod overrides
```

The `postgres` service configuration — image, environment, healthcheck, volumes — is identical in both dev and prod. Without a base file, it would be duplicated in both `docker-compose.dev.yml` and `docker-compose.prod.yml`. Every time you change a healthcheck interval, a postgres version, or an environment variable, you'd have to change it in two places.

The base file defines shared config once. Both dev and prod inherit it. Change the postgres version in one place — both environments pick it up automatically.

Docker merges the files left to right when you pass multiple `-f` flags — each file overrides the one before it:

```
docker-compose.yml       # foundation
      ↓ overridden by
docker-compose.dev.yml   # dev adds build, volumes, NODE_ENV=development
```

The base file is intentionally incomplete — the `api` service has no `build` instruction. It is never meant to be run alone. It always needs an override file alongside it.

---

## Dockerfile.dev

```dockerfile
FROM node:20-alpine

WORKDIR /app

# pg_isready lives in postgresql-client — needed by wait-for-pg.sh
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

**Layer order is intentional for caching:**

`package*.json` and `npm ci` come before `COPY . .`. If you change source code but not `package.json`, Docker reuses the cached `npm ci` layer and skips reinstalling dependencies. Only the layers after the change are rebuilt.

**Scripts go to `/usr/local/bin/`:**

This is where system-wide executables live on Linux. Placing scripts here means they can be called by name (`wait-for-pg`, `entrypoint`) without specifying a path.

**`COPY . .` is overridden at runtime:**

In development, `docker-compose.yml` mounts the host project folder over `/app`. The `COPY . .` here makes the image self-contained if run without Docker Compose, but in normal dev usage the volume mount takes over.

---

## Dockerfile.prod

```dockerfile
# ── Stage 1: builder ──────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: prod ─────────────────────────────────────────
FROM node:20-alpine AS prod

WORKDIR /app

RUN apk add --no-cache postgresql-client

COPY package*.json ./
RUN npm ci --omit=dev

COPY docker/wait-for-pg.sh /usr/local/bin/wait-for-pg
COPY docker/entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/wait-for-pg /usr/local/bin/entrypoint

# Only the compiled output crosses from builder into prod
COPY --from=builder /app/dist ./dist

ENTRYPOINT ["entrypoint"]
CMD ["node", "dist/index.js"]
```

The `builder` stage installs everything and compiles TypeScript. The `prod` stage starts fresh — it only pulls `dist/` across via `COPY --from=builder`. Everything else in the builder stage (TypeScript, tsx, devDependencies, source files) is discarded.

---

## Shell Scripts

### `docker/wait-for-pg.sh`

```sh
#!/bin/sh
# Polls PostgreSQL until it's ready to accept connections.

HOST="${POSTGRES_HOST:-postgres}"
USER="${POSTGRES_USER:-postgres}"
MAX_TRIES=30
WAIT_SECONDS=2

echo "⏳  Waiting for PostgreSQL at $HOST..."

i=0
until pg_isready -h "$HOST" -U "$USER" -q; do
  i=$((i + 1))
  if [ "$i" -ge "$MAX_TRIES" ]; then
    echo "❌  PostgreSQL not ready after $((MAX_TRIES * WAIT_SECONDS))s. Aborting."
    exit 1
  fi
  echo "   attempt $i/$MAX_TRIES — retrying in ${WAIT_SECONDS}s"
  sleep "$WAIT_SECONDS"
done

echo "✅  PostgreSQL is ready."
```

`MAX_TRIES=30` × `WAIT_SECONDS=2` gives PostgreSQL 60 seconds to become ready before aborting. The `-q` flag keeps `pg_isready` silent so we control all output ourselves.

---

### `docker/entrypoint.sh`

```sh
#!/bin/sh
# Runs before the app on every container start.
# Order: wait for postgres → run migrations → start app

set -e

# 1. Wait for Postgres
wait-for-pg

# 2. Run migrations
echo "🗄️   Running migrations..."

if [ "$NODE_ENV" = "production" ]; then
  node dist/db/migrate.js
else
  npx tsx src/db/migrate.ts
fi

echo "✅  Migrations complete."

# 3. Hand off to CMD
echo "🚀  Starting application..."
exec "$@"
```

`set -e` means the script exits immediately if any command fails. If migrations crash, the container stops — you see the error and nothing starts in a broken state.

The migration command differs by environment because in dev, TypeScript hasn't been compiled yet so we run migrations directly from `src/` using `tsx`. In prod, `dist/` already exists from the build stage.

---



---

## docker-compose.yml

The **base file** — shared by both dev and prod. Never run alone.

```yml
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

volumes:
  postgres_data:
```

Notice the `api` service has no `build` instruction and no `NODE_ENV`. These are intentionally omitted — they differ between dev and prod and are provided by the override files.

**Health check parameters explained:**

| Parameter | Value | Meaning |
|---|---|---|
| `interval` | 5s | Check every 5 seconds |
| `timeout` | 5s | Each check has 5 seconds to respond |
| `retries` | 10 | Fail after 10 consecutive failures |
| `start_period` | 10s | Give Postgres 10s to boot before checks begin |

`start_period` prevents early failures from counting against the retry limit while Postgres is still initialising.

**`depends_on` with `condition: service_healthy`:**

Plain `depends_on` only waits for the container to start, not for Postgres to be ready. `condition: service_healthy` means the api container will not start until the postgres healthcheck passes. This is backed up by `wait-for-pg.sh` as a second layer of protection.

**`env_file` vs `environment`:**

`env_file` loads everything from `.env` — JWT_SECRET, PORT, POSTGRES_USER, etc. `environment` then overrides specific values. `DATABASE_URL` is overridden to use the `postgres` service hostname instead of `localhost`. `environment` always wins over `env_file` when the same variable appears in both.

---

## docker-compose.dev.yml

The **dev override** — layered on top of the base for development.

```yml
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

Only dev-specific things live here. Everything else — postgres service, ports, env_file, depends_on — is inherited from the base file.

**The two volume mounts:**

```yml
- .:/app              # mounts source code — tsx watch picks up live changes
- /app/node_modules   # anonymous volume — protects the container's node_modules
```

Without the second line, the host's `node_modules` (built for macOS or Windows) would overwrite the container's `node_modules` (built for Linux). This causes silent failures with packages that compile native binaries. The anonymous volume tells Docker to keep the container's own copy untouched.

**`restart: unless-stopped`:**

Restarts automatically on crashes but respects manual `docker compose down`. Fine for dev — you don't want containers fighting you when you deliberately stop them.

---

## docker-compose.prod.yml

The **prod override** — layered on top of the base for production.

```yml
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile.prod
    restart: always
    environment:
      NODE_ENV: production
```

Minimal by design — only what's different in production.

**No volume mounts:**

Source code is baked into the image during the build stage. Mounting volumes would override the compiled `dist/` — defeating the entire purpose of the multi-stage build.

**`restart: always`:**

Unlike `unless-stopped`, `always` restarts the container under every circumstance — including after a server reboot. In production you want the app to come back up automatically without manual intervention.

**Differences between dev and prod at a glance:**

| Thing | Dev | Prod |
|---|---|---|
| Dockerfile | `Dockerfile.dev` | `Dockerfile.prod` |
| `NODE_ENV` | `development` | `production` |
| `restart` | `unless-stopped` | `always` |
| Volume mounts | Yes — source + node_modules | None |

---

## .env.example

```bash
# Application
PORT=3000
HOST=0.0.0.0

# Auth — must be at least 32 characters
JWT_SECRET=your-long-random-secret-here

# Database
# These three configure the postgres container on first run
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=task_api_dev

# Without Docker — points to local postgres
# With Docker — docker-compose overrides this automatically to use the postgres service
DATABASE_URL=postgres://postgres:postgres@localhost:5432/task_api_dev
```

`POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` serve double duty — they configure the postgres container on first run AND are used by docker-compose for variable substitution when building `DATABASE_URL`.

`DATABASE_URL` uses `localhost` so the app works when run directly with `npm run dev` outside Docker. Docker Compose overrides it automatically to point at the `postgres` service hostname.

---

## .dockerignore

```
# Dependencies — container builds its own via npm ci
node_modules/

# Secrets — never bake these into an image
.env
.env.*
!.env.example

# Git
.git/
.gitignore

# Compiled output — prod container compiles its own in Dockerfile.prod
dist/

# Logs
*.log
npm-debug.log*

# Docker files — don't need to live inside the container
Dockerfile*
docker-compose*.yml
docker/

# OS files
.DS_Store
```

The most important entries are `node_modules/` and `.env`.

`node_modules/` — if it's copied in, it overrides the container's own `node_modules` built by `npm ci` inside the Dockerfile. This is the same problem the anonymous volume solves at runtime — `.dockerignore` solves it at build time.

`.env` — if it leaks into an image that gets pushed to a registry, your `JWT_SECRET` and database password are publicly exposed. `.dockerignore` is the safety net.

`!.env.example` is a negation — it un-ignores `.env.example` from the `.env.*` pattern. `.env.example` contains no real secrets and is safe to include in the image.

`docker/` — the scripts are already copied explicitly to `/usr/local/bin/` in the Dockerfile. No need for them to also exist at `/app/docker/` inside the container.

---

## How to Run

### Prerequisites

- Docker Desktop (or Docker Engine + Docker Compose plugin)
- A `.env` file copied from `.env.example` with real values

```bash
cp .env.example .env
# Set JWT_SECRET to something at least 32 characters long
```

### Development

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

- API runs at `http://localhost:3000`
- Hot reload is active — edit any file in `src/` and the server restarts automatically
- PostgreSQL data persists in the `postgres_data` Docker volume between restarts

```bash
# Stop and remove containers (data is preserved in the volume)
docker compose -f docker-compose.yml -f docker-compose.dev.yml down

# Stop and wipe all data (start completely fresh)
docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v
```

### Production

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build
```

### Shortcut — add scripts to package.json

The `-f` flags are long to type every time. Add these to `package.json`:

```json
"scripts": {
  "docker:dev":  "docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build",
  "docker:prod": "docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build",
  "docker:down": "docker compose -f docker-compose.yml -f docker-compose.dev.yml down"
}
```

Then just:

```bash
npm run docker:dev
npm run docker:prod
npm run docker:down
```

---

## Boot Sequence

Every time a container starts, this happens in order:

```
docker compose up
  └── postgres container starts
        └── healthcheck runs every 5s until pg_isready returns 0

  └── api container starts (only after postgres is healthy)
        └── entrypoint.sh runs
              ├── wait-for-pg.sh
              │     └── pg_isready polls until PostgreSQL accepts queries
              ├── migrations run
              │     ├── dev:  npx tsx src/db/migrate.ts
              │     └── prod: node dist/db/migrate.js
              └── exec npm run dev  (or node dist/index.js in prod)
                    └── Fastify server starts on port 3000
```

---

## Future Improvements

**Distroless + JS entrypoint**

Replace `node:20-alpine` with `gcr.io/distroless/nodejs20-debian12` in the production image. Since distroless has no shell, `entrypoint.sh` would be rewritten as a TypeScript file that programmatically polls Postgres and runs migrations before starting the server. Smaller attack surface, no shell injection risk.

**docker-compose.test.yml**

A separate compose file for running tests in CI — a clean database, `NODE_ENV=test`, exits when tests finish. Completely isolated from dev and prod:

```bash
docker compose -f docker-compose.yml -f docker-compose.test.yml up --abort-on-container-exit
```

**docker-compose.local.yml**

When working in a team, each developer can maintain a personal `docker-compose.local.yml` (gitignored) for machine-specific overrides — different ports, extra environment variables, etc. It layers on top of the dev override:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.local.yml up
```