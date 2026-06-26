/**
 * Tests for the mock judgment path (JOBHUNTER_MOCK=1).
 * We call judgeJob after setting the env flag so no network/API key is needed.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { judgeJob } from "../../src/judge.js";
import type { JobForJudgment, JudgeContext } from "../../src/judge.js";

const CTX: JudgeContext = {
  criteria: {
    seniority: "senior",
    mustHaves: ["Python"],
    dealbreakers: [],
    scoringRubric: "Prefer backend",
  },
  resume: null,
};

const BACKEND_JOB: JobForJudgment = {
  title: "Senior Backend Engineer",
  company: "Acme",
  location: "NYC",
  description: "Build distributed systems in Go and PostgreSQL on Kubernetes.",
  category: "swe",
};

const FRONTEND_JOB: JobForJudgment = {
  title: "Junior Frontend Developer",
  company: "WidgetCo",
  location: "Remote",
  description: "React and TypeScript, entry level.",
  category: "swe",
};

before(() => { process.env.JOBHUNTER_MOCK = "1"; });
after(() => { delete process.env.JOBHUNTER_MOCK; });

describe("judgeJob (mock mode)", () => {
  test("returns a valid Judgment shape", async () => {
    const j = await judgeJob(BACKEND_JOB, CTX);
    assert.ok(typeof j.relevance === "number");
    assert.ok(j.relevance >= 1 && j.relevance <= 5, `relevance ${j.relevance} out of 1-5`);
    assert.ok(["suitable", "unsuitable"].includes(j.suitability));
    assert.ok(typeof j.relevanceNotes === "string");
    assert.ok(typeof j.suitabilityNotes === "string");
    assert.ok(Array.isArray(j.skills));
  });

  test("is deterministic — same input always same output", async () => {
    const a = await judgeJob(BACKEND_JOB, CTX);
    const b = await judgeJob(BACKEND_JOB, CTX);
    assert.equal(a.relevance, b.relevance);
    assert.equal(a.suitability, b.suitability);
    assert.deepEqual(a.skills, b.skills);
  });

  test("extracts skills mentioned in the job description", async () => {
    const j = await judgeJob(BACKEND_JOB, CTX);
    // The backend job mentions Go and Kubernetes; at least one should appear.
    const combined = j.skills.join(" ");
    assert.ok(
      combined.includes("Go") || combined.includes("Kubernetes") || combined.includes("PostgreSQL"),
      `Expected Go/Kubernetes/PostgreSQL in skills, got: ${combined}`,
    );
  });

  test("different jobs produce different relevance", async () => {
    const a = await judgeJob(BACKEND_JOB, CTX);
    const b = await judgeJob(FRONTEND_JOB, CTX);
    // The hash-based mock correlates suitability with relevance band —
    // at minimum the results shouldn't be identical for different titles.
    const aStr = JSON.stringify({ r: a.relevance, s: a.suitability });
    const bStr = JSON.stringify({ r: b.relevance, s: b.suitability });
    assert.notEqual(aStr, bStr);
  });

  test("suitable jobs have relevance 4-5", async () => {
    // Run a few jobs and verify the correlation: suitable → relevance ≥ 4.
    const jobs: JobForJudgment[] = [
      BACKEND_JOB,
      FRONTEND_JOB,
      { title: "ML Engineer", company: "DataWorks", location: "Remote",
        description: "PyTorch and AWS.", category: "mle" },
    ];
    for (const job of jobs) {
      const j = await judgeJob(job, CTX);
      if (j.suitability === "suitable") {
        assert.ok(j.relevance >= 4, `suitable job has relevance ${j.relevance} < 4`);
      } else {
        assert.ok(j.relevance <= 3, `unsuitable job has relevance ${j.relevance} > 3`);
      }
    }
  });
});
