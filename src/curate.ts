import "dotenv/config";
import { readFileSync } from "node:fs";
import { openDb } from "./db.js";
import { judgeJob } from "./judge.js";
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

  let reviewed = 0;
  let suitable = 0;
  for (const r of rows) {
    const job = {
      title: String(r.title),
      company: String(r.company ?? ""),
      location: String(r.location ?? ""),
      description: String(r.description ?? ""),
      category: String(r.category ?? ""),
    };
    const j = await judgeJob(job, { criteria, resume });

    await db.execute({
      sql: `UPDATE jobs SET relevance = :rel, relevance_notes = :relNotes,
              suitability = :suit, suitability_notes = :suitNotes, status = 'reviewed'
            WHERE id = :id`,
      args: {
        id: r.id as string,
        rel: j.relevance,
        relNotes: j.relevanceNotes,
        suit: j.suitability,
        suitNotes: j.suitabilityNotes,
      },
    });

    // refresh skills idempotently
    await db.execute({ sql: "DELETE FROM job_skills WHERE job_id = :id", args: { id: r.id as string } });
    for (const skill of j.skills) {
      await db.execute({
        sql: "INSERT OR IGNORE INTO job_skills (job_id, skill) VALUES (:id, :skill)",
        args: { id: r.id as string, skill },
      });
    }

    reviewed++;
    if (j.suitability === "suitable") suitable++;
  }
  db.close();

  console.log(
    `Curated ${reviewed} job(s): ${suitable} suitable, ${reviewed - suitable} unsuitable (kept).`,
  );
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
