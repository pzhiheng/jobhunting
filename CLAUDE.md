# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal SWE/MLE **job-hunting platform**: it finds jobs from job-board APIs,
curates them against the user's profile and résumé, tracks application progress
from the user's inbox, surfaces in-demand skills to learn, and emails a daily
digest — with a local web tracker UI. Built **incrementally in numbered phases**.

**Current state:** Phases 1–6 are implemented (data+ingest, judgment, web app,
email+refine, analyst, and the `/schedule` digest routine). See `PROGRESS.md`
for the authoritative phase status and `ROUTINE.md` for the daily deployment.

The development process is itself part of the project — see "Working in this repo".

## Commands

```bash
npm install                       # deps

npm run configure "<request>"     # NL request → structured filter.json (+ request.md)
npm run configure                 # no arg: re-parse the saved request.md
npm run fetch                     # run sources per filter.json → upsert into the DB

npx tsc --noEmit                  # typecheck (no emit)
npm run build                     # tsc → dist/

npm test                          # unit + integration + API tests (node:test via tsx, ~0.6s)
npm run test:e2e                  # Playwright browser E2E (14 tests, ~5s; requires chromium)
npm run test:all                  # both suites in sequence
```

**Test layout** (`test/`):
- `unit/` — pure logic (assertReadOnly, filter/toSearchConfig, mock judgment, adzuna normalize)
- `integration/` — in-memory libSQL (upsertJob dedup/refresh, buildDigest, curate mock loop)
- `api/` — real Express app on port 0 (all endpoints, stage 200/400/404, /api/run allow-list)
- `e2e/` — Playwright headless Chromium (tabs, stage select, Run command, skills panel)
- `helpers/` — `tmpdb.ts` (in-memory isolated DB), `fixture.ts` (deterministic offline dataset)

Tests use isolated in-memory DBs (`openDb(":memory:")`). They never touch `jobs.db`,
`.env`, or make network/LLM calls. The Playwright `webServer` boots `fixture-server.ts`
(in-memory DB + fixture) on port 3333 — no real server process needed for other suites.

## Environment (`.env`, see `.env.example`)

- `ANTHROPIC_API_KEY` — required by `configure` (the NL→filter parse).
- `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` — required by `fetch` (free key at developer.adzuna.com).
- `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` — **optional**. If unset, the DB falls
  back to a local `file:jobs.db`. Set both for the shared hosted database.

## Architecture (big picture)

**Pipeline:** `configure` (natural language → `filter.json`) → `fetch` (job-board
APIs → libSQL `jobs`) → [future phases: relevance/résumé curation → link
verification/repair → skills analysis → digest email; plus a local web tracker
and a Gmail poller that advances application stages].

Three runtimes are planned around **one database**: a daily cloud routine
(`/schedule`), a local web app (tracker), and a local Gmail poller. That's why
the DB is libSQL/Turso (a shared client), not an in-process file by default.

### Key modules (`src/`)

- **`filter.ts`** — the heart of configuration. A "filter" has **two halves**,
  both produced from one NL request: `searches[]` (`{category, what, where}` —
  the API-executable queries) and `criteria` (`{seniority, mustHaves[],
  dealbreakers[], scoringRubric}` — the judgment a later curation step scores
  against). `FilterSchema`/`ParsedFilterSchema` are **zod v4** schemas reused for
  both structured-output parsing and load-time validation. `toSearchConfig()`
  extracts the slice a source needs.
- **`configure.ts`** — turns the request into a filter via the Anthropic SDK
  (`client.messages.parse` + `zodOutputFormat`, model `claude-sonnet-4-6`).
  Writes `filter.json` (generated) and `request.md` (the editable NL source).
- **`db.ts`** — libSQL data layer (`@libsql/client`, **async**). `openDb()`
  creates the **entire schema up front** (later phases only populate, never
  migrate): `jobs` (22 cols incl. `relevance`, `suitability`, `link_status`,
  `stage`, `status`), plus `job_skills`, `app_events`, `analyses`, and a
  `skill_demand` view. `upsertJob()` dedups on `jobs.id` (`source:external_id`).
- **`sources/`** — pluggable `JobSource` interface consuming a `SearchConfig`.
  `adzuna.ts` is the only source today; company career boards
  (Greenhouse/Lever/Ashby) are planned as additional sources.
- **`fetch.ts`** — loads + validates `filter.json`, runs every source, upserts.
  Per-source `try/catch` so one source failing doesn't abort the run.

### Non-obvious constraints

- **`filter.json` is generated, not hand-edited.** Edit intent via `request.md`
  (or pass a new string to `configure`); regenerate. `profile.json`/`profile.md`
  were the old hand-edited config and have been retired.
- **Zod must be v4 and the SDK ≥ 0.105.** The SDK's `helpers/zod`
  (`zodOutputFormat`, `messages.parse`) is built against zod v4 internals; zod v3
  fails to typecheck and older SDKs (e.g. 0.65) lack the helper entirely.
- The DB layer is fully **async** (libSQL), unlike a typical better-sqlite3
  setup — `openDb()` and `upsertJob()` are awaited.

## Working in this repo (the build process)

This project is built by an **independent-verifier loop**, and the meta-files are
load-bearing — read them before continuing the build:

- **`~/.claude/plans/snappy-foraging-stonebraker.md`** — the approved plan:
  full architecture, data model, the 5-role build team (Planner/Coder/Reviewer/
  Tester/Debugger), and the phased build order with per-phase success criteria.
- **`PROGRESS.md`** — source of truth for which phase is active and its checklist.
  Update it at every checkpoint; one git commit per phase.
- **`RESUMING.md`** — how to resume a paused build.
- **`VERIFY.md`** (when present) — the latest independent verifier verdict.

Convention: each phase ends with a commit + `PROGRESS.md` update, then an
independent fresh-context subagent verifies against the phase's criteria before
advancing. Build-side roles (Planner/Coder/Debugger) share context; Reviewer and
Tester run as fresh, independent subagents so they don't grade the builder's own
work. Commits are checkpoints — commit per completed phase.
