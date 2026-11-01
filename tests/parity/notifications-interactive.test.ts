import { moveAssistantLauncherAboveFooter } from "./helpers/app-driver.js";

import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { FIXTURE_IDS } from "./helpers/fixture-queue.js";
import { mockQueueId } from "../../src/dashboard/surfaces/workflows/mocks/workflow-queue-model.js";

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`notification destinations, approval and new run updates @ ${theme.attribute}-${width}`, async ({ page }, _info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET") writes.push(`${request.method()} ${new URL(request.url()).pathname}`); });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 }); await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
      await page.getByRole("button", { name: "Close assistant", exact: true }).click();
      await moveAssistantLauncherAboveFooter(page);
      const bell = page.getByRole("button", { name: /^Notifications, \d+ unread$/u });
      const inbox = page.getByRole("complementary", { name: "Workspace", exact: true }).getByRole("region", { name: "Notifications", exact: true });
      const logs = page.getByRole("region", { name: "Selected run logs", exact: true, includeHidden: true });
      await expect(bell).toHaveAccessibleName("Notifications, 3 unread"); await bell.click();
      await inbox.locator(".notification-row").filter({ has: page.getByRole("button", { name: "Morrow, Bea", exact: true }) }).getByRole("button", { name: "Mark unread: Approval waiting", exact: true }).click();
      await expect(bell).toHaveAccessibleName("Notifications, 4 unread");
      await inbox.getByRole("tab", { name: "Unread", exact: true }).click();
      await inbox.getByRole("button", { name: "Read all", exact: true }).click();
      await expect(inbox).toContainText("All caught up"); await expect(bell).toHaveAccessibleName("Notifications, 0 unread");
      await expect(inbox.getByRole("button", { name: "Read all", exact: true })).toBeDisabled();
      await expect(inbox.getByRole("tab", { name: "Unread", exact: true })).toBeFocused();
      await inbox.getByRole("tab", { name: "All", exact: true }).click();
      await inbox.getByRole("button", { name: "Filter notifications by category", exact: true }).click();
      await page.getByRole("menuitemradio", { name: "Needs you", exact: true }).click();
      await expect(inbox.locator(".notification-row")).toHaveCount(11);

      const contact = inbox.locator(".notification-row").filter({ has: page.getByRole("button", { name: "emergency-contacts.pdf", exact: true }) });
      await contact.getByRole("button", { name: "Review records", exact: true }).focus(); await page.keyboard.press("Enter");
      await expect(inbox).toHaveCount(0);
      const drawer = logs.getByRole("region", { name: "OCR records", exact: true });
      await expect(drawer).toBeVisible(); await expect(drawer.getByRole("button", { name: "Approve records", exact: true })).toBeEnabled();
      await expect.poll(async () => { const box = await drawer.boundingBox(); return box ? box.x + box.width : Infinity; }).toBeLessThanOrEqual(width);
      await expect(logs.getByRole("heading", { level: 2, includeHidden: true })).toHaveText("emergency-contacts.pdf");
      await expect(drawer.getByRole("heading", { name: "Jordan Lee", exact: true })).toBeFocused();

      await drawer.getByRole("region", { name: "Record person-1", exact: true }).getByRole("textbox", { name: "Cell phone", exact: true }).fill("619-555-0199");
      await bell.click(); await contact.getByRole("button", { name: "Review records", exact: true }).click();
      await expect(drawer.getByRole("heading", { name: "Jordan Lee", exact: true })).toBeFocused();
      await expect(drawer.getByRole("region", { name: "Record person-1", exact: true }).getByRole("textbox", { name: "Cell phone", exact: true })).toHaveValue("619-555-0199");
      await drawer.getByRole("button", { name: "Approve records", exact: true }).click();
      await logs.getByRole("button", { name: /^Records \d+$/u }).click();
      await bell.click();
      await expect(inbox.locator(".notification-row")).toHaveCount(10);
      await inbox.getByRole("button", { name: "Filter notifications by category", exact: true }).click();
      await page.getByRole("menuitemradio", { name: "All updates", exact: true }).click();
      await expect(inbox).toContainText("Records approved"); await expect(bell).toHaveAccessibleName("Notifications, 0 unread");
      await contact.getByRole("button", { name: "View records", exact: true }).click();
      await expect(drawer).toBeVisible(); await expect(drawer).toContainText("619-555-0199");
      await expect(drawer.getByRole("region", { name: "Record person-1", exact: true }).getByRole("textbox", { name: "Cell phone", exact: true })).toHaveCount(0);
      await expect(drawer.getByRole("button", { name: "Approve records", exact: true })).toHaveCount(0);
      await logs.getByRole("button", { name: /^Records \d+$/u }).click(); await expect(drawer).toHaveCount(0);
      await bell.click(); await inbox.locator(".notification-row").filter({ has: page.getByRole("button", { name: "Morrow, Bea", exact: true }) }).getByRole("button", { name: "Review run", exact: true }).click();
      await expect(inbox).toHaveCount(0); expect(new URL(page.url()).searchParams.get("run")).toBe(FIXTURE_IDS.openGateRun);
      await expect(logs.getByRole("heading", { level: 2 })).toHaveText("Morrow, Bea");
      await expect(page.locator(`[data-demo-row-id="${FIXTURE_IDS.openGateRun}"]`)).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(`[data-demo-row-id="${FIXTURE_IDS.openGateRun}"] [data-demo-row-title]`)).toBeInViewport();
      await expect(page.locator("#dashboard-main-region")).toBeFocused();
      await bell.click(); await inbox.locator(".notification-row").filter({ has: page.getByRole("button", { name: "EID 10101010", exact: true }) }).getByRole("button", { name: "Open log", exact: true }).click();
      expect(new URL(page.url()).searchParams.get("run")).toBe(FIXTURE_IDS.doneRun);
      await expect(logs.getByRole("heading", { level: 2 })).toHaveText("EID 10101010");
      await expect(page.locator(`[data-demo-row-id="${FIXTURE_IDS.doneRun}"] [data-demo-row-title]`)).toBeInViewport();
      await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: "Onboarding", exact: true }).click();
      await page.getByRole("button", { name: "Start a run", exact: true }).click();
      const launcher = page.getByRole("dialog", { name: "Start a run", exact: true });
      await launcher.getByRole("navigation", { name: "Workflow", exact: true }).getByRole("button", { name: "Onboarding", exact: true }).click();
      await launcher.getByRole("textbox", { name: "Emails", exact: true }).fill("notification.hire@example.com");
      await launcher.getByRole("button", { name: "Continue", exact: true }).click(); await launcher.getByRole("button", { name: "Preview plan", exact: true }).click();
      await launcher.getByRole("button", { name: "Start preview", exact: true }).click();
      await expect(bell).toHaveAccessibleName("Notifications, 1 unread"); await bell.click();
      const created = inbox.locator(".notification-row").filter({ hasText: "notification.hire@example.com" });
      await expect(created).toContainText("Completed"); await expect(created).toContainText("Just now"); await created.getByRole("button", { name: "notification.hire@example.com", exact: true }).click();
      await expect(logs.getByRole("heading", { level: 2 })).toHaveText("notification.hire@example.com");
      await expect(bell).toHaveAccessibleName("Notifications, 0 unread");

      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]); expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
  test(`every mock notification reveals its queue row @ ${theme.attribute}-${width}`, async ({ page }, _info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET") writes.push(`${request.method()} ${new URL(request.url()).pathname}`); });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 }); await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
      await page.getByRole("button", { name: "Close assistant", exact: true }).click();
      await moveAssistantLauncherAboveFooter(page);
      const bell = page.getByRole("button", { name: /^Notifications, \d+ unread$/u });
      const inbox = page.getByRole("complementary", { name: "Workspace", exact: true }).getByRole("region", { name: "Notifications", exact: true });
      const logs = page.getByRole("region", { name: "Selected run logs", exact: true, includeHidden: true });
      await expect(bell).toHaveAccessibleName("Notifications, 3 unread");
      await page.getByRole("button", { name: "Filter queue by status", exact: true }).click();
      await page.getByRole("menuitemcheckbox", { name: /^Running /u }).click(); await page.keyboard.press("Escape");
      await expect(page.locator(`[data-demo-row-id="${FIXTURE_IDS.failedRun}"]`)).toHaveCount(0);
      const targets = [
        ["EID 10555001", FIXTURE_IDS.failedRun], ["Morrow, Bea", FIXTURE_IDS.openGateRun],
        ["Rehire eligibility sweep", FIXTURE_IDS.groupOf4], ["EID 10777012", FIXTURE_IDS.parkedRun],
        ["EID 10333015", FIXTURE_IDS.partialRun], ["EID 10101010", FIXTURE_IDS.doneRun],
        ["Onboarding cohort — July stragglers", FIXTURE_IDS.groupOf12], ["Separation audit — August", FIXTURE_IDS.groupOf13],
      ] as const;
      for (const [subject, id] of targets) {
        await bell.click();
        const item = inbox.locator(".notification-row").filter({ has: page.getByRole("button", { name: subject, exact: true }) });
        await item.getByRole("button", { name: /^(?:Open log|Review run)$/u }).click();
        expect(new URL(page.url()).searchParams.get("run")).toBe(id);
        await expect(logs.getByRole("heading", { level: 2 })).toHaveText(subject);
        const row = page.locator(`.dashboard-queue-column [data-demo-row-id="${id}"]`);
        await expect(row).toHaveAttribute("aria-pressed", "true");
        await expect(row.locator("[data-demo-row-title]")).toBeInViewport();
        expect((await page.locator("#dashboard-main-region").boundingBox())!.y).toBe(0);
        await expect(bell).toBeInViewport();
      }

      for (const [subject, id, count] of [
        ["single-oath.pdf", "mock:oath-signature:sample:ocr", 1],
        ["multiple-oath.pdf", "mock:oath-upload:sample:ocr", 4],
        ["emergency-contacts.pdf", "mock:emergency-contact:sample:ocr", 3],
        ["detect-test.pdf", "mock:onbase:sample:ocr", 4],
        ["i9.pdf", "mock:i9-check:sample:ocr", 2],
      ] as const) {
        await bell.click();
        const item = inbox.locator(".notification-row").filter({ has: page.getByRole("button", { name: subject, exact: true }) });
        await item.getByRole("button", { name: "Review records", exact: true }).click();
        await expect(logs.getByRole("heading", { level: 2, includeHidden: true })).toHaveText(subject);
        const review = logs.getByRole("region", { name: "OCR records", exact: true });
        await expect(review.locator("[data-review-record-id]")).toHaveCount(count);
        await expect(review.getByRole("button", { name: "Approve records", exact: true })).toBeEnabled();
        const row = page.locator(`.dashboard-queue-column [data-demo-row-id="${mockQueueId(id)}"]`);
        await expect(row).toHaveAttribute("aria-pressed", "true");
        await expect(row.locator("[data-demo-row-title]")).toBeInViewport();
        expect((await page.locator("#dashboard-main-region").boundingBox())!.y).toBe(0);
        await expect(bell).toBeInViewport();
        if (subject === "detect-test.pdf") await expect(review).toContainText("3 selected for approval");
      }
      await bell.click();
      await expect(inbox.locator(".notification-row")).toHaveCount(13);
      await expect(inbox.getByRole("button", { name: "sick-hours.pdf", exact: true })).toHaveCount(0);
      await expect(bell).toHaveAccessibleName("Notifications, 0 unread");

      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]); expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}
