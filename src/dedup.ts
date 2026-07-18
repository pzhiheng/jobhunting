import "dotenv/config";
import { fileURLToPath } from "node:url";
import { openDb, dedupKey, normCompany } from "./db.js";
import type { Client } from "@libsql/client";

// Direct-apply source rows beat the Adzuna redirect copy; rows synthesized from
// an email or the manual form are last — they exist only because the real row
// wasn't fetched (or matched) yet, so when a twin appears, the twin survives.
const sourceRank = (s: string) => (s === "email" || s === "manual" ? 2 : s === "adzuna" ? 1 : 0);
const engagedRank = (stage: string) => (stage && stage !== "not_applied" ? 0 : 1);
const ts = (p: unknown) => {
  const t = Date.parse(String(p ?? ""));
  return isNaN(t) ? 0 : t;
};

// Stage order for propagation onto the surviving row ('confirmed' = legacy applied).
const STAGE_RANK: Record<string, number> = {
  not_applied: 0, applied: 1, confirmed: 1, oa: 3, interview: 4, offer: 5, rejected: 6,
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

/** Pick the row that should survive a merge: real source rows over the Adzuna
 *  redirect over email/manual stand-ins; engagement breaks ties, then recency.
 *  Engagement itself is never lost — dedupeJobs moves stage + events onto the
 *  survivor. */
export function pickCanonical(group: Row[]): Row {
  return [...group].sort(
    (a, b) =>
      sourceRank(a.source) - sourceRank(b.source) ||
      engagedRank(a.stage) - engagedRank(b.stage) ||
      ts(b.posted_at) - ts(a.posted_at) ||
      (a.id < b.id ? -1 : 1),
  )[0];
}

/** An email/manual row created without a role ("Acme Corp application"). */
const isPlaceholder = (r: Row) =>
  (r.source === "email" || r.source === "manual") &&
  r.title.toLowerCase() === `${r.company} application`.toLowerCase();

/** Point `dup` at `canonical`: mark it, move its timeline events over, and
 *  carry the highest stage of the pair onto the canonical row. */
async function mergeInto(db: Client, dup: Row, canonical: Row): Promise<void> {
  await db.execute({
    sql: "UPDATE jobs SET duplicate_of = :c WHERE id = :id",
    args: { c: canonical.id, id: dup.id },
  });
  await db.execute({
    sql: "UPDATE app_events SET job_id = :c WHERE job_id = :id",
    args: { c: canonical.id, id: dup.id },
  });
  if ((STAGE_RANK[dup.stage] ?? 0) > (STAGE_RANK[canonical.stage] ?? 0)) {
    await db.execute({
      sql: "UPDATE jobs SET stage = :s WHERE id = :id",
      args: { s: dup.stage === "confirmed" ? "applied" : dup.stage, id: canonical.id },
    });
    canonical.stage = dup.stage; // keep the in-memory copy honest for later merges
  }
}

/** Collapse duplicate postings to a single canonical row; the rest get
 *  duplicate_of set (hidden from listings, never deleted) and their engagement
 *  (stage + dated events) moves onto the survivor.
 *
 *  Pass 1 groups by fingerprint (normalized company | title) across ALL sources.
 *  Pass 2 folds placeholder rows ("Acme application", created from an email or
 *  the manual form when no role was known) into a same-company real row — those
 *  can never title-match, but they describe the same application.
 *  Idempotent; runs at the end of every fetch. */
export async function dedupeJobs(db: Client): Promise<{ duplicateGroups: number; hidden: number }> {
  const rows = (
    await db.execute("SELECT id, source, company, title, location, stage, posted_at FROM jobs")
  ).rows as unknown as Row[];

  let duplicateGroups = 0;
  let hidden = 0;

  // --- Pass 1: fingerprint groups ---
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = dedupKey(r.company, r.title, r.location);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }

  const canonicals: Row[] = [];
  for (const [key, g] of groups) {
    const canonical = pickCanonical(g);
    canonicals.push(canonical);
    if (g.length > 1) duplicateGroups++;
    await db.execute({
      sql: "UPDATE jobs SET dedup_key = :k, duplicate_of = NULL WHERE id = :id",
      args: { k: key, id: canonical.id },
    });
    for (const r of g) {
      if (r.id === canonical.id) continue;
      await db.execute({ sql: "UPDATE jobs SET dedup_key = :k WHERE id = :id", args: { k: key, id: r.id } });
      await mergeInto(db, r, canonical);
      hidden++;
    }
  }

  // --- Pass 2: fold placeholder rows into a same-company real row ---
  const byCompany = new Map<string, Row[]>();
  for (const c of canonicals) {
    const k = normCompany(c.company);
    if (!k) continue;
    (byCompany.get(k) ?? byCompany.set(k, []).get(k)!).push(c);
  }
  for (const row of canonicals) {
    if (!isPlaceholder(row)) continue;
    const twins = (byCompany.get(normCompany(row.company)) ?? []).filter(
      (t) => t.id !== row.id && !isPlaceholder(t),
    );
    if (twins.length === 0) continue; // genuinely not on the board — keep it
    // Prefer the twin the user engaged with (they may have clicked "applied" on
    // the website row), then the best source, then the freshest posting.
    const target = [...twins].sort(
      (a, b) =>
        engagedRank(a.stage) - engagedRank(b.stage) ||
        sourceRank(a.source) - sourceRank(b.source) ||
        ts(b.posted_at) - ts(a.posted_at) ||
        (a.id < b.id ? -1 : 1),
    )[0];
    await mergeInto(db, row, target);
    duplicateGroups++;
    hidden++;
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
