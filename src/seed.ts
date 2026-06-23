import "dotenv/config";
import { openDb, upsertJob } from "./db.js";
import type { NormalizedJob } from "./sources/types.js";

/** Dev-only mock jobs so the judgment pipeline can be exercised without Adzuna.
 *  Includes a reachable URL and an unreachable one to test link checking. */
const MOCK_JOBS: NormalizedJob[] = [
  {
    id: "seed:1", source: "seed", externalId: "1",
    title: "Senior Backend Engineer", company: "Acme Corp", location: "New York, NY",
    remote: false, url: "https://example.com/",
    description: "Build distributed systems in Go and PostgreSQL on Kubernetes.",
    salaryMin: 160000, salaryMax: 210000, category: "swe", postedAt: "2026-06-22",
  },
  {
    id: "seed:2", source: "seed", externalId: "2",
    title: "Machine Learning Engineer", company: "DataWorks", location: "Remote",
    remote: true, url: "https://this-domain-should-not-exist-xyz123.invalid/job/2",
    description: "Train models with PyTorch and serve them with Python and AWS.",
    salaryMin: 150000, salaryMax: 200000, category: "mle", postedAt: "2026-06-22",
  },
  {
    id: "seed:3", source: "seed", externalId: "3",
    title: "Full Stack Engineer", company: "Foobar Inc", location: "San Francisco, CA",
    remote: false, url: "https://example.org/",
    description: "TypeScript, React, GraphQL. Ship product end to end.",
    salaryMin: 140000, salaryMax: 190000, category: "swe", postedAt: "2026-06-22",
  },
  {
    id: "seed:4", source: "seed", externalId: "4",
    title: "Applied Scientist", company: "Acme Corp", location: "Remote",
    remote: true, url: "https://no-such-host-abc987.invalid/4",
    description: "Research with TensorFlow and Spark over large Kafka streams.",
    salaryMin: 170000, salaryMax: 230000, category: "mle", postedAt: "2026-06-22",
  },
];

async function main() {
  const db = await openDb();
  let added = 0;
  for (const job of MOCK_JOBS) {
    if (await upsertJob(db, job)) added++;
  }
  db.close();
  console.log(`Seeded ${MOCK_JOBS.length} mock job(s) (${added} new).`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
