import { expect,test } from "@playwright/test";
import { DashboardDayWireSchema } from "../../src/domain/dashboard/projection.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR,ensureParityBundle } from "./helpers/bundle.js";
import {
fixtureSnapshotEnvelope,
startFixtureServer,
type FixtureServer,
} from "./helpers/fixture-bff.js";
import { FIXTURE_RUN_DETAILS } from "./helpers/fixture-detail.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { FIXTURE_DAY_WIRE,FIXTURE_IDS } from "./helpers/fixture-queue.js";

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
  }, {
    direction: "write" as const,
    field: "person.status",
    values: [
      { key: "status", state: "allowed" as const, classification: "safe-diagnostic" as const, transform: "allow" as const, value: "staged" },
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

const serviceObserved = {
  ...observed,
  logId: "e1b8ae3e-0000-4000-8000-000000000005",
  sequence: 5,
  spanPath: "run/read-separation-plan",
  producer: {
    nodeId: "plan",
    step: "Read separation plan",
    taskId: "workflow:separations/read-separation-plan",
  },
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

function deferred<Value>() {
  let settle: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolve) => { settle = resolve; });
  return {
    promise,
    resolve(value: Value): void {
      if (settle === undefined) throw new Error("deferred promise was not initialized");
      settle(value);
    },
  };
}

let server: FixtureServer;

test.beforeAll(async () => {
  ensureParityBundle();
  server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
});

test.afterAll(async () => {
  await server.close();
});

test("a stale continuation cannot append to or clear loading for a refreshed snapshot", async ({ page }) => {
  const firstRelease = deferred<void>();
  const firstFulfilled = deferred<void>();
  const secondRelease = deferred<void>();
  const firstCursor = `lc:${"a".repeat(64)}:3`;
  const secondCursor = `lc:${"b".repeat(64)}:1`;
  const secondInitialNote = {
    noteId: "e1b8ae3e-0000-4000-8000-000000000011",
    runId: RUN,
    sequence: 1,
    at: AT,
    level: "warning" as const,
    message: "Current run B evidence",
  };
  const secondNextNote = {
    ...secondInitialNote,
    noteId: "e1b8ae3e-0000-4000-8000-000000000012",
    sequence: 2,
    message: "Current run B continuation",
  };

  let initialLogReads = 0;
  let firstContinuationReads = 0;
  let secondContinuationReads = 0;
  let refreshed = false;
  const logRequestUrls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(`/api/v1/runs/${RUN}/logs`)) logRequestUrls.push(request.url());
  });
  await page.route(`**/api/v1/runs/${RUN}/logs**`, async (route) => {
    const url = new URL(route.request().url());
    const cursor = url.searchParams.get("cursor");
    if (cursor === null) {
      initialLogReads += 1;
      if (!refreshed) {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(logResponse(false)) });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          section: "logs",
          payload: {
            runId: RUN,
            rows: [{ kind: "note", logId: secondInitialNote.noteId, sequence: 1, note: secondInitialNote }],
            notes: [secondInitialNote],
            nextCursor: { state: "present", value: secondCursor },
          },
        }),
      });
      return;
    }
    if (cursor === firstCursor) {
      firstContinuationReads += 1;
      await firstRelease.promise;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(logResponse(true)) });
      firstFulfilled.resolve();
      return;
    }
    if (cursor === secondCursor) {
      secondContinuationReads += 1;
      await secondRelease.promise;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          section: "logs",
          payload: {
            runId: RUN,
            rows: [{ kind: "note", logId: secondNextNote.noteId, sequence: 2, note: secondNextNote }],
            notes: [secondNextNote],
            nextCursor: { state: "absent", reason: "end-of-page" },
          },
        }),
      });
      return;
    }
    throw new Error(`unexpected log cursor ${String(cursor)}`);
  });

  const detailFixture = FIXTURE_RUN_DETAILS[RUN];
  if (detailFixture === undefined) throw new Error(`fixture run ${RUN} has no detail`);
  let detailReads = 0;
  await page.route(`**/api/v1/runs/${RUN}`, async (route) => {
    detailReads += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...detailFixture,
        rowRevision: detailFixture.rowRevision + (refreshed ? 1 : 0),
      }),
    });
  });

  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, run: RUN, section: "logs" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Load more lines" }).click();
  await expect(page.getByRole("button", { name: "Loading more lines…" })).toBeVisible();
  await expect.poll(() => firstContinuationReads, { timeout: 10_000 }).toBe(1);
  expect(logRequestUrls.some((url) => new URL(url).searchParams.get("cursor") === firstCursor)).toBe(true);

  refreshed = true;
  const refreshedDay = DashboardDayWireSchema.parse({
      ...FIXTURE_DAY_WIRE,
      queueSurfaces: FIXTURE_DAY_WIRE.queueSurfaces.map((surface) => (
        surface.runId === RUN
          ? {
              ...surface,
              rowRevision: surface.rowRevision + 1,
              actions: surface.actions.map((action) => action.kind === "command"
                ? { ...action, expectedVersion: action.expectedVersion + 1 }
                : action),
            }
          : surface
      )),
  });
  server.publish(fixtureSnapshotEnvelope(refreshedDay, "pc:2"));
  await expect.poll(() => detailReads, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  await expect.poll(() => initialLogReads, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.getByText(secondInitialNote.message)).toBeVisible();
  await page.getByRole("button", { name: "Load more lines" }).click();
  await expect.poll(() => secondContinuationReads, { timeout: 10_000 }).toBe(1);
  await expect(page.getByRole("button", { name: "Loading more lines…" })).toBeVisible();

  firstRelease.resolve();
  await firstFulfilled.promise;
  await expect(page.getByText(secondInitialNote.message)).toBeVisible();
  await expect(page.getByRole("list", { name: "Run log lines" }).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Loading more lines…" })).toBeVisible();

  secondRelease.resolve();
  await expect(page.getByText(secondNextNote.message)).toBeVisible();
  await expect(page.getByRole("button", { name: "Loading more lines…" })).toHaveCount(0);
});

test("a continuation error keeps the page and names the server refusal", async ({ page }) => {
  await page.route(`**/api/v1/runs/${RUN}/logs**`, async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    if (cursor === null) {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(logResponse(false)) });
      return;
    }
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        state: "error",
        code: "LOG_SNAPSHOT_STALE",
        message: "Log snapshot expired for this run.",
        retryable: true,
      }),
    });
  });

  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, run: RUN, section: "logs" });
  await page.keyboard.press("Escape");
  const log = page.getByRole("list", { name: "Run log lines" });
  await expect(log.getByRole("listitem")).toHaveCount(3);
  await page.getByRole("button", { name: "Load more lines" }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("LOG_SNAPSHOT_STALE");
  await expect(alert).toContainText("Log snapshot expired for this run.");
  await expect(log.getByRole("listitem")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Load more lines" })).toBeEnabled();
});

test("the initial log request exposes its loading state", async ({ page }) => {
  const release = deferred<void>();
  await page.route(`**/api/v1/runs/${RUN}/logs**`, async (route) => {
    await release.promise;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(logResponse(false)) });
  });

  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, run: RUN, section: "logs" });
  await page.keyboard.press("Escape");
  const loading = page.getByLabel("Loading logs");
  await expect(loading).toBeVisible();
  await expect(loading).toHaveAttribute("aria-busy", "true");
  release.resolve();
  await expect(page.getByRole("list", { name: "Run log lines" })).toBeVisible();
});

test("a service-task observation makes no browser-system claim", async ({ page }) => {
  await page.route(`**/api/v1/runs/${RUN}/logs**`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        section: "logs",
        payload: {
          runId: RUN,
          rows: [serviceObserved],
          notes: [],
          nextCursor: { state: "absent", reason: "end-of-page" },
        },
      }),
    });
  });

  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, run: RUN, section: "logs" });
  await page.keyboard.press("Escape");
  const row = page.getByRole("list", { name: "Run log lines" })
    .getByRole("listitem", { name: /observed at Read separation plan/i });
  await expect(row).toBeVisible();
  await expect(row).not.toHaveAttribute("aria-label", /system /i);
  await expect(row.getByText("UCPATH", { exact: true })).toHaveCount(0);
});

test("the served 200-row bound remains complete and searchable without eager continuation", async ({ page }) => {
  const rows = Array.from({ length: 200 }, (_, index) => {
    const sequence = index + 1;
    const rowNote = {
      noteId: `e1b8ae3e-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
      runId: RUN,
      sequence,
      at: AT,
      level: "info" as const,
      message: `Bounded line ${String(sequence)}`,
    };
    return { kind: "note" as const, logId: rowNote.noteId, sequence, note: rowNote };
  });
  let continuationRequests = 0;
  await page.route(`**/api/v1/runs/${RUN}/logs**`, async (route) => {
    if (new URL(route.request().url()).searchParams.has("cursor")) continuationRequests += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        section: "logs",
        payload: {
          runId: RUN,
          rows,
          notes: rows.map((row) => row.note),
          nextCursor: { state: "absent", reason: "end-of-page" },
        },
      }),
    });
  });

  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, run: RUN, section: "logs" });
  await page.keyboard.press("Escape");
  const log = page.getByRole("list", { name: "Run log lines" });
  await expect(log.getByRole("listitem")).toHaveCount(200);
  await expect(log.getByRole("listitem", { name: /Bounded line 200/ })).toBeAttached();
  const search = page.getByRole("searchbox", { name: "Search logs" });
  await search.fill("Bounded line 199");
  await expect(search).toBeFocused();
  await expect(page.getByText("1 match")).toBeVisible();
  await expect(log.getByRole("listitem")).toHaveCount(200);
  await expect(page.getByRole("button", { name: "Load more lines" })).toHaveCount(0);
  expect(continuationRequests).toBe(0);
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "narrow", width: 1024, height: 768 },
]) {
  test(`observed values and action notes share Logs without retired Run data reads at ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.route(`**/api/v1/runs/${RUN}/logs**`, async (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ section: "logs", payload: {
        runId: RUN,
        rows: [{ kind: "note", logId: note.noteId, sequence: 0, note: {
          ...note, sequence: 0, message: "Typed into Kuali action list search input",
        } }, { ...observed, sequence: 1 }, { ...serviceObserved, sequence: 2 }, { ...fence, sequence: 3 }],
        notes: [{ ...note, sequence: 0, message: "Typed into Kuali action list search input" }],
        nextCursor: { state: "absent", reason: "end-of-page" },
      } }),
    }));
    const retiredReads: string[] = [];
    page.on("request", (request) => { if (/context-(?:data|evidence)/u.test(request.url())) retiredReads.push(request.url()); });
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, run: RUN, section: "logs" });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Workflow Panel" })).toHaveCount(0);

    const log = page.getByRole("list", { name: "Run log lines" });
    await expect(log).toBeVisible();
    await expect(log.getByText("Typed into Kuali action list search input")).toBeVisible();
    await expect(log.getByRole("listitem", { name: /observed at Find person/i })).toHaveCount(1);
    const fenced = log.getByRole("listitem", { name: /authority transaction fence/i });
    await expect(fenced).toContainText("Authority fence");
    await expect(page.getByRole("region", { name: "Extracted fields" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Receipt", exact: true })).toHaveCount(0);
    await expect(log.getByText("Find person").first()).toBeVisible();
    await expect(log.getByText("UCPATH", { exact: true }).first()).toBeVisible();
    await expect(log.getByText("redacted", { exact: true }).first()).toBeVisible();
    await expect(log.getByText("Read separation plan").first()).toBeVisible();
    await expect(page.getByText("No run data recorded")).toHaveCount(0);
    expect(retiredReads).toEqual([]);
    const width = await log.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
    expect(width, "recorded values must fit Logs").toEqual({ scroll: width.client, client: width.client });
    await page.screenshot({ path: testInfo.outputPath(`observed-data-${viewport.name}.png`), fullPage: true });
  });
}
