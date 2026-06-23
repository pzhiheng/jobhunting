# Phase 3 Verification — Web app (Express API + vanilla-JS tracker)

Independent verifier. No prior context. Verified against git HEAD `119482c "Phase 3: web app (Express API + vanilla-JS tracker UI)"`. Date: 2026-06-23.

Setup ran clean from project root:
`rm -f jobs.db* && npm run seed && JOBHUNTER_MOCK=1 npm run curate && npm run check-links && JOBHUNTER_MOCK=1 npm run repair-links`
- seed: 4 jobs (4 new)
- curate: 2 suitable, 2 unsuitable
- check-links: 2 ok, 2 broken
- repair-links: 0 repaired, 2 marked expired

Server started with `PORT=3188 npm run serve`, tests run against http://localhost:3188.

## Results

| # | Criterion | Verdict |
|---|-----------|---------|
| 1 | `npx tsc --noEmit` exit 0 | **PASS** — exit 0 |
| 2 | `/api/summary` total=4, top_picks>=1, not_suitable=2, broken=2 | **PASS** |
| 3 | section filters (top_picks / not_suitable / all) | **PASS** |
| 4 | PERSISTENCE — POST stage=applied → 200, GET applied shows it | **PASS** |
| 5 | bogus stage → 400; unknown id → 404 | **PASS** |
| 6 | `GET /` → 200 + HTML tracker page | **PASS** |
| 7 | Code review for real issues (SQLi / enum / XSS / bound params) | **PASS** (1 minor note) |

### 1. tsc
`npx tsc --noEmit` → exit 0. No type errors.

### 2. /api/summary
`{"total":4,"top_picks":1,"suitable":2,"not_suitable":2,"applied":0,"new":0,"broken":2}`
total=4 ✓, top_picks=1 (>=1) ✓, not_suitable=2 ✓, broken=2 ✓.

### 3. Section filtering
- `?section=top_picks` → 1 job: `seed:1 suitable rel=5 link=ok`. Each is suitable, relevance>=4, link not broken/expired ✓. (seed:4 is suitable but link=expired → correctly excluded, confirming the link-status guard at server.ts:20.)
- `?section=not_suitable` → 2 jobs (seed:2, seed:3), both `suitability=unsuitable` ✓.
- `?section=all` → 4 jobs ✓.

### 4. Persistence (the Phase 3 acceptance bar)
`POST /api/jobs/seed:1/stage {"stage":"applied"}` → 200 `{"id":"seed:1","stage":"applied"}`.
`GET /api/jobs?section=applied` → 1 row `seed:1 stage=applied`. Stage change persisted to the DB and surfaces in the Applied section. ✓

### 5. Validation / errors
- `POST .../stage {"stage":"bogus"}` → 400 with enum message ✓ (server.ts:65).
- `POST /api/jobs/does-not-exist/stage {"stage":"applied"}` → 404 `{"error":"job not found"}` ✓ (server.ts:73, keyed on `rowsAffected === 0`).

### 6. Static page
`GET /` → 200, body begins `<!doctype html>` (the tracker). Static middleware serves `public/` (server.ts:80). ✓

### 7. Code review — security & correctness

- **SQL injection via `section`** — SAFE. `src/server.ts:47` does `SECTIONS[String(req.query.section ?? "all")] ?? SECTIONS.all`: a whitelist map lookup with a safe default. The `where`/`order` fragments interpolated into SQL (server.ts:50) are server-controlled constants from the `SECTIONS` table (server.ts:17-25); user input never reaches the SQL string. An unknown/garbage `section` falls back to `all`.
- **Stage enum validation** — SAFE. `src/server.ts:64-68` rejects any stage not in `STAGES` with 400 before the UPDATE.
- **Bound DB params** — SAFE. The stage UPDATE uses named args (`:stage`, `:id`) via the libSQL client (server.ts:69-72). All summary/section COUNT/SELECT queries interpolate only server constants, no user data. `src/db.ts` upsert/lookups also use bound named args.
- **XSS in UI** — SAFE in practice. `public/index.html:72` `esc()` escapes `& < >` and is applied to every DB/user string injected into the table (title, location, company, category, suitability, link_status, id) and to the skills view. Stage `<option>` values come from the client-side `STAGES` constant, not the DB.
  - MINOR NOTE (not a bug, no exploit with current data): `job.url` is placed into an `href="..."` attribute (index.html:91) and `job.id` into `data-id="..."` (index.html:109) via `esc`, which escapes `<>&` but not double-quotes. A DB value containing a literal `"` could break out of the attribute. Seeded/Adzuna URLs and ids don't contain quotes, so this is unreachable today; attribute-context escaping (also encoding `"`/`'`) would be more defensive. Flagging for awareness only — does not affect Phase 3 acceptance.

## Cleanup
- Server killed (`kill`/`pkill -f src/server.ts`); port 3188 no longer listening (curl returns 000).
- `rm -f jobs.db jobs.db-wal jobs.db-shm` done.
- `git status --short` was clean before writing this file; after this write only `VERIFY.md` is modified. No source files modified, nothing committed.

## Overall verdict: **PASS**

All 7 criteria pass. The Phase 3 goal — "list/filter; sections present; ticking applied persists" — is met: sections filter correctly (incl. the top_picks link-status guard), and a stage change round-trips to the DB and reappears in the Applied section. One minor, non-exploitable hardening note on attribute-context HTML escaping; no blocking issues.
