import "dotenv/config";
import express from "express";
import { openDb } from "./db.js";

const PORT = Number(process.env.PORT ?? 3001);
const PUBLIC_DIR = new URL("../public", import.meta.url).pathname;

const STAGES = [
  "not_applied", "applied", "confirmed", "oa", "interview", "offer", "rejected",
];

const JOB_COLS = `id, title, company, location, remote, url, category,
  salary_min, salary_max, relevance, relevance_notes, suitability,
  suitability_notes, link_status, link_checked_at, stage, status, posted_at`;

// Section → WHERE/ORDER. "top_picks" = suitable, strong relevance, link not dead.
const SECTIONS: Record<string, { where: string; order: string }> = {
  all: { where: "1=1", order: "relevance DESC, company" },
  top_picks: {
    where: "suitability = 'suitable' AND relevance >= 4 AND link_status NOT IN ('broken','expired')",
    order: "relevance DESC, company",
  },
  not_suitable: { where: "suitability = 'unsuitable'", order: "relevance DESC, company" },
  applied: { where: "stage <> 'not_applied'", order: "stage, company" },
};

async function main() {
  const db = await openDb();
  const app = express();
  app.use(express.json());

  app.get("/api/summary", async (_req, res) => {
    const q = async (where: string) =>
      Number((await db.execute(`SELECT COUNT(*) AS n FROM jobs WHERE ${where}`)).rows[0].n);
    res.json({
      total: await q("1=1"),
      top_picks: await q(SECTIONS.top_picks.where),
      suitable: await q("suitability = 'suitable'"),
      not_suitable: await q(SECTIONS.not_suitable.where),
      applied: await q(SECTIONS.applied.where),
      new: await q("status = 'new'"),
      broken: await q("link_status IN ('broken','expired')"),
    });
  });

  app.get("/api/jobs", async (req, res) => {
    const section = SECTIONS[String(req.query.section ?? "all")] ?? SECTIONS.all;
    const rows = (
      await db.execute(
        `SELECT ${JOB_COLS} FROM jobs WHERE ${section.where} ORDER BY ${section.order}`,
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
    res.json({ id: req.params.id, stage });
  });

  app.use(express.static(PUBLIC_DIR));

  app.listen(PORT, () => {
    console.log(`Job tracker on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
