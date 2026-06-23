# Phase 6 Verification — Digest + /schedule routine

Independent verifier, fresh context, no prior trust: every result below was
re-derived by running real commands against git HEAD `e56a714` ("Phase 6: digest
+ /schedule routine prompt"). No source edits; VERIFY.md is the only modified file.

## Results

| Criterion | Verdict |
|-----------|---------|
| 1. Typecheck (`npx tsc --noEmit` exits 0) | PASS |
| 2. End-to-end mock pipeline → digest (3 sections) | PASS |
| 3. Digest correctness vs DB and server.ts predicates | PASS |
| 4. Read-only / non-destructive | PASS |
| 5. Graceful edge cases (empty DB, malformed analysis) | PASS |
| 6. Routine wiring & scripts (ROUTINE.md, package.json) | PASS |
| 7. Code review of digest.ts | PASS |

**Overall: PASS.** No blocking defects. Only minor cosmetic notes below.

---

## Evidence

### 1. Typecheck — PASS

```
$ npx tsc --noEmit ; echo $?
0
```

### 2. End-to-end mock pipeline → digest — PASS

Clean DB (`rm -f jobs.db jobs.db-wal jobs.db-shm`), then in order. Every step exit 0:

```
seed         -> exit 0  | Seeded 4 mock job(s) (4 new).
check-links  -> exit 0  | Checked 4 link(s): 2 ok, 2 broken.   (real HTTP)
curate(mock) -> exit 0  | Curated 4 job(s): 2 suitable, 2 unsuitable (kept).
repair(mock) -> exit 0  | Repaired 0, marked expired 2 (kept in tracker).
analyze(mock)-> exit 0  | Analysis stored: 4 jobs, 2 suitable, top skill "AWS", 9 to learn.
digest       -> exit 0
```

Actual `npm run digest` output (three sections present — Top picks list, Pipeline
counts line, Skills block with analyst summary + "To learn" gap line):

```
# Job digest — 2026-06-23

## Top picks (1)
- Senior Backend Engineer — Acme Corp · New York, NY · $160k–$210k · relevance 5
  https://example.com/

## Pipeline
4 tracked · 1 top picks · 2 suitable · 2 not suitable · 0 in progress · 2 broken links

## Skills
Across 4 jobs (2 suitable), the most in-demand skills are AWS, Go, GraphQL. Consider learning: AWS, GraphQL, Kafka, Kubernetes, PostgreSQL.
To learn: AWS, GraphQL, Kafka, Kubernetes, PostgreSQL, PyTorch, Python, React, Spark.
```

### 3. Digest correctness vs DB and server.ts — PASS

**Predicate identity.** `src/digest.ts:8-9` `TOP_PICKS_WHERE` is byte-identical to
`src/server.ts:20` `SECTIONS.top_picks.where`:
`suitability = 'suitable' AND relevance >= 4 AND link_status NOT IN ('broken','expired')`.
The counts in `digest.ts:25-30` use the same semantics as `server.ts:36-42`
`/api/summary` (`applied` = `stage <> 'not_applied'`; `broken` =
`link_status IN ('broken','expired')`; `notSuitable` = `suitability = 'unsuitable'`).

**Direct DB cross-check** (throwaway `@libsql/client` script over `file:jobs.db`):

```
COUNTS:  total=4  topPicks=1  suitable=2  notSuitable=2  applied=0  broken=2
```
matches the digest Pipeline line exactly.

```
TOP PICKS SET (predicate, ORDER BY relevance DESC, company):
  Senior Backend Engineer | Acme Corp | rel=5 | suit=suitable | link=ok | https://example.com/
```
equals the single row the digest lists. Discriminating evidence — the link
predicate is genuinely applied: "Applied Scientist" is `suitable, rel=5` but
`link=expired`, so it is correctly EXCLUDED from both the DB query and the digest.

```
LATEST analyses row (id=1) content JSON:
  summary: "Across 4 jobs (2 suitable), the most in-demand skills are AWS, Go, GraphQL. Consider learning: AWS, GraphQL, Kafka, Kubernetes, PostgreSQL."
  gap:     ["AWS","GraphQL","Kafka","Kubernetes","PostgreSQL","PyTorch","Python","React","Spark"]
```
The Skills block reproduces `summary` verbatim and `gap.join(", ")` as the
"To learn" line. Exact match.

### 4. Read-only / non-destructive — PASS

```
$ grep -niE 'insert|update|delete|drop' src/digest.ts ; echo $?
1            # no matches
```

Row counts before vs after running `digest` twice more (no growth; `analyses`
only ever grows from `analyze`):

```
before: jobs=4  job_skills=12  analyses=1
after:  jobs=4  job_skills=12  analyses=1
```

### 5. Graceful edge cases — PASS

**Empty DB** (fresh `openDb()` creates schema, zero rows, zero analyses):

```
# Job digest — 2026-06-23

## Top picks (0)
No new top picks today.

## Pipeline
0 tracked · 0 top picks · 0 suitable · 0 not suitable · 0 in progress · 0 broken links
```
Exit 0. No Skills section (the `if (a?.content)` guard at digest.ts:64 skips it
when `analyses` is empty). Correct.

**Malformed latest analysis** (injected `content='{not valid json'`): the
`try/catch` at digest.ts:65-72 swallows the parse error and skips only the Skills
block; Top picks + Pipeline still render and the run exits 0. No crash.

**Null fields** (top-pick job with null company/location/url/salary): renders
`Null Fields Job — — · — · relevance 5` — `?? "—"` covers company/location, the
`if (p.url)` guard drops the URL line, and `fmtSalary` returns `""` for null
salaries (no `$NaNk`). Exit 0.

### 6. Routine wiring & scripts — PASS

- `package.json:17` — `"digest": "tsx src/digest.ts"`.
- `ROUTINE.md:19` — pipeline order `fetch → check-links → curate → repair-links →
  analyze → digest → email`, matching the plan and the actual run order.
- Prerequisites documented (`.env`, `resume.md`, `filter.json`, Gmail connector).
- A paste-ready `/schedule` prompt (ROUTINE.md:35-49) runs the six npm steps in
  order, stops on failure, captures `npm run digest` stdout as the email body,
  and sends it via the connected Gmail to **zp2153@nyu.edu** (matches project
  userEmail) with subject `Job digest — <date>`.
- ROUTINE.md:57-59 is explicit that scheduling + Gmail send is a user action
  (needs creds + connector); repo ships only the prompt + digest. Honest.

### 7. Code review of src/digest.ts — PASS

- All DB calls awaited (`db.execute` at lines 23, 37, 39, 63; `counts` awaited at 37).
- `db.close()` called in `main()` (line 81) — no resource leak.
- WHERE clauses are hardcoded literals — no SQL built from untrusted input.
- `fmtSalary` (11-19) handles null and zero cleanly; the `lo`/`hi` truthiness
  gate short-circuits before `Math.round(n/1000)`, so no `$NaNk`.
- `JSON.parse` wrapped in try/catch (65-72) — malformed analysis tolerated.
- Null company/location via `?? "—"`; null url via `if (p.url)` guard.

No real bugs found.

**Non-blocking notes (cosmetic only):**
- Pipeline line always says "top picks" / "broken links" (no singular form) even
  at count 1 — pluralization is cosmetic, not a defect.
- `check-links` performs real HTTP by design; the `.invalid` hosts fail as
  intended, which is what produces the 2 broken links in the mock run.
