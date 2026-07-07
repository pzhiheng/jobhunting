import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSimplify, selectEntries, locationIsUS, qualifySeason } from "../../src/sources/simplify.js";

test("locationIsUS accepts US states / bare remote, rejects foreign", () => {
  assert.ok(locationIsUS("San Bruno, CA"));
  assert.ok(locationIsUS("New York, NY"));
  assert.ok(locationIsUS("Remote in USA"));
  assert.ok(locationIsUS("Remote")); // US-centric list → bare remote counts
  assert.ok(!locationIsUS("London, UK"));
  assert.ok(!locationIsUS("Toronto, Canada"));
  assert.ok(!locationIsUS("Remote - India"));
});

test("normalizeSimplify maps a feed entry to a NormalizedJob with a direct link", () => {
  const job = normalizeSimplify({
    id: "abc123",
    company_name: "Zipline",
    title: "Software Engineer Intern",
    url: "https://www.zipline.com/open-roles?gh_jid=7787868003",
    locations: ["San Bruno, CA", "Remote"],
    terms: ["Summer 2027"],
    date_posted: 1751000000,
    category: "Software",
  });
  assert.equal(job.id, "simplify:abc123");
  assert.equal(job.source, "simplify");
  assert.equal(job.company, "Zipline");
  assert.equal(job.location, "San Bruno, CA; Remote");
  assert.equal(job.remote, true);
  assert.match(job.url, /zipline\.com/);
  assert.equal(job.category, "swe");
  assert.ok(job.postedAt?.startsWith("20"));
  // The start term is surfaced so curate can judge it against the filter window.
  assert.match(job.description, /Summer 2027/);
});

test("selectEntries keeps active US SWE/ML roles and drops the rest", () => {
  const entries = [
    { id: "1", company_name: "A", title: "SWE Intern", url: "u", locations: ["NYC, NY"], date_posted: 3, active: true, is_visible: true, category: "Software" },
    { id: "2", company_name: "B", title: "ML Intern", url: "u", locations: ["Remote"], date_posted: 5, active: true, is_visible: true, category: "AI/ML/Data" },
    { id: "3", company_name: "C", title: "Chip Intern", url: "u", locations: ["Austin, TX"], date_posted: 9, active: true, is_visible: true, category: "Hardware" }, // wrong domain
    { id: "4", company_name: "D", title: "SWE Intern", url: "u", locations: ["London, UK"], date_posted: 9, active: true, is_visible: true, category: "Software" }, // not US
    { id: "5", company_name: "E", title: "Old", url: "u", locations: ["NYC, NY"], date_posted: 9, active: false, is_visible: true, category: "Software" }, // inactive
  ];
  const kept = selectEntries(entries as never[]).map((e) => (e as { id: string }).id);
  assert.deepEqual(kept.sort(), ["1", "2"]);
});

test("vansh-feed entries work: yearless season is cycle-qualified, no category passes", () => {
  // The real feed has season "Summer" (no year) and no category field.
  const raw = [
    { id: "v1", company_name: "Optiver", title: "Software Engineer Intern", url: "https://optiver.com/apply", locations: ["Chicago, IL"], season: "Summer", date_posted: 1751000000, active: true, is_visible: true },
  ];
  const qualified = qualifySeason(raw as never[], "2027");
  assert.deepEqual((qualified[0] as { terms?: string[] }).terms, ["Summer 2027"]);

  // Qualified entries survive the 2027 window + missing-category filters…
  const kept = selectEntries(qualified);
  assert.equal(kept.length, 1);
  // …and unqualified ("Summer" only) would have been dropped by the window.
  assert.equal(selectEntries(raw as never[]).length, 0);

  const job = normalizeSimplify(kept[0], "vansh2027");
  assert.equal(job.id, "vansh2027:v1");
  assert.equal(job.source, "vansh2027");
  assert.match(job.description, /Summer 2027/);
});

test("selectEntries drops explicit non-2027 terms but keeps undated and 2027 postings", () => {
  const base = { company_name: "X", title: "SWE Intern", url: "u", locations: ["NYC, NY"], date_posted: 1, active: true, is_visible: true, category: "Software" };
  const entries = [
    { ...base, id: "in-window", terms: ["Summer 2027"] },
    { ...base, id: "mixed", terms: ["Fall 2026", "Spring 2027"] },   // any in-window term keeps it
    { ...base, id: "undated" },                                       // no term stated → keep
    { ...base, id: "na", terms: ["N/A"] },                            // N/A = unstated → keep
    { ...base, id: "old", terms: ["Summer 2026"] },                   // explicitly out → drop
    { ...base, id: "far", terms: ["Spring 2028"] },                   // explicitly out → drop
  ];
  const kept = selectEntries(entries as never[]).map((e) => (e as { id: string }).id);
  assert.deepEqual(kept.sort(), ["in-window", "mixed", "na", "undated"]);
});
