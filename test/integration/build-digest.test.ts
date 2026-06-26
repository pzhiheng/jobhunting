import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildDigest } from "../../src/digest.js";
import { openTestDb } from "../helpers/tmpdb.js";
import { seedFixture, FIXTURE_COUNTS } from "../helpers/fixture.js";

describe("buildDigest", () => {
  test("produces a non-empty string", async () => {
    const db = await openTestDb();
    try {
      await seedFixture(db);
      const digest = await buildDigest(db);
      assert.ok(digest.length > 0);
    } finally {
      db.close();
    }
  });

  test("starts with a # heading containing today's date", async () => {
    const db = await openTestDb();
    try {
      await seedFixture(db);
      const digest = await buildDigest(db);
      const today = new Date().toISOString().slice(0, 10);
      assert.ok(digest.startsWith(`# Job digest — ${today}`), `Got: ${digest.slice(0, 60)}`);
    } finally {
      db.close();
    }
  });

  test("Top picks section lists correct count from fixture", async () => {
    const db = await openTestDb();
    try {
      await seedFixture(db);
      const digest = await buildDigest(db);
      assert.ok(
        digest.includes(`## Top picks (${FIXTURE_COUNTS.top_picks})`),
        `Expected top_picks=${FIXTURE_COUNTS.top_picks} in digest`,
      );
    } finally {
      db.close();
    }
  });

  test("Top picks lists job titles for suitable+relevance≥4+non-broken", async () => {
    const db = await openTestDb();
    try {
      await seedFixture(db);
      const digest = await buildDigest(db);
      // seed:1 and seed:4 qualify; seed:3 is suitable but relevance=3+broken.
      assert.ok(digest.includes("Senior Backend Engineer"), "seed:1 missing");
      assert.ok(digest.includes("ML Engineer"), "seed:4 missing");
      assert.equal(digest.includes("Full Stack Engineer"), false, "seed:3 should NOT appear in top picks");
    } finally {
      db.close();
    }
  });

  test("Pipeline section has correct totals", async () => {
    const db = await openTestDb();
    try {
      await seedFixture(db);
      const digest = await buildDigest(db);
      assert.ok(
        digest.includes(`${FIXTURE_COUNTS.total} tracked`),
        `total=${FIXTURE_COUNTS.total} not found`,
      );
      assert.ok(
        digest.includes(`${FIXTURE_COUNTS.suitable} suitable`),
        `suitable count not found`,
      );
      assert.ok(
        digest.includes(`${FIXTURE_COUNTS.not_suitable} not suitable`),
        `not_suitable count not found`,
      );
    } finally {
      db.close();
    }
  });

  test("Skills section appears when analysis row exists", async () => {
    const db = await openTestDb();
    try {
      await seedFixture(db);
      const digest = await buildDigest(db);
      assert.ok(digest.includes("## Skills"), "Skills heading missing");
      assert.ok(digest.includes("Python"), "Expected Python in skills summary");
    } finally {
      db.close();
    }
  });

  test("Skills section absent when no analyses row", async () => {
    const db = await openTestDb();
    try {
      // Seed without the analyses row (seed direct jobs only).
      await db.execute({
        sql: `INSERT INTO jobs (id, source, external_id, title, company, location, remote,
                url, description, salary_min, salary_max, category, posted_at, fetched_at,
                relevance, suitability, link_status, stage, status)
              VALUES ('x:1','x','1','Eng','Co','NYC',0,'https://example.com','desc',
                      null,null,'swe','2026-06-22',:now,5,'suitable','ok','not_applied','reviewed')`,
        args: { now: new Date().toISOString() },
      });
      const digest = await buildDigest(db);
      assert.equal(digest.includes("## Skills"), false, "Skills section should be absent");
    } finally {
      db.close();
    }
  });

  test("returns 'No new top picks today' when nothing qualifies", async () => {
    const db = await openTestDb();
    try {
      // An empty DB has no jobs.
      const digest = await buildDigest(db);
      assert.ok(digest.includes("No new top picks today"), `Got: ${digest}`);
    } finally {
      db.close();
    }
  });
});
