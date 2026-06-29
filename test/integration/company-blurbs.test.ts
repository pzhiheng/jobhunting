import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestDb } from "../helpers/tmpdb.js";
import { companiesNeedingBlurbs, mockBlurb } from "../../src/company-blurbs.js";

async function addJob(db: import("@libsql/client").Client, id: string, company: string) {
  await db.execute({
    sql: "INSERT INTO jobs (id, source, external_id, title, company, fetched_at) VALUES (:id,'seed',:id,'Engineer',:company,datetime('now'))",
    args: { id, company },
  });
}

test("companiesNeedingBlurbs lists distinct companies without a blurb, then none after backfill", async () => {
  const db = await openTestDb();
  try {
    await addJob(db, "j:1", "Acme Corp");
    await addJob(db, "j:2", "Acme Corp"); // same company → de-duped
    await addJob(db, "j:3", "Globex");

    const need = await companiesNeedingBlurbs(db);
    assert.deepEqual([...need].sort(), ["Acme Corp", "Globex"]);

    // Backfill (mock) and confirm nothing remains needing a blurb.
    for (const name of need) {
      await db.execute({
        sql: "INSERT INTO companies (name, blurb, updated_at) VALUES (:name, :blurb, datetime('now'))",
        args: { name, blurb: mockBlurb(name) },
      });
    }
    assert.deepEqual(await companiesNeedingBlurbs(db), []);
  } finally {
    db.close();
  }
});

test("a company whose blurb row is empty still counts as needing one", async () => {
  const db = await openTestDb();
  try {
    await addJob(db, "j:1", "Initech");
    await db.execute("INSERT INTO companies (name, blurb, updated_at) VALUES ('Initech', '', datetime('now'))");
    assert.deepEqual(await companiesNeedingBlurbs(db), ["Initech"]);
  } finally {
    db.close();
  }
});
