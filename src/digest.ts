import "dotenv/config";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.js";
import type { Client } from "@libsql/client";

// Mirrors the web app's "Top picks" section (server.ts SECTIONS.top_picks):
// suitable, strong relevance, link not dead.
const TOP_PICKS_WHERE =
  "suitability = 'suitable' AND relevance >= 4 AND link_status NOT IN ('broken','expired')";

function fmtSalary(min: unknown, max: unknown): string {
  const k = (n: number) => `$${Math.round(n / 1000)}k`;
  const lo = min == null ? 0 : Number(min);
  const hi = max == null ? 0 : Number(max);
  if (lo && hi) return ` · ${k(lo)}–${k(hi)}`;
  if (lo) return ` · ${k(lo)}+`;
  if (hi) return ` · up to ${k(hi)}`;
  return "";
}

async function counts(db: Client) {
  const q = async (where: string) =>
    Number((await db.execute(`SELECT COUNT(*) AS n FROM jobs WHERE ${where}`)).rows[0].n);
  return {
    total: await q("1=1"),
    topPicks: await q(TOP_PICKS_WHERE),
    suitable: await q("suitability = 'suitable'"),
    notSuitable: await q("suitability = 'unsuitable'"),
    applied: await q("stage <> 'not_applied'"),
    broken: await q("link_status IN ('broken','expired')"),
  };
}

/** Build the daily email body (Markdown): top picks + pipeline counts + skills. */
export async function buildDigest(db: Client): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const c = await counts(db);
  const picks = (
    await db.execute(
      `SELECT title, company, location, url, salary_min, salary_max, relevance
       FROM jobs WHERE ${TOP_PICKS_WHERE} ORDER BY relevance DESC, company LIMIT 10`,
    )
  ).rows;

  const lines: string[] = [`# Job digest — ${today}`, "", `## Top picks (${c.topPicks})`];
  if (picks.length === 0) {
    lines.push("No new top picks today.");
  } else {
    for (const p of picks) {
      lines.push(
        `- ${p.title} — ${p.company ?? "—"} · ${p.location ?? "—"}` +
          `${fmtSalary(p.salary_min, p.salary_max)} · relevance ${p.relevance}`,
      );
      if (p.url) lines.push(`  ${p.url}`);
    }
  }

  lines.push("", "## Pipeline", `${c.total} tracked · ${c.topPicks} top picks · ` +
    `${c.suitable} suitable · ${c.notSuitable} not suitable · ${c.applied} in progress · ` +
    `${c.broken} broken links`);

  // Latest analyst output (skills demand + résumé gap), if any.
  const a = (await db.execute("SELECT content FROM analyses ORDER BY id DESC LIMIT 1")).rows[0];
  if (a?.content) {
    try {
      const an = JSON.parse(String(a.content)) as { summary?: string; gap?: string[] };
      lines.push("", "## Skills");
      if (an.summary) lines.push(an.summary);
      if (an.gap?.length) lines.push(`To learn: ${an.gap.join(", ")}.`);
    } catch {
      // malformed analysis row — skip the skills block
    }
  }

  return lines.join("\n");
}

async function main() {
  const db = await openDb();
  const digest = await buildDigest(db);
  db.close();
  process.stdout.write(digest + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
