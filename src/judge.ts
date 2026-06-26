import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Criteria } from "./filter.js";
import type { ResumeContent } from "./resume.js";

/** A single job's judgment: search-fit relevance + résumé-fit suitability + skills. */
export const JudgmentSchema = z.object({
  relevance: z.number(), // 1..5; clamped after parse (structured outputs drop numeric bounds)
  relevanceNotes: z.string(),
  suitability: z.enum(["suitable", "unsuitable"]),
  suitabilityNotes: z.string(),
  skills: z.array(z.string()),
});
export type Judgment = z.infer<typeof JudgmentSchema>;

export interface JobForJudgment {
  title: string;
  company: string;
  location: string;
  description: string;
  category: string;
}

export interface JudgeContext {
  criteria: Criteria;
  resume: ResumeContent | null;
}

const SYSTEM = `You evaluate a single job posting for one candidate. Return:
- relevance: integer 1-5 for how well the job matches the candidate's search
  criteria and scoring rubric (5 = bullseye, 1 = not for me).
- relevanceNotes: one sentence on why.
- suitability: "suitable" or "unsuitable" — whether the candidate's résumé
  (experience, skills, eligibility) actually fits this role, respecting any
  dealbreakers. Be honest; "unsuitable" is fine and expected for poor fits.
- suitabilityNotes: one sentence on why.
- skills: the normalized technical skills / technologies the job requires
  (e.g. "Python", "Kubernetes", "distributed systems"). Lowercase-free, canonical.`;

const isMock = () => !!process.env.JOBHUNTER_MOCK;

export async function judgeJob(job: JobForJudgment, ctx: JudgeContext): Promise<Judgment> {
  if (isMock()) return mockJudgment(job);

  const client = new Anthropic();
  const content: Anthropic.ContentBlockParam[] = [
    { type: "text", text: buildPrompt(job, ctx.criteria) },
  ];
  if (ctx.resume?.kind === "text") {
    content.push({ type: "text", text: `\n--- CANDIDATE RÉSUMÉ ---\n${ctx.resume.text}` });
  } else if (ctx.resume?.kind === "pdf") {
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: ctx.resume.data },
    });
  }

  const response = await client.messages.parse({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(JudgmentSchema) },
  });

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error(`Judge returned no valid output (stop reason: ${response.stop_reason}).`);
  }
  return { ...parsed, relevance: clamp(Math.round(parsed.relevance), 1, 5) };
}

function buildPrompt(job: JobForJudgment, c: Criteria): string {
  return [
    `JOB`,
    `Title: ${job.title}`,
    `Company: ${job.company}`,
    `Location: ${job.location}`,
    `Category: ${job.category}`,
    `Description: ${job.description.slice(0, 4000)}`,
    ``,
    `CANDIDATE CRITERIA`,
    `Seniority: ${c.seniority ?? "unspecified"}`,
    `Must-haves: ${c.mustHaves.join("; ") || "none"}`,
    `Dealbreakers: ${c.dealbreakers.join("; ") || "none"}`,
    `Scoring rubric: ${c.scoringRubric}`,
  ].join("\n");
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// --- Deterministic mock (JOBHUNTER_MOCK) — exercises the plumbing without an API key ---

const SKILL_VOCAB = [
  "Python", "TypeScript", "Go", "Java", "React", "Kubernetes", "Docker",
  "PostgreSQL", "AWS", "PyTorch", "TensorFlow", "Spark", "Kafka", "GraphQL",
];

function hash(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

function mockJudgment(job: JobForJudgment): Judgment {
  const found = SKILL_VOCAB.filter((s) =>
    `${job.title} ${job.description}`.toLowerCase().includes(s.toLowerCase()),
  );
  // alternate by title hash → a seed yields a suitable/unsuitable mix
  const suitable = hash(job.title) % 2 !== 0;
  const spread = hash(job.title + "|" + job.description);
  return {
    // correlate: suitable → 4-5 (top-pick range), unsuitable → 1-3
    relevance: suitable ? 4 + (spread % 2) : 1 + (spread % 3),
    relevanceNotes: "mock relevance",
    suitability: suitable ? "suitable" : "unsuitable",
    suitabilityNotes: "mock suitability",
    skills: found.length ? found : ["general-software"],
  };
}
