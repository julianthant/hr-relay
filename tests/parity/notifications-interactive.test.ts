
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
      const bell = page.getByRole("button", { name: /^Notifications, \d+ unread$/u });
      const inbox = page.getByRole("complementary", { name: "Workspace", exact: true }).getByRole("region", { name: "Notifications", exact: true });
      const logs = page.getByRole("region", { name: "Selected run logs", exact: true, includeHidden: true });
      const item = (subject: string) => inbox.locator("li.notification-row").filter({ has: page.locator("button.notification-item", { hasText: subject }) });
      const open = (subject: string) => item(subject).locator("button.notification-item");
      const menuButton = inbox.getByRole("button", { name: "Notification actions", exact: true });
      await expect(bell).toHaveAccessibleName("Notifications, 3 unread"); await bell.click();
      await item("Morrow, Bea").hover();
      await item("Morrow, Bea").getByRole("button", { name: "Mark as unread", exact: true }).click();
      await expect(bell).toHaveAccessibleName("Notifications, 4 unread");
      await menuButton.click();
      await page.getByRole("menuitem", { name: "Mark all as read", exact: true }).click();
      await expect(bell).toHaveAccessibleName("Notifications, 0 unread");
      await expect(inbox.locator(".notification-unread-dot")).toHaveCount(0);
      await menuButton.click();
      await expect(page.getByRole("menuitem", { name: "Mark all as read", exact: true })).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(inbox).toBeVisible();
      await expect(inbox.locator("li.notification-row")).toHaveCount(13);

      const contact = open("emergency-contacts.pdf");
      const dialog = page.getByRole("dialog", { name: /^Review records/u });
      const drawer = dialog.getByRole("region", { name: "OCR records", exact: true });
      const cell = () => drawer.getByRole("region", { name: "Record person-1", exact: true }).getByRole("group", { name: "Employee", exact: true }).getByRole("textbox", { name: "Cell phone", exact: true });
      await contact.focus(); await page.keyboard.press("Enter");
      await expect(dialog).toBeVisible(); await expect(drawer.getByRole("button", { name: "Approve records", exact: true })).toBeEnabled();
      await expect.poll(async () => { const box = await dialog.boundingBox(); return box ? box.x + box.width : Infinity; }).toBeLessThanOrEqual(width);
      await expect(dialog.getByRole("heading", { level: 2 })).toContainText("emergency-contacts.pdf");

      await cell().fill("619-555-0199");
      await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
      await expect(inbox).toBeVisible();
      await contact.click();
      await expect(cell()).toHaveValue("619-555-0199");
      await drawer.getByRole("button", { name: "Approve records", exact: true }).click();
      await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
      await expect(inbox.locator("li.notification-row")).toHaveCount(13);
      await expect(inbox).toContainText("Records approved"); await expect(bell).toHaveAccessibleName("Notifications, 0 unread");
      await contact.click();
      await expect(drawer).toBeVisible(); await expect(drawer).toContainText("619-555-0199");
      await expect(cell()).toHaveCount(0);
      await expect(drawer.getByRole("button", { name: "Approve records", exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
      await open("Morrow, Bea").click();
      await expect(inbox).toBeVisible(); expect(new URL(page.url()).searchParams.get("run")).toBe(FIXTURE_IDS.openGateRun);
      await expect(logs.getByRole("heading", { level: 2 })).toHaveText("Morrow, Bea");
      await expect(page.locator(`[data-demo-row-id="${FIXTURE_IDS.openGateRun}"]`)).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(`[data-demo-row-id="${FIXTURE_IDS.openGateRun}"] [data-demo-row-title]`)).toBeInViewport();
      await expect(page.locator("#dashboard-main-region")).toBeFocused();
      await open("EID 10101010").click();
      expect(new URL(page.url()).searchParams.get("run")).toBe(FIXTURE_IDS.doneRun);
      await expect(logs.getByRole("heading", { level: 2 })).toHaveText("EID 10101010");
      await expect(page.locator(`[data-demo-row-id="${FIXTURE_IDS.doneRun}"] [data-demo-row-title]`)).toBeInViewport();
      await bell.click();
      await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: "Onboarding", exact: true }).click();
      await page.getByRole("button", { name: "Start run", exact: true }).click();
      const launcher = page.getByRole("dialog", { name: "Start run", exact: true });
      await launcher.getByRole("navigation", { name: "Workflow", exact: true }).getByRole("button", { name: "Onboarding", exact: true }).click();
      await launcher.getByRole("textbox", { name: "Emails", exact: true }).fill("notification.hire@example.com");
      await launcher.getByRole("button", { name: "Continue", exact: true }).click(); await launcher.getByRole("button", { name: "Preview plan", exact: true }).click();
      await launcher.getByRole("button", { name: "Start preview", exact: true }).click();
      await expect(bell).toHaveAccessibleName("Notifications, 1 unread"); await bell.click();
      const created = item("notification.hire@example.com");
      await expect(created).toContainText("Completed"); await open("notification.hire@example.com").click();
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
      const item = (subject: string) => inbox.locator("li.notification-row").filter({ has: page.locator("button.notification-item", { hasText: subject }) });
      await bell.click();
      for (const [subject, id] of targets) {
        await item(subject).locator("button.notification-item").click();
        expect(new URL(page.url()).searchParams.get("run")).toBe(id);
        await expect(logs.getByRole("heading", { level: 2 })).toHaveText(subject);
        const row = page.locator(`.dashboard-queue-column [data-demo-row-id="${id}"]`);
        await expect(row).toHaveAttribute("aria-pressed", "true");
        await expect(row.locator("[data-demo-row-title]")).toBeInViewport();
        expect((await page.locator("#dashboard-main-region").boundingBox())!.y).toBe(0);
        await expect(bell).toBeInViewport();
      }

      for (const [subject, id, count] of [
        ["single-oath.pdf", "mock:oath-signature:sample", 1],
        ["multiple-oath.pdf", "mock:oath-upload:sample", 4],
        ["emergency-contacts.pdf", "mock:emergency-contact:sample", 3],
        ["detect-test.pdf", "mock:onbase:sample", 4],
        ["i9.pdf", "mock:i9-check-start:sample", 2],
      ] as const) {
        await item(subject).locator("button.notification-item").click();
        await expect(logs.getByRole("heading", { level: 2, includeHidden: true })).toHaveText(subject);
        const reviewDialog = page.getByRole("dialog", { name: /^Review records/u });
        const review = reviewDialog.getByRole("region", { name: "OCR records", exact: true });
        await expect(review.locator("[data-review-record-id]")).toHaveCount(count);
        await expect(review.getByRole("button", { name: "Approve records", exact: true })).toBeEnabled();
        const row = page.locator(`.dashboard-queue-column [data-demo-row-id="${mockQueueId(id)}"]`);
        await expect(row).toHaveAttribute("aria-pressed", "true");
        await expect(row.locator("[data-demo-row-title]")).toBeInViewport();
        expect((await page.locator("#dashboard-main-region").boundingBox())!.y).toBe(0);
        await expect(bell).toBeInViewport();
        if (subject === "detect-test.pdf") await expect(review).toContainText("3 selected for approval");
        await page.keyboard.press("Escape"); await expect(reviewDialog).toHaveCount(0);
      }
      await expect(inbox.locator("li.notification-row")).toHaveCount(13);
      await expect(inbox.locator("button.notification-item", { hasText: "sick-hours.pdf" })).toHaveCount(0);
      await expect(bell).toHaveAccessibleName("Notifications, 0 unread");

      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]); expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}
