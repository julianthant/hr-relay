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
  const t0 = Date.now();
  const log = (line: string) => diagLog.push(`${String(Date.now() - t0)}ms ${line}`);
  const diagLog: string[] = [];
  (page as unknown as { diagLog: string[] }).diagLog = diagLog;
  page.on("request", request => { const path = new URL(request.url()).pathname; if (path.startsWith("/api/") || path.startsWith("/events/")) log(`start ${request.method()} ${path}`); });
  page.on("requestfinished", request => { const path = new URL(request.url()).pathname; if (path.startsWith("/api/") || path.startsWith("/events/")) log(`done ${path}`); });
  page.on("framenavigated", frame => { if (frame === page.mainFrame()) log(`navigated ${frame.url()}`); });
  page.on("close", () => log("page closed"));
  let tick = Date.now();
  const lag = setInterval(() => { const now = Date.now(); if (now - tick > 300) log(`event loop blocked ${String(now - tick - 100)}ms`); tick = now; }, 100);
  page.on("close", () => clearInterval(lag));
  page.on("pageerror", error => seen.push(`pageerror: ${error.message}`));
  page.on("requestfailed", request => {
    const reason = request.failure()?.errorText ?? "";
    log(`FAILED ${new URL(request.url()).pathname} ${reason}`);
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
    if (seen.some(entry => !allowed.some(pattern => pattern.test(entry)))) console.log(`[diag] ${base.info().title}\n${(page as unknown as { diagLog: string[] }).diagLog.join("\n")}`);
    expect(seen.filter(entry => !allowed.some(pattern => pattern.test(entry))), "unexpected page diagnostics").toEqual([]);
  }, { auto: true }],
  dashboard: async ({ page, seeded }, use) => {
    await use(new DashboardPage(page, seeded));
  },
});

export { expect };
