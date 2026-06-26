import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestDb } from "../helpers/tmpdb.js";
import { findJob, titleOverlap, mockClassify } from "../../src/email-poller.js";

test("titleOverlap counts shared significant tokens", () => {
  assert.ok(titleOverlap("Software Engineer Intern", "Software Engineering Intern") >= 2);
  assert.equal(titleOverlap("Data Scientist", "Marketing Manager"), 0);
});

test("mockClassify detects type, company, and role", () => {
  const c = mockClassify({
    id: "x", from: "Acme Corp Talent <a@b>",
    subject: "Interview for Software Engineer Intern", snippet: "let's schedule", receivedAt: "",
  });
  assert.equal(c.type, "interview");
  assert.equal(c.company, "Acme Corp");
  assert.match(c.title, /software engineer/i);
});

test("mockClassify recognizes an offer", () => {
  const c = mockClassify({
    id: "y", from: "DataWorks <a@b>",
    subject: "Your offer from DataWorks", snippet: "We are pleased to offer you the role", receivedAt: "",
  });
  assert.equal(c.type, "offer");
});

test("findJob picks the specific role at a company by title", async () => {
  const db = await openTestDb();
  try {
    const insert = (id: string, company: string, title: string) =>
      db.execute({
        sql: "INSERT INTO jobs (id, source, external_id, title, company, fetched_at) VALUES (:id,'seed',:id,:title,:company,datetime('now'))",
        args: { id, title, company },
      });
    await insert("j:1", "Stripe", "Data Scientist Intern");
    await insert("j:2", "Stripe", "Software Engineer Intern");
    await insert("j:3", "Other Co", "Software Engineer Intern");

    // Two Stripe roles → match the one whose title overlaps the email's role.
    assert.equal(await findJob(db, "Stripe", "Software Engineering Internship"), "j:2");
    assert.equal(await findJob(db, "Stripe", "Data Science Intern"), "j:1");
    // No company match → null.
    assert.equal(await findJob(db, "Nonexistent Inc", "anything"), null);
  } finally {
    db.close();
  }
});
