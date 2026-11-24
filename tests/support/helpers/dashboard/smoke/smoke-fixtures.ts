import { expect, test as base, type Page } from "@playwright/test";
import { MOCK_DIST_DIR } from "../served-fixtures/bundle.js";
import { startSeededServer, type SeededServer } from "../served-fixtures/seeded-bff.js";
import { DashboardPage } from "./dashboard-page.js";

export interface PageFailures {
  /** Declares a failure the test expects; the reason says why the state under test produces it. */
  allow(pattern: RegExp, reason: string): void;
}

/** Choosing a workflow saves it as a preference; the seeded backend wires no settings executor and answers 500. */
export const SEEDED_PREFERENCE_WRITE = /^(?:http 500: POST |console: Failed to load resource: the server responded with a status of 500 \(Internal Server Error\) )http:\/\/127\.0\.0\.1:\d+\/api\/v1\/commands$/u;

/** Records every console error, page error, failed request and HTTP error the page produces from now on. */
export function watchPageDiagnostics(page: Page): string[] {
  const seen: string[] = [];
  page.on("console", message => { if (message.type() === "error") seen.push(`console: ${message.text()} ${message.location().url}`); });
  page.on("pageerror", error => seen.push(`pageerror: ${error.message}`));
  page.on("requestfailed", request => {
    const reason = request.failure()?.errorText ?? "";
    // Leaving or reloading the page aborts its open event stream.
    if (reason === "net::ERR_ABORTED" && new URL(request.url()).pathname.startsWith("/events/")) return;
    seen.push(`requestfailed: ${request.url()} ${reason}`);
  });
  page.on("response", response => {
    if (response.status() >= 400) seen.push(`http ${response.status()}: ${response.request().method()} ${response.url()}`);
  });
  return seen;
}

interface TestFixtures {
  failures: PageFailures;
  dashboard: DashboardPage;
  seeded: SeededServer;
}

export const test = base.extend<TestFixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright parses fixture dependencies from this pattern.
  seeded: async ({}, use) => {
    const server = await startSeededServer({ distDir: MOCK_DIST_DIR, bundle: { proof: "working-tree" }, productApp: true });
    try {
      await use(server);
    } finally {
      await server.close();
    }
  },
  failures: [async ({ page }, use) => {
    const seen = watchPageDiagnostics(page);
    const allowed: RegExp[] = [];
    await use({ allow: pattern => { allowed.push(pattern); } });
    expect(seen.filter(entry => !allowed.some(pattern => pattern.test(entry))), "unexpected page diagnostics").toEqual([]);
  }, { auto: true }],
  dashboard: async ({ page, seeded }, use) => {
    await use(new DashboardPage(page, seeded));
  },
});

export { expect };
