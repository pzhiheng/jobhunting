import "dotenv/config";
import nodemailer from "nodemailer";
import { openDb } from "./db.js";
import { buildDigest } from "./digest.js";
import type { Client } from "@libsql/client";

/**
 * Emails the daily digest directly via SMTP (e.g. Gmail) — so it lands in your
 * inbox, not a Drafts folder, with no connector involved. The sending account
 * (SMTP_USER) just needs a Gmail App Password; the recipient is DIGEST_TO.
 * Without SMTP creds it prints the digest instead of sending (so the pipeline
 * never hard-fails on a missing mailer).
 */

// Mirrors the app's "Top picks" definition (server.ts / digest.ts).
const TOP_PICKS_WHERE =
  "suitability = 'suitable' AND relevance >= 4 AND link_status NOT IN ('broken','expired')";

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function salary(min: unknown, max: unknown): string {
  const k = (n: number) => `$${Math.round(n / 1000)}k`;
  const lo = min == null ? 0 : Number(min);
  const hi = max == null ? 0 : Number(max);
  if (lo && hi) return ` · ${k(lo)}–${k(hi)}`;
  if (lo) return ` · ${k(lo)}+`;
  return "";
}

/** A nicer HTML body: clickable apply links + the skills block. */
async function buildHtml(db: Client): Promise<string> {
  const num = async (w: string) =>
    Number((await db.execute(`SELECT COUNT(*) AS n FROM jobs WHERE ${w}`)).rows[0].n);
  const c = {
    total: await num("1=1"),
    top: await num(TOP_PICKS_WHERE),
    suit: await num("suitability = 'suitable'"),
    notsuit: await num("suitability = 'unsuitable'"),
    broken: await num("link_status IN ('broken','expired')"),
  };
  const picks = (
    await db.execute(
      `SELECT title, company, location, url, salary_min, salary_max, relevance, source
       FROM jobs WHERE ${TOP_PICKS_WHERE} ORDER BY relevance DESC, company LIMIT 15`,
    )
  ).rows;
  const a = (await db.execute("SELECT content FROM analyses ORDER BY id DESC LIMIT 1")).rows[0];
  const an = a?.content ? (JSON.parse(String(a.content)) as { summary?: string; gap?: string[] }) : {};
  const today = new Date().toISOString().slice(0, 10);

  const items = picks
    .map((p) => {
      const badge =
        p.source !== "adzuna"
          ? ` <span style="background:#e6f4ea;color:#137333;font-size:11px;padding:1px 6px;border-radius:10px">direct apply</span>`
          : "";
      return (
        `<li style="margin-bottom:8px"><a href="${esc(p.url)}" style="color:#1a56db;font-weight:600;text-decoration:none">${esc(p.title)}</a>${badge}` +
        `<br><span style="color:#5a6b7b;font-size:13px">${esc(p.company)} · ${esc(p.location || "—")}${salary(p.salary_min, p.salary_max)} · relevance ${p.relevance}</span></li>`
      );
    })
    .join("");

  return (
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:680px;color:#1a2233">` +
    `<h2 style="margin:0 0 4px">Job digest — ${today}</h2>` +
    `<p style="color:#5a6b7b;margin:0 0 16px">${c.total} tracked · <b>${c.top} top picks</b> · ${c.suit} suitable · ${c.notsuit} not suitable · ${c.broken} broken link${c.broken === 1 ? "" : "s"}</p>` +
    (picks.length
      ? `<h3 style="margin:0 0 8px">Top picks${picks.length < c.top ? ` (${picks.length} of ${c.top})` : ""}</h3><ol style="padding-left:18px;margin:0 0 18px">${items}</ol>`
      : `<p>No new top picks today.</p>`) +
    (an.summary ? `<h3 style="margin:0 0 8px">Skills</h3><p style="margin:0 0 10px;line-height:1.5">${esc(an.summary)}</p>` : "") +
    (an.gap?.length ? `<p style="margin:0"><b>To learn:</b> ${esc(an.gap.join(" · "))}</p>` : "") +
    `</div>`
  );
}

async function main() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const to = process.env.DIGEST_TO || user;

  const db = await openDb();
  const text = await buildDigest(db);
  const html = await buildHtml(db);
  db.close();

  if (!user || !pass) {
    process.stdout.write(text + "\n");
    console.error(
      "\n[send-digest] SMTP_USER / SMTP_PASS not set — printed the digest instead of sending.\n" +
        "  Set SMTP_USER (a Gmail address), SMTP_PASS (a Gmail App Password), and DIGEST_TO in .env to email it.",
    );
    return;
  }
  if (!to) throw new Error("No recipient: set DIGEST_TO in .env.");

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    secure: true,
    auth: { user, pass },
  });

  const today = new Date().toISOString().slice(0, 10);
  const info = await transport.sendMail({ from: user, to, subject: `Job digest — ${today}`, text, html });
  console.log(`Digest emailed to ${to} (messageId ${info.messageId}).`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
