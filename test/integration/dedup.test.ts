import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestDb } from "../helpers/tmpdb.js";
import { dedupeJobs, pickCanonical } from "../../src/dedup.js";
import type { Client } from "@libsql/client";

async function add(
  db: Client,
  id: string,
  o: { source: string; company: string; title: string; location?: string; stage?: string; posted_at?: string },
) {
  await db.execute({
    sql: `INSERT INTO jobs (id, source, external_id, title, company, location, stage, posted_at, fetched_at)
          VALUES (:id, :source, :id, :title, :company, :location, :stage, :posted_at, datetime('now'))`,
    args: {
      id, source: o.source, title: o.title, company: o.company,
      location: o.location ?? "", stage: o.stage ?? "not_applied", posted_at: o.posted_at ?? "2026-06-01",
    },
  });
}
const dupOf = async (db: Client, id: string) =>
  (await db.execute({ sql: "SELECT duplicate_of AS d FROM jobs WHERE id=:id", args: { id } })).rows[0].d;

test("collapses same company+title+city across sources, preferring the direct-apply source", async () => {
  const db = await openTestDb();
  try {
    await add(db, "adzuna:1", { source: "adzuna", company: "Stripe", title: "Software Engineer Intern", location: "New York, NY" });
    await add(db, "greenhouse:stripe:9", { source: "greenhouse", company: "Stripe", title: "Software Engineer Intern", location: "New York" });

    const r = await dedupeJobs(db);
    assert.equal(r.duplicateGroups, 1);
    assert.equal(r.hidden, 1);
    // Greenhouse (direct link) is canonical; the Adzuna copy points at it.
    assert.equal(await dupOf(db, "greenhouse:stripe:9"), null);
    assert.equal(await dupOf(db, "adzuna:1"), "greenhouse:stripe:9");
  } finally {
    db.close();
  }
});

test("is idempotent — a second pass changes nothing", async () => {
  const db = await openTestDb();
  try {
    await add(db, "adzuna:1", { source: "adzuna", company: "Acme", title: "ML Intern", location: "Remote" });
    await add(db, "adzuna:2", { source: "adzuna", company: "Acme", title: "ML Intern", location: "Remote" });
    const a = await dedupeJobs(db);
    const b = await dedupeJobs(db);
    assert.deepEqual(a, b);
    assert.equal(a.hidden, 1);
  } finally {
    db.close();
  }
});

test("a job you've engaged with stays canonical even if it's the aggregator copy", async () => {
  const db = await openTestDb();
  try {
    await add(db, "adzuna:7", { source: "adzuna", company: "Globex", title: "Data Science Intern", location: "Boston, MA", stage: "applied" });
    await add(db, "lever:globex:3", { source: "lever", company: "Globex", title: "Data Science Intern", location: "Boston" });
    await dedupeJobs(db);
    assert.equal(await dupOf(db, "adzuna:7"), null);              // applied → kept
    assert.equal(await dupOf(db, "lever:globex:3"), "adzuna:7");
  } finally {
    db.close();
  }
});

test("same company+title merges regardless of (noisy) location", async () => {
  const db = await openTestDb();
  try {
    // Adzuna emits junk locations for one role — the key ignores location so
    // these still collapse to one canonical posting.
    await add(db, "a", { source: "adzuna", company: "Initech", title: "SWE Intern", location: "Austin, TX", posted_at: "2026-06-02" });
    await add(db, "b", { source: "adzuna", company: "Initech", title: "SWE Intern", location: "Kenwood, Sonoma County", posted_at: "2026-06-01" });
    const r = await dedupeJobs(db);
    assert.equal(r.hidden, 1);
    assert.equal(await dupOf(db, "a"), null);        // newer → canonical
    assert.equal(await dupOf(db, "b"), "a");
  } finally {
    db.close();
  }
});

test("different titles at the same company stay separate", async () => {
  const db = await openTestDb();
  try {
    await add(db, "a", { source: "adzuna", company: "Initech", title: "Backend Engineer Intern" });
    await add(db, "b", { source: "adzuna", company: "Initech", title: "Frontend Engineer Intern" });
    const r = await dedupeJobs(db);
    assert.equal(r.hidden, 0);
  } finally {
    db.close();
  }
});

test("pickCanonical orders engaged > direct source > newer", () => {
  const mk = (id: string, source: string, stage: string, posted_at: string) =>
    ({ id, source, company: "X", title: "Y", location: "Z", stage, posted_at });
  // direct (lever) beats aggregator (adzuna) when neither is engaged
  assert.equal(pickCanonical([mk("a", "adzuna", "not_applied", "2026-06-02"), mk("b", "lever", "not_applied", "2026-06-01")]).id, "b");
  // engaged adzuna beats fresh direct
  assert.equal(pickCanonical([mk("a", "adzuna", "applied", "2026-01-01"), mk("b", "lever", "not_applied", "2026-06-01")]).id, "a");
});
