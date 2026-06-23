# Build progress

Source of truth for where the build is. Updated at every phase checkpoint.
See `RESUME.md` for how to resume a paused build, and the approved plan at
`~/.claude/plans/snappy-foraging-stonebraker.md` for full detail.

**Current phase:** Phase 0 (in progress)
**Next action:** commit Phase 0 docs, then start Phase 1 (Data + ingest).

---

## Phases

- [~] **Phase 0 — Resume & progress docs** (in progress)
  - [x] `RESUME.md` written
  - [x] `PROGRESS.md` written (this file)
  - [ ] committed
- [ ] **Phase 1 — Data + ingest**
  - libSQL `db.ts` (schema), `filter.ts`, `configure.ts`, `sources/`, `fetch.ts`
  - swap better-sqlite3 → `@libsql/client`; retire `profile.json` / `profile.md`
  - ✅ `npm run configure "<req>"` writes valid `filter.json` + `request.md`
  - ✅ `npm run fetch` populates Turso `jobs` (deduped); clear errors on missing creds
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
