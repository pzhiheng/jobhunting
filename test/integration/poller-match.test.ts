import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestDb } from "../helpers/tmpdb.js";
import { findJob, titleOverlap, mockClassify, createJobFromEmail, imapAccounts } from "../../src/email-poller.js";

test("imapAccounts builds primary (SMTP fallback) and optional second inbox", () => {
  // Primary only, via SMTP creds.
  assert.deepEqual(imapAccounts({ SMTP_USER: "a@x.com", SMTP_PASS: "p" }), [
    { user: "a@x.com", pass: "p", host: "imap.gmail.com", port: 993 },
  ]);
  // Second inbox (e.g. a university mailbox for Handshake emails).
  const two = imapAccounts({
    SMTP_USER: "a@x.com", SMTP_PASS: "p",
    IMAP2_USER: "b@nyu.edu", IMAP2_PASS: "q", IMAP2_HOST: "imap.uni.edu",
  });
  assert.equal(two.length, 2);
  assert.deepEqual(two[1], { user: "b@nyu.edu", pass: "q", host: "imap.uni.edu", port: 993 });
  // IMAP_* overrides SMTP_*; incomplete IMAP2 (no pass) is ignored.
  assert.equal(imapAccounts({ IMAP_USER: "c@x.com", IMAP_PASS: "r", SMTP_USER: "a@x.com", SMTP_PASS: "p", IMAP2_USER: "b@y.com" })[0].user, "c@x.com");
  assert.equal(imapAccounts({ IMAP_USER: "c@x.com", IMAP_PASS: "r", IMAP2_USER: "b@y.com" }).length, 1);
  assert.deepEqual(imapAccounts({}), []);
});

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

test("findJob matches through punctuation and corporate suffixes", async () => {
  const db = await openTestDb();
  try {
    const insert = (id: string, company: string, title: string) =>
      db.execute({
        sql: "INSERT INTO jobs (id, source, external_id, title, company, fetched_at) VALUES (:id,'seed',:id,:title,:company,datetime('now'))",
        args: { id, title, company },
      });
    await insert("j:1", "DE Shaw", "Software Developer Intern");
    await insert("j:2", "IMC Trading", "Software Engineer Intern");
    await insert("j:3", "Tesla, Inc.", "SWE Intern");

    // The email's company dressing differs from the board's — still the same employer.
    assert.equal(await findJob(db, "D. E. Shaw Group", "Software Developer Intern"), "j:1");
    assert.equal(await findJob(db, "IMC", "Software Engineering Internship"), "j:2");
    assert.equal(await findJob(db, "Tesla", "SWE Internship"), "j:3");
  } finally {
    db.close();
  }
});

test("createJobFromEmail tracks an unmatched application and is reused by later emails", async () => {
  const db = await openTestDb();
  try {
    const c = { type: "confirmation" as const, company: "NewCo", title: "Backend Engineer Intern" };
    const id = await createJobFromEmail(db, c);
    assert.match(id, /^email:newco/);

    // It now exists and is matchable by a later email about the same application.
    assert.equal(await findJob(db, "NewCo", "Backend Engineering Internship"), id);
    // Idempotent — a second email for the same role reuses the same row.
    assert.equal(await createJobFromEmail(db, c), id);

    const n = Number((await db.execute("SELECT COUNT(*) AS n FROM jobs WHERE source='email'")).rows[0].n);
    assert.equal(n, 1);
  } finally {
    db.close();
  }
});
