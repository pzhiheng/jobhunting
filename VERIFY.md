# Phase 4 Verification — Email poller + refine

Independent verifier. No prior context. Verified against git HEAD `efb3811 "Phase 4: email poller + refine"`. Date: 2026-06-23.

Tested from project root. All LLM/Gmail paths exercised via `JOBHUNTER_MOCK=1`; real Gmail/Anthropic paths reviewed statically only (no credentials — pending credentials, not a defect). Files: `src/email-poller.ts`, `src/refine.ts`, `src/db.ts`, `src/filter.ts`, `src/seed.ts`.

## Results

| # | Criterion | Verdict |
|---|-----------|---------|
| 1 | `npx tsc --noEmit` exit 0 | **PASS** |
| 2 | Poller (mock): writes 4 app_events, matches job_ids, advances stages, dedups on re-run | **PASS** |
| 3 | Poller missing-creds: clear error, exit 1, no network call | **PASS** |
| 4 | Refine (mock): rewrites filter.json (request + refine: mustHave), preserves searches, writes request.md | **PASS** |
| 5 | Refine error paths: no-args usage error; no-filter.json error | **PASS** |
| 6 | Code review for real issues | **PASS** (notes only) |

### 1. tsc
`npx tsc --noEmit` → exit 0. No type errors.

### 2. Poller (mock) — the Phase 4 acceptance bar
Setup: `rm -f jobs.db jobs.db-wal jobs.db-shm && npm run seed && JOBHUNTER_MOCK=1 npm run curate`
- seed → 4 jobs (4 new); curate → 2 suitable, 2 unsuitable.

First `JOBHUNTER_MOCK=1 npm run poll` → `Polled 4 email(s): 4 new event(s), 4 stage advance(s), 0 already seen.`

DB inspection (`@libsql/client` against `file:jobs.db`):
```
app_events count: 4   (rows with NULL job_id: 0)
  ev#1 email=m1 type=confirmation job_id=seed:1 | We received your application
  ev#2 email=m2 type=oa           job_id=seed:2 | Online Assessment for Machine Learning Engineer
  ev#3 email=m3 type=interview    job_id=seed:3 | Interview invitation
  ev#4 email=m4 type=rejection    job_id=seed:1 | Update on your application
jobs:
  seed:1 Acme Corp -> stage=rejected
  seed:2 DataWorks -> stage=oa
  seed:3 Foobar Inc -> stage=interview
  seed:4 Acme Corp -> stage=not_applied
```
- 4 app_events, types confirmation/oa/interview/rejection, every row matched to a non-null job_id. ✓
- DataWorks → `oa`, Foobar → `interview`, an Acme job → `rejected`. ✓ (m4 rejection lands on the lowest-id Acme job seed:1 after m1's confirmation — exactly the documented acceptable scenario. seed:4 Acme stays `not_applied`.)

Dedup: second `JOBHUNTER_MOCK=1 npm run poll` → `Polled 4 email(s): 0 new event(s), 0 stage advance(s), 4 already seen.` app_events count still 4. ✓ (deduped by `email_id` via `SELECT 1 FROM app_events WHERE email_id = :eid`, email-poller.ts:169-173.)

### 3. Poller missing-creds error path
No `.env` file present; ran `env -u JOBHUNTER_MOCK -u GOOGLE_CLIENT_ID -u GOOGLE_CLIENT_SECRET -u GOOGLE_REFRESH_TOKEN npm run poll`:
```
Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN in .env (or set JOBHUNTER_MOCK).
POLL_EXIT=1
```
The guard (email-poller.ts:51-55) runs **before** any `getAccessToken`/`fetch` call, so no real network request is attempted. ✓

### 4. Refine (mock)
Created a valid `filter.json` (FilterSchema shape: request, country, maxDaysOld, resultsPerPage, 2 searches, criteria{seniority,mustHaves,dealbreakers,scoringRubric}).
`JOBHUNTER_MOCK=1 npm run refine "drop crypto, prefer staff backend"` → exit 0, `Refined filter.json: 2 searches, 3 must-haves.`

Resulting `filter.json`:
- `request` == `"drop crypto, prefer staff backend"` ✓ (the instruction)
- `criteria.mustHaves` == `["python","distributed systems","refine: drop crypto, prefer staff backend"]` — contains an entry starting `refine:` ✓
- both original `searches` preserved verbatim ✓
- `country`/`maxDaysOld`/`resultsPerPage`/`dealbreakers`/`scoringRubric` carried through unchanged ✓

`request.md` written: `drop crypto, prefer staff backend`. ✓

### 5. Refine error paths
- `JOBHUNTER_MOCK=1 npm run refine` (no args) → `Usage: npm run refine "<how to change the filter>"`, exit 1 ✓ (refine.ts:44-47; empty-instruction check precedes filter load / DB signal).
- `JOBHUNTER_MOCK=1 npm run refine "x"` with no `filter.json` present → `No filter.json to refine. Run \`npm run configure "..."\` first.`, exit 1 ✓ (refine.ts:13-19).

### 6. Code review — real issues only

- **Never DELETEs from jobs/app_events** — SAFE. `grep -rni delete src/` finds exactly one DELETE: `curate.ts:63` `DELETE FROM job_skills WHERE job_id = :id` (Phase 2 skills rejoin). The poller only INSERTs into app_events and UPDATEs `jobs.stage`; refine never touches those tables (it only reads counts). ✓
- **Dedup correctness** — SAFE for this single-process CLI. Per-email `SELECT 1 FROM app_events WHERE email_id = :eid` gate before INSERT (email-poller.ts:169-173); verified idempotent live (re-run = 0 new). NOTE (not a defect): there is no UNIQUE constraint on `app_events.email_id` and the check→insert is not transactional, so concurrent pollers could double-insert. Out of scope for a personal CLI run serially.
- **Stage-map correctness** — SAFE. `EVENT_STAGE` (email-poller.ts:20-25) maps confirmation→confirmed, oa→oa, interview→interview, rejection→rejected; `other` is intentionally absent so `EVENT_STAGE["other"]` is undefined and no stage advance occurs (email-poller.ts:188-189). Verified live.
- **Company matching** — SAFE for the fixtures. `companyFromSender` strips role suffixes (Talent/Recruiting/Hiring/…): "Acme Corp Talent"→"Acme Corp", "DataWorks Recruiting"→"DataWorks", "Foobar Inc Hiring"→"Foobar Inc", plain names pass through. `findJob` does a bidirectional case-insensitive substring match ordered by id (email-poller.ts:149-158). NOTE (not a defect): bidirectional `includes` could mis-match if one company name is a substring of an unrelated one; resolves to lowest id. Acceptable here.
- **Refine mustHaves dedup** — SAFE. `Array.from(new Set([...mustHaves, \`refine: ${instruction}\`]))` (refine.ts:58); re-running the same instruction does NOT add a duplicate `refine:` entry (verified live: still 1 such entry). A *different* instruction appends a new entry — expected accumulation, not a bug.
- **Real Gmail path** (pending credentials — reviewed statically, not a defect): token refresh is a `POST https://oauth2.googleapis.com/token` with `grant_type=refresh_token` and url-encoded client_id/secret/refresh_token, `res.ok` checked (email-poller.ts:83-96); `messages.list` with `maxResults` + q filter, then per-id `format=metadata&metadataHeaders=From&Subject&Date` GET, headers parsed via `find` with `?? ""` fallbacks, `Bearer` auth header, non-2xx throws (email-poller.ts:57-102). Plausibly correct.
- **classify schema / async / param-binding** — SAFE. `messages.parse` with `zodOutputFormat(ClassificationSchema)`, falls back to `mockClassify` when `parsed_output` is null (email-poller.ts:117-129). All DB calls awaited; consistent named-param binding throughout poller and refine.

## Cleanup
`rm -f jobs.db jobs.db-wal jobs.db-shm filter.json request.md` plus the temporary `_inspect.mjs` helper — all removed. `git status --short` was clean before writing this file; after this write only `VERIFY.md` is modified. No source files modified, nothing committed.

## Overall verdict: **PASS**

The Phase 4 goal is met: the mock poller writes 4 app_events (correctly typed and job-matched), advances stages per email (DataWorks→oa, Foobar→interview, Acme→rejected), and dedups cleanly on re-run; the missing-creds path fails fast with a clear message and no network call. The mock refine rewrites filter.json so `request` is the instruction and `criteria.mustHaves` gains a `refine:` entry while preserving searches, and writes request.md; both refine error paths report clearly. No DELETEs from jobs/app_events; dedup, stage-map, and company-matching are correct. Notes above are minor/out-of-scope (no UNIQUE on email_id; bidirectional company match) and real Gmail/Anthropic paths are pending credentials — none are blocking.
