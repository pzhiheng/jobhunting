import "dotenv/config";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import { spawn } from "node:child_process";
import { openDb } from "./db.js";
import type { Client } from "@libsql/client";

const PORT = Number(process.env.PORT ?? 3001);
const PUBLIC_DIR = new URL("../public", import.meta.url).pathname;

// Allow-list of pipeline npm scripts runnable from the control panel.
const COMMANDS: { id: string; label: string; script: string; takesArg: boolean }[] = [
  { id: "seed", label: "Seed sample jobs", script: "seed", takesArg: false },
  { id: "fetch", label: "Fetch from job boards", script: "fetch", takesArg: false },
  { id: "check-links", label: "Check links", script: "check-links", takesArg: false },
  { id: "curate", label: "Curate (relevance + suitability)", script: "curate", takesArg: false },
  { id: "repair-links", label: "Repair links", script: "repair-links", takesArg: false },
  { id: "dedup", label: "Dedup postings", script: "dedup", takesArg: false },
  { id: "analyze", label: "Analyze skills", script: "analyze", takesArg: false },
  { id: "blurbs", label: "Company intros", script: "blurbs", takesArg: false },
  { id: "digest", label: "Build digest", script: "digest", takesArg: false },
  { id: "poll", label: "Poll inbox", script: "poll", takesArg: false },
  { id: "configure", label: "Configure search", script: "configure", takesArg: true },
  { id: "refine", label: "Refine filter", script: "refine", takesArg: true },
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

  // Applied pipeline: each non-not_applied job with its dated stage-event timeline.
  app.get("/api/applied", async (_req, res) => {
    const jobs = (
      await db.execute(
        `SELECT j.id, j.title, j.company, j.location, j.url, j.stage, c.blurb AS company_blurb
         FROM jobs j LEFT JOIN companies c ON c.name = j.company
         WHERE j.stage <> 'not_applied' AND j.duplicate_of IS NULL ORDER BY j.posted_at DESC`,
      )
    ).rows;
    const events = (
      await db.execute(
        `SELECT job_id, type, COALESCE(received_at, created_at) AS date FROM app_events
         WHERE job_id IN (SELECT id FROM jobs WHERE stage <> 'not_applied')
         ORDER BY COALESCE(received_at, created_at)`,
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
