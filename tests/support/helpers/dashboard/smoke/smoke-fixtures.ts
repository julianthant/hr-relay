import { expect, test as base, type Page, type Request, type Response } from "@playwright/test";
import { MOCK_DIST_DIR } from "../served-fixtures/bundle.js";
import { startSeededServer, type SeededServer } from "../served-fixtures/seeded-bff.js";
import { DashboardPage } from "./dashboard-page.js";

export interface PageFailures {
  /** Declares a failure the test expects; the reason says why the state under test produces it. */
  allow(pattern: RegExp, reason: string): void;
  allowSettingsCancellationOnReload(): void;
}

/** Choosing a workflow saves it as a preference; the seeded backend wires no settings executor and answers 500. */
export const SEEDED_PREFERENCE_WRITE = /^(?:http 500: POST |console: Failed to load resource: the server responded with a status of 500 \(Internal Server Error\) )http:\/\/127\.0\.0\.1:\d+\/api\/v1\/commands$/u;

function watchReloadSettingsCancellation(page: Page): (request: Request) => boolean {
  const target = new URL(page.url());
  target.hash = "";
  const mainFrame = page.mainFrame();
  let replacingDocument = false;
  const startReplacement = (response: Response) => {
    if (response.url() === target.href && response.ok() && response.request().isNavigationRequest() && response.frame() === mainFrame) {
      replacingDocument = true;
      page.off("response", startReplacement);
    }
  };
  page.on("response", startReplacement);
  page.on("framenavigated", function finishReplacement(frame) {
    if (frame !== mainFrame || !replacingDocument) return;
    replacingDocument = false;
    page.off("framenavigated", finishReplacement);
  });
  // Chromium cancels the outgoing document's fetches between the reload response and frame commit.
  return request => replacingDocument && request.method() === "GET" && request.resourceType() === "fetch"
    && request.url() === `${target.origin}/api/v1/settings/editable` && request.frame() === mainFrame;
}

/** Records unexpected console errors, page errors, failed requests and HTTP errors. */
export function watchPageDiagnostics(page: Page, isReloadCancellation?: (request: Request) => boolean): string[] {
  const seen: string[] = [];
  page.on("console", message => { if (message.type() === "error") seen.push(`console: ${message.text()} ${message.location().url}`); });
  page.on("pageerror", error => seen.push(`pageerror: ${error.message}`));
  page.on("requestfailed", request => {
    const reason = request.failure()?.errorText ?? "";
    // Leaving or reloading the page aborts its open event stream.
    if (reason === "net::ERR_ABORTED" && new URL(request.url()).pathname.startsWith("/events/")) return;
    if (reason === "net::ERR_ABORTED" && isReloadCancellation?.(request)) return;
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
    let isReloadCancellation: ((request: Request) => boolean) | undefined;
    const seen = watchPageDiagnostics(page, request => isReloadCancellation?.(request) === true);
    const allowed: RegExp[] = [];
    await use({
      allow: pattern => { allowed.push(pattern); },
      allowSettingsCancellationOnReload: () => { isReloadCancellation = watchReloadSettingsCancellation(page); },
    });
    expect(seen.filter(entry => !allowed.some(pattern => pattern.test(entry))), "unexpected page diagnostics").toEqual([]);
  }, { auto: true }],
  dashboard: async ({ page, seeded }, use) => {
    await use(new DashboardPage(page, seeded));
  },
});

export { expect };
