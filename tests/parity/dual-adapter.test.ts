
import { expect,test } from "@playwright/test";
import { DashboardDayWireSchema } from "../../src/models/dashboard/projection.js";
import { RunDetailSectionResponseSchema } from "../../src/models/dashboard/run-detail.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR,ensureParityBundle } from "./helpers/bundle.js";
import { readA11yTree } from "./helpers/capture.js";
import { startFixtureServer,type FixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { FIXTURE_DAY_WIRE, FIXTURE_IDS } from "./helpers/fixture-queue.js";
import { startSeededServer,type SeededServer } from "./helpers/seeded-bff.js";
import { SEEDED_DAY } from "../support/helpers/dashboard/served-fixtures/seeded-identity.js";

let fixture: FixtureServer;
let seeded: SeededServer;
let groupFixture: FixtureServer | undefined;

test.afterEach(async () => {
  await groupFixture?.close();
  groupFixture = undefined;
});

test.beforeAll(async () => {
  ensureParityBundle();
  fixture = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  seeded = await startSeededServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
});

test.afterAll(async () => {
  if (fixture !== undefined) await fixture.close();
  if (seeded !== undefined) await seeded.close();
});


function skeleton(tree: string): string[] {
  return tree
    .split("\n")
    .map((line) => {
      const match = /^(\s*)-\s+([a-z]+)/u.exec(line);
      if (match === null) return undefined;
      return `${String(match[1]?.length ?? 0)}:${match[2] ?? ""}`;
    })
    .filter((entry): entry is string => entry !== undefined);
}

/** The roles that carry meaning for these comparisons, in document order. */
function rolesOf(tree: string): string[] {
  return skeleton(tree).map((entry) => entry.split(":")[1] ?? "");
}

const ROLE_PAIRS: readonly { id: string; fixtureRun?: string; seededRun?: string }[] = [
  { id: "queue-day" },
  { id: "failed-run", fixtureRun: FIXTURE_IDS.failedRun, seededRun: "failedRun" },
  { id: "open-gate-run", fixtureRun: FIXTURE_IDS.openGateRun, seededRun: "openGateRun" },
  { id: "running-run", fixtureRun: FIXTURE_IDS.runningRun, seededRun: "runningRun" },
  { id: "done-run", fixtureRun: FIXTURE_IDS.doneRun, seededRun: "doneRun" },
  { id: "group-run", fixtureRun: FIXTURE_IDS.groupOf3, seededRun: "groupRun" },

  { id: "parked-write-run", fixtureRun: FIXTURE_IDS.parkedRun, seededRun: "parkedRun" },
];

for (const pair of ROLE_PAIRS) {
  test(`both adapters render the same structure: ${pair.id}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    if (pair.id === "open-gate-run") {
      const response = await page.request.get(`${seeded.baseUrl}/api/v1/runs/${seeded.runIds.openGateRun}/identity-gate`);
      expect(response.ok()).toBe(true);
      const gate = RunDetailSectionResponseSchema.parse(await response.json());
      if (gate.section !== "identity-gate") throw new Error("The seeded generic gate served a different section");
      expect(gate.payload.state).toBe("missing");
      // Compare the same missing-packet capability; rich ceremonies have their own gate parity lane.
      await page.route(`${fixture.baseUrl}/api/v1/runs/${pair.fixtureRun}/identity-gate`, route => route.fulfill({ json: gate }));
    }

    let fixtureBase = fixture.baseUrl;
    if (pair.id === "group-run") {
      const response = await page.request.get(`${seeded.baseUrl}/api/v1/dashboard?day=${SEEDED_DAY}`);
      expect(response.ok()).toBe(true);
      const day = DashboardDayWireSchema.parse(await response.json());
      const group = day.queueSurfaces.find(row => String(row.runId) === seeded.runIds.groupRun);
      if (!group) throw new Error("seeded group projection missing");
      if (group.surfaceKind !== "operation") throw new Error("seeded group is not an operation");
      expect(group.memberRunIds).toHaveLength(3);
      // HTTP and SSE must serve the same optional-message branch.
      groupFixture = await startFixtureServer({
        distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" },
        dayWire: { ...FIXTURE_DAY_WIRE, queueSurfaces: FIXTURE_DAY_WIRE.queueSurfaces.map(row => String(row.runId) === pair.fixtureRun ? { ...row, liveMessage: group.liveMessage } : row) },
      });
      fixtureBase = groupFixture.baseUrl;
    }

    // Pin the tab; adapters may legitimately choose different defaults from their available sections.
    await gotoAppState(page, fixtureBase, {
      day: FIXTURE_DAY,
      ...(pair.fixtureRun === undefined ? {} : { run: pair.fixtureRun, section: "logs", ...(pair.id === "group-run" ? { logPreview: "selected" as const } : {}) }),
    });
    if (pair.id === "group-run") {
      await expect(page.getByRole("region", { name: "Queue", exact: true }).getByRole("button", { name: "New-hire lookups — batch 3 — running", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("heading", { name: "New-hire lookups — batch 3", exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Run status", exact: true })).toBeVisible();
    }
    const fixtureTree = await readA11yTree(page);
    if (pair.id === "open-gate-run") await expect(page.getByRole("region", { name: "Selected run logs", exact: true }).getByRole("article", { name: "Confirm the employee match", exact: true })).toBeVisible();

    const seededRunId = pair.seededRun === undefined ? undefined : seeded.runIds[pair.seededRun];
    if (pair.seededRun !== undefined && seededRunId === undefined) {
      throw new Error(`the seeded adapter has no run for role "${pair.seededRun}"`);
    }
    await gotoAppState(page, seeded.baseUrl, {
      day: SEEDED_DAY,
      ...(seededRunId === undefined ? {} : { run: seededRunId, section: "logs", ...(pair.id === "group-run" ? { logPreview: "selected" as const } : {}) }),
    });
    if (pair.id === "group-run") {
      await expect(page.getByRole("region", { name: "Queue", exact: true }).getByRole("button", { name: "Onboarding packet — 3 people — queued", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("heading", { name: "Onboarding packet — 3 people", exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Run status", exact: true })).toBeVisible();
    }
    const seededTree = await readA11yTree(page);
    if (pair.id === "open-gate-run") await expect(page.getByRole("region", { name: "Selected run logs", exact: true }).getByRole("article", { name: "Confirm the employee match", exact: true })).toBeVisible();
    await test.info().attach("fixture-tree", { body: fixtureTree, contentType: "text/plain" });
    await test.info().attach("seeded-tree", { body: seededTree, contentType: "text/plain" });

    // Both adapters must have rendered something substantial — an empty tree
    // on either side would make the comparison vacuously pass.
    expect(rolesOf(fixtureTree).length).toBeGreaterThan(20);
    expect(rolesOf(seededTree).length).toBeGreaterThan(20);

    // The role VOCABULARY must match exactly: a role present on one side and
    // absent on the other means a component took a different branch.
    const fixtureRoles = new Set(rolesOf(fixtureTree));
    const seededRoles = new Set(rolesOf(seededTree));
    expect(
      [...fixtureRoles].filter((role) => !seededRoles.has(role)).sort(),
      `roles the fixture adapter rendered and the seeded adapter did not (${pair.id})`,
    ).toEqual([]);
    expect(
      [...seededRoles].filter((role) => !fixtureRoles.has(role)).sort(),
      `roles the seeded adapter rendered and the fixture adapter did not (${pair.id})`,
    ).toEqual([]);
  });
}


for (const adapter of ["fixture", "seeded"] as const) {
  test(`${adapter} adapter satisfies the standing a11y contract`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const base = adapter === "fixture" ? fixture.baseUrl : seeded.baseUrl;
    const day = adapter === "fixture" ? FIXTURE_DAY : SEEDED_DAY;
    await gotoAppState(page, base, { day });

    expect(await page.locator("h1").count(), "exactly one h1 names the page").toBe(1);

    const unnamed = await page.evaluate(() => {
      const offenders: string[] = [];
      for (const element of document.querySelectorAll("button, a[href], [role='button']")) {
        const label =
          element.getAttribute("aria-label") ??
          element.getAttribute("title") ??
          element.textContent?.trim() ??
          "";
        if (label.length === 0) offenders.push(element.outerHTML.slice(0, 120));
      }
      return offenders;
    });
    expect(unnamed, "every control carries an accessible name").toEqual([]);
  });
}
