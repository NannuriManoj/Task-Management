# Task Management API

A REST API for managing projects and tasks, built from scratch with **Fastify**, **TypeScript**, and **PostgreSQL**. No ORM — all queries are raw SQL.

## What's been built so far

### Phase 1 — Server bootstrap
- Fastify server running with TypeScript
- Hot reload in development via `tsx watch`

### Phase 2 — Config + Database
- Environment variable validation with Zod (fails fast on startup if anything is missing)
- PostgreSQL connection pool via `pg`
- Database health check before the server accepts traffic

### Phase 3 — Auth routes
- `POST /auth/register` — creates a user, hashes password with bcrypt, returns JWT
- `POST /auth/login` — verifies credentials, returns JWT
- `GET /auth/me` — protected route, returns current user from token

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | Type safety end to end |
| Framework | Fastify | Fast, plugin-based, minimal magic |
| Database | PostgreSQL | Relational, solid for permissions and joins |
| DB client | `pg` (node-postgres) | Raw SQL, no ORM abstraction |
| Auth | `@fastify/jwt` + `bcryptjs` | JWT for stateless auth, bcrypt for password hashing |
| Validation | `zod` | Schema validation for env and request bodies |
| Migrations | Custom SQL runner | Plain `.sql` files, tracked in `_migrations` table |

---

## Project structure

```
task-api/
├── src/
│   ├── config/
│   │   └── env.ts              # Zod-validated environment variables
│   ├── db/
│   │   ├── database.ts         # PostgreSQL connection pool
│   │   ├── migrate.ts          # Migration runner script
│   │   └── migrations/
│   │       └── 001_create_users.sql
│   ├── middleware/
│   │   └── authenticate.ts     # JWT verification preHandler
│   ├── modules/
│   │   └── auth/
│   │       └── auth.routes.ts  # register, login, me
│   ├── types/
│   │   └── index.ts            # JwtPayload + Fastify module augmentation
│   └── index.ts                # Entry point — wires everything together
├── .env                        # Local environment variables (never commit)
├── .env.example                # Reference for required variables
├── .gitignore
├── package.json
└── tsconfig.json
```

> As we add features, new folders will appear under `modules/` — one folder per feature (projects, tasks, members).

---

## Database schema

Only one table exists right now. The full schema will be built up as we progress through each phase.

### Current — Phase 3

```
users
─────────────────────────────────────────
id            UUID        PK  DEFAULT uuid_generate_v4()
email         VARCHAR     NOT NULL  UNIQUE
password_hash VARCHAR     NOT NULL
name          VARCHAR     NOT NULL
created_at    TIMESTAMPTZ NOT NULL  DEFAULT NOW()

Index: idx_users_email ON users(email)
```

### Planned — upcoming phases

```
projects
─────────────────────────────────────────
id            UUID        PK
owner_id      UUID        FK → users.id
name          VARCHAR     NOT NULL
description   TEXT
created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()


project_members
─────────────────────────────────────────
id            UUID        PK
project_id    UUID        FK → projects.id
user_id       UUID        FK → users.id
role          ENUM        'owner' | 'member'
joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()

Constraint: UNIQUE(project_id, user_id)


tasks
─────────────────────────────────────────
id            UUID        PK
project_id    UUID        FK → projects.id
assignee_id   UUID        FK → users.id  (nullable)
created_by    UUID        FK → users.id
title         VARCHAR     NOT NULL
description   TEXT
status        ENUM        'todo' | 'in_progress' | 'in_review' | 'done'
priority      ENUM        'low' | 'medium' | 'high' | 'urgent'
due_date      TIMESTAMPTZ
created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

---

## API routes

### Currently implemented

| Method | Endpoint | Auth required | Description |
|---|---|---|---|
| GET | `/health` | No | Server health check |
| POST | `/auth/register` | No | Create a new user account |
| POST | `/auth/login` | No | Login, returns JWT |
| GET | `/auth/me` | Yes | Get current user profile |

### Planned

| Method | Endpoint | Auth required | Description |
|---|---|---|---|
| GET | `/projects` | Yes | List user's projects |
| POST | `/projects` | Yes | Create a project |
| GET | `/projects/:id` | Yes | Get a project |
| PATCH | `/projects/:id` | Yes (owner) | Update a project |
| DELETE | `/projects/:id` | Yes (owner) | Delete a project |
| GET | `/projects/:id/members` | Yes (member) | List project members |
| POST | `/projects/:id/members` | Yes (owner) | Add a member by email |
| DELETE | `/projects/:id/members/:userId` | Yes (owner) | Remove a member |
| GET | `/projects/:id/tasks` | Yes (member) | List tasks |
| POST | `/projects/:id/tasks` | Yes (member) | Create a task |
| GET | `/projects/:id/tasks/:taskId` | Yes (member) | Get a task |
| PATCH | `/projects/:id/tasks/:taskId` | Yes (member) | Update a task |
| PATCH | `/projects/:id/tasks/:taskId/assign` | Yes (member) | Assign a task |
| DELETE | `/projects/:id/tasks/:taskId` | Yes (creator/owner) | Delete a task |

---

## Getting started

### Prerequisites

- Node.js 20+
- PostgreSQL 15+

### Setup

```bash
# 1. Clone and install
npm install

# 2. Create the database
createdb task_api_dev

# 3. Set up environment
cp .env.example .env
# Edit .env with your values

# 4. Run migrations
npm run migrate

# 5. Start dev server
npm run dev
```

### Environment variables

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://postgres:password@localhost:5432/task_api_dev` |
| `JWT_SECRET` | Secret for signing tokens (min 32 chars) | `your-long-random-secret-here` |
| `PORT` | Port to listen on | `3000` |
| `HOST` | Host to bind to | `0.0.0.0` |

---

## How authentication works

```
Register / Login
─────────────────────────────────────────────────────
Client sends email + password
  → Server looks up user by email
  → bcrypt.compare() checks password against stored hash
  → If valid, server signs a JWT with { sub: userId, email }
  → JWT returned to client

Protected routes
─────────────────────────────────────────────────────
Client sends request with header:
  Authorization: Bearer <token>
  → authenticate middleware calls request.jwtVerify()
  → If valid, request.user is populated with JWT payload
  → Route handler runs with access to request.user.sub (userId)
  → If invalid or missing → 401 Unauthorized
```

---

## Scripts

```bash
npm run dev        # start with hot reload
npm run build      # compile TypeScript → dist/
npm run start      # run compiled output
npm run migrate    # apply pending SQL migrations
```

---

## Design decisions

**Raw SQL over ORM** — every database query is a plain SQL string sent directly to PostgreSQL via `pg`. No Prisma, no TypeORM. This means full control over every query, no hidden abstractions, and you actually learn SQL properly.

**Zod for validation** — used in two places: validating environment variables at startup (so misconfiguration fails immediately), and validating request bodies in route handlers (so bad input is rejected with a clear error before it touches the database).

**One migration per change** — schema changes live in numbered `.sql` files. The migration runner tracks what's been applied in a `_migrations` table and only runs new files. Safe to run repeatedly.

**Module-per-feature structure** — each feature (auth, projects, tasks, members) lives in its own folder under `src/modules/`. As the project grows, each module will contain its own routes, service (business logic), and schema (validation).
