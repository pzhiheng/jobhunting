/**
 * Standalone server process for Playwright E2E tests.
 * Boots the real Express app on FIXTURE_PORT (default 3333) backed by an
 * in-memory DB seeded with the deterministic test fixture.
 *
 * Playwright's webServer directive runs this as a subprocess before the tests,
 * then kills it when tests are done.
 */
import { createServer } from "node:http";
import { openDb } from "../../src/db.js";
import { createApp } from "../../src/server.js";
import { seedFixture } from "../helpers/fixture.js";

const PORT = Number(process.env.FIXTURE_PORT ?? 3333);

async function main() {
  const db = await openDb(":memory:");
  await seedFixture(db);
  const app = createApp(db);
  const server = createServer(app);

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[fixture-server] ready on http://localhost:${PORT}`);
  });

  // Graceful shutdown on SIGTERM (sent by Playwright when tests are done).
  process.on("SIGTERM", () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}

main().catch((err) => {
  console.error("[fixture-server] fatal:", err);
  process.exit(1);
});
