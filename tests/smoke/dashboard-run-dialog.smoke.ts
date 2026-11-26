/** Run dialog smoke: Start run opens for every workflow, holds later stages until input, and closes cleanly. */
import { DESKTOP_VIEWPORTS, WORKFLOW_LABELS } from "../support/helpers/dashboard/smoke/dashboard-page.js";
import { expect, test } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";

for (const viewport of DESKTOP_VIEWPORTS) {
  test.describe(`run dialog at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    for (const label of WORKFLOW_LABELS) {
      test(`${label} shows its Input stage inside the window`, async ({ dashboard }) => {
        await dashboard.open();
        // The rail starts collapsed below 1200px, and the sidebar + lives on the expanded rows.
        if (viewport.width < 1200) await dashboard.page.getByRole("button", { name: "Expand sidebar" }).click();
        await dashboard.page.getByRole("button", { name: `Start a ${label} run`, exact: true }).click();
        await expect(dashboard.dialog).toBeVisible();
        await expect(dashboard.dialog.getByRole("banner")).toContainText(label);
        // The Input stage can contain a second region named Input for the text entry.
        await expect(dashboard.dialog.getByRole("region", { name: "Input", exact: true }).first()).toBeVisible();
        await expect(dashboard.dialog).toBeInViewport({ ratio: 1 });
      });
    }
  });
}

test("later stages stay off until the input is given", async ({ dashboard }) => {
  await dashboard.open();
  await dashboard.openStartDialog();
  const path = dashboard.dialog.getByRole("list", { name: "Run configuration path" });
  await expect(path.getByRole("button", { name: /Input$/ })).toBeEnabled();
  await expect(path.getByRole("button", { name: /Start$/ })).toBeDisabled();
});

test("Escape closes the dialog and returns focus to Start run", async ({ dashboard, page }) => {
  await dashboard.open();
  await dashboard.openStartDialog();
  await page.keyboard.press("Escape");
  await expect(dashboard.dialog).toBeHidden();
  await expect(dashboard.startRunButton).toBeFocused();
});

test("the Close control closes the dialog", async ({ dashboard }) => {
  await dashboard.open();
  await dashboard.openStartDialog();
  await dashboard.dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dashboard.dialog).toBeHidden();
});

test("Tab stays inside the open dialog", async ({ dashboard, page }) => {
  await dashboard.open();
  await dashboard.openStartDialog();
  const focusedDialog = dashboard.dialog.and(page.locator(":focus-within"));
  for (let press = 0; press < 40; press += 1) {
    await page.keyboard.press("Tab");
    await expect(focusedDialog, `focus after ${press + 1} Tab presses`).toBeVisible();
  }
});

test("the dialog is named for assistive technology", async ({ dashboard }) => {
  await dashboard.open();
  await dashboard.openStartDialog();
  await expect(dashboard.dialog).toHaveAccessibleName(/Start run/);
});
