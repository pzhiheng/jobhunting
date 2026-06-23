# Phase 1 Verification — Independent Review

Verifier: independent (no prior context). Date: 2026-06-23. Git HEAD: `6aeb070 Phase 1: data + ingest`.
Constraints honored: no real credentials used; credentialed happy-paths marked pending; source files not modified; nothing committed; artifacts cleaned up.

## Acceptance criteria

### 1. `npx tsc --noEmit` — PASS
Exit 0, no errors. tsconfig is strict + `moduleResolution: Bundler` (so the `.js` import extensions in `.ts` sources resolve cleanly).

### 2. configure without ANTHROPIC_API_KEY — PASS
`env -u ANTHROPIC_API_KEY npm run configure "test"` exits 1 with `Missing ANTHROPIC_API_KEY. Put it in .env to run configure.`
The key check (`src/configure.ts:44`) runs first in `main()`, before `readRequest()` writes `request.md`, so the error path produces no side-effect files (confirmed: no `request.md`/`filter.json` created). No `.env` exists in the repo, so `env -u` genuinely exercises the missing-key path.

### 3. fetch with no filter.json — PASS
`npm run fetch` exits 1 with `No filter.json found. Run \`npm run configure ...\` first to generate it.`
`loadFilter()` (`src/fetch.ts:11-21`) runs before `openDb()`, so no `jobs.db` is created on this path (confirmed).

### 4. fetch degrades gracefully without Adzuna creds + schema created — PASS
Hand-made valid `filter.json` placed at project root (matches `FILTER_PATH = ../filter.json` relative to `src/`).
`env -u ADZUNA_APP_ID -u ADZUNA_APP_KEY npm run fetch` output:
```
[adzuna] failed: Missing ADZUNA_APP_ID / ADZUNA_APP_KEY...
Done. 0 fetched, 0 new this run, 0 awaiting review.
```
Process exit code = 0 (per-source try/catch in `src/fetch.ts:31-41` isolates the failure; summary still prints).
Schema inspection of `file:jobs.db`:
- `jobs` columns include all required: `relevance`, `suitability`, `link_status`, `stage`, `status` (full set: id, source, external_id, title, company, location, remote, url, description, salary_min, salary_max, category, posted_at, fetched_at, relevance, relevance_notes, suitability, suitability_notes, link_status, link_checked_at, stage, status).
- Tables present: `jobs`, `job_skills`, `app_events`, `analyses` (plus `sqlite_sequence` from AUTOINCREMENT).
- View `skill_demand` present and queryable.

### 5. Dedup correctness — PASS
Reviewed `upsertJob` (`src/db.ts:83-124`) and ran a live double-insert against `file:jobs.db`:
- 1st insert → `isNew=true`; 2nd insert (same job) → `isNew=false`; row count stays 1.
- ON CONFLICT(id) update path verified: changing `title` and re-upserting returns `isNew=false` and the stored title is refreshed (volatile-field update works).
The dedup is by `SELECT 1 ... WHERE id=:id` to compute `isNew`, then a single `INSERT ... ON CONFLICT(id) DO UPDATE`. Correct for the intended use.

### 6. Code review (real issues) — PASS WITH NOTES
SDK usage verified against installed `@anthropic-ai/sdk@0.105.0`:
- `messages.parse({ ..., output_config: { format: zodOutputFormat(ParsedFilterSchema) } })` and reading `response.parsed_output` exactly match the SDK's documented shape (`node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts`, `lib/parser.d.ts`). `zodOutputFormat` is a real export of `@anthropic-ai/sdk/helpers/zod`.
- zod v4 schemas (`FilterSchema`, `ParsedFilterSchema`) are well-formed; `FilterSchema = ParsedFilterSchema.extend({ request })` and `configure.ts` correctly parses with `FilterSchema.parse({ request, ...parsed })`.
- Param binding in `upsertJob` matches the schema column count/order; named args all supplied; `remote` boolean→INTEGER coerced (`job.remote ? 1 : 0`).
- COUNT(*) renders as a JS `number` (not bigint) — summary string is clean.
- Async correctness: `await` on every `db.execute`/`upsertJob`; `db.close()` after counting; `main().catch(...)` handles rejections with exit 1.

Notes (none blocking):
- **N1 (minor, by design):** `upsertJob` computes `isNew` with a separate SELECT before the INSERT (`src/db.ts:84-88`). These two statements are not atomic, so concurrent writers could both see "new." Irrelevant for this single-threaded sequential pipeline, but worth knowing if sources ever run in parallel. A single `INSERT ... ON CONFLICT ... RETURNING` + `changes()`-style check could make it atomic.
- **N2 (pending credentials, not a defect):** model id `claude-sonnet-4-6` is passed straight to the API. Validity is a runtime concern that can't be checked without a key; it matches the Phase-1 spec. The SDK docstring example uses a dated `claude-sonnet-4-5-20250929` alias.
- **N3 (pending credentials, not a defect):** real Adzuna fetch + real LLM parse were not exercised (no credentials). Both code paths type-check and the no-credential error/degradation paths are verified.
- **N4 (informational):** `filter.json` is NOT in `.gitignore` (only `jobs.db`, `jobs.db-*`, `.env`, `node_modules/`, `dist/`). A real `npm run configure` run will leave `filter.json` and `request.md` as untracked files. Likely intended (the filter is a user artifact), just flagging.

## Overall verdict: PASS WITH NOTES
All 6 criteria pass. No bugs found that would break with real credentials. Notes N1–N4 are advisory only.
