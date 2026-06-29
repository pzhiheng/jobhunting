# Build progress

Source of truth for where the build is. Updated at every phase checkpoint.
See `RESUMING.md` for how to resume a paused build, and the approved plan at
`~/.claude/plans/snappy-foraging-stonebraker.md` for full detail.

**Current phase:** ✅ Build complete — all 6 phases implemented and independently
verified. Testing + debugging phase added (see Phase 7 below).
Remaining work is a **user action**: populate `.env` (Anthropic/Adzuna/
Turso/Google) + `resume.*`, run `configure`, then deploy `ROUTINE.md` via
`/schedule` with the Gmail connector.
**Next action:** none in the build loop. Credentialed happy-paths (real fetch,
real LLM judgment quality, real Gmail send) are exercised on first deploy.

**LIVE — running for real (2026-06-26).** Credentials in `.env`; `resume.md`
(text) + `filter.json` configured for US SWE/ML/DS **internships** (title-only,
7-day window). Hardened against real Adzuna/Anthropic behavior: short `what`
queries, 403≠broken link check, Haiku for curate, Adzuna pagination (`maxPages`),
`titleOnly` precision (53%→99% intern-titled). Deployed as a **Claude daily
routine** ("job-hunter-daily-digest", 4:01 PM, runs the pipeline + emails the
digest via Gmail). Runs locally while the Claude app is open.

**Shipped enhancements:**
- **B — Direct company links** (`0bfed6f`): `src/sources/companyBoards.ts` — keyless
  Greenhouse/Lever/Ashby boards (companies in `companies.json`) → **direct employer
  apply URLs**. Title-filtered via `makeKeepFilter` (word-boundary intern gate +
  role keywords). Verified live: 23 intern postings, all direct (200, no Adzuna
  redirect).
- **A — Batch curate**: `judge.ts` gains `judgeJobsBatch` (Message Batches API,
  50% cheaper, no rate-limit pacing); `curate.ts` submits one batch per run.
  Verified live (2-job batch, ~2 min, correct discrimination). Errored requests
  are deferred (stay `new`, retried next run). `judgeJob` (single) retained for
  the mock + any non-batch use.

**Backlog idea:** company-board source could also pre-drop PhD-required titles to
save curate calls (currently left to the criteria dealbreaker).

**Backlog (non-blocking, from verifiers):** analyze gap uses naive substring
`includes` (e.g. "Go" suppressed by "good" in résumé) — word-boundary match
would be cleaner; repair-links greedy JSON regex (safe);
app_events email_id no UNIQUE + non-atomic check-insert (fine for serial CLI);
findJob bidirectional substring could mis-match short company names.
Fixed: `analyze` db.close() now in `finally`; digest plural ("1 top pick").

---

## Phases

- [x] **Phase 0 — Resume & progress docs** (committed `334a621`)
- [x] **Phase 1 — Data + ingest** (committed `6aeb070`; independently verified
      → `VERIFY.md`: **PASS WITH NOTES**, all 6 criteria green)
  - [x] `package.json`: dropped better-sqlite3 → `@libsql/client`,
        `@anthropic-ai/sdk@0.105`, `zod@4`; scripts `configure`, `fetch`
  - [x] `src/filter.ts`: zod `FilterSchema`/`ParsedFilterSchema` + `toSearchConfig`
  - [x] `src/db.ts`: libSQL client (Turso URL, else local `file:jobs.db`),
        full schema (jobs+22 cols, job_skills, app_events, analyses,
        skill_demand view), async `upsertJob` (dedup)
  - [x] `src/sources/types.ts` (`SearchConfig`) + `adzuna.ts` updated
  - [x] `src/fetch.ts`: load `filter.json` → run sources → async upsert → summary
  - [x] `src/configure.ts`: NL → filter via `messages.parse` + `zodOutputFormat`
        (sonnet-4-6); persist `filter.json` + `request.md`
  - [x] retired `profile.json` / `profile.md`; removed old `src/index.ts`
  - [x] `.env.example`: added `ANTHROPIC_API_KEY`, `TURSO_*`
  - Self-smoke ✅: typecheck clean; configure & fetch error clearly on missing
        creds; schema builds (4 tables + view, 22 jobs cols); fetch degrades
        gracefully without Adzuna keys.
  - ⏳ Credentialed happy-paths (real configure with ANTHROPIC key, real fetch
        with ADZUNA keys) pending user-provided credentials — not a defect.
- [x] **Phase 2 — Judgment** (committed `d48d8c1`; independently verified
      → `VERIFY.md`: **PASS WITH NOTES**, all 5 criteria green)
  - [x] `src/judge.ts`: `JudgmentSchema` + `judgeJob()` (real messages.parse
        sonnet-4-6 w/ résumé+criteria; deterministic mock under `JOBHUNTER_MOCK`)
  - [x] `src/resume.ts`: load `resume.md`/`resume.pdf` (null-tolerant)
  - [x] `src/curate.ts` (`npm run curate`): relevance + suitability + job_skills;
        status→'reviewed'; never deletes
  - [x] `src/check-links.ts` (`npm run check-links`): real HTTP HEAD/GET →
        link_status ok|broken + link_checked_at
  - [x] `src/repair-links.ts` (`npm run repair-links`): broken → repaired/expired
        (real LLM+web_search; mock deterministic); never deletes
  - [x] `src/seed.ts` (`npm run seed`): 4 mock jobs (2 good + 2 bad URLs)
  - Self-smoke ✅ (mock): seed→curate→check-links→repair-links →
        relevance/suitability/job_skills set, 2 suitable + 2 unsuitable (kept),
        2 links ok / 2 broken→expired (kept), skill_demand view populated.
  - ⏳ Real judgment quality (LLM relevance/suitability/skills, web-search repair)
        pending résumé + ANTHROPIC key — plumbing verified, quality deferred.
- [x] **Phase 3 — Web app** (committed `119482c`; independently verified
      → `VERIFY.md`: **PASS**, all 7 criteria; applied `esc()` attribute-escaping
      hardening per verifier's minor note)
  - [x] `src/server.ts`: Express JSON API — `GET /api/jobs?section=`
        (top_picks/all/not_suitable/applied), `GET /api/skills`, `GET /api/summary`,
        `POST /api/jobs/:id/stage` (validated); serves `public/`
  - [x] `public/index.html`: vanilla-JS tabs + job table + per-row stage select
  - [x] `package.json`: `express` dep + `serve` script
  - [x] improved mock relevance (suitable→4-5) so Top picks is demonstrable
        (also resolves verifier note A)
  - Self-smoke ✅: seed→pipeline→serve; summary/top_picks/sections correct;
        POST stage 'applied' persists (appears in Applied section); invalid
        stage → 400; index.html served (200).
- [x] **Phase 4 — Email + refine** (committed `efb3811`; independently verified
      → `VERIFY.md`: **PASS**, all 6 criteria)
  - [x] `src/email-poller.ts` (`npm run poll`): fetch (mock fixture | real Gmail
        REST via OAuth refresh-token + native fetch — no heavy deps), classify
        (mock keywords | real messages.parse), match by company → `app_events`
        (dedup by email_id) + advance `stage`
  - [x] `src/refine.ts` (`npm run refine "<instruction>"`): current filter +
        DB signal → updated filter.json (real messages.parse | deterministic mock)
  - [x] `.env.example` GOOGLE_* ; `package.json` poll/refine scripts
  - Self-smoke ✅ (mock): poll → 4 events, 4 stage advances (confirmed/oa/
        interview/rejected), re-poll dedups (0 new); refine rewrites filter.json
        from the instruction using live DB signal.
- [x] **Phase 5 — Analyst** (committed `d32287e`; independently verified
      → `VERIFY.md`: **PASS WITH NOTES**, all 6 criteria green)
  - [x] `src/analyze.ts` (`npm run analyze`): `assertReadOnly` SQL guard;
        deterministic mock analysis (top skills + résumé gap + counts) | real
        Claude agent w/ `query_db` read-only tool → structured `AnalysisSchema`;
        insert `analyses`. Entry-guarded `main()` so the guard is unit-testable.
  - [x] `src/server.ts`: `GET /api/analyses`; `public/index.html` Skills tab
        surfaces the latest analysis (summary + "skills to learn" pills)
  - [x] `package.json`: `analyze` script
  - Self-smoke ✅: guard allows SELECT/WITH, blocks DELETE/DROP/UPDATE/INSERT/
        multi-statement; analyze(mock) stores structured analysis; /api/analyses
        + /api/skills serve it.
- [x] **Phase 6 — Deploy as `/schedule` routine** (committed `e56a714`;
      independently verified → `VERIFY.md`: **PASS**, all 7 criteria green)
  - [x] `src/digest.ts` (`npm run digest`): pure DB-read → Markdown email body
        (`buildDigest` exported). Top picks reuse the app's
        `top_picks` definition; counts mirror `/api/summary`; Skills block from
        the latest `analyses` row (summary + résumé-gap "to learn").
  - [x] `ROUTINE.md`: the `/schedule` routine prompt + prerequisites, wiring
        fetch → check-links → curate → repair-links → analyze → digest → Gmail.
  - [x] `package.json`: `digest` script.
  - Self-smoke ✅ (mock): seed → check-links → curate → repair-links → analyze →
        digest produced a correct digest (1 top pick = the suitable job with a
        live link; counts 4/1/2/2/2; skills summary + gap), exit 0, typecheck clean.
  - ⏳ Real `/schedule` deploy + Gmail send is a **user action** (needs creds +
        Gmail connector) — pipeline + digest verified; the send is deferred,
        consistent with prior phases' credentialed happy-paths.

- [x] **Phase 7 — Testing + debugging** (end-to-end frontend/backend, automated test suite)
  - [x] `src/db.ts`: `openDb(overrideUrl?)` — optional arg for test isolation; default behaviour unchanged
  - [x] `src/server.ts`: exported `createApp(db)` so tests mount the real app on port 0 without spawning a subprocess; `main()` guards with `process.argv[1]` check
  - [x] `test/helpers/tmpdb.ts`: `openTestDb()` / `withTestDb()` — fresh in-memory DB per test
  - [x] `test/helpers/fixture.ts`: deterministic offline dataset (4 jobs, skills, analyses row); `FIXTURE_COUNTS` for cross-suite assertions
  - [x] `test/unit/`: assertReadOnly (13), filter+toSearchConfig (9), judge mock (5), adzuna normalize (8) — 35 tests
  - [x] `test/integration/`: upsertJob (8), buildDigest (8), curate mock loop (6) — 22 tests
  - [x] `test/api/server.test.ts`: all endpoints, stage 200/400/404, /api/run allow-list, static serving — 30 tests
  - [x] `test/e2e/fixture-server.ts`: standalone server for Playwright (in-memory DB + fixture)
  - [x] `test/e2e/ui.spec.ts`: 14 Playwright tests (title, summary, tabs, stage change, Skills panel, Run tab + command execution)
  - [x] `playwright.config.ts`: Chromium headless, webServer = fixture-server on port 3333
  - [x] `package.json`: `test`, `test:e2e`, `test:all` scripts; `@playwright/test` devDep
  - [x] Bug fixes: `analyze.ts` `db.close()` now in `finally`; `digest.ts` singular/plural counts ("1 top pick")
  - [x] Debug pass: full mock chain (`seed → check-links → curate → repair-links → analyze → digest`) + live server verified against every endpoint; all exit 0
  - Self-smoke ✅: `npx tsc --noEmit` clean; `npm test` 87/87 pass (~0.6 s); `npm run test:e2e` 14/14 pass (~5 s); `npm run test:all` 101/101 pass

- [x] **Phase 8 — Tracker UX: date-sort, company intros, availability hiding**
  - [x] Sort listings by **posting date (newest first)** instead of company name
        (`server.ts` SECTIONS); Top picks = relevance then recency. `posted_at`
        was already populated by every source.
  - [x] **Company intros**: new `companies` table (`db.ts`) + `src/company-blurbs.ts`
        (`npm run blurbs`, Haiku, `JOBHUNTER_MOCK` aware, cached per company);
        `server.ts` LEFT JOINs the blurb into `/api/jobs` + `/api/applied`;
        `public/index.html` shows it under the company name and adds a Posted column.
  - [x] **Availability hiding** (chosen over hard delete to keep the never-delete
        invariant): not-applied jobs whose link is gone (`broken`/`expired`) drop
        out of every listing via the `AVAILABLE` predicate; applied jobs always kept.
  - [x] `check-links.ts` now **re-checks every not-applied job each run** (was
        once-only `unchecked`), so postings that die later get caught and hidden.
  - [x] Tests: fixture gains `listed`(3) + a seeded blurb; api tests cover the
        hide, the date-sort, and the blurb join; new `company-blurbs.test.ts`;
        e2e All-tab count → `listed`. Routine docs + scheduled task add `blurbs`.
  - Self-smoke ✅: `npx tsc --noEmit` clean; `npm test` 99/99 pass; live tracker
        verified (148 listed + sorted newest-first + 148/148 blurbs; expired job hidden).

---

## Build process (per phase)
Planner → Coder → (Reviewer + Tester, fresh/independent) → Debugger on failure →
back to Coder → re-verify → pass → advance. Commit at each checkpoint.

## Notation
`[ ]` not started · `[~]` in progress · `[x]` done
