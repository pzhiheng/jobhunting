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
fetch → check-links → curate → blurbs → analyze → digest → email
```

| Step | Command | Effect |
|------|---------|--------|
| 1 | `npm run fetch`        | pull new postings (Adzuna + company boards + community internship feeds) → `jobs`, then collapse duplicates to one canonical row each |
| 2 | `npm run check-links`  | HTTP-check each URL (every not-applied job, every run) → `link_status` |
| 3 | `npm run curate`       | relevance + résumé suitability + skills for new rows |
| 4 | `npm run blurbs`       | one-line company intro for any new company → `companies` |
| 5 | `npm run analyze`      | refresh the skills-demand + résumé-gap analysis |
| 6 | `npm run digest`       | print the email body (Markdown) to stdout |

Every step only populates/updates the shared DB — nothing is ever deleted. A
posting that 404s is flagged (`link_status='broken'`), which hides it from the
tracker's listings; the row itself is kept, and `check-links` re-checks it every
run, so it un-hides itself if the posting comes back. Not-applied postings also
**age out 15 days after posting** — they drop from every listing, digest, and
link-check automatically (rows kept; applying — even via a late email — brings
one back into the Applied pipeline).

## Routine prompt (paste into `/schedule`, daily)

> Run the daily job hunt from the `~/Downloads/jobhunting` directory. Run these
> in order, and if any one fails, stop and report which step failed with its
> error instead of continuing:
>
> 1. `npm run fetch`
> 2. `npm run check-links`
> 3. `npm run curate`
> 4. `npm run blurbs` — generate a one-line intro for any newly-seen company.
> 5. `npm run poll` — read the inbox (IMAP via the app password, or Gmail OAuth)
>    to mark jobs already applied to / advanced (so they drop out of Top picks).
>    **Best-effort:** if no inbox is configured, note it and continue.
> 6. `npm run analyze`
> 7. `npm run send-digest` — emails the digest (clickable apply links + skills)
>    to `DIGEST_TO` via SMTP. Report the recipient + messageId it prints.
> 8. **Source discovery** (a few minutes — every run, actively hunt for NEW
>    sources, don't just monitor existing ones): web-search for new keyless
>    feeds/lists of US 2027 SWE/AI/ML internships (new GitHub `listings.json`
>    repos, public APIs, aggregators), verify candidates with a real fetch,
>    and probe whether the awaited `SimplifyJobs`/`cvrve` Summer2027 repos
>    exist yet; also note any wired source that has errored or yielded 0 for
>    days. Read + append the ledger `source-watch.md` (the one file the
>    routine may modify) so runs never repeat a suggestion; report verified
>    new findings as a "Source watch:" line. No code changes; skip
>    ToS-violating scrapers (LinkedIn, Indeed, Glassdoor).
>
> If any step other than `poll` fails, stop and report which one and its error.

`send-digest` delivers the digest **into the inbox** (no connector, no drafts) —
it needs `SMTP_USER` / `SMTP_PASS` (Gmail App Password) and `DIGEST_TO` in `.env`.
Without those it prints the digest instead of sending, so the routine never
hard-fails on a missing mailer. (The Gmail *connector* can only `create_draft`,
which is why sending goes through SMTP instead.)

## Notes

- The pipeline is runnable end-to-end locally without API keys using the
  deterministic mocks: `JOBHUNTER_MOCK=1 npm run <step>` (and `npm run seed`
  instead of `fetch`). `check-links` always does real HTTP; `digest` reads only
  the DB. See `PROGRESS.md` Phase 6 for the verified mock run.
- The actual scheduling and the Gmail send are a **user action** — this repo
  ships the routine prompt and the digest; deploy with your own `/schedule` +
  Gmail connector.
