import "dotenv/config";
import { readFileSync } from "node:fs";
import { openDb, upsertJob } from "./db.js";
import { dedupeJobs } from "./dedup.js";
import { adzuna } from "./sources/adzuna.js";
import { companyBoards } from "./sources/companyBoards.js";
import { simplify } from "./sources/simplify.js";
import { FilterSchema, toSearchConfig } from "./filter.js";
import type { JobSource } from "./sources/types.js";

const SOURCES: JobSource[] = [adzuna, companyBoards, simplify];
const FILTER_PATH = new URL("../filter.json", import.meta.url).pathname;

function loadFilter() {
  let raw: string;
  try {
    raw = readFileSync(FILTER_PATH, "utf8");
  } catch {
    throw new Error(
      'No filter.json found. Run `npm run configure "<what you want>"` first to generate it.',
    );
  }
  return FilterSchema.parse(JSON.parse(raw));
}

async function main() {
  const filter = loadFilter();
  const config = toSearchConfig(filter);
  const db = await openDb();

  let fetched = 0;
  let added = 0;
  for (const source of SOURCES) {
    try {
      const jobs = await source.fetch(config);
      fetched += jobs.length;
      for (const job of jobs) {
        if (await upsertJob(db, job)) added++;
      }
      console.log(`[${source.name}] fetched ${jobs.length}`);
    } catch (err) {
      console.error(`[${source.name}] failed: ${(err as Error).message}`);
    }
  }

  // Collapse cross-source/within-source duplicates to one canonical row each.
  const { duplicateGroups, hidden } = await dedupeJobs(db);

  const newCount = (
    await db.execute("SELECT COUNT(*) AS n FROM jobs WHERE status = 'new' AND duplicate_of IS NULL")
  ).rows[0].n;
  db.close();

  console.log(
    `\nDone. ${fetched} fetched, ${added} new this run, ${newCount} awaiting review` +
      ` (deduped ${duplicateGroups} group(s), ${hidden} copy(ies) hidden).`,
  );
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
