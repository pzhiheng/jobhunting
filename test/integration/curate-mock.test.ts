/**
 * Integration test for the curate pipeline step (mock mode).
 * We seed jobs with status='new' into an isolated in-memory DB,
 * then run the judge+write loop directly (extracted to a testable helper).
 * This verifies the DB update path without an API key or filter.json.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { openTestDb } from "../helpers/tmpdb.js";
import { upsertJob } from "../../src/db.js";
import { judgeJob } from "../../src/judge.js";

before(() => { process.env.JOBHUNTER_MOCK = "1"; });
after(() => { delete process.env.JOBHUNTER_MOCK; });

/** Minimal version of curate's inner loop, operating on a passed-in DB. */
async function curateDb(db: Awaited<ReturnType<typeof openTestDb>>) {
  const { rows } = await db.execute(
    "SELECT id, title, company, location, description, category FROM jobs WHERE status = 'new'",
  );
  const criteria = { seniority: null, mustHaves: [], dealbreakers: [], scoringRubric: "" };
  let suitable = 0;
  for (const r of rows) {
    const j = await judgeJob(
      {
        title: String(r.title),
        company: String(r.company ?? ""),
        location: String(r.location ?? ""),
        description: String(r.description ?? ""),
        category: String(r.category ?? ""),
      },
      { criteria, resume: null },
    );
    await db.execute({
      sql: `UPDATE jobs SET relevance = :rel, relevance_notes = :relNotes,
              suitability = :suit, suitability_notes = :suitNotes, status = 'reviewed'
            WHERE id = :id`,
      args: {
        id: r.id as string, rel: j.relevance, relNotes: j.relevanceNotes,
        suit: j.suitability, suitNotes: j.suitabilityNotes,
      },
    });
    await db.execute({ sql: "DELETE FROM job_skills WHERE job_id = :id", args: { id: r.id as string } });
    for (const skill of j.skills) {
      await db.execute({
        sql: "INSERT OR IGNORE INTO job_skills (job_id, skill) VALUES (:id, :skill)",
        args: { id: r.id as string, skill },
      });
    }
    if (j.suitability === "suitable") suitable++;
  }
  return { total: rows.length, suitable };
}

const BASE_JOB = {
  source: "seed", externalId: "1",
  title: "Senior Backend Engineer", company: "Acme",
  location: "NYC", remote: false,
  url: "https://example.com", description: "Go and Kubernetes distributed systems.",
  salaryMin: null, salaryMax: null, category: "swe", postedAt: null,
};

describe("curate pipeline (mock)", () => {
  test("marks new jobs as reviewed", async () => {
    const db = await openTestDb();
    try {
      await upsertJob(db, { id: "seed:1", ...BASE_JOB });
      await curateDb(db);
      const { rows } = await db.execute("SELECT status FROM jobs WHERE id = 'seed:1'");
      assert.equal(rows[0].status, "reviewed");
    } finally {
      db.close();
    }
  });

  test("sets relevance to a valid 1-5 value", async () => {
    const db = await openTestDb();
    try {
      await upsertJob(db, { id: "seed:1", ...BASE_JOB });
      await curateDb(db);
      const { rows } = await db.execute("SELECT relevance FROM jobs WHERE id = 'seed:1'");
      const rel = Number(rows[0].relevance);
      assert.ok(rel >= 1 && rel <= 5, `relevance ${rel} out of 1-5`);
    } finally {
      db.close();
    }
  });

  test("sets suitability to suitable or unsuitable", async () => {
    const db = await openTestDb();
    try {
      await upsertJob(db, { id: "seed:1", ...BASE_JOB });
      await curateDb(db);
      const { rows } = await db.execute("SELECT suitability FROM jobs WHERE id = 'seed:1'");
      assert.ok(["suitable", "unsuitable"].includes(String(rows[0].suitability)));
    } finally {
      db.close();
    }
  });

  test("inserts skills into job_skills", async () => {
    const db = await openTestDb();
    try {
      await upsertJob(db, { id: "seed:1", ...BASE_JOB });
      await curateDb(db);
      const { rows } = await db.execute("SELECT skill FROM job_skills WHERE job_id = 'seed:1'");
      assert.ok(rows.length > 0, "Expected at least one skill");
    } finally {
      db.close();
    }
  });

  test("re-curating is idempotent (reviewed jobs are skipped)", async () => {
    const db = await openTestDb();
    try {
      await upsertJob(db, { id: "seed:1", ...BASE_JOB });
      const { total: first } = await curateDb(db);
      const { total: second } = await curateDb(db);
      assert.equal(first, 1);
      assert.equal(second, 0); // already reviewed — skipped
    } finally {
      db.close();
    }
  });

  test("only processes new jobs, leaves reviewed jobs untouched", async () => {
    const db = await openTestDb();
    try {
      await upsertJob(db, { id: "seed:1", ...BASE_JOB });
      await upsertJob(db, { id: "seed:2", ...BASE_JOB, externalId: "2" });
      // Manually mark seed:1 as already reviewed.
      await db.execute("UPDATE jobs SET status = 'reviewed' WHERE id = 'seed:1'");
      const { total } = await curateDb(db);
      assert.equal(total, 1); // only seed:2 processed
    } finally {
      db.close();
    }
  });
});
