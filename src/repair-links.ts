import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { openDb } from "./db.js";

type Repair =
  | { action: "repaired"; url: string }
  | { action: "expired" };

const isMock = () => !!process.env.JOBHUNTER_MOCK;

function hash(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

function mockRepair(job: { id: string; externalId: string }): Repair {
  return hash(job.id) % 2 === 0
    ? { action: "repaired", url: `https://jobs.example.com/${job.externalId}` }
    : { action: "expired" };
}

const REPAIR_SYSTEM = `A job posting's link is dead. Using web search, find the
current working URL for the SAME posting (same company + role), or determine the
posting is no longer available. Reply with ONE line of strict JSON, nothing else:
{"action":"repaired","url":"<working url>"}  or  {"action":"expired"}`;

async function realRepair(client: Anthropic, job: {
  title: string;
  company: string;
  url: string;
}): Promise<Repair> {
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Title: ${job.title}\nCompany: ${job.company}\nDead URL: ${job.url}`,
    },
  ];

  // Run the server-side web_search loop; resume on pause_turn (bounded).
  let response: Anthropic.Message | undefined;
  for (let i = 0; i < 4; i++) {
    response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: REPAIR_SYSTEM,
      messages,
      tools: [{ type: "web_search_20260209", name: "web_search" }],
    });
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }

  const text = (response?.content ?? [])
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed.action === "repaired" && typeof parsed.url === "string") {
        return { action: "repaired", url: parsed.url };
      }
    } catch {
      /* fall through */
    }
  }
  return { action: "expired" };
}

async function main() {
  const db = await openDb();
  const { rows } = await db.execute(
    "SELECT id, external_id, title, company, url FROM jobs WHERE link_status = 'broken'",
  );

  const client = isMock() ? null : new Anthropic();
  let repaired = 0;
  let expired = 0;
  for (const r of rows) {
    const job = {
      id: String(r.id),
      externalId: String(r.external_id),
      title: String(r.title),
      company: String(r.company ?? ""),
      url: String(r.url ?? ""),
    };
    const result = isMock() ? mockRepair(job) : await realRepair(client!, job);

    if (result.action === "repaired") {
      await db.execute({
        sql: "UPDATE jobs SET url = :url, link_status = 'repaired', link_checked_at = :t WHERE id = :id",
        args: { id: job.id, url: result.url, t: new Date().toISOString() },
      });
      repaired++;
    } else {
      await db.execute({
        sql: "UPDATE jobs SET link_status = 'expired', link_checked_at = :t WHERE id = :id",
        args: { id: job.id, t: new Date().toISOString() },
      });
      expired++;
    }
  }
  db.close();

  console.log(`Repaired ${repaired}, marked expired ${expired} (kept in tracker).`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
