/** Smoke fixtures for flows that start and follow a run: the seeded server executes Work-Study on a script the test holds. */
import { MOCK_DIST_DIR } from "../served-fixtures/bundle.js";
import { startSeededServer, type SeededServer } from "../served-fixtures/seeded-bff.js";
import { expect, test as base } from "./smoke-fixtures.js";

export const test = base.extend<{ seeded: SeededServer }>({
  seeded: async ({ page }, use) => {
    const server = await startSeededServer({ distDir: MOCK_DIST_DIR, bundle: { proof: "working-tree" }, productApp: true, scriptedRuns: true });
    try {
      await use(server);
    } finally {
      try { await page.close(); }
      finally { await server.close(); }
    }
  },
});

export { expect };
