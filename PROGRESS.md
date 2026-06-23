# Build progress

Source of truth for where the build is. Updated at every phase checkpoint.
See `RESUME.md` for how to resume a paused build, and the approved plan at
`~/.claude/plans/snappy-foraging-stonebraker.md` for full detail.

**Current phase:** Phase 6 — Deploy as `/schedule` routine (starting)
**Next action:** build the digest step + routine prompt wiring the full daily
pipeline; verify a manual mock run end-to-end; then independent verification.

**Backlog (non-blocking, from verifiers):** analyze gap uses naive substring
`includes` (e.g. "Go" suppressed by "good" in résumé) — word-boundary match
would be cleaner; analyze `db.close()` only on happy path (no try/finally,
harmless on exit); repair-links greedy JSON regex (safe);
app_events email_id no UNIQUE + non-atomic check-insert (fine for serial CLI);
findJob bidirectional substring could mis-match short company names. Revisit with
real credentials.

**Backlog (non-blocking, from verifiers):** repair-links real path uses a greedy
JSON regex (safe failure mode); mock relevance is uniform (cosmetic). Address
when wiring real credentials.

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
- [ ] **Phase 6 — Deploy as `/schedule` routine**
  - routine prompt: fetch → check-links → curate/suitability/skills → repair → analyst → digest email
  - ✅ manual routine run completes pipeline end-to-end and sends digest via Gmail

---

## Build process (per phase)
Planner → Coder → (Reviewer + Tester, fresh/independent) → Debugger on failure →
back to Coder → re-verify → pass → advance. Commit at each checkpoint.

## Notation
`[ ]` not started · `[~]` in progress · `[x]` done
