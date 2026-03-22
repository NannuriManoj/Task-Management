# Task Management API

A production-style REST API for managing projects, members, and tasks, built with **Fastify**, **TypeScript**, **PostgreSQL**, and raw SQL. No ORM.

This project was built from scratch, phase by phase, to demonstrate how a real backend is structured and reasoned about, not just what the final code looks like.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Architecture](#3-architecture)
4. [Project Structure](#4-project-structure)
5. [Request Lifecycle](#5-request-lifecycle)
6. [Module Breakdown](#6-module-breakdown)
7. [Permission System](#7-permission-system)
8. [Database Schema](#8-database-schema)
9. [API Endpoints](#9-api-endpoints)
10. [Getting Started](#10-getting-started)
11. [Environment Variables](#11-environment-variables)
12. [Scripts](#12-scripts)
13. [Design Decisions](#13-design-decisions)
14. [Future Improvements](#14-future-improvements)

---

## 1. Project Overview

This API lets users register, create projects, invite collaborators, and manage tasks, with strict role-based rules on who can do what.

**What a user can do:**

- Register and log in, receive a JWT
- Create projects and become their owner
- Invite other users to a project by email
- Create tasks inside a project, assign them to members
- Update tasks as work progresses
- View all tasks assigned to them across every project
- Track a full activity history on every task (who changed what, and when)
- Delete tasks or projects they own

**What makes this production-style:**

- Every route is protected by JWT authentication
- Every action checks whether the user has permission before touching the database
- Passwords are never stored, only bcrypt hashes
- Every task change is recorded in an append-only `task_activity` log
- Schema changes are version-controlled SQL migration files
- The codebase is split into modules, each with a single responsibility

---

## 2. Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Language | TypeScript (strict mode) | Catches bugs at compile time, not runtime |
| Framework | Fastify | Faster than Express, built-in plugin system, minimal magic |
| Database | PostgreSQL | Relational model fits permissions and joins well |
| DB Client | `pg` (node-postgres) | Raw SQL, no abstraction layer |
| Auth | `@fastify/jwt` | Stateless JWT — no session storage needed |
| Passwords | `bcryptjs` | One-way hashing, safe to store |
| Validation | `zod` | Runtime schema validation with TypeScript type inference |
| Migrations | Custom SQL runner | Plain `.sql` files tracked in a `_migrations` table |

---

## 3. Architecture

The project uses a **layered architecture**. Each layer has one job and only talks to the layer directly below it.

```
Client
  ↓
Routes          — define the URL and HTTP method
  ↓
Controller      — validate the request, call the service, send the response
  ↓
Service         — business logic, permission checks
  ↓
Repository      — raw SQL queries, nothing else
  ↓
Database
```

**Why this separation matters:**

| Layer | Responsibility | What it does NOT do |
|---|---|---|
| Routes | Declare endpoints and attach middleware | No business logic |
| Controller | Parse input, format output | No SQL |
| Service | Enforce rules and orchestrate | No HTTP concepts |
| Repository | Execute queries | No permission checks |

This makes each layer independently testable and independently changeable. If you swap PostgreSQL for another database later, only the repository layer changes.

---

## 4. Project Structure

```
task-api/
├── src/
│   ├── config/
│   │   ├── databases.ts            # PostgreSQL connection pool
│   │   └── env.ts                  # Zod-validated env variables — crashes fast if anything is missing
│   │
│   ├── db/
│   │   ├── migrations/             # SQL migration files (run in order, tracked in _migrations)
│   │   │   ├── 001_create_users.sql
│   │   │   ├── 002_create_projects.sql
│   │   │   ├── 003_create_project_members.sql
│   │   │   ├── 004_create_tasks.sql
│   │   │   └── 005_task_activity_logs.sql
│   │   ├── queries/
│   │   │   └── members.ts          # Shared SQL helpers (e.g. membership check)
│   │   └── migrate.ts              # Migration runner
│   │
│   ├── middleware/
│   │   └── authenticate.ts         # JWT preHandler — verifies token before route runs
│   │
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.controller.ts  # Validate input, call service, send response
│   │   │   ├── auth.repository.ts  # SQL queries (find user, insert user)
│   │   │   ├── auth.route.ts       # POST /register, POST /login, GET /me
│   │   │   ├── auth.schema.ts      # Zod schemas for register + login
│   │   │   ├── auth.service.ts     # Business logic (hash, compare, sign JWT)
│   │   │   └── auth.type.ts        # TypeScript interfaces for this module
│   │   │
│   │   ├── members/
│   │   │   ├── member.controller.ts
│   │   │   ├── member.repository.ts
│   │   │   ├── member.routes.ts
│   │   │   ├── member.schema.ts
│   │   │   ├── member.service.ts
│   │   │   └── member.types.ts
│   │   │
│   │   ├── projects/
│   │   │   ├── project.controller.ts
│   │   │   ├── project.repository.ts
│   │   │   ├── project.routes.ts
│   │   │   ├── project.schema.ts
│   │   │   ├── project.service.ts
│   │   │   └── project.types.ts
│   │   │
│   │   └── tasks/
│   │       ├── task.controller.ts
│   │       ├── task.repository.ts
│   │       ├── task.routes.ts
│   │       ├── task.schema.ts
│   │       ├── task.service.ts
│   │       └── task.type.ts
│   │
│   ├── plugins/
│   │   └── jwt.ts                  # @fastify/jwt plugin registration
│   │
│   └── index.ts                    # Entry point — wires plugins and routes, starts server
│
├── .env                            # Local secrets (never commit this)
├── .env.example                    # Reference for required variables
├── .gitignore
├── package.json
└── tsconfig.json
```

> Each module follows the same internal structure: `routes → controller → service → repository → types`. This consistency means you always know where to look for any piece of logic.

---

## 5. Request Lifecycle

Tracing a real request end to end helps understand how all the layers connect.

### Example: `DELETE /projects/:projectId/tasks/:taskId`

```
1. Client sends:
   DELETE /projects/abc/tasks/xyz
   Authorization: Bearer <token>

2. authenticate middleware
   → calls request.jwtVerify()
   → if invalid → 401, stop here
   → if valid   → request.user = { sub: userId, email }

3. task.routes.ts
   → passes request to task.controller.ts

4. task.controller.ts
   → extracts projectId, taskId from params
   → calls task.service.deleteTask(projectId, taskId, userId)

5. task.service.ts
   → calls task.repository to check membership
   → calls task.repository to fetch the task
   → checks: is user the creator OR the project owner?
   → if neither → throws 403, stop here
   → calls task.repository.deleteTask(taskId)
   → calls task.repository.logActivity(taskId, userId, 'deleted')

6. task.repository.ts
   → DELETE FROM tasks WHERE id = $1
   → INSERT INTO task_activity (action = 'deleted', ...)

7. task.controller.ts
   → sends HTTP 204 No Content
```

Every protected action follows this same pattern — authenticate, check permission, execute, log, respond.

---

## 6. Module Breakdown

### Auth

Handles registration, login, and identity.

```
POST /auth/register
  → Validate input
  → Check email not already registered
  → Hash password (bcrypt)
  → INSERT into users
  → Sign JWT { sub, email }
  → Return user + token

POST /auth/login
  → Validate input
  → Find user by email
  → Compare password (bcrypt.compare)
  → If invalid → 401 Unauthorized
  → Sign JWT
  → Return user + token

GET /auth/me
  → Verify JWT
  → Fetch user by id from token
  → Return user profile
```

### Projects

Handles project ownership and CRUD.

```
POST /projects
  → Authenticate (JWT required)
  → Validate request body (name, description)
  → BEGIN database transaction
      → INSERT INTO projects (name, description, owner_id)
      → INSERT INTO project_members (project_id, user_id, role = 'owner')
  → COMMIT transaction
  → Return created project

PATCH /projects/:id
  → Authenticate
  → Verify project exists AND requester is the owner
  → Validate input (name/description optional)
  → Build dynamic UPDATE query (only provided fields)
  → UPDATE projects SET ...
  → Return updated project

DELETE /projects/:id
  → Authenticate
  → Verify requester is the project owner
  → DELETE FROM projects WHERE id = $1
  → Related records are automatically deleted via ON DELETE CASCADE:
        - project_members
        - tasks
        - task_activity
  → Return success response
```

### Members

Handles project collaboration.

```
POST /projects/:id/members
  → Authenticate
  → Verify requester is project owner
  → Find user by email
  → Check not already a member
  → INSERT into project_members

DELETE /projects/:id/members/:userId
  → Authenticate
  → Verify requester is project owner
  → Prevent owner removing themselves
  → DELETE member

GET /projects/:id/members
  → Authenticate
  → Verify requester is project member
  → SELECT members JOIN users
  → Return members list
```

### Tasks

Handles task creation, updates, assignment, deletion, personal task view, and activity history.

```
POST /projects/:id/tasks
  - Authenticate
  - Verify requester is project admin OR owner
  - If assigneeId provided → verify assignee is project member
  - INSERT task
  - INSERT task_activity (task_created)

PATCH /projects/:id/tasks/:taskId
  - Authenticate
  - Verify requester is project member
  - Verify task exists
  - Check permission:
        - Task creator OR
        - Task assignee OR
        - Project admin OR
        - Project owner
  - If changing assignee → verify new assignee is project member
  - UPDATE task
  - INSERT task_activity

DELETE /projects/:id/tasks/:taskId
  - Authenticate
  - Verify requester is project member
  - Check permission:
        - Task creator OR
        - Project owner
  - DELETE task (activity deleted via cascade)

GET /tasks/my
  - Authenticate
  - SELECT tasks WHERE assignee_id = current user
  - JOIN projects to include project name

GET /projects/:id/tasks/:taskId/activity
  - Authenticate
  - Verify requester is project member
  - SELECT task_activity ORDER BY created_at
  - JOIN users to include actor name
```

---

## 7. Permission System

| Action | Who can do it |
|---|---|
| Register / Login | Anyone |
| Create a project | Any logged-in user |
| View own projects | Project members |
| Update a project | Owner only |
| Delete a project | Owner only |
| List project members | Any project member |
| Add a member | Owner only |
| Remove a member | Owner only |
| View tasks | Any project member |
| Create a task | Any project member |
| Update a task | Any project member |
| Assign a task | Any project member |
| Delete a task | Task creator or project owner |
| View my tasks | Any logged-in user (own tasks only) |
| View task activity | Any project member |

**On the 404 vs 403 distinction:**
Routes that check membership return `404` (not `403`) when a non-member tries to access a project. A `403` would confirm that a project with that ID exists — which is information an outsider shouldn't have. The `404` response is identical whether the project doesn't exist or the user just has no access.

---

## 8. Database Schema

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

## 9. API Endpoints

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
| GET | `/projects/:id/members` | Yes (member) | List all members with roles |
| POST | `/projects/:id/members` | Yes (owner) | Invite a user by email |
| DELETE | `/projects/:id/members/:userId` | Yes (owner) | Remove a member |

### Tasks

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/projects/:id/tasks` | Yes (member) | List tasks, supports filters |
| POST | `/projects/:id/tasks` | Yes (member) | Create a task |
| GET | `/projects/:id/tasks/:taskId` | Yes (member) | Get a single task |
| PATCH | `/projects/:id/tasks/:taskId` | Yes (member) | Update any task field |
| DELETE | `/projects/:id/tasks/:taskId` | Yes (creator/owner) | Delete a task |
| GET | `/tasks/my` | Yes | All tasks assigned to you across all projects |
| GET | `/projects/:id/tasks/:taskId/activity` | Yes (member) | Full activity history for a task |

**Task filters (query params):**
```
GET /projects/:id/tasks?status=todo
GET /projects/:id/tasks?priority=high
GET /projects/:id/tasks?assigneeId=<uuid>
GET /projects/:id/tasks?status=in_progress&priority=urgent
```

**Task activity response shape:**
```json
{
  "activity": [
    {
      "id": "uuid",
      "action": "status_changed",
      "old_value": "todo",
      "new_value": "in_progress",
      "created_at": "2025-01-15T10:30:00Z",
      "user_name": "Manoj"
    }
  ]
}
```

---

## 10. Getting Started

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

## 11. Environment Variables

| Variable | Required | Description | Example |
|---|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string | `postgres://postgres:password@localhost:5432/task_api_dev` |
| `JWT_SECRET` | Yes | Secret for signing tokens, min 32 chars | `a-long-random-string-here` |
| `PORT` | No | Port to listen on (default: 3000) | `3000` |
| `HOST` | No | Host to bind to (default: 0.0.0.0) | `0.0.0.0` |

> The server **refuses to start** if any required variable is missing or invalid. This is enforced by Zod at startup before any routes are registered.

---

## 12. Scripts

```bash
npm run dev        # Start server with hot reload (tsx watch)
npm run build      # Compile TypeScript → dist/
npm run start      # Run compiled output (production)
npm run migrate    # Apply any pending SQL migrations
```

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

Each module has five files with fixed responsibilities: `routes → controller → service → repository → types`. Nothing bleeds across layers — a repository never checks permissions, a service never touches `reply.send()`. This makes every file predictable and every function independently testable.

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

## 14. Future Improvements

| Improvement | Why |
|---|---|
| Centralized error handler | Replace per-controller try/catch with a single Fastify error handler |
| Refresh tokens | Short-lived access tokens + rotatable refresh tokens for security |
| Pagination | Limit/offset on task and project list endpoints |
| Unit tests | Vitest + supertest for route-level integration tests |
| Rate limiting | `@fastify/rate-limit` on auth routes to prevent brute force |
| Request ID tracing | Correlate logs across a single request lifecycle |
| Admin role | A third role between owner and member for larger teams |
| Docker | `docker-compose.yml` for running Postgres in a container |
| CI/CD | GitHub Actions running lint + tests on every push |