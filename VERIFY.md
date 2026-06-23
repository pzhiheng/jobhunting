# Phase 5 Verification — Analyst

I verified this independently with fresh context and no prior trust, against git HEAD `d32287e` ("Phase 5: analyst (read-only SQL → analyses) + app surfacing"). All evidence below is from commands I ran myself.

## Results

| # | Criterion | Verdict |
|---|-----------|---------|
| 1 | Typecheck (`npx tsc --noEmit`) | PASS |
| 2 | `assertReadOnly` SQL guard (allow/reject/bypass) | PASS |
| 3 | `analyze` (mock) stores a structured analysis | PASS |
| 4 | App surfacing (`/api/analyses`, `/api/skills`, Skills tab) | PASS |
| 5 | Read-only enforcement on the real path (static) | PASS |
| 6 | Code review for real issues | PASS WITH NOTES |

**Overall: PASS WITH NOTES.** No blocking defects. Phase 5 meets its success criteria; advance to Phase 6.

---

## 1. Typecheck — PASS

```
$ npx tsc --noEmit; echo "EXIT=$?"
EXIT=0
```

No type errors.

## 2. `assertReadOnly` guard — PASS

`assertReadOnly` (src/analyze.ts:23) trims the SQL, strips one trailing `;`, rejects any remaining `;` (single statement), requires `^(select|with)`, and rejects whole-word mutating keywords (`insert|update|delete|drop|alter|create|attach|detach|pragma|replace|vacuum`). I called it directly via a throwaway tsx script importing from `./src/analyze.js`:

ALLOW cases (returned trimmed sql, no throw):
```
ALLOW ok: "SELECT * FROM jobs" -> "SELECT * FROM jobs"
ALLOW ok: "  select skill from job_skills  " -> "select skill from job_skills"
ALLOW ok: "WITH t AS (SELECT 1) SELECT * FROM t" -> "WITH t AS (SELECT 1) SELECT * FROM t"
ALLOW ok: "SELECT 1;" -> "SELECT 1"          # trailing semicolon stripped
ALLOW ok: "SELECT 1;   " -> "SELECT 1"
```

REJECT cases (all threw):
```
DELETE / DROP / UPDATE / INSERT / ALTER / CREATE / ATTACH  -> "must start with SELECT or WITH"
PRAGMA table_info(jobs)                                     -> "must start with SELECT or WITH"
SELECT 1; DROP TABLE jobs                                   -> "only one statement allowed"
EXPLAIN SELECT 1                                            -> "must start with SELECT or WITH"
```

Bypass probes (all safely rejected — no bypass found):
```
/* hi */ SELECT 1                                          -> "must start with SELECT or WITH" (leading comment doesn't start with SELECT)
SELECT 1 -- ; DROP TABLE jobs                              -> "only one statement allowed" (over-strict but safe: ; in comment trips the check)
WITH t AS (DELETE FROM jobs RETURNING id) SELECT * FROM t  -> "mutating keyword rejected"
select * from jobs; select * from jobs                     -> "only one statement allowed"
REPLACE / VACUUM / DETACH                                  -> rejected
DELETE ... RETURNING *                                     -> "must start with SELECT or WITH"
```

Embedded whole-word mutating keyword inside a SELECT is rejected; substring-only false positives are correctly allowed:
```
SELECT ... AND delete = 1                 -> REJECTED (mutating keyword)
SELECT ..., drop FROM jobs                -> REJECTED (mutating keyword)
SELECT ... (INSERT INTO x) y              -> REJECTED (mutating keyword)
SELECT 'updated_at', updated_count ...    -> ALLOWED   (no whole-word match)
```

No casing/comment/stacked-query bypass found. The guard always errs toward rejection.

## 3. `analyze` (mock) stores a structured analysis — PASS

Pipeline:
```
$ rm -f jobs.db jobs.db-wal jobs.db-shm && npm run seed && JOBHUNTER_MOCK=1 npm run curate && JOBHUNTER_MOCK=1 npm run analyze
Seeded 4 mock job(s) (4 new).
Curated 4 job(s): 2 suitable, 2 unsuitable (kept).
Analysis stored: 4 jobs, 2 suitable, top skill "AWS", 9 to learn.   # exit 0
```

Inspected the row directly with a `@libsql/client` script on `file:jobs.db`. One row per run, `kind='skills'`, `content` parses and satisfies `{ totalJobs:number, suitableJobs:number, topSkills:[{skill,count}], gap:string[], summary:string }` (SHAPE OK: true).

Cross-checked against the live tables:
```
DB ground truth: total jobs: 4 | suitable jobs: 2
topSkills(db) == content.topSkills  -> MATCH true
content.totalJobs == 4              -> MATCH true
content.suitableJobs == 2           -> MATCH true
```

`gap` = the 9 top skills not found in resume.md ("Go" excluded). The INSERT is parameter-bound (`:content`) and targets only the `analyses` table; running `analyze` twice left `jobs` at 4 / `job_skills` unchanged — it never deletes or mutates job data.

## 4. App surfacing — PASS

Started `PORT=3017 npm run serve` (default port is 3001 per src/server.ts:5; overrode to avoid collision) and curled it:

```
GET /api/analyses -> {"id":2,"created_at":"...","kind":"skills","content":"{...full JSON...}"}   # latest row
GET /api/skills   -> [{"skill":"AWS","category":"mle","count":1}, ... 12 rows from skill_demand view]
GET /            -> served HTML contains renderSkills / api/analyses / "Skills to learn" (grep count 4)
```

Null path: against an empty `analyses` table the endpoint logic `res.json(rows[0] ?? null)` returns `null`. `renderSkills` (public/index.html:115) fetches both endpoints, guards with `if (analysis && analysis.content)`, renders `summary` and the `gap[]` as "Skills to learn" pills, and falls back to the skills table / "No skills extracted yet." when null. All dynamic output is escaped via `esc(...)` (summary, gap pills, skill/category cells) — no XSS hole. Server stopped; port 3017 confirmed free afterward.

## 5. Read-only enforcement on the real path (static) — PASS

`realAnalysis` (src/analyze.ts:94):
- The only model-supplied SQL site is line 130: `await db.execute(assertReadOnly((b.input as {sql:string}).sql))` — every `query_db` call routes through `assertReadOnly` before `db.execute`. No raw model SQL can reach `db.execute`.
- Errors are caught (lines 132–134) and returned to the model as `ERROR: ${message}` strings, not thrown.
- The agent loop is bounded: `for (let i = 0; i < 8; i++)` (line 115), breaks on non-`tool_use`.
- Final structured output uses `client.messages.parse(... zodOutputFormat(AnalysisSchema))` (lines 141–146) with a null-guard `if (!final.parsed_output) throw` (line 147).

## 6. Code review — PASS WITH NOTES

No blocking defects. All `db.execute` calls are awaited; the `analyses` INSERT is parameter-bound; `analyze` only reads `jobs`/`job_skills` and inserts into `analyses`.

Non-blocking notes (backlog, not Phase-5 blockers):
- **Gap heuristic is a naive substring `includes`** (src/analyze.ts:64–66). "Go" was dropped from `gap` because the substring "go" appears in "good" in resume.md — a false "covered" classification. Same class of issue could over- or under-report any short skill token. Cosmetic for the mock; consider word-boundary matching later.
- **`db.close()` only on the happy path** (src/analyze.ts:41): if `mockAnalysis`/`realAnalysis` throws, the close is skipped and cleanup relies on `process.exit(1)`. Harmless (process exit frees the handle); a `try/finally` would be tidier.
- **`mockAnalysis` `num(where)` interpolates `where` into SQL** (src/analyze.ts:53). Only ever called with hardcoded literals (`"1=1"`, `"suitability = 'suitable'"`) — no untrusted input, and it mirrors the existing `/api/summary` pattern in server.ts. Not a vulnerability.

---

_Verification artifacts (scratch scripts, scratch DB) were removed; `git status --short` shows only this VERIFY.md modified._
