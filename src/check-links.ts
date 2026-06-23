import "dotenv/config";
import { openDb } from "./db.js";

const TIMEOUT_MS = 10_000;

/** Deterministic HTTP reachability check. Returns "ok" for <400, else "broken". */
async function checkUrl(url: string): Promise<"ok" | "broken"> {
  for (const method of ["HEAD", "GET"] as const) {
    try {
      const res = await fetch(url, {
        method,
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status < 400) return "ok";
      // Some servers reject HEAD with 4xx/405 but serve GET — fall through to GET.
      if (method === "HEAD" && (res.status === 405 || res.status === 403)) continue;
      return "broken";
    } catch {
      if (method === "HEAD") continue; // retry with GET on network/abort errors
      return "broken";
    }
  }
  return "broken";
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
