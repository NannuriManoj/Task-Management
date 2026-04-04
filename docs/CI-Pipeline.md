# CI Pipeline Architecture

This document explains the CI pipeline built for this project, what it does, how it is structured, every decision made, and why. It is intended to be a living reference for anyone working on or maintaining the pipeline.

---

## Table of contents

1. [Overview](#1-overview)
2. [Pipeline structure](#2-pipeline-structure)
3. [File layout](#3-file-layout)
4. [Job breakdown](#4-job-breakdown)
5. [Reusable pieces](#5-reusable-pieces)
6. [Test architecture](#6-test-architecture)
7. [Docker strategy](#7-docker-strategy)
8. [Security decisions](#8-security-decisions)
9. [Secrets and variables](#9-secrets-and-variables)
10. [Branch behaviour](#10-branch-behaviour)
11. [What runs where and when](#11-what-runs-where-and-when)
12. [Known gaps and next steps](#12-known-gaps-and-next-steps)

---

## 1. Overview

The pipeline runs on every push and pull request. Its job is to ensure that no broken code reaches `main`, and that every merge to `main` produces a versioned, production-ready Docker image pushed to Docker Hub automatically.

The pipeline is built on three principles:

**No drift between local and CI.** Every command that runs in CI also runs locally through `Taskfile.yml`. A developer running `task ci:test` locally gets the exact same behaviour as the CI test job. There are no CI-only scripts.

**Fail fast, fail clearly.** Type checking and linting run in parallel before tests. If your types are wrong or your code has lint errors, you know within seconds, before a database spins up or a Docker image builds.

**Docker push is a privilege, not a default.** The image is only built and pushed to Docker Hub when a commit lands on `main` via a direct push (i.e., a merged pull request). Feature branches and pull requests run all quality checks but never touch Docker Hub.

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

Each stage only runs if the previous one passed. A lint failure stops tests from running. A test failure stops the build. A build failure stops the Docker push. This prevents wasted compute and keeps the failure signal clean.

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
├── unit/                       # Tests with no database dependency
├── integration/                # Tests that require a real database
└── e2e/
    ├── vitest.config.e2e.ts    # Separate config for e2e tests
    └── Auth.e2e.test.ts        # E2E tests (not run in CI — see below)
```

---

## 4. Job breakdown

### setup

Exists to validate that the tooling environment is correct before any real work begins. Prints Node.js, npm, and Task versions. Serves as a fast sanity check, if `actions/checkout` or `setup-node` is broken, this job catches it before wasting time on typecheck or lint.

**Decision:** The setup job uses the same composite `setup-node` action as every other job. This ensures the environment is identical across all jobs.

---

### typecheck

Runs `npx tsc --noEmit` — compiles the entire TypeScript codebase without emitting any files. This catches type errors across all modules without needing a database or a running server.

**Decision:** TypeScript compilation is separated from the build step. The `build` job later runs `tsc` again and emits the `dist/` output. Running typecheck separately means type errors are reported early and clearly, before any database or Docker work begins.

**Why `--noEmit`?** We only want to validate types here, not produce output. The actual compiled output is produced once in the `build` job and uploaded as an artifact.

---

### lint

Runs ESLint across all TypeScript source files in `src/`. Enforces code style and catches common errors that TypeScript alone does not catch (unused variables, explicit `any` warnings, etc.).

**Decision:** Lint runs in parallel with typecheck, not after it. Both are fast static checks that do not depend on each other. Running them in parallel saves wall-clock time.

**ESLint config:** `eslint.config.js` at the project root uses the flat config format (ESLint v9+). It targets `src/**/*.ts` and excludes `dist/`, `node_modules/`, and `tests/`. The tests directory is excluded because test files intentionally use patterns (like `any` casts and inline mock apps) that would trigger lint warnings in production code.

---

### test

Calls `.github/workflows/ci-test.yml` as a reusable workflow. This job is responsible for spinning up a real PostgreSQL database, running migrations against it, and executing the full unit + integration test suite.

**Decision:** Tests are extracted into a separate reusable workflow (`ci-test.yml`) rather than defined inline in `ci.yml`. This means the test job can be called from other workflows in the future (e.g., a nightly run, a release workflow) without duplicating YAML.

**Why a real database and not mocks?** The application uses raw SQL with no ORM. Mocking the database layer would mean mocking SQL strings, which tests nothing real. The integration tests run against an actual PostgreSQL 15 instance spun up as a GitHub Actions service container. This catches real errors: constraint violations, migration problems, query bugs.

**Database credentials in plain text:** The `DATABASE_URL` and `JWT_SECRET` in `ci-test.yml` are hardcoded test-only values. They connect to a throwaway container that is destroyed after every run. There is no real data, no production system, and no secrets leak. Storing these as GitHub Secrets would add complexity with zero security benefit.

---

### build

Compiles TypeScript to `dist/` and uploads the result as a GitHub Actions artifact named `dist` with a 1-day retention. Downstream jobs (currently just `docker-push`) can download this artifact instead of recompiling.

**Decision:** The artifact approach was chosen so that `docker-push` does not need to re-run `npm install` and `tsc`. However — see the Docker strategy section — the current `Dockerfile.prod` runs its own build internally as part of the multi-stage build. The artifact is kept for auditability (you can inspect exactly what was compiled) and future use.

---

### docker-push

Builds the production Docker image using `Dockerfile.prod` and pushes it to Docker Hub. Only runs on direct pushes to `main`.

**Image tagging strategy:**

Every push to `main` produces two tags:

```
nannurimanoj17/task-api:latest
nannurimanoj17/task-api:main-<run_number>-<short_sha>
```

For example: `nannurimanoj17/task-api:main-15-3788537`

The versioned tag (`main-15-3788537`) is permanent and immutable, it identifies exactly which commit and run produced that image. The `latest` tag always points to the most recent push. This means you can always roll back to a specific image by referencing the versioned tag.

**Registry cache:** The pipeline uses `type=gha` (GitHub Actions cache) for Docker layer caching. This avoids a chicken-and-egg problem with registry-based cache (`type=registry`) where the `buildcache` tag must already exist before the first push. GitHub Actions cache is always available and requires no pre-existing state.

---

## 5. Reusable pieces

### setup-node composite action

Located at `.github/actions/setup-node/action.yml`. Every job that needs Node.js uses this action instead of repeating the same three steps inline.

What it does:

1. Installs the specified Node.js version via `actions/setup-node`
2. Restores `node_modules` from cache using `package-lock.json` as the cache key
3. Runs `npm ci` only if the cache was not hit

**Decision:** Caching `node_modules` rather than the npm cache (`~/.npm`) is faster for this project because it skips the extraction step entirely on cache hits. The trade-off is that `node_modules` caches are larger and platform-specific, the cache key includes `runner.os` to handle this.

**Why a composite action and not a reusable workflow?** Composite actions run as steps inside an existing job. Reusable workflows run as separate jobs with their own runners. For setup (which is always a prerequisite, not a standalone unit of work), a composite action is the right choice — it adds steps to the calling job rather than adding a new job with its own startup overhead.

### ci-test.yml reusable workflow

Called from `ci.yml` via `uses: ./.github/workflows/ci-test.yml`. Accepts `node-version` as an input and inherits all secrets from the parent workflow.

The workflow spins up a `postgres:15` service container, waits for it to be healthy, runs migrations, then runs the test suite. The entire environment is self-contained, no external dependencies, no shared state with other runs.

### Taskfile.yml

The `Taskfile.yml` at the project root is the single entrypoint for every command used in CI and locally. Every CI job calls a `task` command rather than running `npx` or `npm run` directly.

```
task ci:typecheck  →  npx tsc --noEmit
task ci:lint       →  npx eslint "src/**/*.ts"
task ci:test       →  npx vitest run --config tests/vitest.config.ts
task ci:build      →  npx tsc
task migrate       →  npm run migrate
```

**Why Task?** Task provides a consistent interface that works identically on macOS, Linux, and Windows. It also supports up-to-date checks (skipping tasks when sources haven't changed), which speeds up local development. In CI, the up-to-date checks are bypassed because every run starts with a fresh checkout — but the commands themselves remain identical.

---

## 6. Image naming

```
nannurimanoj17/task-api:latest
nannurimanoj17/task-api:main-<run_number>-<short_sha>
```

The versioned tag is constructed in the `Build image tag` step:

```bash
SHORT_SHA="${{ github.sha }}"
SHORT_SHA="${SHORT_SHA:0:7}"
IMAGE_TAG="${{ github.ref_name }}-${{ github.run_number }}-${SHORT_SHA}"
```

This produces tags like `main-15-3788537` — human-readable (branch + run number) and unique (commit SHA). Run number alone is not sufficient because it resets if the repository is forked or recreated.

---

## 7. Security decisions

### Pinned action SHAs

All GitHub Actions are pinned to exact commit SHAs rather than version tags. Version tags (like `@v4`) are mutable, a compromised action maintainer could push malicious code to an existing tag without changing the tag name. A SHA pin is immutable.

### Minimal permissions

The top-level `ci.yml` declares `permissions: contents: read`. Each job only has the permissions it needs. The `docker-push` job overrides to `contents: read` explicitly. The `stale.yml` workflow declares `issues: write` and `pull-requests: write`, the minimum required for the stale action to label and close items.

### Production environment gate

The `docker-push` job is scoped to the `production` environment in GitHub. This enables environment protection rules, you can add required reviewers, deployment branch restrictions, or wait timers in the GitHub repository settings under Environments → production.

### Docker Hub credentials

`DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` are stored as GitHub repository secrets. The token uses **Read, Write, Delete** scope on Docker Hub. A Personal Access Token is used rather than the account password, tokens can be revoked individually without changing the account password.

---

## 8. Secrets and variables

### Required secrets

These must be set in **Settings → Secrets and variables → Actions → Secrets** before the pipeline will work end to end.

| Secret | Used by | Description |
|---|---|---|
| `DOCKERHUB_USERNAME` | `docker-push` job | Docker Hub username for image tagging and login |
| `DOCKERHUB_TOKEN` | `docker-push` job | Docker Hub Personal Access Token with Read/Write/Delete scope |

### Required environments

A `production` environment must exist in **Settings → Environments**. The `docker-push` job references it. Without it, the job fails to start. No variables need to be set inside the environment, it exists to enable protection rules if needed.

### No secrets needed for tests

The test database credentials (`DATABASE_URL`, `JWT_SECRET`, `PORT`) are hardcoded directly in `ci-test.yml`:

```yaml
DATABASE_URL: postgres://postgres:postgres@localhost:5432/task_api_test
JWT_SECRET: test-jwt-secret-that-is-long-enough-for-validation
```

These are throwaway values for a temporary container. They are not secrets.

### Local development

Create a `.env.test` file at the project root (it is gitignored) for running tests locally:

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/task_api_test
JWT_SECRET=test-jwt-secret-that-is-long-enough-for-validation
PORT=3001
HOST=0.0.0.0
```

`tests/setup.ts` loads this file automatically when `NODE_ENV=test`.

---

## 9. Branch behaviour

### Trigger rules

The pipeline triggers on:

- Push to `main`, `dev`, or any `feature/**` branch
- Pull request targeting `main` or `dev`
- Manual dispatch (`workflow_dispatch`) with optional `node-version` and `debug` inputs

Pushes that only change documentation are ignored via `paths-ignore`:

```yaml
paths-ignore:
  - '**.md'
  - '.gitignore'
  - '.env.example'
  - 'docs/**'
```

### Concurrency

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
```

On feature branches and `dev`, if a new push arrives while a previous run is still going, the old run is cancelled. This prevents a queue of stale runs building up during active development.

On `main`, cancellation is disabled. Every push to `main` represents a merge and must complete fully, a Docker image must be produced for every merge.

---

## 10. What runs where and when

| Job | feature/** | dev | PR → main | push → main |
|---|---|---|---|---|
| setup | ✓ | ✓ | ✓ | ✓ |
| typecheck | ✓ | ✓ | ✓ | ✓ |
| lint | ✓ | ✓ | ✓ | ✓ |
| test | ✓ | ✓ | ✓ | ✓ |
| build | ✓ | ✓ | ✓ | ✓ |
| docker-push | ✗ | ✗ | ✗ | ✓ |

The `docker-push` condition:

```yaml
if: github.ref == 'refs/heads/main' && github.event_name == 'push'
```

A pull request into `main` has `github.event_name == 'pull_request'`, so it does not trigger a push. Only the merge commit that lands on `main` triggers the Docker push.

---

## 11. Known gaps and next steps

### Tests not yet written

The current test suite only covers the `auth` module. The following modules have no tests:

- `projects` — CRUD, ownership checks, transaction rollback on create failure
- `members` — invite by email, duplicate prevention, owner-only removal
- `tasks` — full permission matrix (creator/assignee/owner/member), activity log, filters
- `GET /tasks/my` — cross-project assignee query
- `GET /projects/:id/tasks/:taskId/activity` — audit trail endpoint

These are the most complex parts of the application and should be the next priority.

### E2E pipeline stage

The e2e tests exist but have no CI home. When a staging environment is available, add a `deploy-staging` job after `docker-push` and a subsequent `e2e` job that runs `task test:e2e` against the staging URL.

### Continuous deployment

The pipeline currently stops at Docker Hub. A `cd.yml` workflow should be added when a production server exists. It would:

1. Trigger on successful completion of `ci.yml` on `main`
2. SSH into the server
3. Pull the new image tag
4. Run `docker compose up -d` with zero-downtime restart

### npm audit

The build logs show 2 critical severity vulnerabilities in the production dependencies. Run `npm audit` to identify them and `npm audit fix` to resolve where possible. Consider adding an `npm audit --audit-level=critical` step to the CI pipeline to block builds with unresolved critical vulnerabilities.

### Dependabot

Add a `.github/dependabot.yml` to automatically receive pull requests when action SHAs and npm dependencies have updates:

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