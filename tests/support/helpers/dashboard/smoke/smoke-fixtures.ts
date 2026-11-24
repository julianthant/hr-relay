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

declare global {
  interface Window { relayDiagnosticsFetchCancelled?: (url: string) => Promise<void> }
}

/** Reports each fetch the page cancels through its own signal before the response body has arrived. */
function reportCancelledFetches(): void {
  const fetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (!signal || signal.aborted) return fetch(input, init);
    const url = new URL(input instanceof Request ? input.url : String(input), location.href).href;
    const cancelled = () => { void window.relayDiagnosticsFetchCancelled?.(url); };
    const settled = () => { signal.removeEventListener("abort", cancelled); };
    signal.addEventListener("abort", cancelled, { once: true });
    try {
      const response = await fetch(input, init);
      void response.clone().arrayBuffer().then(settled, settled);
      return response;
    } catch (error) {
      settled();
      throw error;
    }
  };
}

/** Records every console error, page error, failed request and HTTP error the page produces from now on. */
export async function watchPageDiagnostics(page: Page): Promise<string[]> {
  const seen: string[] = [];
  // A request the page cancelled itself is no failure; the page's notice and the network abort arrive in either order.
  const cancelledUrls: string[] = [];
  const unclaimedAborts: { url: string; entry: string }[] = [];
  await page.exposeBinding("relayDiagnosticsFetchCancelled", (_source, url: string) => {
    const claimed = unclaimedAborts.find(candidate => candidate.url === url);
    if (claimed === undefined) { cancelledUrls.push(url); return; }
    unclaimedAborts.splice(unclaimedAborts.indexOf(claimed), 1);
    seen.splice(seen.indexOf(claimed.entry), 1);
  });
  await page.addInitScript(reportCancelledFetches);
  page.on("console", message => { if (message.type() === "error") seen.push(`console: ${message.text()} ${message.location().url}`); });
  page.on("pageerror", error => seen.push(`pageerror: ${error.message}`));
  page.on("requestfailed", request => {
    const url = request.url();
    const reason = request.failure()?.errorText ?? "";
    if (reason === "net::ERR_ABORTED") {
      // Leaving or reloading the page aborts its open event stream.
      if (new URL(url).pathname.startsWith("/events/")) return;
      const cancelled = cancelledUrls.indexOf(url);
      if (cancelled !== -1) { cancelledUrls.splice(cancelled, 1); return; }
    }
    const entry = `requestfailed: ${url} ${reason}`;
    seen.push(entry);
    if (reason === "net::ERR_ABORTED") unclaimedAborts.push({ url, entry });
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
    const seen = await watchPageDiagnostics(page);
    const allowed: RegExp[] = [];
    await use({ allow: pattern => { allowed.push(pattern); } });
    expect(seen.filter(entry => !allowed.some(pattern => pattern.test(entry))), "unexpected page diagnostics").toEqual([]);
  }, { auto: true }],
  dashboard: async ({ page, seeded }, use) => {
    await use(new DashboardPage(page, seeded));
  },
});

export { expect };
