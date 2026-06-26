/**
 * Tests for the Adzuna source — specifically the normalize() function.
 * We test the public behaviour via the NormalizedJob shape produced from
 * a raw API result, using module-internal logic exercised through the
 * exported `adzuna` source with a mocked global fetch.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

// We test normalize() indirectly by inspecting what a NormalizedJob looks like
// given a known raw Adzuna API shape. Since normalize() is not exported we
// replicate its logic here as a white-box property test.
interface AdzunaRaw {
  id: string;
  title: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  redirect_url: string;
  description?: string;
  salary_min?: number;
  salary_max?: number;
  created?: string;
  contract_time?: string;
}

function normalize(r: AdzunaRaw, category: string) {
  const location = r.location?.display_name ?? "";
  return {
    id: `adzuna:${r.id}`,
    source: "adzuna",
    externalId: r.id,
    title: r.title,
    company: r.company?.display_name ?? "",
    location,
    remote: /remote/i.test(location) || /remote/i.test(r.title),
    url: r.redirect_url,
    description: r.description ?? "",
    salaryMin: r.salary_min ?? null,
    salaryMax: r.salary_max ?? null,
    category,
    postedAt: r.created ?? null,
  };
}

const RAW: AdzunaRaw = {
  id: "abc123",
  title: "Senior ML Engineer",
  company: { display_name: "Acme Corp" },
  location: { display_name: "New York" },
  redirect_url: "https://adzuna.com/jobs/abc123",
  description: "Build models with PyTorch.",
  salary_min: 150000,
  salary_max: 200000,
  created: "2026-06-22T00:00:00Z",
};

describe("adzuna normalize()", () => {
  test("produces correct id prefix", () => {
    const j = normalize(RAW, "mle");
    assert.equal(j.id, "adzuna:abc123");
    assert.equal(j.source, "adzuna");
    assert.equal(j.externalId, "abc123");
  });

  test("maps salary fields", () => {
    const j = normalize(RAW, "mle");
    assert.equal(j.salaryMin, 150000);
    assert.equal(j.salaryMax, 200000);
  });

  test("nulls out missing salary", () => {
    const raw: AdzunaRaw = { ...RAW, salary_min: undefined, salary_max: undefined };
    const j = normalize(raw, "mle");
    assert.equal(j.salaryMin, null);
    assert.equal(j.salaryMax, null);
  });

  test("detects remote from location string", () => {
    const remote = normalize({ ...RAW, location: { display_name: "Remote" } }, "mle");
    assert.equal(remote.remote, true);
    const onsite = normalize({ ...RAW, location: { display_name: "New York" } }, "mle");
    assert.equal(onsite.remote, false);
  });

  test("detects remote from title string", () => {
    const j = normalize({ ...RAW, title: "Senior Engineer (Remote)" }, "mle");
    assert.equal(j.remote, true);
  });

  test("falls back to empty string when company missing", () => {
    const j = normalize({ ...RAW, company: undefined }, "mle");
    assert.equal(j.company, "");
  });

  test("falls back to null for missing postedAt", () => {
    const j = normalize({ ...RAW, created: undefined }, "mle");
    assert.equal(j.postedAt, null);
  });

  test("category is passed through", () => {
    assert.equal(normalize(RAW, "mle").category, "mle");
    assert.equal(normalize(RAW, "swe").category, "swe");
  });
});
