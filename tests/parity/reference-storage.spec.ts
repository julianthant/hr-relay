import { expect,test } from "@playwright/test";
import { createHash } from "node:crypto";
import { gotoAppState,type AppRoute } from "./helpers/app-driver.js";
import {
PARITY_THEMES,
PARITY_VIEWPORTS,
assertThemeApplied,
captureParityPair,
installTheme,
type ParityTheme,
} from "./helpers/capture.js";
import { FIXTURE_APP_VERSION,FIXTURE_DAY,FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";
import { assertShellGeometry } from "./helpers/geometry.js";
import { REFERENCES,dismissWorkflowWindow,dismissWorkflowWindowOverQueue,failOnPageErrors,registerReferenceServers } from "./helpers/reference-harness.js";

const servers = registerReferenceServers(["server","storageServer"]);



/**
 * D281 item 7: the storage hazard is its own degraded-fixture family. The
 * ordinary corpus stays healthy; these references prove the same app-wide site
 * on the queue and above a takeover without degrading an operator runtime.
 */
async function assertStorageBandGeometry(
  page: import("@playwright/test").Page,
  viewportWidth: number,
): Promise<void> {
  const band = page.getByRole("alert").filter({ hasText: "Authority storage is unavailable" });
  await expect(band).toBeVisible();
  const geometry = await band.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      x: rect.x,
      width: rect.width,
      borderTop: style.borderTopWidth,
      borderRight: style.borderRightWidth,
      borderBottom: style.borderBottomWidth,
      borderLeft: style.borderLeftWidth,
      borderRadius: style.borderRadius,
    };
  });
  expect(geometry).toEqual({
    x: 0,
    width: viewportWidth,
    borderTop: "0px",
    borderRight: "0px",
    borderBottom: "1px",
    borderLeft: "0px",
    borderRadius: "0px",
  });
}


const STORAGE_DOCTOR_VIEWPORTS = PARITY_VIEWPORTS.filter(
  (viewport) => viewport.name === "1440x900" || viewport.name === "narrow-1024x768",
);


test.describe("storage band", () => {
  const STORAGE_STATES: readonly { id: string; route: AppRoute }[] = [
    { id: "storage-queue", route: { day: FIXTURE_DAY } },
    { id: "storage-settings", route: { day: FIXTURE_DAY, settings: "storage" } },
  ];

  for (const viewport of PARITY_VIEWPORTS) {
    for (const theme of PARITY_THEMES) {
      for (const state of STORAGE_STATES) {
        test(`${state.id} @ ${theme.name} @ ${viewport.name}`, async ({ page }) => {
          const errors = failOnPageErrors(page);
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await installTheme(page, theme satisfies ParityTheme);
          await gotoAppState(page, servers.storageServer.baseUrl, state.route);
          if (state.route.settings === undefined) {
            await dismissWorkflowWindowOverQueue(page);
          } else {
            await dismissWorkflowWindow(page);
          }
          await assertThemeApplied(page, theme satisfies ParityTheme);
          await assertStorageBandGeometry(page, viewport.width);

          await assertShellGeometry(page, `${state.id} @ ${viewport.name} ${theme.name}`);
          expect(errors, `page errors while rendering ${state.id}`).toEqual([]);

          await captureParityPair(page, REFERENCES, {
            stateId: state.id,
            viewport: viewport.name,
            theme: theme.name,
            adapter: "fixture",
            fixtureId: state.id,
            descriptorHash: FIXTURE_DESCRIPTOR_HASH,
            appVersion: FIXTURE_APP_VERSION,
            capturedAt: FIXTURE_DAY,
            variant: "default",
          });
        });
      }
    }
  }

  test("storage-queue @ graphite-warm @ 1440x900 @ sidebar", async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.setItem("hr-dashboard.workflow-panel", "sidebar");
    });
    await installTheme(page, PARITY_THEMES[0]);
    await gotoAppState(page, servers.storageServer.baseUrl, { day: FIXTURE_DAY });
    await assertThemeApplied(page, PARITY_THEMES[0]);
    await expect(page.getByRole("navigation", { name: "Workflow Panel" })).toBeVisible();
    await assertStorageBandGeometry(page, 1440);
    await assertShellGeometry(page, "storage-queue @ 1440x900 graphite-warm sidebar");
    expect(errors, "page errors while rendering storage-queue in sidebar mode").toEqual([]);

    await captureParityPair(page, REFERENCES, {
      stateId: "storage-queue",
      viewport: "1440x900",
      theme: PARITY_THEMES[0].name,
      adapter: "fixture",
      fixtureId: "storage-queue",
      descriptorHash: FIXTURE_DESCRIPTOR_HASH,
      appVersion: FIXTURE_APP_VERSION,
      capturedAt: FIXTURE_DAY,
      variant: "sidebar",
    });
  });
});


test.describe("loaded storage doctor", () => {
  for (const viewport of STORAGE_DOCTOR_VIEWPORTS) {
    for (const theme of PARITY_THEMES) {
      const a11yName = `storage-doctor-${theme.name}-${viewport.name}.a11y.yml`;
      test(`${theme.name} @ ${viewport.name}`, {
        annotation: [{ type: "required-a11y-evidence", description: a11yName }],
      }, async ({ page }) => {
        const errors = failOnPageErrors(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await installTheme(page, theme satisfies ParityTheme);
        await gotoAppState(page, servers.server.baseUrl, { day: FIXTURE_DAY, settings: "storage" });
        await dismissWorkflowWindow(page);
        await assertThemeApplied(page, theme satisfies ParityTheme);

        await page.getByRole("button", { name: "Run the read-only storage doctor" }).click();
        const row = page.locator(".storage-check-row").filter({ hasText: "Run record consistency" });
        await expect(page.getByText(/terminal outbox/u)).toHaveCount(0);
        await expect(row).toContainText("Needs attention");
        await expect(row).toContainText("1 archived run");
        await expect(row).toContainText("4 run record issues");
        await row.getByText("4 run record issues", { exact: true }).click();
        await expect(row).toContainText("Activity history missing");
        await row.scrollIntoViewIfNeeded();

        await assertShellGeometry(page, `storage-doctor-degraded @ ${viewport.name} ${theme.name}`);
        expect(errors, "page errors while rendering the loaded storage doctor").toEqual([]);

        const snapshot = await page.locator("body").ariaSnapshot();
        expect(snapshot).toContain("Run record consistency");
        test.info().annotations.push({
          type: `a11y-attachment-sha256:${a11yName}`,
          description: createHash("sha256").update(snapshot).digest("hex"),
        });
        await test.info().attach(a11yName, { body: snapshot, contentType: "text/yaml" });

        await captureParityPair(page, REFERENCES, {
          stateId: "storage-doctor-degraded",
          viewport: viewport.name,
          theme: theme.name,
          adapter: "fixture",
          fixtureId: "storage-doctor-degraded",
          descriptorHash: FIXTURE_DESCRIPTOR_HASH,
          appVersion: FIXTURE_APP_VERSION,
          capturedAt: FIXTURE_DAY,
          variant: "default",
        });
      });
    }
  }
});
