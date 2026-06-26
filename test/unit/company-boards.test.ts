import { test } from "node:test";
import assert from "node:assert/strict";
import { makeKeepFilter } from "../../src/sources/companyBoards.js";

const internSearches = [
  { category: "swe", what: "software engineer intern", where: "" },
  { category: "mle", what: "machine learning intern", where: "" },
  { category: "ds", what: "data science intern", where: "" },
];

test("intern filter keeps matching internship titles", () => {
  const keep = makeKeepFilter(internSearches);
  assert.equal(keep("Software Engineering Intern"), true);
  assert.equal(keep("Machine Learning Intern (Summer 2026)"), true);
  assert.equal(keep("Data Science Intern"), true);
});

test("intern gate rejects non-intern roles and 'internal' false positives", () => {
  const keep = makeKeepFilter(internSearches);
  assert.equal(keep("Senior Software Engineer"), false); // no intern at all
  assert.equal(keep("Fullstack Engineer, Internal Tools"), false); // "internal" != intern
  assert.equal(keep("Legal Intern"), false); // intern, but no role keyword
  assert.equal(keep("Marketing Manager"), false);
});

test("non-intern filter falls back to role-keyword match", () => {
  const keep = makeKeepFilter([{ category: "swe", what: "software engineer", where: "" }]);
  assert.equal(keep("Senior Software Engineer"), true);
  assert.equal(keep("Software Developer"), true);
  assert.equal(keep("Account Executive"), false);
});
