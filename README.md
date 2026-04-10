# Task Management API

A production-style REST API for managing projects, members, and tasks. Built with **Fastify**, **TypeScript**, **PostgreSQL**, and **Redis**. No ORM, every query is raw SQL.

---

## What this is

A backend API that lets users register, create projects, invite collaborators, and manage tasks with role-based access control. Every design decision was made deliberately, there is a detailed explanation for each one in the docs listed below.

---

## Quick start

### Prerequisites

- Node.js 20+
- PostgreSQL 15+
- Redis 7+

### Local setup

```bash
# 1. Install dependencies
npm install

# 2. Create the database
createdb task_api_dev

# 3. Copy and fill in environment variables
cp .env.example .env

# 4. Run migrations
npm run migrate

# 5. Start dev server
npm run dev
```

Server starts at `http://localhost:3000`.

### Docker (recommended)

```bash
# Development — hot reload, source mounted as volume
npm run docker:dev

# Production — multi-stage build, compiled output
npm run docker:prod
```

---

## Tech stack

| Layer | Technology | Why |
|---|---|---|
| Language | TypeScript (strict) | Catches bugs at compile time, not at runtime |
| Framework | Fastify | Faster than Express, schema-based, plugin system |
| Database | PostgreSQL 15 | Relational model fits permissions and joins well |
| DB client | `pg` (node-postgres) | Raw SQL, no ORM abstraction |
| Cache | Redis 7 + `ioredis` | In-memory read cache, reduces DB load on hot routes |
| Auth | `@fastify/jwt` | Stateless JWT, no session storage needed |
| Passwords | `bcryptjs` | One-way hashing, safe to store |
| Validation | `zod` | Runtime schema validation with TypeScript inference |
| Migrations | Custom SQL runner | Plain `.sql` files tracked in `_migrations` table |
| Tests | Vitest | Unit + integration tests |
| CI | GitHub Actions | Typecheck → lint → test → build → Docker push |
| Container | Docker + Compose | Dev and prod environments, multi-stage prod build |

---

## Architecture

The project uses a strict layered architecture. Each layer has one job and only talks to the layer directly below it.

```
Client
  ↓
Routes          — define URL, HTTP method, attach middleware
  ↓
Controller      — validate input, call service, send response
  ↓
Service         — business logic, permission checks, cache reads/writes
  ↓
Repository      — raw SQL queries, nothing else
  ↓
PostgreSQL / Redis
```

This means: no SQL in controllers, no HTTP concepts in services, no permission checks in repositories. Each layer is independently testable and independently changeable.

---

## Project structure

```
task-api/
├── src/
│   ├── config/
│   │   ├── databases.ts            # PostgreSQL connection pool
│   │   ├── env.ts                  # Zod-validated env — crashes fast if anything missing
│   │   └── redis.ts                # ioredis client + startup health check
│   ├── db/
│   │   ├── migrations/             # SQL files, run in order, tracked in _migrations
│   │   │   ├── 001_create_users.sql
│   │   │   ├── 002_create_projects.sql
│   │   │   ├── 003_create_project_members.sql
│   │   │   ├── 004_create_tasks.sql
│   │   │   └── 005_task_activity_logs.sql
│   │   ├── queries/
│   │   │   └── members.ts          # Shared membership check helper
│   │   └── migrate.ts              # Migration runner
│   ├── middleware/
│   │   └── authenticate.ts         # JWT preHandler — verifies token before route runs
│   ├── modules/
│   │   ├── auth/                   # register, login, me
│   │   ├── members/                # invite, remove, list
│   │   ├── projects/               # CRUD + ownership
│   │   └── tasks/                  # tasks + activity log
│   ├── plugins/
│   │   ├── cache.ts                # withCache utility
│   │   └── jwt.ts                  # @fastify/jwt registration
│   ├── app.ts                      # Fastify app builder — registers plugins and routes
│   └── index.ts                    # Entry point — health checks, then starts server
├── redis/
│   └── acl.conf                    # Redis ACL — restricts prod user to required commands only
├── docker/
│   ├── entrypoint.sh               # wait → migrate → start
│   └── wait-for-pg.sh              # polls pg_isready before migrations run
├── tests/
│   ├── integration/
│   │   └── database.test.ts
│   └── setup.ts
├── Dockerfile.dev
├── Dockerfile.prod
├── docker-compose.yml
├── docker-compose.dev.yml
├── docker-compose.prod.yml
├── .env.example
└── .github/
    └── workflows/
        ├── ci.yml
        └── ci-test.yml
```

Each module follows the same internal structure: `routes → controller → service → repository → types`. You always know where to look.

---

## API endpoints

### Auth

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | No | Create account, returns JWT |
| POST | `/auth/login` | No | Login, returns JWT |
| GET | `/auth/me` | Yes | Get current user profile |

### Projects

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/projects` | Yes | List projects you belong to |
| POST | `/projects` | Yes | Create a project |
| GET | `/projects/:id` | Yes | Get a single project |
| PATCH | `/projects/:id` | Yes (owner) | Update name or description |
| DELETE | `/projects/:id` | Yes (owner) | Delete project and all its data |

### Members

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/projects/:id/members` | Yes (member) | List all members |
| POST | `/projects/:id/members` | Yes (owner) | Invite a user by email |
| DELETE | `/projects/:id/members/:userId` | Yes (owner) | Remove a member |

### Tasks

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/projects/:id/tasks` | Yes (member) | List tasks — supports filters |
| POST | `/projects/:id/tasks` | Yes (member) | Create a task |
| GET | `/projects/:id/tasks/:taskId` | Yes (member) | Get a single task |
| PATCH | `/projects/:id/tasks/:taskId` | Yes (member) | Update a task |
| DELETE | `/projects/:id/tasks/:taskId` | Yes (creator/owner) | Delete a task |
| GET | `/tasks/my` | Yes | All tasks assigned to you |
| GET | `/projects/:id/tasks/:taskId/activity` | Yes (member) | Full activity history |

**Task filters:**
```
GET /projects/:id/tasks?status=todo
GET /projects/:id/tasks?priority=high
GET /projects/:id/tasks?assigneeId=<uuid>
GET /projects/:id/tasks?status=in_progress&priority=urgent&limit=20&offset=0
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Min 32 characters |
| `PORT` | No | Default: `3000` |
| `HOST` | No | Default: `0.0.0.0` |
| `REDIS_HOST` | Yes | Redis hostname |
| `REDIS_PORT` | No | Default: `6379` |
| `REDIS_USERNAME` | Prod only | ACL username (`taskapi` in production) |
| `REDIS_PASSWORD` | Prod only | Must match `redis/acl.conf` |

All variables are validated by Zod at startup. The server refuses to start if anything required is missing or malformed.

---

## Scripts

```bash
npm run dev          # start with hot reload (tsx watch)
npm run build        # compile TypeScript → dist/
npm run start        # run compiled output
npm run migrate      # apply pending SQL migrations
npm test             # run test suite (Vitest)
npm run docker:dev   # run dev environment in Docker
npm run docker:prod  # run production environment in Docker
npm run docker:down  # stop and remove containers
```

---

## Permission model

| Action | Who can do it |
|---|---|
| Register / Login | Anyone |
| Create a project | Any logged-in user |
| View a project | Project members only |
| Update / Delete a project | Owner only |
| List members | Any project member |
| Add / Remove a member | Owner only |
| View / Create tasks | Any project member |
| Update a task | Creator, assignee, or owner |
| Delete a task | Creator or owner |
| View my tasks | Any logged-in user (own tasks only) |
| View task activity | Any project member |

Routes return `404` (not `403`) when a non-member accesses a project. A `403` would confirm the project exists — information an outsider shouldn't have.

---

## Database Schema

### `users`
```
id            UUID         PK       DEFAULT uuid_generate_v4()
email         VARCHAR(255) NOT NULL  UNIQUE
password_hash VARCHAR(255) NOT NULL
name          VARCHAR(255) NOT NULL
created_at    TIMESTAMPTZ           DEFAULT NOW()

Index: idx_users_email (email)
```

### `projects`
```
id          UUID         PK       DEFAULT uuid_generate_v4()
owner_id    UUID         NOT NULL  FK → users.id  ON DELETE CASCADE
name        VARCHAR(255) NOT NULL
description TEXT
created_at  TIMESTAMPTZ           DEFAULT NOW()

Index: idx_projects_owner_id (owner_id)
```

### `project_members`
```
id         UUID      PK       DEFAULT uuid_generate_v4()
project_id UUID      NOT NULL  FK → projects.id  ON DELETE CASCADE
user_id    UUID      NOT NULL  FK → users.id     ON DELETE CASCADE
role       user_role NOT NULL  DEFAULT 'member'
              -- ENUM: 'owner' | 'member'
joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()

Constraint: UNIQUE (project_id, user_id)
Index: idx_project_members_project_id (project_id)
Index: idx_project_members_user_id    (user_id)
```

### `tasks`
```
id          UUID          PK       DEFAULT uuid_generate_v4()
project_id  UUID          NOT NULL  FK → projects.id  ON DELETE CASCADE
assignee_id UUID          NULLABLE  FK → users.id     ON DELETE SET NULL
creator_id  UUID          NOT NULL  FK → users.id     ON DELETE RESTRICT
title       VARCHAR(255)  NOT NULL
description TEXT
status      task_status   NOT NULL  DEFAULT 'pending'
              -- ENUM: 'pending' | 'in_progress' | 'in_review' | 'completed'
priority    task_priority NOT NULL  DEFAULT 'medium'
              -- ENUM: 'low' | 'medium' | 'high'
due_date    TIMESTAMPTZ
created_at  TIMESTAMPTZ             DEFAULT CURRENT_TIMESTAMP
updated_at  TIMESTAMPTZ             DEFAULT CURRENT_TIMESTAMP
              -- auto-updated by set_updated_at trigger on every UPDATE

Index: idx_tasks_project_id  (project_id)
Index: idx_tasks_assignee_id (assignee_id)
Index: idx_tasks_status      (status)
Index: idx_tasks_priority    (priority)
```

### `task_activity`
```
id         UUID        PK       DEFAULT uuid_generate_v4()
task_id    UUID        NOT NULL  FK → tasks.id    ON DELETE CASCADE
project_id UUID        NOT NULL  FK → projects.id ON DELETE CASCADE
user_id    UUID        NOT NULL  FK → users.id
action     TEXT        NOT NULL  -- e.g. 'created', 'status_changed', 'assigned', 'deleted'
old_value  TEXT        NULLABLE  -- value before the change
new_value  TEXT        NULLABLE  -- value after the change
created_at TIMESTAMPTZ           DEFAULT NOW()

Index: idx_task_activity_task_id    (task_id)
Index: idx_task_activity_user_id    (user_id)
Index: idx_task_activity_created_at (project_id)
```

> `task_activity` is append-only. Rows are never updated, only inserted. This gives you a reliable audit trail of every change ever made to a task.

### Entity Relationships

```
users ──< projects              (one user owns many projects)
users ──< project_members       (one user belongs to many projects)
projects ──< project_members    (one project has many members)
projects ──< tasks              (one project has many tasks)
users ──< tasks                 (one user can be assigned many tasks)
users ──< tasks                 (one user can create many tasks)
tasks ──< task_activity         (one task has many activity log entries)
users ──< task_activity         (one user can author many activity entries)
projects ──< task_activity      (activity is scoped to a project)
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL 15+

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Create the database
createdb task_api_dev

# 3. Configure environment
cp .env.example .env
# Edit .env — set DATABASE_URL and JWT_SECRET at minimum

# 4. Run all migrations
npm run migrate

# 5. Start the dev server
npm run dev
```

Server starts at **http://localhost:3000**

---

## 13. Design Decisions

### Raw SQL over ORM

Every database query in this project is a plain SQL string sent directly to PostgreSQL via `pg`. No Prisma, no TypeORM, no Drizzle.

The reasons:
- **Full visibility** — you see exactly what hits the database, no generated queries to decode
- **No abstraction ceiling** — complex joins, CTEs, window functions, `EXPLAIN ANALYZE` all work without fighting the ORM
- **Real SQL knowledge** — the skill transfers to any language or database

The trade-off is more boilerplate for simple queries. The `db.query<T>(sql, params)` pattern with an explicit type parameter is the middle ground — you get TypeScript types without losing visibility into the query itself.

### Layered architecture

Each module has five files with fixed responsibilities: `routes → controller → service → repository → types`. Nothing bleeds across layers, a repository never checks permissions, a service never touches `reply.send()`. This makes every file predictable and every function independently testable.

### Append-only activity log

`task_activity` rows are never updated, only inserted. Every status change, reassignment, or edit creates a new row with the old and new values. This gives you a reliable audit trail that can answer "who changed this, and from what to what" for any task at any point in its history.

### Validation at the boundary

Zod schemas sit at the edge of the system, in controllers, before anything touches the database. Invalid input is rejected with a clear error immediately. Nothing downstream needs to defensively check for null or undefined.

The same pattern applies to environment variables at startup. If `DATABASE_URL` is missing, the server exits immediately with a readable error — not a cryptic crash when the first query runs.

### Transactions for multi-step writes

Any operation that touches more than one table is wrapped in a `BEGIN / COMMIT / ROLLBACK` block. The clearest example is creating a project — two inserts happen (into `projects` and `project_members`). If the second fails, the first is rolled back. The database never ends up in a half-written state.

### 404 instead of 403 for inaccessible resources

When a non-member tries to access a project, the API returns `404 Not Found`, not `403 Forbidden`. A `403` would confirm that a project with that ID exists — which is information an outsider shouldn't have. The `404` response is identical whether the project doesn't exist or the user just has no access.

---

## Health check

```
GET /health
```

Returns `200` when both PostgreSQL and Redis are reachable. Returns `503` with a `degraded` status if either is down.

```json
{
  "status": "ok",
  "database": "ok",
  "redis": "ok"
}
```

---

## Detailed documentation

Each doc covers design decisions and technical implementation in depth for its specific area.

| Document | What it covers |
|---|---|
| [`docs/Redis.md`](docs/Redis.md) | Caching architecture, `withCache`, cache key design, invalidation strategy, ACL, testing |
| [`docs/Docker.md`](docs/Docker.md) | Dockerfile design, compose file strategy, entrypoint, boot sequence, dev vs prod differences |
| [`docs/CI-Pipeline.md`](docs/CI.md) | Pipeline structure, job breakdown, reusable workflows, security decisions, branch behaviour |