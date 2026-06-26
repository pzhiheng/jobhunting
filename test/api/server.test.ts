/**
 * API-level tests for server.ts.
 * Boots the real Express app on a random port over an in-memory DB seeded
 * with the test fixture. No browser, no subprocess, no network calls.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { openTestDb } from "../helpers/tmpdb.js";
import { seedFixture, FIXTURE_COUNTS } from "../helpers/fixture.js";
import { createApp } from "../../src/server.js";
import type { Client } from "@libsql/client";

let server: Server;
let base: string;
let db: Client;

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`${base}${path}`, opts);
  return { status: res.status, body: await res.json() };
}

before(async () => {
  db = await openTestDb();
  await seedFixture(db);
  const app = createApp(db);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  db.close();
});

// --- /api/summary ---
describe("GET /api/summary", () => {
  test("returns 200", async () => {
    const { status } = await api("/api/summary");
    assert.equal(status, 200);
  });

  test("total matches fixture", async () => {
    const { body } = await api("/api/summary");
    assert.equal(body.total, FIXTURE_COUNTS.total);
  });

  test("top_picks count matches fixture", async () => {
    const { body } = await api("/api/summary");
    assert.equal(body.top_picks, FIXTURE_COUNTS.top_picks);
  });

  test("not_suitable count matches fixture", async () => {
    const { body } = await api("/api/summary");
    assert.equal(body.not_suitable, FIXTURE_COUNTS.not_suitable);
  });

  test("applied count matches fixture", async () => {
    const { body } = await api("/api/summary");
    assert.equal(body.applied, FIXTURE_COUNTS.applied);
  });

  test("broken count matches fixture", async () => {
    const { body } = await api("/api/summary");
    assert.equal(body.broken, FIXTURE_COUNTS.broken);
  });
});

// --- /api/jobs ---
describe("GET /api/jobs", () => {
  test("?section=all returns all jobs", async () => {
    const { status, body } = await api("/api/jobs?section=all");
    assert.equal(status, 200);
    assert.equal(body.length, FIXTURE_COUNTS.total);
  });

  test("defaults to all when no section given", async () => {
    const { body } = await api("/api/jobs");
    assert.equal(body.length, FIXTURE_COUNTS.total);
  });

  test("?section=top_picks returns only qualifying rows", async () => {
    const { body } = await api("/api/jobs?section=top_picks");
    assert.equal(body.length, FIXTURE_COUNTS.top_picks);
    for (const j of body) {
      assert.equal(j.suitability, "suitable");
      assert.ok(j.relevance >= 4);
      assert.ok(!["broken", "expired"].includes(j.link_status));
    }
  });

  test("?section=not_suitable returns only unsuitable rows", async () => {
    const { body } = await api("/api/jobs?section=not_suitable");
    assert.equal(body.length, FIXTURE_COUNTS.not_suitable);
    for (const j of body) assert.equal(j.suitability, "unsuitable");
  });

  test("?section=applied returns only jobs with non-default stage", async () => {
    const { body } = await api("/api/jobs?section=applied");
    assert.equal(body.length, FIXTURE_COUNTS.applied);
    for (const j of body) assert.notEqual(j.stage, "not_applied");
  });

  test("unknown section falls back to all", async () => {
    const { body } = await api("/api/jobs?section=nope");
    assert.equal(body.length, FIXTURE_COUNTS.total);
  });

  test("jobs include expected fields", async () => {
    const { body } = await api("/api/jobs?section=all");
    const j = body[0];
    for (const field of ["id", "title", "company", "location", "url", "relevance",
                          "suitability", "link_status", "stage", "status"]) {
      assert.ok(field in j, `missing field: ${field}`);
    }
  });
});

// --- /api/skills ---
describe("GET /api/skills", () => {
  test("returns 200 with an array", async () => {
    const { status, body } = await api("/api/skills");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
  });

  test("returns skill rows with skill/category/count fields", async () => {
    const { body } = await api("/api/skills");
    assert.ok(body.length > 0);
    const row = body[0];
    assert.ok("skill" in row);
    assert.ok("category" in row);
    assert.ok("count" in row);
  });

  test("Python appears across categories (seeded in 3 jobs total)", async () => {
    const { body } = await api("/api/skills");
    // skill_demand groups by (skill, category), so Python can appear in
    // multiple rows (swe: 2, mle: 1). Check total count across categories = 3.
    const pythonRows = body.filter((r: { skill: string }) => r.skill === "Python");
    assert.ok(pythonRows.length > 0, "Python not found in skills");
    const total = pythonRows.reduce((s: number, r: { count: number }) => s + r.count, 0);
    assert.equal(total, 3, `Expected Python total count=3, got ${total}`);
  });

  test("results are sorted by count descending", async () => {
    const { body } = await api("/api/skills");
    for (let i = 1; i < body.length; i++) {
      assert.ok(
        body[i - 1].count >= body[i].count,
        `Out of order at index ${i}: ${body[i-1].count} < ${body[i].count}`,
      );
    }
  });
});

// --- /api/analyses ---
describe("GET /api/analyses", () => {
  test("returns 200", async () => {
    const { status } = await api("/api/analyses");
    assert.equal(status, 200);
  });

  test("returns an analysis object with id, kind, content", async () => {
    const { body } = await api("/api/analyses");
    assert.ok(body !== null, "Expected non-null analysis");
    assert.ok("id" in body);
    assert.ok("kind" in body);
    assert.ok("content" in body);
  });

  test("content is valid JSON with expected shape", async () => {
    const { body } = await api("/api/analyses");
    const a = JSON.parse(body.content);
    assert.ok("summary" in a);
    assert.ok("gap" in a);
    assert.ok(Array.isArray(a.gap));
  });

  test("returns null when no analyses exist", async () => {
    // Spin up a fresh DB with no analyses.
    const emptyDb = await openTestDb();
    const emptyApp = createApp(emptyDb);
    const emptyServer = createServer(emptyApp);
    await new Promise<void>((res) => emptyServer.listen(0, "127.0.0.1", res));
    const { port } = emptyServer.address() as { port: number };
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/analyses`);
      const body = await res.json();
      assert.equal(body, null);
    } finally {
      emptyServer.close();
      emptyDb.close();
    }
  });
});

// --- POST /api/jobs/:id/stage ---
describe("POST /api/jobs/:id/stage", () => {
  test("200 on valid stage update", async () => {
    const { status, body } = await api("/api/jobs/seed:1/stage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stage: "applied" }),
    });
    assert.equal(status, 200);
    assert.equal(body.stage, "applied");
  });

  test("stage persists to DB", async () => {
    await api("/api/jobs/seed:1/stage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stage: "interview" }),
    });
    const { body } = await api("/api/jobs?section=all");
    const job = body.find((j: { id: string }) => j.id === "seed:1");
    assert.equal(job.stage, "interview");
  });

  test("400 for invalid stage", async () => {
    const { status, body } = await api("/api/jobs/seed:1/stage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stage: "winning" }),
    });
    assert.equal(status, 400);
    assert.ok(body.error.includes("stage must be one of"));
  });

  test("404 for nonexistent job id", async () => {
    const { status, body } = await api("/api/jobs/no-such-id/stage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stage: "applied" }),
    });
    assert.equal(status, 404);
    assert.ok(body.error.includes("not found"));
  });

  test("accepts all valid stage values", async () => {
    const stages = ["not_applied", "applied", "confirmed", "oa", "interview", "offer", "rejected"];
    for (const stage of stages) {
      const { status } = await api("/api/jobs/seed:1/stage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      assert.equal(status, 200, `Expected 200 for stage=${stage}`);
    }
  });
});

// --- /api/commands + /api/run ---
describe("GET /api/commands", () => {
  test("returns the allow-list array", async () => {
    const { status, body } = await api("/api/commands");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    assert.ok(body.length > 0);
    assert.ok(body.some((c: { id: string }) => c.id === "seed"));
    assert.ok(body.some((c: { id: string }) => c.id === "configure"));
  });
});

describe("POST /api/run", () => {
  test("400 for unknown command", async () => {
    const { status, body } = await api("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "rm -rf /" }),
    });
    assert.equal(status, 400);
    assert.ok(body.error.includes("unknown command"));
  });

  test("400 for empty command", async () => {
    const { status, body } = await api("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "" }),
    });
    assert.equal(status, 400);
    assert.ok(body.error);
  });
});

// --- Static files ---
describe("static file serving", () => {
  test("GET / returns index.html (200)", async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes("<title>Job Tracker</title>"));
  });
});
