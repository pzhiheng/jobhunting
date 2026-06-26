import "dotenv/config";
import { readFileSync } from "node:fs";
import { openDb } from "./db.js";
import { judgeJobsBatch } from "./judge.js";
import { loadResume } from "./resume.js";
import { FilterSchema, type Criteria } from "./filter.js";

const FILTER_PATH = new URL("../filter.json", import.meta.url).pathname;
const DEFAULT_CRITERIA: Criteria = {
  seniority: null,
  mustHaves: [],
  dealbreakers: [],
  scoringRubric: "",
};

function loadCriteria(): Criteria {
  try {
    return FilterSchema.parse(JSON.parse(readFileSync(FILTER_PATH, "utf8"))).criteria;
  } catch {
    if (process.env.JOBHUNTER_MOCK) return DEFAULT_CRITERIA;
    throw new Error('No filter.json found. Run `npm run configure "<what you want>"` first.');
  }
}

async function main() {
  const criteria = loadCriteria();
  const resume = loadResume();
  if (!resume && !process.env.JOBHUNTER_MOCK) {
    console.warn("Warning: no resume.md/resume.pdf found — suitability will be weaker.");
  }

  const db = await openDb();
  const { rows } = await db.execute(
    "SELECT id, title, company, location, description, category FROM jobs WHERE status = 'new'",
  );
  const jobs = rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    company: String(r.company ?? ""),
    location: String(r.location ?? ""),
    description: String(r.description ?? ""),
    category: String(r.category ?? ""),
  }));

  if (jobs.length === 0) {
    db.close();
    console.log("Nothing new to curate.");
    return;
  }

  // One Message Batch for the whole set (50% cheaper, no rate-limit pacing).
  const judgments = await judgeJobsBatch(jobs, { criteria, resume });

  let reviewed = 0;
  let suitable = 0;
  for (const job of jobs) {
    const j = judgments.get(job.id);
    if (!j) continue; // request errored — leave status='new' to retry next run

    await db.execute({
      sql: `UPDATE jobs SET relevance = :rel, relevance_notes = :relNotes,
              suitability = :suit, suitability_notes = :suitNotes, status = 'reviewed'
            WHERE id = :id`,
      args: {
        id: job.id,
        rel: j.relevance,
        relNotes: j.relevanceNotes,
        suit: j.suitability,
        suitNotes: j.suitabilityNotes,
      },
    });

    // refresh skills idempotently
    await db.execute({ sql: "DELETE FROM job_skills WHERE job_id = :id", args: { id: job.id } });
    for (const skill of j.skills) {
      await db.execute({
        sql: "INSERT OR IGNORE INTO job_skills (job_id, skill) VALUES (:id, :skill)",
        args: { id: job.id, skill },
      });
    }

    reviewed++;
    if (j.suitability === "suitable") suitable++;
  }
  db.close();

  const deferred = jobs.length - reviewed;
  console.log(
    `Curated ${reviewed} job(s): ${suitable} suitable, ${reviewed - suitable} unsuitable (kept).` +
      (deferred ? ` ${deferred} deferred (batch errors, will retry).` : ""),
  );
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
