import { test as base, type Browser } from "@playwright/test";
import { startFixtureServer, type FixtureServer } from "../../support/helpers/dashboard/fixture-bff.js";
import { PARITY_DIST_DIR } from "./bundle.js";

export const test = base.extend<object, {
  browserFor: (name: "chromium" | "webkit") => Promise<Browser>;
  hubServer: FixtureServer;
}>({
  // HUB cases route mutable workbook/account requests to their own test harness.
  // eslint-disable-next-line no-empty-pattern -- Playwright parses fixture dependencies from this pattern.
  hubServer: [async ({}, use) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await use(server);
    } finally {
      await server.close();
    }
  }, { scope: "worker" }],
  browserFor: [async ({ browser, playwright }, use) => {
    let webkit: Browser | undefined;
    try {
      await use(async name => {
        if (name === "chromium") return browser;
        webkit ??= await playwright.webkit.launch();
        return webkit;
      });
    } finally {
      await webkit?.close();
    }
  }, { scope: "worker" }],
});
