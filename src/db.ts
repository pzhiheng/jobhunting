import { createClient, type Client } from "@libsql/client";
import type { NormalizedJob } from "./sources/types.js";

/**
 * Open the shared database. When `overrideUrl` is given (used by tests for an
 * isolated in-memory/temp DB) it wins. Otherwise uses hosted libSQL (Turso)
 * when TURSO_DATABASE_URL is set; otherwise falls back to a local file so the
 * pipeline is runnable in dev without cloud credentials. All paths use the same
 * client + schema.
 */
export async function openDb(overrideUrl?: string): Promise<Client> {
  const envUrl = process.env.TURSO_DATABASE_URL;
  const client = overrideUrl
    ? createClient({ url: overrideUrl })
    : envUrl
      ? createClient({ url: envUrl, authToken: process.env.TURSO_AUTH_TOKEN })
      : createClient({ url: "file:jobs.db" });

  await client.executeMultiple(SCHEMA);
  // Idempotent migration: add the dedup columns + indexes to DBs created before
  // they existed (CREATE TABLE IF NOT EXISTS won't add columns to an old table).
  for (const col of ["dedup_key TEXT", "duplicate_of TEXT"]) {
    try {
      await client.execute(`ALTER TABLE jobs ADD COLUMN ${col}`);
    } catch {
      /* column already exists — fine */
    }
  }
  await client.executeMultiple(`
    CREATE INDEX IF NOT EXISTS idx_jobs_dedup ON jobs(dedup_key);
    CREATE INDEX IF NOT EXISTS idx_jobs_dupof ON jobs(duplicate_of);
  `);
  return client;
}

const slugify = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Canonical fingerprint for cross-source dedup: same company + same title is
 *  treated as the same posting, regardless of which source reported it or what
 *  (often noisy) location string it carried. Location is deliberately excluded —
 *  aggregators like Adzuna emit junk locations for one role, which would defeat a
 *  city-based key. The `location` arg is accepted (callers pass it) but ignored. */
export function dedupKey(company: unknown, title: unknown, _location?: unknown): string {
  return `${slugify(company)}|${slugify(title)}`;
}

/** Full schema. Columns for later phases (relevance, suitability, link, stage) are
 *  created now so those phases only populate, never migrate. */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS jobs (
    id              TEXT PRIMARY KEY,
    source          TEXT NOT NULL,
    external_id     TEXT NOT NULL,
    title           TEXT NOT NULL,
    company         TEXT,
    location        TEXT,
    remote          INTEGER NOT NULL DEFAULT 0,
    url             TEXT,
    description     TEXT,
    salary_min      REAL,
    salary_max      REAL,
    category        TEXT,
    posted_at       TEXT,
    fetched_at      TEXT NOT NULL,
    relevance       INTEGER,                                  -- 1..5 (Phase 2)
    relevance_notes TEXT,
    suitability     TEXT NOT NULL DEFAULT 'unreviewed',       -- suitable|unsuitable|unreviewed
    suitability_notes TEXT,
    link_status     TEXT NOT NULL DEFAULT 'unchecked',        -- ok|broken|expired|repaired|unchecked
    link_checked_at TEXT,
    stage           TEXT NOT NULL DEFAULT 'not_applied',      -- not_applied|applied|confirmed|oa|interview|offer|rejected
    status          TEXT NOT NULL DEFAULT 'new',              -- new|reviewed|dismissed
    dedup_key       TEXT,                                     -- canonical fingerprint (company|title|city)
    duplicate_of    TEXT                                      -- NULL = canonical; else the id of the kept copy
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_relevance ON jobs(relevance);
  CREATE INDEX IF NOT EXISTS idx_jobs_suitability ON jobs(suitability);
  CREATE INDEX IF NOT EXISTS idx_jobs_stage ON jobs(stage);

  CREATE TABLE IF NOT EXISTS job_skills (
    job_id TEXT NOT NULL,
    skill  TEXT NOT NULL,
    PRIMARY KEY (job_id, skill)
  );

  CREATE TABLE IF NOT EXISTS app_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id      TEXT,
    type        TEXT NOT NULL,                                -- confirmation|oa|interview|rejection|other
    email_id    TEXT,
    subject     TEXT,
    snippet     TEXT,
    received_at TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS analyses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    kind       TEXT,
    content    TEXT
  );

  -- One short, cached introduction per company (filled by company-blurbs.ts).
  CREATE TABLE IF NOT EXISTS companies (
    name       TEXT PRIMARY KEY,
    blurb      TEXT,
    updated_at TEXT
  );

  -- Raw demand counts. The résumé-gap flag is layered on by the analyst (Phase 5).
  CREATE VIEW IF NOT EXISTS skill_demand AS
    SELECT js.skill AS skill, j.category AS category, COUNT(*) AS count
    FROM job_skills js JOIN jobs j ON j.id = js.job_id
    GROUP BY js.skill, j.category;
`;

/** Insert a job if new; refresh volatile fields if already seen. Returns true when newly inserted. */
export async function upsertJob(db: Client, job: NormalizedJob): Promise<boolean> {
  const existing = await db.execute({
    sql: "SELECT 1 FROM jobs WHERE id = :id",
    args: { id: job.id },
  });
  const isNew = existing.rows.length === 0;

  await db.execute({
    sql: `INSERT INTO jobs (
            id, source, external_id, title, company, location, remote, url,
            description, salary_min, salary_max, category, posted_at, fetched_at, dedup_key
          ) VALUES (
            :id, :source, :externalId, :title, :company, :location, :remote, :url,
            :description, :salaryMin, :salaryMax, :category, :postedAt, :fetchedAt, :dedupKey
          )
          ON CONFLICT(id) DO UPDATE SET
            title      = excluded.title,
            company    = excluded.company,
            location   = excluded.location,
            url        = excluded.url,
            salary_min = excluded.salary_min,
            salary_max = excluded.salary_max,
            fetched_at = excluded.fetched_at,
            dedup_key  = excluded.dedup_key`,
    args: {
      id: job.id,
      source: job.source,
      externalId: job.externalId,
      title: job.title,
      company: job.company,
      location: job.location,
      remote: job.remote ? 1 : 0,
      url: job.url,
      description: job.description,
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      category: job.category,
      postedAt: job.postedAt,
      fetchedAt: new Date().toISOString(),
      dedupKey: dedupKey(job.company, job.title, job.location),
    },
  });
  return isNew;
}
