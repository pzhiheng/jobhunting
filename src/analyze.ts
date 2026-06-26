import "dotenv/config";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { openDb } from "./db.js";
import { loadResume } from "./resume.js";
import type { Client } from "@libsql/client";

const isMock = () => !!process.env.JOBHUNTER_MOCK;

const SkillCount = z.object({ skill: z.string(), count: z.number() });
export const AnalysisSchema = z.object({
  totalJobs: z.number(),
  suitableJobs: z.number(),
  topSkills: z.array(SkillCount),
  gap: z.array(z.string()), // in-demand skills missing from the résumé
  summary: z.string(),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

/** Allow a single read-only SELECT/WITH statement only. */
export function assertReadOnly(sql: string): string {
  const s = sql.trim().replace(/;+\s*$/, "");
  if (s.includes(";")) throw new Error("only one statement allowed");
  if (!/^(select|with)\b/i.test(s)) throw new Error("read-only: must start with SELECT or WITH");
  if (/\b(insert|update|delete|drop|alter|create|attach|detach|pragma|replace|vacuum)\b/i.test(s)) {
    throw new Error("read-only: mutating keyword rejected");
  }
  return s;
}

async function main() {
  const db = await openDb();
  try {
    const analysis = isMock() ? await mockAnalysis(db) : await realAnalysis(db);

    await db.execute({
      sql: "INSERT INTO analyses (kind, content) VALUES ('skills', :content)",
      args: { content: JSON.stringify(analysis) },
    });

    console.log(
      `Analysis stored: ${analysis.totalJobs} jobs, ${analysis.suitableJobs} suitable, ` +
        `top skill "${analysis.topSkills[0]?.skill ?? "–"}", ${analysis.gap.length} to learn.`,
    );
  } finally {
    db.close();
  }
}

// --- Deterministic mock: aggregate directly ---

async function mockAnalysis(db: Client): Promise<Analysis> {
  const num = async (where: string) =>
    Number((await db.execute(`SELECT COUNT(*) AS n FROM jobs WHERE ${where}`)).rows[0].n);
  const totalJobs = await num("1=1");
  const suitableJobs = await num("suitability = 'suitable'");

  const topSkills = (
    await db.execute(
      "SELECT skill, COUNT(*) AS count FROM job_skills GROUP BY skill ORDER BY count DESC, skill LIMIT 10",
    )
  ).rows.map((r) => ({ skill: String(r.skill), count: Number(r.count) }));

  const resumeText = resumeAsText().toLowerCase();
  const gap = topSkills
    .filter((s) => !resumeText.includes(s.skill.toLowerCase()))
    .map((s) => s.skill);

  return {
    totalJobs,
    suitableJobs,
    topSkills,
    gap,
    summary:
      `Across ${totalJobs} jobs (${suitableJobs} suitable), the most in-demand skills are ` +
      `${topSkills.slice(0, 3).map((s) => s.skill).join(", ") || "n/a"}. ` +
      `${gap.length ? `Consider learning: ${gap.slice(0, 5).join(", ")}.` : "Your résumé covers the top skills."}`,
  };
}

function resumeAsText(): string {
  const r = loadResume();
  return r?.kind === "text" ? r.text : "";
}

// --- Real: Claude analyst with a read-only query_db tool ---

const ANALYST_SYSTEM = `You are a job-market analyst with READ-ONLY SQL access to a
SQLite/libSQL database. Tables: jobs (incl. suitability, relevance, salary_min/max,
category), job_skills (job_id, skill), app_events; view skill_demand (skill,
category, count). Use the query_db tool (SELECT/WITH only) to explore demand and
trends. Then summarize the most in-demand skills and, cross-referencing the
candidate's résumé, which ones they should learn.`;

async function realAnalysis(db: Client): Promise<Analysis> {
  const client = new Anthropic();
  const resume = resumeAsText();
  const tools: Anthropic.Tool[] = [
    {
      name: "query_db",
      description: "Run one read-only SQL SELECT/WITH query; returns JSON rows.",
      input_schema: {
        type: "object",
        properties: { sql: { type: "string" } },
        required: ["sql"],
      },
    },
  ];
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Analyze the job market in this database for the candidate.\n\nRÉSUMÉ:\n${resume || "(none provided)"}`,
    },
  ];

  for (let i = 0; i < 8; i++) {
    const resp = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: ANALYST_SYSTEM,
      tools,
      messages,
    });
    if (resp.stop_reason !== "tool_use") break;
    messages.push({ role: "assistant", content: resp.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const b of resp.content) {
      if (b.type === "tool_use" && b.name === "query_db") {
        let out: string;
        try {
          const rows = (await db.execute(assertReadOnly((b.input as { sql: string }).sql))).rows;
          out = JSON.stringify(rows).slice(0, 4000);
        } catch (e) {
          out = `ERROR: ${(e as Error).message}`;
        }
        results.push({ type: "tool_result", tool_use_id: b.id, content: out });
      }
    }
    messages.push({ role: "user", content: results });
  }

  const final = await client.messages.parse({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [...messages, { role: "user", content: "Return your final structured analysis." }],
    output_config: { format: zodOutputFormat(AnalysisSchema) },
  });
  if (!final.parsed_output) throw new Error("Analyst returned no structured analysis.");
  return final.parsed_output;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
