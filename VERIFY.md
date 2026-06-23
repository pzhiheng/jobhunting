# Phase 2 Verification — Independent Review ("Judgment")

Verifier: independent (no prior context). Date: 2026-06-23. Git HEAD: `d48d8c1 Phase 2: judgment (curate, check-links, repair-links, seed)`.
Constraints honored: no real ANTHROPIC/ADZUNA/Turso credentials used; `JOBHUNTER_MOCK=1` set for all curate/repair-links runs; real-LLM judgment quality marked pending; no source file modified; nothing committed; all temp artifacts removed; fresh local `jobs.db` used and cleaned up.

## Overall verdict: PASS WITH NOTES

All five acceptance criteria pass. The Phase 2 goal is met: new rows get relevance(1–5), suitability, job_skills, and link_status set; unsuitable and broken/expired jobs are retained (total count stays 4, nothing deleted). Notes below are low-severity robustness observations on the real-LLM paths, none of which affect the mock pipeline or block the phase.

---

## Acceptance criteria

### 1. `npx tsc --noEmit` — PASS
Exit 0, no errors. tsconfig is strict + `moduleResolution: Bundler`. SDK API surface used by `src/judge.ts` was verified against `@anthropic-ai/sdk@0.105.0` type defs: `messages.parse` (messages.d.ts:52), `output_config`/`OutputConfig` (messages.d.ts:2077), `parsed_output`, `zodOutputFormat` (helpers/zod.d.ts:12), and `web_search_20260209` (messages.d.ts:1883) all exist as used.

### 2. Mock pipeline against a fresh DB — PASS
Ran `rm -f jobs.db*` → `npm run seed` → `JOBHUNTER_MOCK=1 npm run curate` → `npm run check-links` → `JOBHUNTER_MOCK=1 npm run repair-links`. Console: "Seeded 4 (4 new)", "Curated 4: 2 suitable, 2 unsuitable (kept)", "Checked 4: 2 ok, 2 broken", "Repaired 0, marked expired 2 (kept)".

DB inspection (file:jobs.db) results — all checks TRUE:
- Total jobs == 4 (nothing deleted). PASS
- Every job `status='reviewed'`. PASS
- Every `relevance` is an integer in [1,5] (all 3 — see Note A). PASS
- Every `suitability` ∈ {suitable,unsuitable} (suitable,unsuitable,unsuitable,suitable). PASS
- Every job has ≥1 `job_skills` row (3 each). PASS
- ≥1 unsuitable job retained (2 unsuitable, total still 4) → confirms unsuitable retention. PASS
- Link checking: **this sandbox HAS outbound network** — both reachable URLs (example.com, example.org) → `link_status='ok'`; both `.invalid` URLs → `broken`. PASS (no environmental caveat needed.)
- repair-links (mock): the 2 broken `.invalid` jobs → `expired` (deterministic: `hash(job.id)%2` gave expired for both seed:2/seed:4), both STILL present (count unchanged) → confirms broken/expired retention. PASS

### 3. No `DELETE FROM jobs` in curate.ts / repair-links.ts — PASS
`grep -rn "DELETE FROM jobs" src/` → none. The only DELETE is `curate.ts:63` `DELETE FROM job_skills WHERE job_id = :id` (the idempotent per-job skill refresh — explicitly allowed). repair-links.ts has zero DELETE statements; seed.ts has none.

### 4. Error path — PASS
- No `filter.json` present, no `JOBHUNTER_MOCK`: `npm run curate` prints "No filter.json found. Run `npm run configure \"<what you want>\"` first." and exits 1. PASS (`curate.ts:21`, error via `console.error`+`process.exit(1)`).
- No `filter.json`, with `JOBHUNTER_MOCK=1`: falls back to `DEFAULT_CRITERIA` (`curate.ts:20`) and runs cleanly, exit 0. PASS (ran 0 rows because the earlier run already marked all jobs reviewed — the fallback path itself executed without throwing, which is what's under test).

### 5. Code review for real issues — PASS (with notes)
- **judge structured output + clamp:** `client.messages.parse` with `output_config.format = zodOutputFormat(JudgmentSchema)`, then `parsed_output` null-guarded (judge.ts:67-69) and `relevance: clamp(Math.round(parsed.relevance), 1, 5)` (judge.ts:71). Correct — the schema intentionally drops the 1..5 numeric bound (structured outputs don't support `minimum`/`maximum`) and clamps post-parse. Model id `claude-sonnet-4-6` matches spec. Resume text/PDF blocks use valid `ContentBlockParam` shapes (`document`+base64 for PDF). PASS
- **async/SQL param binding:** All writes use named-param binding (`:id`, `:rel`, …) with `args` objects — no string interpolation, no injection. Awaits are correctly sequenced; `db.close()` after the loop. PASS
- **repair-links pause_turn loop + JSON parse:** Bounded 4-iteration loop; breaks when `stop_reason !== 'pause_turn'`, else pushes `{role:'assistant', content: response.content}` and re-sends — matches the documented server-side-tool resume pattern (no spurious "Continue" user turn). Final text filtered to TextBlocks, greedy `/\{[\s\S]*\}/` JSON match, validates `action==='repaired' && typeof url==='string'`, else `expired`. PASS — see Note B.
- **check-links HEAD→GET fallback + timeout:** HEAD first; `<400`→ok; 403/405→fall through to GET; other ≥400→broken; network/abort error on HEAD→retry GET, on GET→broken. `AbortSignal.timeout(10s)` per request. Logic verified empirically (reachable→ok, .invalid→broken). PASS
- **mock determinism:** `judge.mockJudgment` uses a stable `hash(title)` for relevance/suitability and a substring scan of title+description against a fixed SKILL_VOCAB (falls back to `["general-software"]` if none match — so the ≥1-skill invariant always holds). `repair-links.mockRepair` uses `hash(job.id)%2`. Both deterministic, no API call when `JOBHUNTER_MOCK` set. PASS

---

## Notes (non-blocking)

- **Note A — relevance all 3:** Coincidental, not a bug. Mock relevance is `(hash(title)%5)+1`; all four seed titles happen to hash to `%5==2`. Still satisfies "integer in [1,5]". Suitability `hash(title)%2` correctly yields a 2/2 split, which is what exercises unsuitable retention. If you want the seed to visibly span the relevance range, vary the mock formula or seed titles — purely cosmetic.
- **Note B — greedy JSON regex in real repair path:** `/\{[\s\S]*\}/` spans from the first `{` to the last `}`. If the real model ever emits prose containing a second brace-delimited object before/after the answer JSON, `JSON.parse` fails and the result falls through to `expired`. The system prompt mandates "ONE line of strict JSON, nothing else", and the failure mode is the safe one (job retained as expired, never deleted), so this is a low-severity edge case on the real path only — flagged, not a defect. Pending credentials, real-LLM repair/judgment quality is "not a defect".

## Cleanup / integrity
- `rm -f jobs.db jobs.db-wal jobs.db-shm` performed; all temporary `__verify_*.mjs` scripts removed.
- `jobs.db` confirmed gitignored (`git check-ignore jobs.db`).
- `git status --short` shows only `VERIFY.md` modified; no source files touched, nothing committed.
