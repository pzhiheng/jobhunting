import { test } from "node:test";
import assert from "node:assert/strict";
import { makeKeepFilter, parseWorkdayPostedOn } from "../../src/sources/companyBoards.js";

test("parseWorkdayPostedOn maps Workday's relative text to dates", () => {
  const day = 24 * 60 * 60 * 1000;
  const today = parseWorkdayPostedOn("Posted Today");
  assert.ok(today && Math.abs(Date.parse(today) - Date.now()) < 60_000);

  const yesterday = parseWorkdayPostedOn("Posted Yesterday");
  assert.ok(yesterday && Math.abs(Date.parse(yesterday) - (Date.now() - day)) < 60_000);

  const nDays = parseWorkdayPostedOn("Posted 6 Days Ago");
  assert.ok(nDays && Math.abs(Date.parse(nDays) - (Date.now() - 6 * day)) < 60_000);

  // "30+" is open-ended — no date rather than a wrong one.
  assert.equal(parseWorkdayPostedOn("Posted 30+ Days Ago"), null);
  assert.equal(parseWorkdayPostedOn(""), null);
});

test("makeKeepFilter gates on intern titles and role words", () => {
  const keep = makeKeepFilter([
    { category: "swe", what: "software engineer intern", where: "" },
    { category: "mle", what: "machine learning engineer intern", where: "" },
  ]);
  assert.ok(keep("Software Engineer Intern"));
  assert.ok(keep("Machine Learning Intern - 2026"));
  assert.ok(!keep("Internal Communications Manager")); // "internal" ≠ intern
  assert.ok(!keep("Software Engineer II")); // no intern in title
  assert.ok(!keep("Finance Intern")); // intern, but no role word
});
