import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { gotoAppState,type AppRoute } from "./helpers/app-driver.js";
import { PARITY_THEMES, PARITY_VIEWPORTS, assertThemeApplied, installTheme, type ParityTheme } from "./helpers/capture.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { assertShellGeometry } from "./helpers/geometry.js";
import { dismissWorkflowWindow, dismissWorkflowWindowOverQueue, failOnPageErrors, registerReferenceServers } from "./helpers/reference-harness.js";

const servers = registerReferenceServers(["storageServer"]);




async function assertStorageNotice(page: import("@playwright/test").Page): Promise<void> {
  const notice = page.getByRole("alert").filter({ hasText: "Storage unavailable" });
  await expect(notice).toHaveCount(1);
  await expect(notice).toHaveAccessibleName("Dismiss notification");
  await expect(notice.getByRole("button")).toHaveCount(0);
}


test.describe("storage notice", () => {
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
          await assertStorageNotice(page);

          await assertShellGeometry(page, `${state.id} @ ${viewport.name} ${theme.name}`);
          expect(errors, `page errors while rendering ${state.id}`).toEqual([]);


        });
      }
    }
  }

});

