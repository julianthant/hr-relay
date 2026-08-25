import { expect, test, type Page } from "@playwright/test";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-bff.js";
import { PARITY_DIST_DIR, ensureParityBundle } from "./helpers/bundle.js";
import { FIXTURE_DAY, FIXTURE_IDS } from "./helpers/fixture-day.js";
import { gotoAppState } from "./helpers/app-driver.js";

const RUN = FIXTURE_IDS.doneRun;
const TRACE = "pl-100000-e1b8";
const AT = "2026-08-25T12:00:00.000Z";

const note = {
  noteId: "e1b8ae3e-0000-4000-8000-000000000001",
  runId: RUN,
  sequence: 1,
  at: AT,
  level: "info" as const,
  message: "Started directory verification",
};

const observed = {
  kind: "observed" as const,
  logId: "e1b8ae3e-0000-4000-8000-000000000002",
  sequence: 2,
  at: AT,
  attempt: 2,
  traceId: TRACE,
  spanPath: "run/person-read",
  producer: { nodeId: "person-read", step: "Find person", taskId: "ucpath/person-read", system: "ucpath" as const },
  points: [{
    direction: "read" as const,
    field: "person.employeeId",
    values: [
      { key: "employeeId", state: "redacted" as const, classification: "direct-identifier" as const, transform: "drop" as const },
      { key: "matchCount", state: "transformed" as const, classification: "safe-diagnostic" as const, transform: "count" as const, value: 1 },
    ],
  }],
};

const fence = {
  kind: "transaction-fenced" as const,
  logId: "e1b8ae3e-0000-4000-8000-000000000003",
  sequence: 3,
  at: AT,
  attempt: 2,
  traceId: TRACE,
  spanPath: "run/finalize",
  producer: { nodeId: "finalize", step: "Finalize separation", taskId: "kuali/finalize", system: "kuali" as const },
};

const secondObserved = {
  ...observed,
  logId: "e1b8ae3e-0000-4000-8000-000000000004",
  sequence: 4,
  spanPath: "run/person-read-again",
};

function logResponse(next: boolean) {
  const rows = next
    ? [secondObserved]
    : [{ kind: "note" as const, logId: note.noteId, sequence: note.sequence, note }, observed, fence];
  return {
    section: "logs",
    payload: {
      runId: RUN,
      rows,
      notes: next ? [] : [note],
      nextCursor: next
        ? { state: "absent" as const, reason: "end-of-page" as const }
        : { state: "present" as const, value: `lc:${"a".repeat(64)}:3` },
    },
  };
}

async function serveObservedLogs(page: Page): Promise<void> {
  await page.route(`**/api/v1/runs/${RUN}/logs**`, async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(logResponse(cursor !== null)) });
  });
}

let server: FixtureServer;

test.beforeAll(async () => {
  ensureParityBundle();
  server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
});

test.afterAll(async () => {
  await server.close();
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`observed log ledger is reachable and contained at ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await serveObservedLogs(page);
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, run: RUN, section: "logs" });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Workflow Panel" })).toHaveCount(0);

    const log = page.getByRole("list", { name: "Run log lines" });
    await expect(log).toBeVisible();
    await expect(log.getByText("Find person · ucpath/person-read")).toBeVisible();
    await expect(log.getByText("UCPATH", { exact: true })).toBeVisible();
    await expect(log.getByTitle("person.employeeId · employeeId: redacted")).toBeVisible();
    await expect(log.getByText("attempt 2").first()).toBeVisible();
    const fenced = log.getByRole("listitem", { name: /authority transaction fence/i });
    await expect(fenced).toContainText("Authority fence");
    await expect(fenced).not.toContainText("KUALI");
    await expect(fenced).not.toContainText("read");

    const search = page.getByRole("searchbox", { name: "Search logs" });
    await search.focus();
    await expect(search).toBeFocused();
    await search.fill("employeeId");
    await expect(page.getByText("1 match")).toBeVisible();
    await search.fill("");

    await page.getByRole("button", { name: "Load more lines" }).click();
    await expect(page.getByRole("button", { name: "Load more lines" })).toHaveCount(0);
    await expect(log.getByRole("listitem")).toHaveCount(4);
    const logWidth = await log.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
    expect(logWidth, "the observed log ledger must fit its own mobile panel").toEqual({ scroll: logWidth.client, client: logWidth.client });
    if (viewport.name === "desktop") {
      await expect(log.getByRole("heading", { name: "Find person · ucpath/person-read" }).first()).toHaveCSS("position", "sticky");
    }
    await page.screenshot({ path: testInfo.outputPath(`observed-log-${viewport.name}.png`), fullPage: true });
  });
}
