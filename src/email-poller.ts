import "dotenv/config";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { openDb } from "./db.js";
import type { Client } from "@libsql/client";

const isMock = () => !!process.env.JOBHUNTER_MOCK;

interface RawEmail {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: string;
}

type EventType = "confirmation" | "oa" | "interview" | "rejection" | "other";

const EVENT_STAGE: Partial<Record<EventType, string>> = {
  confirmation: "confirmed",
  oa: "oa",
  interview: "interview",
  rejection: "rejected",
};

// --- Mock fixture inbox (referencing seeded companies) ---
const MOCK_INBOX: RawEmail[] = [
  { id: "m1", from: "Acme Corp Talent <careers@acme.example>",
    subject: "We received your application",
    snippet: "Thank you for applying to the Senior Backend Engineer role.", receivedAt: "2026-06-22T09:00:00Z" },
  { id: "m2", from: "DataWorks Recruiting <noreply@dataworks.example>",
    subject: "Online Assessment for Machine Learning Engineer",
    snippet: "Please complete the coding assessment within 5 days.", receivedAt: "2026-06-22T10:00:00Z" },
  { id: "m3", from: "Foobar Inc Hiring <talent@foobar.example>",
    subject: "Interview invitation",
    snippet: "We'd like to schedule an interview for the Full Stack role.", receivedAt: "2026-06-22T11:00:00Z" },
  { id: "m4", from: "Acme Corp Talent <careers@acme.example>",
    subject: "Update on your application",
    snippet: "Unfortunately we will not be moving forward at this time.", receivedAt: "2026-06-22T12:00:00Z" },
];

// --- Email fetching: mock fixture or real Gmail REST ---

async function fetchEmails(): Promise<RawEmail[]> {
  if (isMock()) return MOCK_INBOX;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN in .env (or set JOBHUNTER_MOCK).",
    );
  }

  const token = await getAccessToken(clientId, clientSecret, refreshToken);
  const list = (await gmailGet(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&q=" +
      encodeURIComponent("newer_than:14d category:primary"),
    token,
  )) as { messages?: { id: string }[] };

  const emails: RawEmail[] = [];
  for (const { id } of list.messages ?? []) {
    const msg = (await gmailGet(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      token,
    )) as { snippet?: string; payload?: { headers?: { name: string; value: string }[] } };
    const headers = msg.payload?.headers ?? [];
    const h = (name: string) => headers.find((x) => x.name === name)?.value ?? "";
    emails.push({
      id,
      from: h("From"),
      subject: h("Subject"),
      snippet: msg.snippet ?? "",
      receivedAt: h("Date") || new Date().toISOString(),
    });
  }
  return emails;
}

async function getAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function gmailGet(url: string, token: string): Promise<unknown> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Gmail API ${res.status}: ${await res.text()}`);
  return res.json();
}

// --- Classification: mock keywords or real Claude ---

const ClassificationSchema = z.object({
  type: z.enum(["confirmation", "oa", "interview", "rejection", "other"]),
  company: z.string(),
});
type Classification = z.infer<typeof ClassificationSchema>;

const CLASSIFY_SYSTEM = `Classify a recruiting email about a job application into one of:
"confirmation" (application received/acknowledged), "oa" (online assessment / coding
challenge invite), "interview" (interview invitation/scheduling), "rejection"
(declined / not moving forward), or "other". Also extract the hiring company's name.`;

async function classify(email: RawEmail, client: Anthropic | null): Promise<Classification> {
  if (isMock() || !client) return mockClassify(email);
  const response = await client.messages.parse({
    model: "claude-sonnet-4-6",
    max_tokens: 256,
    system: CLASSIFY_SYSTEM,
    messages: [
      { role: "user", content: `From: ${email.from}\nSubject: ${email.subject}\nBody: ${email.snippet}` },
    ],
    output_config: { format: zodOutputFormat(ClassificationSchema) },
  });
  return response.parsed_output ?? mockClassify(email);
}

function mockClassify(email: RawEmail): Classification {
  const text = `${email.subject} ${email.snippet}`.toLowerCase();
  let type: EventType = "other";
  if (/assessment|coding challenge|\boa\b/.test(text)) type = "oa";
  else if (/interview/.test(text)) type = "interview";
  else if (/unfortunately|not moving forward|regret|declined/.test(text)) type = "rejection";
  else if (/received|thank you for applying|application/.test(text)) type = "confirmation";
  return { type, company: companyFromSender(email.from) };
}

/** "Acme Corp Talent <x@y>" → "Acme Corp" */
function companyFromSender(from: string): string {
  const name = from.split("<")[0].trim().replace(/"/g, "");
  return name.replace(/\s+(Talent|Recruiting|Careers|Hiring|Team|HR|Jobs)\b.*$/i, "").trim() || name;
}

// --- Matching + persistence ---

async function findJob(db: Client, company: string): Promise<string | null> {
  if (!company) return null;
  const { rows } = await db.execute("SELECT id, company FROM jobs ORDER BY id");
  const c = company.toLowerCase();
  for (const r of rows) {
    const jc = String(r.company ?? "").toLowerCase();
    if (jc && (jc.includes(c) || c.includes(jc))) return String(r.id);
  }
  return null;
}

async function main() {
  const db = await openDb();
  const client = isMock() ? null : new Anthropic();
  const emails = await fetchEmails();

  let recorded = 0;
  let advanced = 0;
  let skipped = 0;
  for (const email of emails) {
    const seen = await db.execute({
      sql: "SELECT 1 FROM app_events WHERE email_id = :eid",
      args: { eid: email.id },
    });
    if (seen.rows.length) { skipped++; continue; }

    const c = await classify(email, client);
    const jobId = await findJob(db, c.company);

    await db.execute({
      sql: `INSERT INTO app_events (job_id, type, email_id, subject, snippet, received_at)
            VALUES (:jobId, :type, :eid, :subject, :snippet, :receivedAt)`,
      args: {
        jobId, type: c.type, eid: email.id,
        subject: email.subject, snippet: email.snippet, receivedAt: email.receivedAt,
      },
    });
    recorded++;

    const stage = EVENT_STAGE[c.type];
    if (jobId && stage) {
      await db.execute({
        sql: "UPDATE jobs SET stage = :stage WHERE id = :id",
        args: { id: jobId, stage },
      });
      advanced++;
    }
  }
  db.close();

  console.log(
    `Polled ${emails.length} email(s): ${recorded} new event(s), ` +
      `${advanced} stage advance(s), ${skipped} already seen.`,
  );
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
