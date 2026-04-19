# Task Management API

A production-style REST API for managing projects, members, and tasks. Built with **Fastify**, **TypeScript**, **PostgreSQL**, **Redis**, and **BullMQ**. No ORM, every query is raw SQL.

---

## What this is

A backend API that lets users register, create projects, invite collaborators, and manage tasks with role-based access control. Async side effects (emails, audit logs, scheduled reminders, report generation) are handled by background workers running as a separate process. Every design decision was made deliberately, there is a detailed explanation for each one in the docs listed below.

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

# 5. Start dev server and workers (two terminals)
npm run dev        # Terminal 1 — API server
npm run workers    # Terminal 2 — Background workers
```

Server starts at `http://localhost:3000`.  
Bull Board dashboard at `http://localhost:3000/admin/queues` (development only).

### Docker (recommended)

```bash
# Development — hot reload, source mounted as volume
npm run docker:dev

# Production — multi-stage build, compiled output
npm run docker:prod
```

Both commands start the API server and workers as separate containers.

---

## Tech stack

| Layer | Technology | Why |
|---|---|---|
| Language | TypeScript (strict) | Catches bugs at compile time, not at runtime |
| Framework | Fastify | Faster than Express, schema-based, plugin system |
| Database | PostgreSQL 15 | Relational model fits permissions and joins well |
| DB client | `pg` (node-postgres) | Raw SQL, no ORM abstraction |
| Cache | Redis 7 + `ioredis` | In-memory read cache, reduces DB load on hot routes |
| Queue | BullMQ + Redis | Async job processing, retries, scheduling, DLQ |
| Email | Resend | Transactional email delivery via REST API |
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
  ↓             — enqueues async side effects after DB mutations
Repository      — raw SQL queries, nothing else
  ↓
PostgreSQL / Redis


Async side effects (separate process)
──────────────────────────────────────
Service enqueues job
  ↓
BullMQ Queue (Redis)
  ↓
Worker picks up job
  ↓
Processor handles it (email / DB write / schedule / report)
  ↓
Retry on failure → DLQ after exhaustion
```

This means: no SQL in controllers, no HTTP concepts in services, no permission checks in repositories. Workers run in a completely separate process — a slow report job never blocks HTTP requests.

---

## Project structure

```
task-api/
├── .github/                    # CI/CD workflows (GitHub Actions)
│   ├── actions/               # Custom reusable actions
│   │   └── setup-node/
│   │       └── action.yml
│   └── workflows/
│       ├── ci.yml             # Main pipeline (lint, test, build)
│       ├── ci-test.yml        # Test-specific workflow
│       └── stale.yml          # Marks stale issues/PRs
│
├── dist/                      # Compiled TypeScript output (prod)
│
├── docker/                    # Docker helper scripts
│   ├── entrypoint.sh         # Wait → migrate → start app
│   └── wait-for-pg.sh        # Waits for PostgreSQL readiness
│
├── docs/                      # Detailed system design docs
│
├── redis/                     # Redis configs (ACL, etc.)
│
├── src/                       # Main application source
│
│   ├── admin/                 # Dev tools
│   │   └── bull-board.ts     # Queue monitoring dashboard
│
│   ├── config/                # App configuration
│   │   ├── databases.ts      # PostgreSQL connection
│   │   ├── env.ts            # Environment validation (Zod)
│   │   └── redis.ts          # Redis clients setup
│
│   ├── db/                    # Database layer
│   │   ├── migrations/       # Raw SQL migrations
│   │   ├── queries/          # Shared query helpers
│   │   ├── migrate.ts        # Migration runner
│   │   └── middleware/       # Request-level infra logic
│   │       ├── authenticate.ts
│   │       ├── rateLimit.ts
│   │       └── perRouteRateLimit.ts
│
│   ├── modules/               # Feature-based modules
│   │   ├── auth/
│   │   ├── members/
│   │   ├── projects/
│   │   └── tasks/
│
│   ├── plugins/               # Fastify plugins
│   │   ├── cache.ts          # Redis caching helper
│   │   └── jwt.ts            # JWT plugin setup
│
│   ├── queues/                # BullMQ queues
│   │   ├── config/           # Shared queue configs
│   │   ├── types/            # Typed job payloads
│   │   ├── activity.queue.ts
│   │   ├── notification.queue.ts
│   │   ├── scheduler.queue.ts
│   │   ├── report.queue.ts
│   │   ├── dlq.queue.ts      # Dead Letter Queue
│   │   └── index.ts          # Central export
│
│   ├── services/              # Business logic layer
│   │   └── email/
│   │       ├── resend.ts     # Email provider wrapper
│   │       └── templates/    # Email templates
│
│   ├── workers/               # Background job processors
│   │   ├── processors/       # Actual job logic
│   │   ├── shared/           # Shared worker utilities
│   │   ├── *.worker.ts       # Worker entry files
│   │   └── index.ts          # Worker bootstrap
│
│   ├── rateLimitHelpers.ts   # Rate limiting utilities
│   ├── app.ts                # Fastify app builder
│   └── index.ts              # Server entrypoint
│
├── tests/                    # Unit & integration tests
│
├── .env*                     # Environment configs
├── docker-compose*.yml       # Container orchestration
├── Dockerfile.*              # Build configs
├── package.json              # Dependencies & scripts
├── tsconfig.json             # TypeScript config
└── README.md
```

Each module follows the same internal structure: `routes → controller → service → repository → types`.

---

## Background jobs

### Queues

| Queue | Purpose | Concurrency | Retries |
|---|---|---|---|
| `notifications` | Sends transactional emails via Resend | 10 | 5 (exponential, 2s base) |
| `activity` | Writes audit log entries to `task_activity` | 50 | 8 (exponential, 500ms base) |
| `scheduler` | Fires delayed jobs for due date reminders | 5 | 3 (exponential, 5s base) |
| `reports` | Generates CSV exports and emails download link | 2 | 3 (exponential, 10s base) |
| `failed-jobs` | Dead letter queue — holds exhausted jobs for inspection | — | 1 (no auto-retry) |

### Notification types

| Type | Trigger | Recipients |
|---|---|---|
| `task_assigned` | Task is assigned to a user | Assignee |
| `task_status_changed` | Task status changes | Creator + assignee (if different) |
| `member_added` | User is added to a project | Added user |
| `due_reminder` | 24 hours before a task's due date | Assignee |

### How it works

```
HTTP request hits service layer
  ↓
DB mutation (source of truth)
  ↓
Queue jobs enqueued (fire and forget)
  ↓
Response returned to client immediately

Meanwhile, in the worker process:
  ↓
Worker picks up job from Redis
  ↓
Processor executes (send email / write log / schedule / generate report)
  ↓
Success → job marked complete
Failure → retry with exponential backoff
Exhausted → forwarded to DLQ
```

### Bull Board

A visual dashboard for monitoring all queues is available in development at:

```
http://localhost:3000/admin/queues
```

Shows waiting, active, completed, failed, and delayed jobs. Allows manual retry of failed jobs directly from the UI.

---

## API endpoints

### Auth

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | No | Create account, returns JWT |
| POST | `/api/auth/login` | No | Login, returns JWT |
| GET | `/api/auth/me` | Yes | Get current user profile |

### Projects

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/projects` | Yes | List projects you belong to |
| POST | `/api/v1/projects` | Yes | Create a project |
| GET | `/api/v1/projects/:id` | Yes | Get a single project |
| PATCH | `/api/v1/projects/:id` | Yes (owner) | Update name or description |
| DELETE | `/api/v1/projects/:id` | Yes (owner) | Delete project and all its data |

### Members

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/projects/:id/members` | Yes (member) | List all members |
| POST | `/api/v1/projects/:id/members` | Yes (owner) | Invite a user by email |
| DELETE | `/api/v1/projects/:id/members/:userId` | Yes (owner) | Remove a member |

### Tasks

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/projects/:id/tasks` | Yes (member) | List tasks — supports filters |
| POST | `/api/v1/projects/:id/tasks` | Yes (member) | Create a task |
| GET | `/api/v1/projects/:id/tasks/:taskId` | Yes (member) | Get a single task |
| PATCH | `/api/v1/projects/:id/tasks/:taskId` | Yes (member) | Update a task |
| DELETE | `/api/v1/projects/:id/tasks/:taskId` | Yes (creator/owner) | Delete a task |
| GET | `/api/v1/tasks/my` | Yes | All tasks assigned to you |
| GET | `/api/v1/projects/:id/tasks/:taskId/activity` | Yes (member) | Full activity history |

**Task filters:**

```
GET /api/v1/projects/:id/tasks?status=todo
GET /api/v1/projects/:id/tasks?priority=high
GET /api/v1/projects/:id/tasks?assigneeId=<uuid>
GET /api/v1/projects/:id/tasks?status=in_progress&priority=urgent&limit=20&offset=0
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
| `REDIS_USERNAME` | Prod only | ACL username |
| `REDIS_PASSWORD` | Prod only | Must match `redis/acl.conf` |
| `RESEND_API_KEY` | Yes | Resend API key — get one at resend.com |
| `EMAIL_FROM` | Yes | Sender address e.g. `Task API <noreply@yourdomain.com>` |
| `APP_URL` | Yes | Base URL used in email links e.g. `https://app.yourdomain.com` |

All variables are validated by Zod at startup. The server refuses to start if anything required is missing or malformed.

---

## Scripts

```bash
npm run dev           # start API server with hot reload (tsx watch)
npm run workers       # start worker process with hot reload
npm run build         # compile TypeScript → dist/
npm run start         # run compiled API server
npm run start:workers # run compiled worker process
npm run migrate       # apply pending SQL migrations
npm test              # run test suite (Vitest)
npm run docker:dev    # run dev environment in Docker
npm run docker:prod   # run production environment in Docker
npm run docker:down   # stop and remove containers
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

## Database schema

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

Index: idx_tasks_project_id  (project_id)
Index: idx_tasks_assignee_id (assignee_id)
Index: idx_tasks_status      (status)
Index: idx_tasks_priority    (priority)
```

### `task_activity`

```
id            UUID        PK       DEFAULT uuid_generate_v4()
job_id        VARCHAR     UNIQUE             -- BullMQ job ID for idempotency
task_id       UUID        NULLABLE  FK → tasks.id    ON DELETE CASCADE
project_id    UUID        NOT NULL  FK → projects.id ON DELETE CASCADE
actor_id      UUID        NULLABLE  FK → users.id    ON DELETE SET NULL
actor_name    VARCHAR     NOT NULL           -- preserved if user is deleted
action        VARCHAR     NOT NULL
resource_type VARCHAR     NOT NULL           -- 'task' | 'project' | 'member'
resource_id   UUID        NOT NULL
meta          JSONB                          -- flexible per-action context
occurred_at   TIMESTAMPTZ NOT NULL           -- when the action happened
created_at    TIMESTAMPTZ NOT NULL  DEFAULT NOW()

Index: idx_task_activity_project_id   (project_id)
Index: idx_task_activity_task_id      (task_id)
Index: idx_task_activity_actor_id     (actor_id)
Index: idx_task_activity_occurred_at  (occurred_at DESC)
Index: idx_task_activity_project_time (project_id, occurred_at DESC)
```

> `task_activity` is append-only and idempotent. The `job_id` unique constraint ensures retried BullMQ jobs never produce duplicate audit entries. `actor_name` is stored alongside `actor_id` so the activity feed remains readable even if a user deletes their account.

### Entity relationships

```
users ──< projects              (one user owns many projects)
users ──< project_members       (one user belongs to many projects)
projects ──< project_members    (one project has many members)
projects ──< tasks              (one project has many tasks)
users ──< tasks                 (one user can be assigned many tasks)
users ──< tasks                 (one user can create many tasks)
tasks ──< task_activity         (one task has many activity log entries)
projects ──< task_activity      (activity is scoped to a project)
```

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

## Design decisions

### Raw SQL over ORM

Every database query in this project is a plain SQL string sent directly to PostgreSQL via `pg`. No Prisma, no TypeORM, no Drizzle.

The reasons:
- **Full visibility** — you see exactly what hits the database, no generated queries to decode
- **No abstraction ceiling** — complex joins, CTEs, window functions, `EXPLAIN ANALYZE` all work without fighting the ORM
- **Real SQL knowledge** — the skill transfers to any language or database

### Layered architecture

Each module has five files with fixed responsibilities: `routes → controller → service → repository → types`. Nothing bleeds across layers, a repository never checks permissions, a service never touches `reply.send()`. This makes every file predictable and every function independently testable.

### Workers as a separate process

The API server and worker process are intentionally separate. A CPU-heavy report job won't block HTTP request handling. Workers can be scaled independently. Deploying the API doesn't interrupt in-flight jobs. Both run from the same Docker image with a different `command`.

### Queue-per-concern

Each queue has its own concurrency limit, retry config, and backoff strategy tuned to what that queue actually does. Activity logs retry aggressively with short delays (lightweight DB inserts). Reports retry conservatively with long delays (heavy CPU work). Notification retries start at 2s to avoid hammering Resend on the first failure.

### Idempotent activity logs

Every `INSERT` into `task_activity` includes the BullMQ `job.id` and uses `ON CONFLICT (job_id) DO NOTHING`. If BullMQ retries a job that already succeeded (e.g. process crash before the job was marked complete), the second insert is a safe no-op. No duplicate audit entries, ever.

### Scheduler delegates to notification queue

The scheduler processor doesn't send emails directly — it only enqueues a notification job when the delay expires. This keeps retry behaviour isolated: if Resend is down when the scheduler fires, the scheduler job succeeds and the notification job handles its own retries independently.

### Append-only activity log

`task_activity` rows are never updated, only inserted. Every status change, reassignment, or edit creates a new row. This gives you a reliable audit trail that can answer "who changed this, and from what to what" for any task at any point in its history.

### Validation at the boundary

Zod schemas sit at the edge of the system, in controllers, before anything touches the database. Invalid input is rejected with a clear error immediately. Nothing downstream needs to defensively check for null or undefined.

The same pattern applies to environment variables at startup. If `DATABASE_URL` is missing, the server exits immediately with a readable error — not a cryptic crash when the first query runs.

### Transactions for multi-step writes

Any operation that touches more than one table is wrapped in a `BEGIN / COMMIT / ROLLBACK` block. The clearest example is creating a project — two inserts happen (into `projects` and `project_members`). If the second fails, the first is rolled back. The database never ends up in a half-written state.

### 404 instead of 403 for inaccessible resources

When a non-member tries to access a project, the API returns `404 Not Found`, not `403 Forbidden`. A `403` would confirm that a project with that ID exists — which is information an outsider shouldn't have. The `404` response is identical whether the project doesn't exist or the user just has no access.

---

## Detailed documentation

Each doc covers design decisions and technical implementation in depth for its specific area.

| Document | What it covers |
|---|---|
| [`docs/Redis.md`](docs/Redis.md) | Caching architecture, `withCache`, cache key design, invalidation strategy, ACL, testing |
| [`docs/Docker.md`](docs/Docker.md) | Dockerfile design, compose file strategy, entrypoint, boot sequence, dev vs prod differences |
| [`docs/CI-Pipeline.md`](docs/CI-Pipeline.md) | Pipeline structure, job breakdown, reusable workflows, security decisions, branch behaviour |
| [`docs/BullMQ.md`](docs/BullMQ.md) | Queue design, worker architecture, retry strategy, DLQ, scheduler pattern, email templates |