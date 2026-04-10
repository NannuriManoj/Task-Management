# CI Pipeline

This document covers the full GitHub Actions CI pipeline: what it does, how every job is structured, every decision made, and why.

---

## Table of contents

1. [What the pipeline does](#1-what-the-pipeline-does)
2. [Pipeline structure](#2-pipeline-structure)
3. [File layout](#3-file-layout)
4. [Trigger rules](#4-trigger-rules)
5. [Job breakdown](#5-job-breakdown)
6. [Reusable pieces](#6-reusable-pieces)
7. [Test architecture](#7-test-architecture)
8. [Docker build and push](#8-docker-build-and-push)
9. [Image tagging strategy](#9-image-tagging-strategy)
10. [Security decisions](#10-security-decisions)
11. [Secrets and environments](#11-secrets-and-environments)
12. [Concurrency](#12-concurrency)
13. [Branch behaviour](#13-branch-behaviour)
14. [What runs where and when](#14-what-runs-where-and-when)
15. [Known gaps and next steps](#15-known-gaps-and-next-steps)

---

## 1. What the pipeline does

The pipeline runs on every push and pull request. Its job is to ensure that no broken code reaches `main`, and that every merge to `main` produces a versioned, production-ready Docker image pushed to Docker Hub.

Three principles guide the design:

**No drift between local and CI.** Every command that runs in CI also runs locally through `Taskfile.yml`. A developer running `task ci:test` locally gets the same behaviour as the CI test job. There are no CI-only scripts.

**Fail fast, fail clearly.** Type checking and linting run in parallel before tests. If your types are wrong, you know within seconds — before a database spins up or a Docker image builds.

**Docker push is a privilege, not a default.** The image is only built and pushed to Docker Hub when a commit lands on `main` via a direct push (a merged pull request). Feature branches and PRs run all quality checks but never touch Docker Hub.

---

## 2. Pipeline structure

```
push / pull_request
        │
        ▼
┌──────────────┐
│    setup     │  Validates tooling, prints versions
└──────┬───────┘
       │
       ├─────────────────────┐
       ▼                     ▼
┌──────────────┐    ┌──────────────┐
│  typecheck   │    │     lint     │  Run in parallel
└──────┬───────┘    └──────┬───────┘
       └─────────┬──────────┘
                 ▼
        ┌──────────────┐
        │     test     │  Calls ci-test.yml (reusable workflow)
        └──────┬───────┘
               ▼
        ┌──────────────┐
        │    build     │  Compiles TypeScript → dist/
        └──────┬───────┘
               ▼
        ┌──────────────┐
        │ docker-push  │  Only on push to main
        └──────────────┘
```

Each stage only runs if the previous one passed. A lint failure stops tests from running. A test failure stops the build. A build failure stops the Docker push. This prevents wasted compute and keeps the failure signal clean, you always know exactly which stage broke and why.

---

## 3. File layout

```
.github/
├── actions/
│   └── setup-node/
│       └── action.yml          # Composite action: Node.js + cache + npm ci
└── workflows/
    ├── ci.yml                  # Main pipeline — all jobs
    ├── ci-test.yml             # Reusable test workflow (called by ci.yml)
    └── stale.yml               # Automatic stale issue/PR management

Taskfile.yml                    # Single source of truth for all commands
tests/
├── vitest.config.ts            # Config for unit + integration tests
├── setup.ts                    # Global test setup (NODE_ENV, dotenv)
├── helpers.ts                  # Shared test utilities
├── unit/
├── integration/
│   └── database.test.ts
└── e2e/
    ├── vitest.config.e2e.ts
    └── Auth.e2e.test.ts
```

---

## 4. Trigger rules

The pipeline triggers on:

- Push to `main`, `dev`, or any `feature/**` branch
- Pull request targeting `main` or `dev`
- Manual dispatch (`workflow_dispatch`) with optional `node-version` and `debug` inputs

Pushes that only change documentation are ignored:

```yaml
paths-ignore:
  - '**.md'
  - '.gitignore'
  - '.env.example'
  - 'docs/**'
```

This prevents the full pipeline from running when someone fixes a typo in the README.

---

## 5. Job breakdown

### setup

Validates that the tooling environment is correct before any real work begins. Prints Node.js, npm, and Task versions. If `actions/checkout` or `setup-node` is broken, this job catches it within seconds before wasting time on typecheck or Docker builds.

Every job uses the same composite `setup-node` action, this ensures the environment is identical across all jobs in the pipeline.

### typecheck

```bash
task ci:typecheck  →  npx tsc --noEmit
```

Runs TypeScript compilation across the entire codebase without emitting files. Catches type errors across all modules without needing a database or a running server.

**Why `--noEmit`:** this step is only for validation. Emitting output here and then emitting again in the `build` job would compile the same code twice. `--noEmit` is fast and produces no artifacts — the actual compiled output is produced once in `build` and uploaded as an artifact.

**Why this is separate from `build`:** type errors are reported early and clearly, before any database or Docker work begins. If your types are wrong, you know in ~15 seconds. If typecheck ran only as part of the build step, you'd wait for it to get to that stage.

### lint

```bash
task ci:lint  →  npx eslint "src/**/*.ts"
```

Runs ESLint across all TypeScript source files. Catches common errors that TypeScript alone does not: unused variables, explicit `any` warnings, and code style violations.

**Why lint runs in parallel with typecheck:** both are fast static checks that have no dependencies on each other or on any external service. Running them in parallel saves wall-clock time on every push.

**Why `tests/` is excluded from lint:** test files intentionally use patterns that would trigger lint warnings in production code — `any` casts, inline mock factories, imports that only exist in test context. Excluding them from lint avoids false positives.

### test

Calls `.github/workflows/ci-test.yml` as a reusable workflow. Spins up a real PostgreSQL database as a GitHub Actions service container, runs migrations against it, and executes the full test suite.

See [section 7](#7-test-architecture) for the full breakdown.

### build

```bash
task ci:build  →  npx tsc
```

Compiles TypeScript to `dist/` and uploads the result as a GitHub Actions artifact named `dist` with a 1-day retention period.

The artifact approach means `docker-push` can download the compiled output instead of re-running `npm install` and `tsc`. In practice, `Dockerfile.prod` runs its own build internally as part of the multi-stage build — the artifact is kept for auditability (you can inspect exactly what was compiled for any run) and as a foundation for a future deploy step that might pull the artifact directly.

### docker-push

Builds the production Docker image using `Dockerfile.prod` and pushes it to Docker Hub. Only runs on direct pushes to `main`.

```yaml
if: github.ref == 'refs/heads/main' && github.event_name == 'push'
```

A pull request into `main` has `github.event_name == 'pull_request'`, it does not trigger a push. Only the merge commit that lands on `main` triggers the Docker push.

---

## 6. Reusable pieces

### setup-node composite action

**Location:** `.github/actions/setup-node/action.yml`

Every job that needs Node.js uses this action instead of repeating the same three steps inline.

```yaml
steps:
  - uses: actions/setup-node@<sha>
    with:
      node-version: ${{ inputs.node-version }}

  - uses: actions/cache@<sha>
    id: cache
    with:
      path: node_modules
      key: ${{ runner.os }}-node-${{ inputs.node-version }}-${{ hashFiles('package-lock.json') }}

  - if: steps.cache.outputs.cache-hit != 'true'
    run: npm ci
```

**Why cache `node_modules` and not `~/.npm`:**

Caching `node_modules` skips the extraction step entirely on a cache hit, Docker just restores the directory. Caching `~/.npm` (the npm cache) still requires `npm ci` to run, which reads from the cache but still writes to `node_modules`. `node_modules` is larger but faster.

The cache key includes `runner.os` because `node_modules` contains platform-specific binaries. A cache built on Linux cannot be reused on macOS.

**Why a composite action and not a reusable workflow:**

Composite actions run as steps inside an existing job. Reusable workflows run as separate jobs with their own runners. For setup, which is always a prerequisite, never a standalone unit of work — a composite action is correct. It adds steps to the calling job rather than adding a new job with startup overhead and a separate billing unit.

### ci-test.yml reusable workflow

**Location:** `.github/workflows/ci-test.yml`

Called from `ci.yml` via `uses: ./.github/workflows/ci-test.yml`. Accepts `node-version` as an input and inherits secrets from the parent workflow.

The workflow spins up a `postgres:15` service container, waits for it to be healthy, runs migrations, then runs the test suite. The entire environment is self-contained.

**Why the test job is a separate reusable workflow:**

Extracted into its own file so it can be called from other workflows in the future, a nightly run, a release workflow, a manual test trigger, without duplicating YAML. The test infrastructure is defined once.

### Taskfile.yml

The `Taskfile.yml` at the project root is the single entrypoint for every command used in CI and locally.

```
task ci:typecheck  →  npx tsc --noEmit
task ci:lint       →  npx eslint "src/**/*.ts"
task ci:test       →  npx vitest run --config tests/vitest.config.ts
task ci:build      →  npx tsc
task migrate       →  npm run migrate
```

Every CI job calls a `task` command rather than running `npm run` or `npx` directly. This ensures that `task ci:test` run locally produces exactly the same behaviour as the CI test job — no CI-only scripts, no drift.

---

## 7. Test architecture

**Why a real database and not mocks:**

The application uses raw SQL with no ORM. Mocking the database layer would mean mocking SQL strings — which tests nothing real. You could write a test that passes against a mock while the actual query has a syntax error or a missing join. The integration tests run against an actual `postgres:15` instance spun up as a service container. This catches real constraint violations, migration problems, and query bugs.

**Why database credentials are hardcoded in ci-test.yml:**

```yaml
DATABASE_URL: postgres://postgres:postgres@localhost:5432/task_api_test
JWT_SECRET: test-jwt-secret-that-is-long-enough-for-validation
```

These connect to a throwaway container that is destroyed after every run. There is no real data. There are no production systems involved. Storing these as GitHub Secrets would add indirection and complexity with zero security benefit, secrets are for values that are actually secret.

**Redis in tests:**

Redis is mocked entirely in the test suite. Tests do not require a live Redis instance. The mock covers both the named and default exports since the codebase uses both:

```typescript
vi.mock("../../src/config/redis.js", () => ({
  default: {
    ping: vi.fn().mockResolvedValue("PONG"),
    get:  vi.fn().mockResolvedValue(null),  // always cache miss → hits real test DB
    set:  vi.fn().mockResolvedValue("OK"),
    del:  vi.fn().mockResolvedValue(1),
    on:   vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
  },
  redis: { /* same shape */ }
}));
```

`get` returning `null` simulates a cache miss. `withCache` then calls the repository, which hits the real PostgreSQL test database. Integration tests still exercise actual SQL, only Redis is mocked. This is the correct split: tests verify SQL correctness, not that Redis returns what you put in.

**Why the `/health` test broke after adding Redis:**

The `/health` route was updated to check both PostgreSQL and Redis. The test suite builds a real app and hits the health endpoint. Without Redis running in the test environment, the Redis ping fails and `/health` returns `503`. The fix is mocking Redis before building the app, `vi.mock` hoisting ensures the mock is in place before the module is imported.

---

## 8. Docker build and push

The `docker-push` job uses `docker/build-push-action` with `docker/setup-buildx-action` for multi-platform support and layer caching.

**Registry cache with `type=gha`:**

```yaml
cache-from: type=gha
cache-to: type=gha,mode=max
```

GitHub Actions cache (`type=gha`) is used instead of registry-based cache (`type=registry`). Registry cache requires a `buildcache` tag to already exist in the registry before the first push — a chicken-and-egg problem on a fresh repository. GitHub Actions cache is always available and requires no pre-existing state.

`mode=max` caches all layers, including intermediate stages from the multi-stage build. This means the `builder` stage is cached separately from the `prod` stage. On subsequent runs, if only the application code changed (not `package.json`), the `npm ci` and dependency installation layers are reused from cache.

---

## 9. Image tagging strategy

Every push to `main` produces two tags:

```
nannurimanoj17/task-api:latest
nannurimanoj17/task-api:main-<run_number>-<short_sha>
```

For example: `nannurimanoj17/task-api:main-15-3788537`

**Why two tags:**

`latest` always points to the most recent build, useful for `docker pull task-api:latest` when you want the current version without thinking about it.

The versioned tag (`main-15-3788537`) is permanent and immutable. It identifies exactly which commit and CI run produced that image. This is what you reference for rollbacks:

```bash
# Rollback to a specific version
docker pull nannurimanoj17/task-api:main-14-abc1234
docker compose up -d
```

`latest` alone is not enough for rollbacks because it moves with every push.

**How the tag is constructed:**

```bash
SHORT_SHA="${{ github.sha }}"
SHORT_SHA="${SHORT_SHA:0:7}"
IMAGE_TAG="${{ github.ref_name }}-${{ github.run_number }}-${SHORT_SHA}"
```

Run number alone is insufficient — it resets if the repository is forked or recreated. The commit SHA makes it globally unique. The branch name (`main`) makes it human-readable.

---

## 10. Security decisions

### Pinned action SHAs

All GitHub Actions are pinned to exact commit SHAs rather than mutable version tags:

```yaml
# Vulnerable — tag can be silently updated with malicious code
- uses: actions/checkout@v4

# Safe — SHA is immutable
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
```

Version tags like `@v4` are mutable. A compromised action maintainer could push malicious code to an existing tag without changing the tag name and every workflow using `@v4` would silently execute the new code on the next run.

### Minimal permissions

The top-level `ci.yml` declares `permissions: contents: read`. Each job only has the permissions it needs. The `stale.yml` workflow declares `issues: write` and `pull-requests: write`, the minimum required for the stale action to close items.

Not declaring permissions defaults to the repository's default token permissions, which are often too broad. Declaring them explicitly means a compromised dependency can only do what your workflow actually needs.

### Production environment gate

The `docker-push` job references the `production` environment:

```yaml
jobs:
  docker-push:
    environment: production
```

This enables GitHub's environment protection rules. You can add required reviewers (a human must approve before the Docker push runs), deployment branch restrictions (only `main` can deploy to `production`), or wait timers in Settings → Environments → production. The environment gate is in place even if no protection rules are configured yet, adding them later requires no pipeline changes.

### Docker Hub access token

`DOCKERHUB_TOKEN` is a Docker Hub Personal Access Token with Read, Write, Delete scope, not the account password. Tokens can be revoked individually without changing the account password. If the token is ever leaked, you revoke it without disrupting other services or requiring a password change.

---

## 11. Secrets and environments

### Required secrets

Set in **Settings → Secrets and variables → Actions → Secrets**:

| Secret | Used by | Description |
|---|---|---|
| `DOCKERHUB_USERNAME` | `docker-push` | Docker Hub username for image tagging and login |
| `DOCKERHUB_TOKEN` | `docker-push` | Personal Access Token with Read/Write/Delete scope |

### Required environments

A `production` environment must exist in **Settings → Environments**. The `docker-push` job references it by name. Without it, the job fails to start. No variables need to be set inside the environment — it exists to enable protection rules.

### No secrets for tests

The test database credentials are hardcoded in `ci-test.yml`:

```yaml
DATABASE_URL: postgres://postgres:postgres@localhost:5432/task_api_test
JWT_SECRET: test-jwt-secret-that-is-long-enough-for-validation
```

These are throwaway values for a temporary container. They are not secrets.

---

## 12. Concurrency

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
```

On feature branches and `dev`: if a new push arrives while a previous run is still going, the old run is cancelled. This prevents a queue of stale runs building up during active development — when you push five times in quick succession while debugging, you only care about the last run.

On `main`: cancellation is disabled. Every push to `main` represents a merge and must complete fully. A Docker image must be produced for every merge. If you could cancel a `main` run, you could end up with a gap in your Docker image history.

---

## 13. Branch behaviour

| Branch | Trigger | What happens |
|---|---|---|
| `feature/**` | push | setup → typecheck + lint → test → build |
| `dev` | push | setup → typecheck + lint → test → build |
| any branch | PR to `main` or `dev` | setup → typecheck + lint → test → build |
| `main` | push (merged PR) | setup → typecheck + lint → test → build → docker-push |

The `paths-ignore` filter applies across all branches, a push to `feature/my-feature` that only changes `.md` files does not trigger any jobs.

---

## 14. What runs where and when

| Job | feature/** push | dev push | PR → main | push → main |
|---|---|---|---|---|
| setup | ✓ | ✓ | ✓ | ✓ |
| typecheck | ✓ | ✓ | ✓ | ✓ |
| lint | ✓ | ✓ | ✓ | ✓ |
| test | ✓ | ✓ | ✓ | ✓ |
| build | ✓ | ✓ | ✓ | ✓ |
| docker-push | ✗ | ✗ | ✗ | ✓ |

---

## 15. Known gaps and next steps

### Tests only cover auth

The current suite only covers the auth module and the database health check. The following have no tests:

- `projects` — CRUD, ownership checks, transaction rollback on create failure
- `members` — invite by email, duplicate prevention, owner-only removal
- `tasks` — full permission matrix (creator/assignee/owner), activity log, filters, assignee invalidation
- `GET /tasks/my` — cross-project assignee query
- `GET /projects/:id/tasks/:taskId/activity` — audit trail endpoint

These are the most complex parts of the application and carry the highest risk. They should be the next testing priority.

### E2E pipeline stage

E2E tests exist locally but have no CI home. When a staging environment is available, add a `deploy-staging` job after `docker-push` and a subsequent `e2e` job that runs against the staging URL:

```yaml
e2e:
  needs: deploy-staging
  steps:
    - run: task test:e2e
      env:
        API_URL: ${{ vars.STAGING_URL }}
```

### Continuous deployment

The pipeline currently stops at Docker Hub. A `cd.yml` workflow should be added when a production server exists. It would trigger on successful `ci.yml` completion on `main`, SSH into the server, pull the new versioned image tag, and run `docker compose up -d`.

### npm audit gate

Running `npm audit` shows vulnerabilities in production dependencies. Adding an audit step to CI would block builds with unresolved critical vulnerabilities:

```yaml
- run: npm audit --audit-level=critical
```

This prevents known vulnerable packages from reaching production without a deliberate decision.

### Dependabot

Add `.github/dependabot.yml` to receive automated PRs when action SHAs and npm dependencies have updates:

```yaml
version: 2
updates:
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
```

Pinned SHAs protect against supply-chain attacks but require manual updates when you want to pull in security fixes. Dependabot automates this.
