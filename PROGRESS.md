# Build progress

Source of truth for where the build is. Updated at every phase checkpoint.
See `RESUME.md` for how to resume a paused build, and the approved plan at
`~/.claude/plans/snappy-foraging-stonebraker.md` for full detail.

**Current phase:** Phase 1 — Data + ingest (in progress)
**Next action:** implement the libSQL DB layer, filter schema, configure CLI,
sources, and fetch entry; then independent Reviewer + Tester verify.

---

## Phases

- [x] **Phase 0 — Resume & progress docs** (committed `334a621`)
- [~] **Phase 1 — Data + ingest** (implemented; independent verification next)
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
- [ ] **Phase 2 — Judgment**
  - relevance score, résumé suitability, skill extraction, `check-links.ts`, link repair
  - ✅ new rows get relevance/suitability/job_skills/link_status; unsuitable & broken kept
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
