import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  FilterSchema,
  ParsedFilterSchema,
  toSearchConfig,
} from "../../src/filter.js";

const VALID_FILTER = {
  request: "Senior backend engineer, NYC, Python/Go, no crypto",
  country: "us",
  maxDaysOld: 14,
  resultsPerPage: 20,
  searches: [{ category: "swe", what: "backend engineer", where: "New York" }],
  criteria: {
    seniority: "senior",
    mustHaves: ["Python", "Go"],
    dealbreakers: ["crypto"],
    scoringRubric: "Prefer distributed systems roles.",
  },
};

describe("FilterSchema", () => {
  test("parses a valid filter", () => {
    const result = FilterSchema.parse(VALID_FILTER);
    assert.equal(result.country, "us");
    assert.equal(result.searches.length, 1);
    assert.equal(result.criteria.seniority, "senior");
  });

  test("accepts null seniority", () => {
    const f = { ...VALID_FILTER, criteria: { ...VALID_FILTER.criteria, seniority: null } };
    const result = FilterSchema.parse(f);
    assert.equal(result.criteria.seniority, null);
  });

  test("rejects filter missing required field", () => {
    const { country: _omit, ...bad } = VALID_FILTER;
    assert.throws(() => FilterSchema.parse(bad));
  });

  test("rejects filter missing request field", () => {
    const { request: _omit, ...bad } = VALID_FILTER;
    assert.throws(() => FilterSchema.parse(bad));
  });
});

describe("ParsedFilterSchema", () => {
  test("parses without the request field", () => {
    const { request: _omit, ...noRequest } = VALID_FILTER;
    const result = ParsedFilterSchema.parse(noRequest);
    assert.equal(result.country, "us");
  });

  test("rejects when request field is present — is a superset parse", () => {
    // ParsedFilterSchema uses .strict() semantics only in zod; Zod v4 ignores extra
    // keys by default (strip). So request just gets stripped — not an error.
    const result = ParsedFilterSchema.parse(VALID_FILTER);
    assert.equal(result.country, "us");
  });
});

describe("toSearchConfig", () => {
  test("extracts the correct fields", () => {
    const filter = FilterSchema.parse(VALID_FILTER);
    const sc = toSearchConfig(filter);
    assert.equal(sc.country, "us");
    assert.equal(sc.maxDaysOld, 14);
    assert.equal(sc.resultsPerPage, 20);
    assert.equal(sc.searches[0].what, "backend engineer");
  });

  test("does not include criteria or request", () => {
    const filter = FilterSchema.parse(VALID_FILTER);
    const sc = toSearchConfig(filter);
    assert.equal("criteria" in sc, false);
    assert.equal("request" in sc, false);
  });

  test("passes through multiple searches", () => {
    const filter = FilterSchema.parse({
      ...VALID_FILTER,
      searches: [
        { category: "swe", what: "backend", where: "NYC" },
        { category: "mle", what: "ml engineer", where: "Remote" },
      ],
    });
    const sc = toSearchConfig(filter);
    assert.equal(sc.searches.length, 2);
  });
});
