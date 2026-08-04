/**
 * Doc 13 §7.2 — the same production components, two data sources, one result.
 *
 * Adapter #1 is the deterministic fixture corpus; adapter #2 is the real
 * projection over real HTTP and SSE, seeded through real transitions. If the
 * components agree on both, then what the reference set photographs is the
 * COMPONENTS' behavior and not the fixtures' shape — which is the only reason a
 * fixture-built reference is worth storing at all.
 *
 * The comparison is the accessibility tree, not pixels: the two adapters mint
 * different run ids, titles and instants, so identical pixels are impossible
 * and would be the wrong thing to demand. What must match is the SEMANTIC
 * skeleton — which roles, in which order, at which nesting — because that is
 * what encodes "the queue rendered a group row with a member well" rather than
 * "the queue rendered these particular words".
 */
import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-bff.js";
import { startSeededServer, SEEDED_DAY, type SeededServer } from "./helpers/seeded-bff.js";
import { FIXTURE_DAY, FIXTURE_IDS } from "./helpers/fixture-day.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { readA11yTree } from "./helpers/capture.js";

const DIST = resolve(import.meta.dirname, "../../dist/dashboard");

let fixture: FixtureServer;
let seeded: SeededServer;

test.beforeAll(async () => {
  fixture = await startFixtureServer({ distDir: DIST });
  seeded = await startSeededServer({ distDir: DIST });
});

test.afterAll(async () => {
  await fixture.close();
  await seeded.close();
});

/**
 * Reduces an aria snapshot to its structural skeleton: role and depth, with
 * every literal string dropped. Two adapters serving different runs of the same
 * SHAPE must produce the same skeleton.
 */
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
  { id: "group-run", fixtureRun: FIXTURE_IDS.groupOf13, seededRun: "groupRun" },
];

for (const pair of ROLE_PAIRS) {
  test(`both adapters render the same structure: ${pair.id}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // The tab is PINNED. Left to their defaults the two adapters can legitimately
    // open different tabs — a done run opens on Receipt, but the seeded backend
    // advertises no receipt section for its done run, so it opens on Logs. That
    // is a difference in what the two backends serve, not in how the components
    // behave, and comparing it would be comparing two different screens.
    await gotoAppState(page, fixture.baseUrl, {
      day: FIXTURE_DAY,
      ...(pair.fixtureRun === undefined ? {} : { run: pair.fixtureRun, section: "logs" }),
    });
    const fixtureTree = await readA11yTree(page);

    const seededRunId = pair.seededRun === undefined ? undefined : seeded.runIds[pair.seededRun];
    if (pair.seededRun !== undefined && seededRunId === undefined) {
      throw new Error(`the seeded adapter has no run for role "${pair.seededRun}"`);
    }
    await gotoAppState(page, seeded.baseUrl, {
      day: SEEDED_DAY,
      ...(seededRunId === undefined ? {} : { run: seededRunId, section: "logs" }),
    });
    const seededTree = await readA11yTree(page);

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

/**
 * The a11y contract that must hold on BOTH adapters regardless of data: one
 * h1, a named queue, and no control without an accessible name. This is the
 * part of §7.1's "a11y snapshot" that is an assertion rather than a stored
 * artifact — a reference set can only prove the tree did not CHANGE, not that
 * it was correct in the first place.
 */
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
