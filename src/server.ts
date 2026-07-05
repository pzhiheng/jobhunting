import "dotenv/config";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import { spawn } from "node:child_process";
import { openDb } from "./db.js";
import type { Client } from "@libsql/client";

const PORT = Number(process.env.PORT ?? 3001);
const PUBLIC_DIR = new URL("../public", import.meta.url).pathname;

// Allow-list of pipeline npm scripts runnable from the control panel.
// "pipeline" commands are listed in daily-run order; "tools" are on-demand.
const COMMANDS: {
  id: string; label: string; script: string; takesArg: boolean;
  group: "pipeline" | "tools"; desc: string;
}[] = [
  { id: "fetch", label: "Fetch postings", script: "fetch", takesArg: false, group: "pipeline",
    desc: "Pull new postings from Adzuna, company career boards, and the Simplify feed, then collapse duplicates." },
  { id: "check-links", label: "Check links", script: "check-links", takesArg: false, group: "pipeline",
    desc: "Re-check every posting's apply link — dead ones are hidden until they come back." },
  { id: "curate", label: "Curate", script: "curate", takesArg: false, group: "pipeline",
    desc: "Score each new posting against your résumé: relevance, fit, and required skills. Costs a few cents." },
  { id: "blurbs", label: "Company intros", script: "blurbs", takesArg: false, group: "pipeline",
    desc: "Write a one-line introduction for any company seen for the first time." },
  { id: "poll", label: "Poll inbox", script: "poll", takesArg: false, group: "pipeline",
    desc: "Read your email and record confirmations, OAs, interviews, offers, and rejections automatically." },
  { id: "analyze", label: "Analyze skills", script: "analyze", takesArg: false, group: "pipeline",
    desc: "Refresh the in-demand-skills and résumé-gap analysis across everything tracked." },
  { id: "digest", label: "Build digest", script: "digest", takesArg: false, group: "pipeline",
    desc: "Preview today's digest email without sending it." },
  { id: "configure", label: "Configure search", script: "configure", takesArg: true, group: "tools",
    desc: "Rebuild the search from a plain-English request — what roles, where, what to exclude." },
  { id: "refine", label: "Refine filter", script: "refine", takesArg: true, group: "tools",
    desc: "Adjust the current search without starting over — e.g. “add AI engineer intern”." },
  { id: "dedup", label: "Dedup postings", script: "dedup", takesArg: false, group: "tools",
    desc: "Collapse duplicate postings to one canonical row. Also runs automatically after every fetch." },
  { id: "seed", label: "Seed sample jobs", script: "seed", takesArg: false, group: "tools",
    desc: "Load four sample postings to try the tracker without any credentials." },
];

const STAGES = [
  "not_applied", "applied", "confirmed", "oa", "interview", "offer", "rejected",
];

const JOB_COLS = `id, title, company, location, remote, url, category,
  salary_min, salary_max, relevance, relevance_notes, suitability,
  suitability_notes, link_status, link_checked_at, stage, status, posted_at`;

// A job is "available" (still worth listing) unless its posting is gone — but a
// job you've already applied to is always kept regardless of its link. So this
// hides only not-applied jobs whose link is dead.
const AVAILABLE = "(stage <> 'not_applied' OR link_status NOT IN ('broken','expired'))";
// Only the canonical copy of a deduped posting is ever listed/counted.
const CANONICAL = "duplicate_of IS NULL";

// Section → WHERE/ORDER. Lists are sorted newest-posted-first (not by company);
// Top picks leads with relevance, then recency. Gone postings drop out via
// AVAILABLE; duplicate copies drop out via CANONICAL. "top_picks" = suitable,
// strong relevance, link not dead, and NOT yet applied.
const SECTIONS: Record<string, { where: string; order: string }> = {
  all: { where: `${CANONICAL} AND ${AVAILABLE}`, order: "posted_at DESC" },
  top_picks: {
    where: `suitability = 'suitable' AND relevance >= 4 AND link_status NOT IN ('broken','expired') AND stage = 'not_applied' AND ${CANONICAL}`,
    order: "relevance DESC, posted_at DESC",
  },
  not_suitable: { where: `suitability = 'unsuitable' AND ${AVAILABLE} AND ${CANONICAL}`, order: "posted_at DESC" },
  applied: { where: `stage <> 'not_applied' AND ${CANONICAL}`, order: "stage, posted_at DESC" },
};

/** Build the Express app around an open DB client. Exported for tests so the
 *  real API can be mounted on an ephemeral port without spawning a subprocess. */
export function createApp(db: Client): Express {
  const app = express();
  app.use(express.json());

  app.get("/api/summary", async (_req, res) => {
    const q = async (where: string) =>
      Number((await db.execute(`SELECT COUNT(*) AS n FROM jobs WHERE ${where}`)).rows[0].n);
    res.json({
      total: await q(CANONICAL),
      top_picks: await q(SECTIONS.top_picks.where),
      suitable: await q(`suitability = 'suitable' AND ${CANONICAL}`),
      not_suitable: await q(SECTIONS.not_suitable.where),
      applied: await q(SECTIONS.applied.where),
      new: await q(`status = 'new' AND ${CANONICAL}`),
      broken: await q(`link_status IN ('broken','expired') AND ${CANONICAL}`),
    });
  });

  app.get("/api/jobs", async (req, res) => {
    const section = SECTIONS[String(req.query.section ?? "all")] ?? SECTIONS.all;
    const rows = (
      await db.execute(
        `SELECT ${JOB_COLS}, c.blurb AS company_blurb
         FROM jobs LEFT JOIN companies c ON c.name = jobs.company
         WHERE ${section.where} ORDER BY ${section.order}`,
      )
    ).rows;
    res.json(rows);
  });

  app.get("/api/skills", async (_req, res) => {
    const rows = (
      await db.execute("SELECT skill, category, count FROM skill_demand ORDER BY count DESC, skill")
    ).rows;
    res.json(rows);
  });

  // Latest analyst output (skill demand + résumé gap), or null if none yet.
  app.get("/api/analyses", async (_req, res) => {
    const rows = (
      await db.execute("SELECT id, created_at, kind, content FROM analyses ORDER BY id DESC LIMIT 1")
    ).rows;
    res.json(rows[0] ?? null);
  });

  app.post("/api/jobs/:id/stage", async (req, res) => {
    const stage = String(req.body?.stage ?? "");
    if (!STAGES.includes(stage)) {
      res.status(400).json({ error: `stage must be one of ${STAGES.join(", ")}` });
      return;
    }
    const r = await db.execute({
      sql: "UPDATE jobs SET stage = :stage WHERE id = :id",
      args: { id: req.params.id, stage },
    });
    if (r.rowsAffected === 0) {
      res.status(404).json({ error: "job not found" });
      return;
    }
    // Record a dated event for the pipeline timeline (so manual stage changes are
    // timestamped even without the email poller). Skip reverting to not_applied.
    if (stage !== "not_applied") {
      await db.execute({
        sql: "INSERT INTO app_events (job_id, type, received_at) VALUES (:id, :stage, datetime('now'))",
        args: { id: req.params.id, stage },
      });
    }
    res.json({ id: req.params.id, stage });
  });

  // Manually log a job you applied to elsewhere (a site the pipeline never
  // fetched). Creates a 'manual' job at the given stage + a dated event, so it
  // shows in the Applied timeline like any other.
  app.post("/api/jobs", async (req, res) => {
    const company = String(req.body?.company ?? "").trim();
    const title = String(req.body?.title ?? "").trim();
    const url = String(req.body?.url ?? "").trim();
    const stage = String(req.body?.stage ?? "applied");
    if (!company) {
      res.status(400).json({ error: "company is required" });
      return;
    }
    if (!STAGES.includes(stage) || stage === "not_applied") {
      res.status(400).json({ error: `stage must be one of ${STAGES.filter((s) => s !== "not_applied").join(", ")}` });
      return;
    }
    const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
    const id = `manual:${slug(company)}${title ? "-" + slug(title) : ""}` || `manual:${Date.now()}`;
    await db.execute({
      sql: `INSERT INTO jobs (id, source, external_id, title, company, url, fetched_at, status, stage, suitability)
            VALUES (:id, 'manual', :id, :title, :company, :url, datetime('now'), 'reviewed', :stage, 'unreviewed')
            ON CONFLICT(id) DO UPDATE SET stage = excluded.stage, url = excluded.url, duplicate_of = NULL`,
      args: { id, title: title || `${company} application`, company, url: url || null, stage },
    });
    await db.execute({
      sql: "INSERT INTO app_events (job_id, type, received_at) VALUES (:id, :stage, datetime('now'))",
      args: { id, stage },
    });
    res.json({ id, stage });
  });

  // Applied pipeline: each non-not_applied job with its dated stage-event timeline.
  app.get("/api/applied", async (_req, res) => {
    const jobs = (
      await db.execute(
        `SELECT j.id, j.title, j.company, j.location, j.url, j.stage, c.blurb AS company_blurb
         FROM jobs j LEFT JOIN companies c ON c.name = j.company
         WHERE j.stage <> 'not_applied' AND j.duplicate_of IS NULL ORDER BY j.posted_at DESC`,
      )
    ).rows;
    // One milestone per (job, type): a single OA generates several oa-classified
    // emails (invite, login codes, "completed"), and a confirmation can repeat —
    // collapse them to the earliest of each type so the timeline reads as stages,
    // not one pill per email. The raw app_events log is kept intact.
    const events = (
      await db.execute(
        `SELECT job_id, type, MIN(COALESCE(received_at, created_at)) AS date FROM app_events
         WHERE job_id IN (SELECT id FROM jobs WHERE stage <> 'not_applied')
         GROUP BY job_id, type
         ORDER BY date`,
      )
    ).rows;
    const byJob: Record<string, { type: string; date: string }[]> = {};
    for (const e of events) {
      (byJob[String(e.job_id)] ??= []).push({ type: String(e.type), date: String(e.date ?? "") });
    }
    res.json(jobs.map((j) => ({ ...j, events: byJob[String(j.id)] ?? [] })));
  });

  // Control panel: the allow-list of runnable pipeline commands.
  app.get("/api/commands", (_req, res) => {
    res.json(COMMANDS);
  });

  // Run an allow-listed command via npm and return its output.
  app.post("/api/run", (req, res) => {
    const command = String(req.body?.command ?? "");
    const cmd = COMMANDS.find((c) => c.id === command);
    if (!cmd) {
      res.status(400).json({ error: `unknown command: ${command}` });
      return;
    }
    const rawArg = String(req.body?.arg ?? "").trim();
    const args = cmd.takesArg && rawArg ? [rawArg] : [];

    const child = spawn("npm", ["run", command, ...args], {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), 5 * 60 * 1000);

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      res.status(500).json({ error: err.message });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      res.json({ command, exitCode: code, stdout, stderr });
    });
  });

  app.use(express.static(PUBLIC_DIR));

  return app;
}

async function main() {
  const db = await openDb();
  const app = createApp(db);
  app.listen(PORT, "127.0.0.1", () => {
    console.log(`Job tracker on http://localhost:${PORT}`);
  });
}

// Only auto-start when run directly (not when imported by tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
