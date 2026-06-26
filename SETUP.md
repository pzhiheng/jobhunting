# Setup — getting the job hunter running

The build is complete. This is the checklist of **things you need to do** to go
from a fresh checkout to a running daily job hunter. Steps 1–4 are required;
5–8 add the tracker, inbox tracking, and the daily auto-run.

> Want to look around first without any credentials? Jump to
> [Try it with no credentials](#try-it-with-no-credentials).

---

## 0. Prerequisites

- Node.js 24+ and npm.
- Install dependencies:
  ```bash
  npm install
  ```

## 1. Add credentials (`.env`)

Copy the template and fill it in:

```bash
cp .env.example .env
```

| Variable | Required for | Where to get it |
|----------|--------------|-----------------|
| `ANTHROPIC_API_KEY` | `configure`, `curate`, `repair-links`, `analyze`, `poll` | console.anthropic.com → API keys |
| `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` | `fetch` (job postings) | free dev key at https://developer.adzuna.com/ |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | **optional** — shared hosted DB | turso.tech. **If unset, a local `jobs.db` file is used** (fine for one machine). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` | `poll` (inbox tracking) | Google Cloud OAuth client with the Gmail read scope |

Minimum to get jobs flowing: `ANTHROPIC_API_KEY` + the two `ADZUNA_*` keys.

## 2. Add your résumé

Drop a résumé in the project root as **`resume.md`** (preferred) or
**`resume.pdf`**. Curation and the analyst read it to judge suitability and find
your skill gaps. Without it, suitability is weaker (you'll get a warning, not an
error).

## 3. Say what you're looking for

Describe the search in plain language; it's parsed into `filter.json` (the
API queries) and `request.md` (your editable source of intent):

```bash
npm run configure "Senior backend or ML roles, remote or NYC, Python/Go, no crypto"
```

Re-run with no argument to re-parse `request.md` after you edit it. **Don't
hand-edit `filter.json`** — it's generated.

## 4. Run the pipeline once

```bash
npm run fetch          # pull postings from the job boards → DB
npm run check-links    # flag dead links
npm run curate         # relevance + résumé suitability + skills
npm run repair-links   # repair or expire broken links
npm run analyze        # skills demand + résumé-gap analysis
npm run digest         # print the "top picks + counts + skills" digest
```

Nothing is ever deleted — unsuitable jobs and dead links are kept, just flagged.

## 5. Browse in the web tracker

```bash
npm run serve          # http://localhost:3001
```

Tabs: **Top picks / All / Not suitable / Applied / Skills**. Mark a job
"applied" and it persists to the DB.

## 6. Track replies from your inbox (optional)

Once your `GOOGLE_*` OAuth credentials are set, poll Gmail to auto-advance
application stages (confirmation → OA → interview → rejected):

```bash
npm run poll
```

Run it on a schedule or whenever you want it to catch up. It only reads mail and
records events; it never sends or deletes.

## 7. Improve the filter over time (optional)

Adjust the search from plain language; it rewrites `filter.json` using your
current DB signal:

```bash
npm run refine "drop crypto, prefer staff backend, add Seattle"
```

## 8. Deploy the daily auto-run

To have the whole pipeline run every day and email you the digest, deploy the
routine described in **[ROUTINE.md](ROUTINE.md)** via `/schedule`. That needs the
`.env` above plus the **Gmail connector** enabled on the scheduled agent (email
sending is done by the connector — no email password lives in this repo).

---

## Try it with no credentials

Every step that calls an API has a deterministic mock behind `JOBHUNTER_MOCK=1`,
and `npm run seed` stands in for `fetch` with sample jobs:

```bash
npm run seed
npm run check-links                 # real HTTP, no key needed
JOBHUNTER_MOCK=1 npm run curate
JOBHUNTER_MOCK=1 npm run repair-links
JOBHUNTER_MOCK=1 npm run analyze
npm run digest
npm run serve                       # browse the mock data
```

## Command reference

| Command | What it does |
|---------|--------------|
| `npm run configure "<request>"` | NL request → `filter.json` (+ `request.md`) |
| `npm run fetch` | job-board APIs → DB |
| `npm run curate` | relevance + suitability + skills |
| `npm run check-links` / `repair-links` | verify / fix job URLs |
| `npm run analyze` | skills-demand + résumé-gap analysis |
| `npm run digest` | print the daily email body |
| `npm run serve` | local web tracker (`:3001`) |
| `npm run poll` | Gmail → advance application stages |
| `npm run refine "<instruction>"` | adjust the filter from plain language |
| `npx tsc --noEmit` | typecheck |
| `npm test` | unit + integration + API tests (~0.6 s, no credentials) |
| `npm run test:e2e` | Playwright browser E2E (14 tests, ~5 s; needs Chromium) |
| `npm run test:all` | both suites in sequence |

## Running tests

Tests use isolated in-memory databases and never touch `jobs.db`, `.env`,
or make real network or LLM calls.

```bash
npm test              # fastest — node:test runner, no browser
npm run test:e2e      # headless Chromium — boots an in-memory fixture server
npm run test:all      # both back to back
```

To install the Playwright browser on a fresh checkout:
```bash
npx playwright install chromium
```
