# Redis — Caching Layer

This document covers the full Redis implementation in this project: why it exists, how it is structured, every design decision, and how each piece works technically.

---

## Table of contents

1. [Why Redis](#1-why-redis)
2. [Architecture overview](#2-architecture-overview)
3. [The withCache utility](#3-the-withcache-utility)
4. [Cache key design](#4-cache-key-design)
5. [Read strategy](#5-read-strategy)
6. [Invalidation strategy](#6-invalidation-strategy)
7. [Filter-aware cache keys](#7-filter-aware-cache-keys)
8. [Assignee invalidation on task update](#8-assignee-invalidation-on-task-update)
9. [Redis client configuration](#9-redis-client-configuration)
10. [Environment variables](#10-environment-variables)
11. [Startup health check](#11-startup-health-check)
12. [ACL — production access control](#12-acl--production-access-control)
13. [Graceful degradation](#13-graceful-degradation)
14. [Health endpoint](#14-health-endpoint)
15. [Testing](#15-testing)
16. [Known limitations and future improvements](#16-known-limitations-and-future-improvements)

---

## 1. Why Redis

Most of the read routes in this API are expensive relative to what they return. `GET /projects/:id/tasks` joins across multiple tables, filters, paginates, and returns a full task list. If 10 requests hit that endpoint in the same 60 seconds with the same filters, that is 10 identical database queries returning identical data.

Redis sits between the service layer and PostgreSQL. The first request pays the DB cost. Every subsequent request within the TTL window hits Redis at microsecond latency instead.

The write routes (create, update, delete) delete the affected cache keys immediately so the next read always gets fresh data from the database.

---

## 2. Architecture overview

The cache lives entirely in the **service layer**. The repository layer knows nothing about Redis — it only runs SQL. The controller layer knows nothing about Redis, it only calls the service. This keeps the cache as a detail of the business logic layer, not a cross-cutting concern scattered across the codebase.

```
READ path
─────────────────────────────────────────────
Request → Controller → Service
                          │
                          ├─ auth check
                          │
                          └─ withCache(key, ttl, fn)
                                │
                                ├─ Redis HIT  → return cached JSON
                                │
                                └─ Redis MISS → call fn()
                                                  │
                                                  └─ Repository (SQL)
                                                       │
                                                       └─ store in Redis
                                                            │
                                                            └─ return result

WRITE path
─────────────────────────────────────────────
Request → Controller → Service
                          │
                          ├─ auth + permission check
                          │
                          ├─ Repository (SQL write)
                          │
                          ├─ insert activity log (tasks only)
                          │
                          └─ redis.del(...stale keys)
```

One rule is enforced without exception: **auth checks always run before any cache interaction**. You never want to serve cached data to a user who has since lost access to a project. The membership check hits the database on every request, it is not cached.

---

## 3. The withCache utility

**Location:** `src/plugins/cache.ts`

```typescript
export async function withCache<T>(
  key: string,
  ttl: number,
  fetchFunction: () => Promise<T>
): Promise<T> {
  let freshData: T | undefined;

  try {
    const cachedData = await redis.get(key);
    if (cachedData) {
      return JSON.parse(cachedData) as T;
    }

    freshData = await fetchFunction();
    await redis.set(key, JSON.stringify(freshData), 'EX', ttl);
    return freshData;
  } catch (error) {
    console.error(`Cache error for key ${key}:`, error);

    if (freshData === undefined) {
      return await fetchFunction();
    }

    return freshData;
  }
}
```

Three parameters:

- `key` — the Redis key to read from and write to
- `ttl` — time to live in seconds (60 on all routes in this project)
- `fetchFunction` — a function that returns the data if the cache misses

**Why the third argument is a function and not a value:** if you passed `taskRepository.getTasks(...)` directly, it would execute immediately regardless of whether the cache hit. Wrapping it in `() =>` means the database query only runs when `withCache` actually needs fresh data.

**The error handling flow:** there are two failure points inside the try block — the Redis read, and the Redis write (after the DB query). The `freshData` variable tracks whether the DB query already ran:

- If Redis read fails → `freshData` is still `undefined` → call the DB via `fetchFunction()` again and return
- If the DB query ran successfully but Redis write fails → `freshData` has data → return it directly without calling the DB a second time

This means the function never throws, never returns stale data, and never hits the database twice in the same request.

---

## 4. Cache key design

Each module defines its cache key helpers in one place. This is the most important structural decision in the caching layer — if the key you use to **set** a value differs by even one character from the key you use to **delete** it, the invalidation silently fails and stale data lives until TTL expires.

### Projects

```typescript
const cacheKeys = {
  allProjects: (userId: string) => `cache:projects:${userId}`,
  project: (projectId: string, userId: string) => `cache:project:${projectId}:${userId}`,
};
```

### Members

```typescript
const cacheKeys = {
  members: (projectId: string) => `cache:members:${projectId}`,
};
```

### Tasks

```typescript
const cacheKeys = {
  projectTasks: (projectId: string) => `cache:tasks:project:${projectId}`,
  task:         (taskId: string)    => `cache:task:${taskId}`,
  myTasks:      (userId: string)    => `cache:tasks:my:${userId}`,
  activity:     (taskId: string)    => `cache:task:${taskId}:activity`,
};
```

The colon-separated naming convention (`cache:tasks:project:123`) is a Redis convention. Redis doesn't treat colons as separators, they're just part of the string, but they make keys readable when inspecting Redis directly with `redis-cli keys 'cache:*'`.

### Full key inventory

| Key | Populated by | Invalidated by |
|---|---|---|
| `cache:projects:{userId}` | `getProjects` | `createProject`, `updateProject`, `deleteProject` |
| `cache:project:{projectId}:{userId}` | `getProjectById` | `updateProject`, `deleteProject` |
| `cache:members:{projectId}` | `getMembers` | `addMember`, `removeMember` |
| `cache:tasks:project:{projectId}:{filterSuffix}` | `getTasks` | `createTask`, `updateTask`, `deleteTask` |
| `cache:task:{taskId}` | `getTaskById` | `updateTask`, `deleteTask` |
| `cache:tasks:my:{userId}` | `getMyTasks` | `createTask` (if assigned), `updateTask` (assignee change), `deleteTask` |
| `cache:task:{taskId}:activity` | `getTaskActivity` | `updateTask` (status changed), `deleteTask` |

---

## 5. Read strategy

Every read route in the service layer follows the same pattern:

```typescript
// 1. Auth check — always hits the DB, never cached
const membership = await getUserProjectRole(project_id, userId);
if (!membership) throw new Error("FORBIDDEN");

// 2. Cache-wrapped DB query
return withCache(
  cacheKeys.task(task_id),
  60,
  () => taskRepository.getTaskById(task_id, project_id)
);
```

TTL is 60 seconds across all routes. This is a deliberate conservative choice — short enough that stale data is never visible for more than a minute, long enough to absorb bursts of repeated reads on the same resource.

`getMyTasks` is the simplest read, a single stable key per user, no filters:

```typescript
export async function getMyTasks(userId: string) {
  return withCache(
    cacheKeys.myTasks(userId),
    60,
    () => taskRepository.getMyTasks(userId)
  );
}
```

---

## 6. Invalidation strategy

Writes call `redis.del` on every key that could be stale after the operation. All deletes run in parallel via `Promise.all` to avoid adding serial latency to write requests.

**Invalidation always happens after the DB write succeeds**, never before. Invalidating before the write would open a race window:

```
Thread A: redis.del(key)          ← key is gone
Thread B: redis.get(key) → miss   ← B re-populates cache from DB
Thread A: DB write completes      ← DB has new data but cache has old data
                                     until TTL expires
```

By invalidating after the write, the worst case is that another request re-populates the cache between the DB write and the `redis.del`, which then gets deleted immediately. The data is always consistent within one TTL cycle.

### createTask

```typescript
await Promise.all([
  redis.del(cacheKeys.projectTasks(project_id)),
  data.assigneeId
    ? redis.del(cacheKeys.myTasks(data.assigneeId))
    : Promise.resolve(),
]);
```

A new task affects two caches: the project task list (a new item appeared), and the assignee's my-tasks view (a task appeared in their queue). If no assignee was set, the second delete is skipped cleanly.

### updateTask

```typescript
const keysToInvalidate = [
  cacheKeys.task(task_id),           // task itself changed
  cacheKeys.projectTasks(project_id), // list entry is stale
  cacheKeys.activity(task_id),        // activity log may have new entry
  cacheKeys.myTasks(userId),          // updater might be the assignee
];

// Old assignee: task may have disappeared from their queue
if (task.assignee_id)
  keysToInvalidate.push(cacheKeys.myTasks(task.assignee_id));

// New assignee: task appeared in their queue
if (data.assigneeId && data.assigneeId !== task.assignee_id)
  keysToInvalidate.push(cacheKeys.myTasks(data.assigneeId));

await Promise.all(keysToInvalidate.map(k => redis.del(k)));
```

This is the most complex invalidation. The service fetches the task's current state before writing (`getTaskForUpdatePermission`) specifically so it knows the old assignee. See [section 8](#8-assignee-invalidation-on-task-update) for the full explanation.

### deleteTask

```typescript
const keysToInvalidate = [
  cacheKeys.task(task_id),
  cacheKeys.projectTasks(project_id),
  cacheKeys.activity(task_id),
];

if (task.assignee_id)
  keysToInvalidate.push(cacheKeys.myTasks(task.assignee_id));

await Promise.all(keysToInvalidate.map(k => redis.del(k)));
```

The activity key is deleted even though the task is gone. This prevents a future task from inheriting a stale activity feed if it were somehow assigned the same ID, unlikely with UUIDs, but correct to clean up regardless.

Activity is logged **before** the delete because the task must still exist in the database when the activity row is inserted (foreign key constraint).

---

## 7. Filter-aware cache keys

The task list endpoint supports filters (`status`, `priority`, `assigneeId`) and pagination (`limit`, `offset`). Without including these in the cache key, different filter combinations would collide on the same key:

```
GET /projects/123/tasks?status=todo   → cached under cache:tasks:project:123
GET /projects/123/tasks?status=done   → hits same key → returns todo tasks ← BUG
```

The fix is to encode the active filters into the key:

```typescript
const filterSuffix = [
  filters.status     ? `s:${filters.status}`     : null,
  filters.priority   ? `p:${filters.priority}`   : null,
  filters.assigneeId ? `a:${filters.assigneeId}` : null,
  `limit:${filters.limit}`,
  `offset:${filters.offset}`,
].filter(Boolean).join(':');

const cacheKey = `${cacheKeys.projectTasks(project_id)}:${filterSuffix}`;
```

This produces distinct keys for each combination:

```
cache:tasks:project:123:s:todo:limit:20:offset:0
cache:tasks:project:123:s:done:limit:20:offset:0
cache:tasks:project:123:p:high:a:user-uuid:limit:10:offset:0
```

`filter(Boolean)` removes the `null` entries from filters that weren't provided, keeping keys clean.

**The tradeoff with invalidation:** because the task list key includes filter suffixes, `redis.del(cacheKeys.projectTasks(project_id))` only deletes the base key, not the filter variants. Those expire naturally after 60 seconds.

To bust all filter variants you would need a pattern delete:

```typescript
const keys = await redis.keys(`cache:tasks:project:${project_id}:*`);
if (keys.length) await redis.del(...keys);
```

This is avoided because `KEYS` is O(N) and blocks the Redis event loop while it scans every key. For a small project it's fine; for high traffic it isn't. At 60s TTL the inconsistency window is acceptable. See [section 16](#16-known-limitations-and-future-improvements) for the proper solution.

---

## 8. Assignee invalidation on task update

This is the subtlest part of the invalidation logic. When a task is reassigned, three different users' `myTasks` caches can become stale simultaneously:

1. **The old assignee** — the task disappeared from their queue
2. **The new assignee** — the task appeared in their queue
3. **The person making the update** — they might be the current assignee updating something else on the task

The service pre-fetches the task's current state before applying the update specifically to capture the old assignee:

```typescript
// fetched BEFORE the update runs
const task = await taskRepository.getTaskForUpdatePermission(task_id, project_id);
// task.assignee_id is the OLD assignee

// ... update runs ...

// now invalidate with knowledge of both old and new
if (task.assignee_id)
  keysToInvalidate.push(cacheKeys.myTasks(task.assignee_id)); // old

if (data.assigneeId && data.assigneeId !== task.assignee_id)
  keysToInvalidate.push(cacheKeys.myTasks(data.assigneeId));  // new
```

The `!== task.assignee_id` guard prevents adding the same key twice if someone reassigns a task to the same person it was already assigned to.

---

## 9. Redis client configuration

**Location:** `src/config/redis.ts`

```typescript
import { env } from "./env.js";
import { Redis } from "ioredis";

export const redis = new Redis({
  host:     env.REDIS_HOST,
  port:     env.REDIS_PORT,
  username: env.REDIS_USERNAME,
  password: env.REDIS_PASSWORD,
  lazyConnect:          true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue:   false,
});
```

**Why `lazyConnect: true`:** without this, ioredis connects to Redis the moment the client is instantiated — which happens at module load time, before the startup health check runs. `lazyConnect` defers the connection until `redis.connect()` is called explicitly in `checkRedisConnection()`. This gives you control over startup order.

**Why `maxRetriesPerRequest: 1`:** by default ioredis retries failed commands multiple times with exponential backoff. In a web API this means a Redis outage causes requests to hang for several seconds rather than failing fast. One retry is enough to handle a transient blip; anything more turns a Redis problem into a user-visible timeout.

**Why `enableOfflineQueue: false`:** when Redis is unreachable, ioredis by default queues commands in memory and replays them when the connection recovers. In a stateless request handler this is dangerous — queued commands from different requests can execute out of order when Redis comes back. Disabling the queue means commands fail immediately and `withCache` catches the error and falls through to the database.

**Why `env.*` instead of `process.env.*`:** the redis config imports from `env.ts` which has already been Zod-validated. Reading directly from `process.env` would bypass that validation, a missing variable would produce `undefined` silently rather than crashing on startup with a clear error.

---

## 10. Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `REDIS_HOST` | Yes | — | Redis server hostname |
| `REDIS_PORT` | No | `6379` | Coerced to number by Zod |
| `REDIS_USERNAME` | No | `undefined` | Required in production (ACL username) |
| `REDIS_PASSWORD` | No | `undefined` | Required in production (must match `acl.conf`) |

All four are defined in the Zod schema in `src/config/env.ts`:

```typescript
const envSchema = z.object({
  DATABASE_URL:    z.url(),
  PORT:            z.coerce.number().default(3000),
  HOST:            z.string().default("0.0.0.0"),
  JWT_SECRET:      z.string().min(32),
  REDIS_HOST:      z.string().min(1),
  REDIS_PORT:      z.coerce.number().default(6379),
  REDIS_USERNAME:  z.string().optional(),
  REDIS_PASSWORD:  z.string().optional(),
});
```

A common mistake is naming the variable `REDIS_USER` in `.env` when the code expects `REDIS_USERNAME`. The ioredis client receives `undefined` for the username, falls back to the `default` user, and authentication fails with `NOAUTH`. Always match the variable names exactly.

---

## 11. Startup health check

**Location:** `src/config/redis.ts`

```typescript
export async function checkRedisConnection() {
  await redis.connect();
  await redis.ping();
  console.log("Redis connection established");
}
```

**Location:** `src/index.ts`

```typescript
export const start = async () => {
  try {
    await checkDbConnection();
    await checkRedisConnection();   // ← must pass before server starts

    const app = await buildApp();
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};
```

If Redis is unreachable at startup, `checkRedisConnection` throws, the catch block logs the error, and the process exits with code 1. The server never starts in a state where the cache is broken without anyone knowing.

This mirrors the same pattern used for the database: `checkDbConnection` runs first, then `checkRedisConnection`. Both must pass before any traffic is accepted.

---

## 12. ACL — production access control

**Location:** `redis/acl.conf`

```
user default off nopass nocommands
user taskapi on >your-strong-password allkeys +get +set +del +expire +ping
```

**Why the default user is disabled:** Redis ships with a `default` user that has no password and full access to all commands. Leaving it enabled means anyone who can reach the Redis port can run `FLUSHALL` and wipe every key. Disabling it forces all connections to authenticate as a named user.

**Why `allcommands` is not used:** the application only needs five commands: `GET`, `SET` (with `EX`), `DEL`, `EXPIRE`, and `PING`. Granting `allcommands` would also give the application permission to run `FLUSHALL`, `CONFIG SET`, `DEBUG`, `REPLICAOF`, and other commands that could wipe data or change server configuration. The principle of least privilege applies here exactly as it does in any other security context.

**Why ACL files do not support comments:** this is a Redis design decision — the ACL parser expects every line to start with the `user` keyword. A `# comment` on line 1 causes Redis to abort on startup with:

```
ACL errors: /etc/redis/acl.conf:1 should start with user keyword
```

The error only appears in production (where the ACL file is mounted) and not in development (where Redis runs without an ACL file), which makes it easy to miss. Never add comments to `acl.conf`.

**Authentication flow:** ioredis with both `username` and `password` set sends `AUTH <username> <password>` (Redis 6+ style). ioredis with only `password` set sends `AUTH <password>` (old style), which authenticates as the `default` user — which is disabled in production. Both `REDIS_USERNAME` and `REDIS_PASSWORD` must be set in `.env.production` for production auth to work.

---

## 13. Graceful degradation

`withCache` never throws. If Redis is down the error is caught, logged, and the function falls through to the database:

```typescript
try {
  const cachedData = await redis.get(key);
  // ...
} catch (error) {
  console.error(`Cache error for key ${key}:`, error);
  // if fresh data not yet fetched, hit the DB directly
  if (freshData === undefined) {
    return await fetchFunction();
  }
  return freshData;
}
```

The result is that a Redis outage is invisible to the client. Requests still return correct data — at the cost of higher database load. The `/health` endpoint reports `redis: "unreachable"` so monitoring picks it up, but the API continues serving traffic.

This is intentional: Redis is a performance enhancement, not a critical dependency. The source of truth is always PostgreSQL.

---

## 14. Health endpoint

`GET /health` checks both PostgreSQL and Redis and returns a structured response:

```typescript
app.get("/health", async (request, reply) => {
  const health = {
    status:   "ok",
    database: "ok",
    redis:    "ok",
  };

  try {
    await dbPool.query("SELECT 1");
  } catch {
    health.status   = "degraded";
    health.database = "unreachable";
  }

  try {
    await redis.ping();
  } catch {
    health.status = "degraded";
    health.redis  = "unreachable";
  }

  const statusCode = health.status === "ok" ? 200 : 503;
  return reply.code(statusCode).send(health);
});
```

Returns `200` when both are healthy, `503` when either is down. Load balancers and monitoring tools that use `/health` to determine whether to route traffic will automatically pull the instance if Redis goes down, giving you a clear signal without silently serving degraded traffic.

---

## 15. Testing

Redis is mocked in the test suite. The tests do not require a live Redis instance.

```typescript
vi.mock("../../src/config/redis.js", () => ({
  default: {
    ping:    vi.fn().mockResolvedValue("PONG"),
    get:     vi.fn().mockResolvedValue(null),   // always cache miss
    set:     vi.fn().mockResolvedValue("OK"),
    del:     vi.fn().mockResolvedValue(1),
    on:      vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
  },
  redis: {
    // same shape — both named and default exports are used across the codebase
    ping:    vi.fn().mockResolvedValue("PONG"),
    get:     vi.fn().mockResolvedValue(null),
    set:     vi.fn().mockResolvedValue("OK"),
    del:     vi.fn().mockResolvedValue(1),
    on:      vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
  },
}));
```

**Why `get` returns `null`:** a null response from `redis.get` simulates a cache miss. `withCache` then calls `fetchFunction()` which hits the real test database. Integration tests still exercise actual SQL — only Redis is mocked. This is the correct split: you want tests to verify your queries are correct, not verify that your cache returns what you put in it.

**Why the mock covers both exports:** the codebase uses `import redis from` (default export) in service files and `import { redis } from` (named export) in `checkRedisConnection`. Both need to be mocked or some imports get the real client and try to connect.

**`.env.test` Redis variables:**

```dotenv
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_USERNAME=
REDIS_PASSWORD=
```

These are required because Zod validates all env vars at startup, even in test. `REDIS_USERNAME` and `REDIS_PASSWORD` are left empty because the local test Redis has no authentication configured. The mock ensures these values are never actually used to connect to anything.

---

## 16. Known limitations and future improvements

**Pattern-based invalidation for task list filters**

When a task is created, updated, or deleted, `redis.del(cacheKeys.projectTasks(project_id))` only deletes the base key, not the filter variants like `cache:tasks:project:123:s:todo:limit:20:offset:0`. Those expire naturally after 60 seconds.

The proper fix is a scan-based delete:

```typescript
const keys = await redis.keys(`cache:tasks:project:${project_id}:*`);
if (keys.length) await redis.del(...keys);
```

This is avoided because `KEYS` is O(N), it scans every key in Redis. The correct production approach is to use `SCAN` with a cursor, or to maintain a set of active keys per project and delete from that set. At 60s TTL and low traffic the current behaviour is acceptable.

**Longer TTLs with event-driven invalidation**

60 seconds is a conservative TTL. With a pub/sub invalidation system (Redis Pub/Sub or a message queue), services could publish invalidation events when data changes and subscribers could delete keys immediately — allowing TTLs of 5-10 minutes without staleness risk.

**Cache warming**

On a cold start (new deployment, Redis restart) all keys are empty. The first request for each resource pays the full DB cost. For high-traffic routes a cache warming job could pre-populate common keys after startup.

**Distributed lock for cache stampede**

If Redis is cold and 100 requests arrive simultaneously for the same key, all 100 will miss and hit the database. A distributed lock (using `SET NX` in Redis) ensures only one request fetches the data and populates the cache while the others wait. Not needed at current scale.