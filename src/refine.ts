import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { openDb } from "./db.js";
import { FilterSchema, ParsedFilterSchema, type Filter } from "./filter.js";

const FILTER_PATH = new URL("../filter.json", import.meta.url).pathname;
const REQUEST_PATH = new URL("../request.md", import.meta.url).pathname;

const isMock = () => !!process.env.JOBHUNTER_MOCK;

function loadFilter(): Filter {
  try {
    return FilterSchema.parse(JSON.parse(readFileSync(FILTER_PATH, "utf8")));
  } catch {
    throw new Error('No filter.json to refine. Run `npm run configure "..."` first.');
  }
}

/** Summarize how the current filter has been performing, to inform the refinement. */
async function gatherSignal(): Promise<string> {
  const db = await openDb();
  const n = async (where: string) =>
    Number((await db.execute(`SELECT COUNT(*) AS n FROM jobs WHERE ${where}`)).rows[0].n);
  const signal = {
    total: await n("1=1"),
    dismissed: await n("status = 'dismissed'"),
    unsuitable: await n("suitability = 'unsuitable'"),
    expired: await n("link_status = 'expired'"),
  };
  db.close();
  return `Recent signal — total ${signal.total}, dismissed ${signal.dismissed}, ` +
    `unsuitable ${signal.unsuitable}, expired-links ${signal.expired}.`;
}

const SYSTEM = `You refine an existing job-search filter based on the user's
plain-language instruction and recent performance signal. Keep what works; change
only what the instruction implies. Return the full updated filter (searches[] +
criteria) in the same structure. searches are { category, what, where } Adzuna
queries; criteria is { seniority|null, mustHaves[], dealbreakers[], scoringRubric }.`;

async function main() {
  const instruction = process.argv.slice(2).join(" ").trim();
  if (!instruction) {
    throw new Error('Usage: npm run refine "<how to change the filter>"');
  }
  const current = loadFilter();
  const signal = await gatherSignal();

  let updated: Filter;
  if (isMock()) {
    updated = {
      ...current,
      request: instruction,
      criteria: {
        ...current.criteria,
        mustHaves: Array.from(new Set([...current.criteria.mustHaves, `refine: ${instruction}`])),
      },
    };
  } else {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("Missing ANTHROPIC_API_KEY. Put it in .env to run refine.");
    }
    const client = new Anthropic();
    const response = await client.messages.parse({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content:
            `CURRENT FILTER:\n${JSON.stringify({ searches: current.searches, criteria: current.criteria }, null, 2)}\n\n` +
            `${signal}\n\nINSTRUCTION: ${instruction}`,
        },
      ],
      output_config: { format: zodOutputFormat(ParsedFilterSchema) },
    });
    const parsed = response.parsed_output;
    if (!parsed) {
      throw new Error(`Refine returned no valid filter (stop reason: ${response.stop_reason}).`);
    }
    updated = { request: instruction, ...parsed };
  }

  writeFileSync(FILTER_PATH, JSON.stringify(updated, null, 2) + "\n");
  writeFileSync(REQUEST_PATH, instruction + "\n");
  console.log(
    `Refined filter.json: ${updated.searches.length} searches, ` +
      `${updated.criteria.mustHaves.length} must-haves. (${signal})`,
  );
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
