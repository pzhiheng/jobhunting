import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSimplify, selectEntries, locationIsUS } from "../../src/sources/simplify.js";

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
});

test("selectEntries keeps active US SWE/ML/Data roles and drops the rest", () => {
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
