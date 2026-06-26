import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ParsedFilterSchema, FilterSchema } from "./filter.js";

const FILTER_PATH = new URL("../filter.json", import.meta.url).pathname;
const REQUEST_PATH = new URL("../request.md", import.meta.url).pathname;

const SYSTEM = `You convert a job seeker's natural-language request into a structured job filter.

A filter has two halves — produce BOTH:
1. searches[]: API-executable queries for the Adzuna job board. Each is
   { category, what, where }. "category" is a short tag you choose (e.g. "swe",
   "mle").
   - "what" = SHORT job-title keywords only (2-3 words, e.g. "software engineer",
     "machine learning engineer", "backend developer"). The board requires EVERY
     word in "what" to appear in a posting, so longer phrases match almost
     nothing. Do NOT put seniority ("entry level", "junior", "new grad"), skills,
     or "remote" in "what" — those belong in criteria.
   - "where" = a US city or state ("New York", "California"), or an EMPTY string
     "" for nationwide. Never use a country name ("United States") or a work-type
     ("Remote") as "where" — those match nothing.
   Produce 2-6 searches that together cover the request — split distinct role
   types into separate searches; vary "what" by role, not by seniority.
2. criteria: judgment the API can't express — { seniority (or null), mustHaves[],
   dealbreakers[], scoringRubric }. scoringRubric is 1-5 guidance a later step
   uses to score each job's fit.

Set titleOnly=true to match the role keywords in the job TITLE only — strongly
preferred for precise searches like internships (it keeps out full-time posts
that merely mention an internship in the body); use false only for a deliberately
broad search.

Defaults unless the request implies otherwise: country "us", maxDaysOld 2,
resultsPerPage 50, titleOnly true.`;

function readRequest(): string {
  const arg = process.argv.slice(2).join(" ").trim();
  if (arg) {
    writeFileSync(REQUEST_PATH, arg + "\n");
    return arg;
  }
  try {
    const saved = readFileSync(REQUEST_PATH, "utf8").trim();
    if (saved) return saved;
  } catch {
    /* fall through to the error below */
  }
  throw new Error(
    'No request given and request.md is empty. Usage: npm run configure "<what you want>"',
  );
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Missing ANTHROPIC_API_KEY. Put it in .env to run configure.");
  }
  const request = readRequest();
  const client = new Anthropic();

  const response = await client.messages.parse({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: SYSTEM,
    messages: [{ role: "user", content: request }],
    output_config: { format: zodOutputFormat(ParsedFilterSchema) },
  });

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error(`Model did not return a valid filter (stop reason: ${response.stop_reason}).`);
  }

  const filter = FilterSchema.parse({ request, ...parsed });
  writeFileSync(FILTER_PATH, JSON.stringify(filter, null, 2) + "\n");

  console.log(
    `Wrote filter.json: ${filter.searches.length} searches, ` +
      `${filter.criteria.mustHaves.length} must-haves, ` +
      `${filter.criteria.dealbreakers.length} dealbreakers.`,
  );
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
