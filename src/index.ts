import "dotenv/config";
import { readFileSync } from "node:fs";
import { openDb, upsertJob } from "./db.js";
import { adzuna } from "./sources/adzuna.js";
import type { JobSource, Profile } from "./sources/types.js";

const SOURCES: JobSource[] = [adzuna];

function loadProfile(): Profile {
  const path = new URL("../profile.json", import.meta.url).pathname;
  return JSON.parse(readFileSync(path, "utf8")) as Profile;
}

async function main() {
  const profile = loadProfile();
  const db = openDb();

  let fetched = 0;
  let added = 0;
  for (const source of SOURCES) {
    try {
      const jobs = await source.fetch(profile);
      fetched += jobs.length;
      const insertAll = db.transaction((js: typeof jobs) => {
        for (const job of js) if (upsertJob(db, job)) added++;
      });
      insertAll(jobs);
      console.log(`[${source.name}] fetched ${jobs.length}`);
    } catch (err) {
      console.error(`[${source.name}] failed: ${(err as Error).message}`);
    }
  }

  const newCount = (
    db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status = 'new'").get() as { n: number }
  ).n;
  db.close();

  console.log(`\nDone. ${fetched} fetched, ${added} new this run, ${newCount} awaiting review.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
