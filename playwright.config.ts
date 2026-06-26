import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: "http://localhost:3333",
    headless: true,
  },
  webServer: {
    command: "tsx test/e2e/fixture-server.ts",
    url: "http://localhost:3333",
    reuseExistingServer: false,
    timeout: 15_000,
    env: {
      // Tells the fixture server which port to bind on.
      FIXTURE_PORT: "3333",
      // Use deterministic mock judgment (not needed for fixture-seeded db,
      // but keeps any accidental pipeline call offline).
      JOBHUNTER_MOCK: "1",
    },
  },
});
