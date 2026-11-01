import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { createHash } from "node:crypto";
import { gotoAppState,type AppRoute } from "./helpers/app-driver.js";
import { PARITY_THEMES, PARITY_VIEWPORTS, assertThemeApplied, installTheme, type ParityTheme } from "./helpers/capture.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { assertShellGeometry } from "./helpers/geometry.js";
import { dismissWorkflowWindow, dismissWorkflowWindowOverQueue, failOnPageErrors, registerReferenceServers } from "./helpers/reference-harness.js";

const servers = registerReferenceServers(["server","storageServer"]);




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
  const takeover = await page.locator('.dashboard-shell[data-settings-takeover="true"]').count();
  const rail = takeover ? 0 : Math.max(208, Math.min(264, viewportWidth / 4 - 96));
  expect(geometry).toEqual({
    x: rail,
    width: viewportWidth - rail,
    borderTop: "0px",
    borderRight: "0px",
    borderBottom: "1px",
    borderLeft: "0px",
    borderRadius: "0px",
  });
}


const STORAGE_DOCTOR_VIEWPORTS = PARITY_VIEWPORTS;


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


        });
      }
    }
  }

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

        await page.getByRole("button", { name: "Run storage checks", exact: true }).click();
        await expect(page.getByText(/terminal outbox/u)).toHaveCount(0);
        await expect(page.getByRole("group", { name: "Storage health checks", exact: true }).getByRole("listitem")).toHaveCount(3);
        await expect(page.getByText("Run history", { exact: true })).toHaveCount(0);
        const row = page.locator(".diagnostic-check-entry").filter({ hasText: "UCPath password" });
        await expect(row).toContainText("Unavailable");
        await page.getByRole("group", { name: "Connections", exact: true }).getByRole("button", { name: "Diagnostic details", exact: true }).click();
        const details = page.getByRole("region", { name: "Connections diagnostics", exact: true });
        await expect(details).toContainText("protected settings fixture is unavailable");
        await details.scrollIntoViewIfNeeded();

        await assertShellGeometry(page, `storage-doctor-degraded @ ${viewport.name} ${theme.name}`);
        expect(errors, "page errors while rendering the loaded storage doctor").toEqual([]);

        const snapshot = await page.locator("body").ariaSnapshot();
        expect(snapshot).toContain("UCPath password");
        expect(snapshot).not.toContain("Run history");
        test.info().annotations.push({
          type: `a11y-attachment-sha256:${a11yName}`,
          description: createHash("sha256").update(snapshot).digest("hex"),
        });
        await test.info().attach(a11yName, { body: snapshot, contentType: "text/yaml" });


      });
    }
  }
});
