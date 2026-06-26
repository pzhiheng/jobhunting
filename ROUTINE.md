# Daily routine — `/schedule` deployment

The job hunter runs as a **daily cloud routine**: a scheduled Claude Code agent
that runs the deterministic pipeline scripts in order, then emails the digest via
a **connected Gmail** (no email credentials live in this repo). Deploy it with
`/schedule` on a checkout that has the credentials and the Gmail connector.

## Prerequisites (one-time)

- `.env` populated (see `.env.example`): `ANTHROPIC_API_KEY`,
  `ADZUNA_APP_ID` / `ADZUNA_APP_KEY`, `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`.
- A `resume.md` (or `resume.pdf`) present — used by curation and the analyst.
- A `filter.json` already generated: `npm run configure "<what you want>"`.
- The **Gmail connector** enabled for the scheduled routine.

## Pipeline (what runs each day)

```
fetch → check-links → curate → repair-links → analyze → digest → email
```

| Step | Command | Effect |
|------|---------|--------|
| 1 | `npm run fetch`        | pull new postings from the job boards → `jobs` |
| 2 | `npm run check-links`  | HTTP-check each URL → `link_status` |
| 3 | `npm run curate`       | relevance + résumé suitability + skills for new rows |
| 4 | `npm run repair-links` | repair or expire broken links |
| 5 | `npm run analyze`      | refresh the skills-demand + résumé-gap analysis |
| 6 | `npm run digest`       | print the email body (Markdown) to stdout |

Every step only populates/updates the shared DB — nothing is ever deleted.

## Routine prompt (paste into `/schedule`, daily)

> Run the daily job hunt from the `~/Downloads/jobhunting` directory. Run these
> in order, and if any one fails, stop and report which step failed with its
> error instead of continuing:
>
> 1. `npm run fetch`
> 2. `npm run check-links`
> 3. `npm run curate`
> 4. `npm run repair-links`
> 5. `npm run analyze`
> 6. `npm run digest` — capture its stdout; that Markdown is the email body.
>
> Then deliver that digest to **zp2153@nyu.edu** via the connected Gmail with the
> subject `Job digest — <today's date>` — use the Gmail **create_draft** tool
> (this connector drafts rather than sends; if your connector exposes a send
> tool, send instead). Use the digest output verbatim — do not invent or reword
> jobs, numbers, or skills. If "Top picks" is empty, still deliver it: that's a
> valid "nothing new today" digest.

The `digest` Markdown works as the plain body as-is; for a nicer email, render
the **Top picks** as `<a href>` links and the **Skills** block as a short
paragraph (see how the 2026-06-26 draft was built — top picks become clickable,
direct-apply company links get a badge).

## Notes

- The pipeline is runnable end-to-end locally without API keys using the
  deterministic mocks: `JOBHUNTER_MOCK=1 npm run <step>` (and `npm run seed`
  instead of `fetch`). `check-links` always does real HTTP; `digest` reads only
  the DB. See `PROGRESS.md` Phase 6 for the verified mock run.
- The actual scheduling and the Gmail send are a **user action** — this repo
  ships the routine prompt and the digest; deploy with your own `/schedule` +
  Gmail connector.
