import "dotenv/config";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { openDb } from "./db.js";
import type { Client } from "@libsql/client";

const isMock = () => !!process.env.JOBHUNTER_MOCK;

const BlurbSchema = z.object({
  blurbs: z.array(z.object({ name: z.string(), blurb: z.string() })),
});

/** Deterministic fallback used in mock mode and when the model omits a company. */
export function mockBlurb(name: string): string {
  return `${name} is an employer with open roles in your search.`;
}

/** Companies that appear in jobs but don't have a blurb yet. */
export async function companiesNeedingBlurbs(db: Client): Promise<string[]> {
  const { rows } = await db.execute(
    `SELECT DISTINCT company FROM jobs
     WHERE company IS NOT NULL AND company <> ''
       AND company NOT IN (SELECT name FROM companies WHERE blurb IS NOT NULL AND blurb <> '')`,
  );
  return rows.map((r) => String(r.company));
}

const SYSTEM = `For each company name, write ONE concise, neutral sentence (max ~25 words)
introducing what the company does. If you are not confident what the company is, write a
generic sentence noting it is an employer in the candidate's job search. No marketing language,
no superlatives.`;

/** One Haiku call per chunk of company names → name→blurb. */
async function realBlurbs(names: string[]): Promise<Map<string, string>> {
  const client = new Anthropic();
  const out = new Map<string, string>();
  for (let i = 0; i < names.length; i += 20) {
    const chunk = names.slice(i, i + 20);
    const resp = await client.messages.parse({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: SYSTEM,
      messages: [{ role: "user", content: `Companies:\n${chunk.map((n) => `- ${n}`).join("\n")}` }],
      output_config: { format: zodOutputFormat(BlurbSchema) },
    });
    for (const b of resp.parsed_output?.blurbs ?? []) out.set(b.name, b.blurb);
  }
  return out;
}

async function main() {
  const db = await openDb();
  try {
    const names = await companiesNeedingBlurbs(db);
    if (names.length === 0) {
      console.log("No new companies needing a blurb.");
      return;
    }
    const blurbs = isMock()
      ? new Map(names.map((n) => [n, mockBlurb(n)] as const))
      : await realBlurbs(names);

    let written = 0;
    for (const name of names) {
      const blurb = blurbs.get(name) ?? mockBlurb(name);
      await db.execute({
        sql: `INSERT INTO companies (name, blurb, updated_at)
              VALUES (:name, :blurb, datetime('now'))
              ON CONFLICT(name) DO UPDATE SET blurb = excluded.blurb, updated_at = excluded.updated_at`,
        args: { name, blurb },
      });
      written++;
    }
    console.log(`Wrote ${written} company blurb(s).`);
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
