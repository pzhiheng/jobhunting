import Database from "better-sqlite3";
import type { NormalizedJob } from "./sources/types.js";

const DB_PATH = new URL("../jobs.db", import.meta.url).pathname;

export function openDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
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
      relevance       INTEGER,          -- 1..5, set by the Claude curation step
      relevance_notes TEXT,             -- why it scored that way
      status          TEXT NOT NULL DEFAULT 'new'  -- new | reviewed | dismissed | applied
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_relevance ON jobs(relevance);
  `);
  return db;
}

/** Insert a job if new; refresh volatile fields if seen. Returns true when newly inserted. */
export function upsertJob(db: Database.Database, job: NormalizedJob): boolean {
  const existed = db.prepare("SELECT 1 FROM jobs WHERE id = ?").get(job.id);
  db.prepare(
    `INSERT INTO jobs (
       id, source, external_id, title, company, location, remote, url,
       description, salary_min, salary_max, category, posted_at, fetched_at
     ) VALUES (
       @id, @source, @externalId, @title, @company, @location, @remote, @url,
       @description, @salaryMin, @salaryMax, @category, @postedAt, @fetchedAt
     )
     ON CONFLICT(id) DO UPDATE SET
       title       = excluded.title,
       company     = excluded.company,
       location    = excluded.location,
       url         = excluded.url,
       salary_min  = excluded.salary_min,
       salary_max  = excluded.salary_max,
       fetched_at  = excluded.fetched_at`,
  ).run({
    ...job,
    remote: job.remote ? 1 : 0,
    fetchedAt: new Date().toISOString(),
  });
  return !existed;
}
