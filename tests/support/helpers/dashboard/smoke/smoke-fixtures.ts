/** Fixtures for the dashboard smoke suite: one seeded server per worker, the page object, and a clean-page guard on every test. */
import { expect, test as base } from "@playwright/test";
import { MOCK_DIST_DIR } from "../served-fixtures/bundle.js";
import { startSeededServer, type SeededServer } from "../served-fixtures/seeded-bff.js";
import { DashboardPage } from "./dashboard-page.js";

export interface PageFailures {
  /** Console errors, page errors, failed requests and HTTP >= 400 responses seen so far. */
  readonly seen: readonly string[];
  /** Declares a failure the test expects; the reason says why the state under test produces it. */
  allow(pattern: RegExp, reason: string): void;
}

/** Choosing a workflow saves it as a preference; the seeded backend wires no settings executor and answers 500. */
export const SEEDED_PREFERENCE_WRITE = /\/api\/v1\/commands\b/u;

/** Each Start run open asks for a preflight re-check; one server shared by a file's tests reaches that endpoint's rate limit. */
export const SHARED_PREFLIGHT_RATE_LIMIT = /429.*\/api\/v1\/preflight\/rerun\b/u;

/**
 * The seeded backend has no preflight reader. The dashboard reports that failed read, and the report
 * endpoint rate-limits; an undelivered report then surfaces as a page error.
 */
const UNDELIVERED_ERROR_REPORT = /429.*\/api\/v1\/debug\/errors\b|Dashboard error report was not recorded/u;

interface TestFixtures {
  failures: PageFailures;
  dashboard: DashboardPage;
}

interface WorkerFixtures {
  seeded: SeededServer;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright parses fixture dependencies from this pattern.
  seeded: [async ({}, use) => {
    const server = await startSeededServer({ distDir: MOCK_DIST_DIR, bundle: { proof: "working-tree" }, productApp: true });
    try {
      await use(server);
    } finally {
      await server.close();
    }
  }, { scope: "worker" }],
  failures: [async ({ page }, use) => {
    const seen: string[] = [];
    const allowed: RegExp[] = [UNDELIVERED_ERROR_REPORT];
    page.on("console", message => { if (message.type() === "error") seen.push(`console: ${message.text()} ${message.location().url}`); });
    page.on("pageerror", error => seen.push(`pageerror: ${error.message}`));
    page.on("requestfailed", request => {
      const reason = request.failure()?.errorText ?? "";
      // Leaving or reloading the page aborts its open event stream.
      if (reason === "net::ERR_ABORTED" && new URL(request.url()).pathname.startsWith("/events/")) return;
      seen.push(`requestfailed: ${request.url()} ${reason}`);
    });
    page.on("response", response => { if (response.status() >= 400) seen.push(`http ${response.status()}: ${response.url()}`); });
    await use({ seen, allow: pattern => { allowed.push(pattern); } });
    expect(seen.filter(entry => !allowed.some(pattern => pattern.test(entry)))).toEqual([]);
  }, { auto: true }],
  dashboard: async ({ page, seeded }, use) => {
    await use(new DashboardPage(page, seeded));
  },
});

export { expect };
