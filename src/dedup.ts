import "dotenv/config";
import { fileURLToPath } from "node:url";
import { openDb, dedupKey } from "./db.js";
import type { Client } from "@libsql/client";

const sourceRank = (s: string) => (s === "adzuna" ? 1 : 0); // prefer direct-apply sources
const engagedRank = (stage: string) => (stage && stage !== "not_applied" ? 0 : 1);
const ts = (p: unknown) => {
  const t = Date.parse(String(p ?? ""));
  return isNaN(t) ? 0 : t;
};

interface Row {
  id: string;
  source: string;
  company: string;
  title: string;
  location: string;
  stage: string;
  posted_at: string | null;
}

/** Pick the row that should survive: a job you've engaged with wins, then a
 *  direct-apply source over an aggregator redirect, then the most recently
 *  posted, then a stable id tiebreak. */
export function pickCanonical(group: Row[]): Row {
  return [...group].sort(
    (a, b) =>
      engagedRank(a.stage) - engagedRank(b.stage) ||
      sourceRank(a.source) - sourceRank(b.source) ||
      ts(b.posted_at) - ts(a.posted_at) ||
      (a.id < b.id ? -1 : 1),
  )[0];
}

/** Collapse duplicate postings (same company|title|city across ANY source) to a
 *  single canonical row; the rest get duplicate_of = canonical id (hidden from
 *  listings, never deleted). Idempotent — safe to re-run after every fetch. */
export async function dedupeJobs(db: Client): Promise<{ duplicateGroups: number; hidden: number }> {
  const rows = (
    await db.execute("SELECT id, source, company, title, location, stage, posted_at FROM jobs")
  ).rows as unknown as Row[];

  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = dedupKey(r.company, r.title, r.location);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }

  let duplicateGroups = 0;
  let hidden = 0;
  for (const g of groups.values()) {
    const canonical = pickCanonical(g);
    const key = dedupKey(canonical.company, canonical.title, canonical.location);
    if (g.length > 1) duplicateGroups++;
    for (const r of g) {
      const dupOf = r.id === canonical.id ? null : canonical.id;
      await db.execute({
        sql: "UPDATE jobs SET dedup_key = :k, duplicate_of = :d WHERE id = :id",
        args: { k: key, d: dupOf, id: r.id },
      });
      if (dupOf) hidden++;
    }
  }
  return { duplicateGroups, hidden };
}

async function main() {
  const db = await openDb();
  try {
    const { duplicateGroups, hidden } = await dedupeJobs(db);
    console.log(`Deduped: ${duplicateGroups} duplicate group(s), ${hidden} copy(ies) hidden (kept in DB).`);
  } finally {
    db.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
