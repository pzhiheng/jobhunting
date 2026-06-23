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
   "mle"). "what" is title/keywords the board matches; "where" is a location
   string ("United States", "New York", "Remote"). Produce 2-6 searches that
   together cover the request — split distinct roles/locations into separate
   searches.
2. criteria: judgment the API can't express — { seniority (or null), mustHaves[],
   dealbreakers[], scoringRubric }. scoringRubric is 1-5 guidance a later step
   uses to score each job's fit.

Defaults unless the request implies otherwise: country "us", maxDaysOld 2,
resultsPerPage 50.`;

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
