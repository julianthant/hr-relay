import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { DashboardDayWireSchema } from "../../src/domain/dashboard/projection.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { FIXTURE_DAY_WIRE, FIXTURE_IDS } from "./helpers/fixture-queue.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { failOnPageErrors } from "./helpers/reference-harness.js";
import { startFixtureServer } from "./helpers/fixture-bff.js";

test("a status-filtered item keeps sibling attempts and opens the exact selected run", {
  annotation: [{ type: "required-a11y-evidence", description: "queue-item-attempts.a11y.yml" }],
}, async ({ page }) => {
  ensureParityBundle();
  const errors = failOnPageErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const firstAttempt = FIXTURE_DAY_WIRE.queueSurfaces.find((row) => row.runId === FIXTURE_IDS.failedRun);
  const retry = FIXTURE_DAY_WIRE.queueSurfaces.find((row) => row.runId === FIXTURE_IDS.doneRun);
  if (firstAttempt === undefined || retry === undefined) throw new Error("attempt parity fixture is missing its exact queue rows");

  const dayWire = DashboardDayWireSchema.parse({
    ...FIXTURE_DAY_WIRE,
    queueSurfaces: FIXTURE_DAY_WIRE.queueSurfaces.map((row) => {
      if (row.runId === FIXTURE_IDS.failedRun) return { ...row, itemId: retry.itemId, attempt: 1 };
      if (row.runId === FIXTURE_IDS.doneRun) return { ...row, attempt: 2 };
      return row;
    }),
  });
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, dayWire });
  try {
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
    const queue = page.getByRole("region", { name: "Queue", exact: true });
    await page.getByRole("button", { name: /^Failed — [0-9]+$/u }).click();

    const attempts = queue.getByRole("button", { name: "Attempts for EID 10001573", exact: true });
    await expect(attempts).toBeVisible();
    await attempts.click();
    const attemptDialog = page.getByRole("dialog", { name: "Attempts for EID 10001573", exact: true });
    await expect(attemptDialog.getByRole("button", { name: "Open EID 10001573 — attempt 1 — failed", exact: true })).toBeVisible();
    await expect(attemptDialog.getByRole("button", { name: "Open EID 10001573 — attempt 2 — done", exact: true })).toBeVisible();
    await test.info().attach("queue-item-attempts.png", { body: await page.screenshot(), contentType: "image/png" });

    await attemptDialog.getByRole("button", { name: "Open EID 10001573 — attempt 1 — failed", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("run")).toBe(FIXTURE_IDS.failedRun);
    await expect(queue.locator(`[data-demo-row-id='${FIXTURE_IDS.failedRun}']`)).toHaveCount(1);
    await expect(queue.locator(`[data-demo-row-id='${FIXTURE_IDS.doneRun}']`)).toHaveCount(0);
    expect(errors, "page errors while filtering and opening one attempt").toEqual([]);
    const a11yName = "queue-item-attempts.a11y.yml";
    const tree = await page.locator("body").ariaSnapshot();
    test.info().annotations.push({
      type: `a11y-attachment-sha256:${a11yName}`,
      description: createHash("sha256").update(tree).digest("hex"),
    });
    await test.info().attach(a11yName, { body: tree, contentType: "text/yaml" });
  } finally {
    await server.close();
  }
});
