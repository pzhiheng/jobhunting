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

test("engagement merges onto the direct copy: canonical inherits stage and events", async () => {
  const db = await openTestDb();
  try {
    // User applied via the Adzuna copy; the Lever copy is the real posting.
    await add(db, "adzuna:7", { source: "adzuna", company: "Globex", title: "Data Science Intern", location: "Boston, MA", stage: "applied" });
    await add(db, "lever:globex:3", { source: "lever", company: "Globex", title: "Data Science Intern", location: "Boston" });
    await db.execute(
      "INSERT INTO app_events (job_id, type, received_at) VALUES ('adzuna:7', 'applied', '2026-07-01')",
    );
    await dedupeJobs(db);
    // The direct-source row survives…
    assert.equal(await dupOf(db, "lever:globex:3"), null);
    assert.equal(await dupOf(db, "adzuna:7"), "lever:globex:3");
    // …and inherits the engagement: stage + the dated event follow it.
    const j = (await db.execute("SELECT stage FROM jobs WHERE id='lever:globex:3'")).rows[0];
    assert.equal(j.stage, "applied");
    const ev = (await db.execute("SELECT job_id FROM app_events")).rows[0];
    assert.equal(ev.job_id, "lever:globex:3");
  } finally {
    db.close();
  }
});

test("email-created row merges into its source twin despite corporate-name dressing", async () => {
  const db = await openTestDb();
  try {
    // Poller created this from a rejection email before/instead of matching.
    await add(db, "email:deshaw", { source: "email", company: "D. E. Shaw Group", title: "Software Developer Intern", stage: "rejected" });
    await add(db, "vansh2027:9", { source: "vansh2027", company: "DE Shaw", title: "Software Developer Intern", posted_at: "2026-07-01" });
    await dedupeJobs(db);
    assert.equal(await dupOf(db, "vansh2027:9"), null);
    assert.equal(await dupOf(db, "email:deshaw"), "vansh2027:9");
    const j = (await db.execute("SELECT stage FROM jobs WHERE id='vansh2027:9'")).rows[0];
    assert.equal(j.stage, "rejected");
  } finally {
    db.close();
  }
});

test("placeholder rows ('Acme application') fold into a same-company real row", async () => {
  const db = await openTestDb();
  try {
    // Email named no role → generic title; can never title-match the twin.
    await add(db, "email:old-mission", { source: "email", company: "Old Mission", title: "Old Mission application", stage: "applied" });
    await add(db, "simplify:om1", { source: "simplify", company: "Old Mission", title: "Software Engineer Intern", posted_at: "2026-07-01" });
    // A placeholder with no twin must survive untouched.
    await add(db, "email:cmu", { source: "email", company: "CMU", title: "CMU application", stage: "applied" });
    await dedupeJobs(db);
    assert.equal(await dupOf(db, "email:old-mission"), "simplify:om1");
    const j = (await db.execute("SELECT stage FROM jobs WHERE id='simplify:om1'")).rows[0];
    assert.equal(j.stage, "applied");
    assert.equal(await dupOf(db, "email:cmu"), null);
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

test("pickCanonical orders real source > adzuna > email/manual; engagement breaks ties", () => {
  const mk = (id: string, source: string, stage: string, posted_at: string) =>
    ({ id, source, company: "X", title: "Y", location: "Z", stage, posted_at });
  // direct (lever) beats aggregator (adzuna) when neither is engaged
  assert.equal(pickCanonical([mk("a", "adzuna", "not_applied", "2026-06-02"), mk("b", "lever", "not_applied", "2026-06-01")]).id, "b");
  // the real source row survives even when the adzuna copy is the engaged one
  // (dedupeJobs moves the engagement onto it)
  assert.equal(pickCanonical([mk("a", "adzuna", "applied", "2026-01-01"), mk("b", "lever", "not_applied", "2026-06-01")]).id, "b");
  // email stand-ins lose to any fetched row
  assert.equal(pickCanonical([mk("a", "email", "applied", "2026-06-02"), mk("b", "adzuna", "not_applied", "2026-06-01")]).id, "b");
  // within the same source tier, engagement wins
  assert.equal(pickCanonical([mk("a", "adzuna", "not_applied", "2026-06-02"), mk("b", "adzuna", "applied", "2026-06-01")]).id, "b");
});
