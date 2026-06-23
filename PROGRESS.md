# Build progress

Source of truth for where the build is. Updated at every phase checkpoint.
See `RESUME.md` for how to resume a paused build, and the approved plan at
`~/.claude/plans/snappy-foraging-stonebraker.md` for full detail.

**Current phase:** Phase 2 complete & verified → Phase 3 (Web app) not started
**Next action:** Phase 3 (Express API + vanilla-JS tracker UI) is cred-free and
mock-testable via `npm run seed`. Confirm before starting.

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
- [ ] **Phase 3 — Web app**
  - `server.ts` API + `public/index.html`
  - ✅ list/filter; sections Top picks / All / Not suitable / Applied / Skills; tick applied persists
- [ ] **Phase 4 — Email + refine**
  - Gmail OAuth poller; `refine.ts`
  - ✅ poller classifies mail → app_events + stage; `npm run refine` updates filter.json
- [ ] **Phase 5 — Analyst**
  - read-only SQL analyst → `analyses`
  - ✅ writes structured analysis incl. skill demand + résumé gap; surfaced in app + digest
- [ ] **Phase 6 — Deploy as `/schedule` routine**
  - routine prompt: fetch → check-links → curate/suitability/skills → repair → analyst → digest email
  - ✅ manual routine run completes pipeline end-to-end and sends digest via Gmail

---

## Build process (per phase)
Planner → Coder → (Reviewer + Tester, fresh/independent) → Debugger on failure →
back to Coder → re-verify → pass → advance. Commit at each checkpoint.

## Notation
`[ ]` not started · `[~]` in progress · `[x]` done
