import "dotenv/config";
import { openDb } from "./db.js";

const TIMEOUT_MS = 12_000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Reachability check. A link is "broken" only when the posting is GONE
 *  (HTTP 404/410) or the host is unreachable (DNS/connection/timeout).
 *  Blocks and limits (401/403/405/429/5xx) count as reachable — many job
 *  boards (e.g. Adzuna) return 403 to every non-browser request even though
 *  the link opens fine in a browser, so treating those as broken is wrong. */
async function checkUrl(url: string): Promise<"ok" | "broken"> {
  for (const method of ["HEAD", "GET"] as const) {
    try {
      const res = await fetch(url, {
        method,
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "user-agent": UA },
      });
      if (res.status === 404 || res.status === 410) {
        if (method === "HEAD") continue; // confirm "gone" with a GET before declaring broken
        return "broken";
      }
      // reachable: 2xx/3xx, or a block/limit (401/403/405/429/5xx) — not a dead link
      if (method === "HEAD" && (res.status === 403 || res.status === 405)) continue; // GET is a cleaner signal
      return "ok";
    } catch {
      if (method === "HEAD") continue; // network/abort on HEAD — retry with GET
      return "broken";
    }
  }
  return "ok";
}

async function main() {
  const db = await openDb();
  const { rows } = await db.execute(
    "SELECT id, url FROM jobs WHERE link_status = 'unchecked' AND url IS NOT NULL AND url <> ''",
  );

  let ok = 0;
  let broken = 0;
  for (const r of rows) {
    const status = await checkUrl(String(r.url));
    await db.execute({
      sql: "UPDATE jobs SET link_status = :s, link_checked_at = :t WHERE id = :id",
      args: { id: r.id as string, s: status, t: new Date().toISOString() },
    });
    if (status === "ok") ok++;
    else broken++;
  }
  db.close();

  console.log(`Checked ${ok + broken} link(s): ${ok} ok, ${broken} broken.`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
