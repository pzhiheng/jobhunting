import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { upsertJob } from "../../src/db.js";
import { openTestDb } from "../helpers/tmpdb.js";
import type { NormalizedJob } from "../../src/sources/types.js";

function makeJob(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    id: "test:1",
    source: "test",
    externalId: "1",
    title: "Software Engineer",
    company: "Acme",
    location: "NYC",
    remote: false,
    url: "https://example.com/1",
    description: "Build things.",
    salaryMin: 100000,
    salaryMax: 150000,
    category: "swe",
    postedAt: "2026-06-22",
    ...overrides,
  };
}

describe("upsertJob", () => {
  test("returns true for a new job", async () => {
    const db = await openTestDb();
    try {
      const isNew = await upsertJob(db, makeJob());
      assert.equal(isNew, true);
    } finally {
      db.close();
    }
  });

  test("returns false on duplicate id", async () => {
    const db = await openTestDb();
    try {
      const job = makeJob();
      await upsertJob(db, job);
      const isNew = await upsertJob(db, job);
      assert.equal(isNew, false);
    } finally {
      db.close();
    }
  });

  test("only one row exists after two upserts of same id", async () => {
    const db = await openTestDb();
    try {
      const job = makeJob();
      await upsertJob(db, job);
      await upsertJob(db, job);
      const { rows } = await db.execute("SELECT COUNT(*) AS n FROM jobs WHERE id = 'test:1'");
      assert.equal(Number(rows[0].n), 1);
    } finally {
      db.close();
    }
  });

  test("refreshes mutable fields on conflict (title, url)", async () => {
    const db = await openTestDb();
    try {
      await upsertJob(db, makeJob({ title: "Old Title", url: "https://old.example.com" }));
      await upsertJob(db, makeJob({ title: "New Title", url: "https://new.example.com" }));
      const { rows } = await db.execute("SELECT title, url FROM jobs WHERE id = 'test:1'");
      assert.equal(rows[0].title, "New Title");
      assert.equal(rows[0].url, "https://new.example.com");
    } finally {
      db.close();
    }
  });

  test("does NOT reset stage or suitability on re-upsert", async () => {
    const db = await openTestDb();
    try {
      await upsertJob(db, makeJob());
      // Simulate a user advancing the stage manually.
      await db.execute("UPDATE jobs SET stage = 'applied', suitability = 'suitable' WHERE id = 'test:1'");
      // Re-fetch the same job (as fetch would do).
      await upsertJob(db, makeJob());
      const { rows } = await db.execute("SELECT stage, suitability FROM jobs WHERE id = 'test:1'");
      assert.equal(rows[0].stage, "applied");
      assert.equal(rows[0].suitability, "suitable");
    } finally {
      db.close();
    }
  });

  test("different ids → two separate rows", async () => {
    const db = await openTestDb();
    try {
      await upsertJob(db, makeJob({ id: "test:1", externalId: "1" }));
      await upsertJob(db, makeJob({ id: "test:2", externalId: "2" }));
      const { rows } = await db.execute("SELECT COUNT(*) AS n FROM jobs");
      assert.equal(Number(rows[0].n), 2);
    } finally {
      db.close();
    }
  });

  test("null salary fields are stored as null", async () => {
    const db = await openTestDb();
    try {
      await upsertJob(db, makeJob({ salaryMin: null, salaryMax: null }));
      const { rows } = await db.execute("SELECT salary_min, salary_max FROM jobs WHERE id = 'test:1'");
      assert.equal(rows[0].salary_min, null);
      assert.equal(rows[0].salary_max, null);
    } finally {
      db.close();
    }
  });

  test("remote flag is stored correctly", async () => {
    const db = await openTestDb();
    try {
      await upsertJob(db, makeJob({ id: "test:r", externalId: "r", remote: true }));
      const { rows } = await db.execute("SELECT remote FROM jobs WHERE id = 'test:r'");
      assert.equal(Number(rows[0].remote), 1);
    } finally {
      db.close();
    }
  });
});
