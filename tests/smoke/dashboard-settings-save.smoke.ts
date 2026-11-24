import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { CommandResultSchema, SettingsCommandRequestSchema } from "../../src/rules/commands/commands.js";
import { syntheticSettingsAuthority } from "../support/helpers/dashboard/settings-harness.js";
import { expect, test as base } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";

type HoldSave = (edit: () => Promise<void>, refused?: boolean) => Promise<void>;
const test = base.extend<{ settings: { pickedPath: string; whileReplyIsHeld: HoldSave } }>({
  settings: async ({ page }, use) => {
    const authority = await syntheticSettingsAuthority();
    let nextSave: { ready: Promise<void>; refused: boolean } | undefined;
    async function whileReplyIsHeld(edit: () => Promise<void>, refused = false) {
      const gate = Promise.withResolvers<void>();
      nextSave = { ready: gate.promise, refused };
      try {
        await edit();
        await expect.poll(() => nextSave === undefined, { message: "The Settings change dispatched a save" }).toBe(true);
      }
      finally { gate.resolve(); }
    }
    const pickedPath = join(authority.root, "smoke-downloads");
    try {
      await mkdir(pickedPath);
      await page.route("**/api/v1/settings/path-picker", route => route.fulfill({
        json: { state: "selected", field: "paths.downloadsDir", path: pickedPath },
      }));
      await page.route("**/api/v1/settings/editable", route => route.fulfill({ json: authority.read() }));
      await page.route("**/api/v1/commands", async route => {
        const request = SettingsCommandRequestSchema.parse(route.request().postDataJSON());
        const save = nextSave;
        nextSave = undefined;
        await save?.ready;
        if (save?.refused) {
          await route.fulfill({ json: CommandResultSchema.parse({
            state: "rejected", commandId: request.commandId, code: "lock-unavailable", message: "Fixture refused this settings save.",
          }) });
        } else {
          await route.fulfill({ json: authority.execute(request) });
        }
      });

      await use({ pickedPath, whileReplyIsHeld });
    } finally {
      await authority.close();
    }
  },
});

test.use({ actionTimeout: 10_000 });

test("Settings show edits immediately, persist on reload, and recover from a refused save", async ({ dashboard, page, settings: { pickedPath, whileReplyIsHeld } }) => {
  await dashboard.open();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(dashboard.pageHeading("General")).toBeVisible();
  const switchControl = page.locator('[data-settings-path="preferences.preventSleepWhileRunning"]').getByRole("switch");
  const browser = page.getByRole("combobox", { name: "Browser window" });
  const theme = page.getByRole("radio", { name: "Light" });
  const downloads = page.getByRole("button", { name: "Change Downloads" });
  const path = page.locator('[data-settings-path="paths.downloadsDir"] .ds-path-value');
  const day = page.locator('[data-settings-path$=".jobEndDate"] [role="spinbutton"][data-type="day"]');
  const toasts = page.locator('[data-slot="toast-title"]');
  const saved = (name: string) => toasts.filter({ hasText: new RegExp(`^Saved ${name}(?:\\. Restart to use them\\.)?$`, "u") });
  const failure = toasts.filter({ hasText: "Settings weren't saved. The previous value is back." });

  await expect(switchControl).toBeChecked();
  await whileReplyIsHeld(async () => {
    await switchControl.click();
    await expect(switchControl).not.toBeChecked();
  }, true);
  await expect(failure).toBeVisible();
  await expect(failure).toHaveCount(1);
  await expect(switchControl).toBeChecked();
  await expect(switchControl).toBeEnabled();
  await whileReplyIsHeld(async () => {
    await switchControl.click();
    await expect(switchControl).not.toBeChecked();
  });
  await expect(saved("Prevent sleep while running")).toBeVisible();

  await whileReplyIsHeld(async () => {
    await browser.click();
    await page.getByRole("option", { name: "Small", exact: true }).click();
    await expect(browser).toContainText("Small");
  });
  await expect(saved("settings")).toBeVisible();
  await expect(browser).toBeEnabled();

  await whileReplyIsHeld(async () => {
    await downloads.click();
    await expect(path).toHaveText(basename(pickedPath));
  });
  await expect(saved("Downloads")).toBeVisible();

  const date = page.locator('[data-settings-path$=".jobEndDate"]');
  await date.locator('[data-type="month"]').press("0");
  await date.locator('[data-type="month"]').press("6");
  await day.press("1");
  await day.press("5");
  const year = date.locator('[data-type="year"]');
  for (const digit of "2027") await year.press(digit);
  await expect(day).toHaveText("15");
  await expect(saved("Job end date")).toBeVisible();

  await whileReplyIsHeld(async () => {
    await page.getByRole("group", { name: "Theme" }).getByText("Light", { exact: true }).click();
    await expect(theme).toBeChecked();
  });
  await dashboard.settleReads();
  await page.reload();
  await expect(dashboard.pageHeading("General")).toBeVisible();
  await expect(switchControl).not.toBeChecked();
  await expect(browser).toContainText("Small");
  await expect(theme).toBeChecked();
  await expect(path).toHaveText(basename(pickedPath));
  await expect(date.locator('[data-type="month"]')).toHaveText("06");
  await expect(day).toHaveText("15");
  await expect(year).toHaveText("2027");

  const search = page.getByRole("searchbox", { name: "Search settings" });
  await search.fill("Default workers");
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: /^Default workers/u }).click();
  await expect(dashboard.pageHeading("Performance")).toBeVisible();
  const workers = page.getByRole("textbox", { name: "Default workers", exact: true });
  await workers.fill("3");
  await expect(workers).toHaveValue("3");
  await expect(saved("Default workers")).toBeVisible();
  await dashboard.settleReads();
  await page.reload();
  await expect(dashboard.pageHeading("Performance")).toBeVisible();
  await expect(workers).toHaveValue("3");
});

test("Downloads can save after a theme change without reopening Settings", async ({ dashboard, page, settings: { pickedPath, whileReplyIsHeld } }) => {
  await dashboard.open();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(dashboard.pageHeading("General")).toBeVisible();
  await whileReplyIsHeld(async () => {
    await page.getByRole("group", { name: "Theme" }).getByText("Light", { exact: true }).click();
    await expect(page.getByRole("radio", { name: "Light" })).toBeChecked();
  });
  await dashboard.settleReads();
  const pathSave = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/commands"
    && SettingsCommandRequestSchema.parse(response.request().postDataJSON()).payload.patch["paths.downloadsDir"] !== undefined);
  await whileReplyIsHeld(async () => {
    await page.getByRole("button", { name: "Change Downloads" }).click();
    await expect(page.locator('[data-settings-path="paths.downloadsDir"] .ds-path-value')).toHaveText(basename(pickedPath));
  });
  const result = CommandResultSchema.parse(await (await pathSave).json());
  expect(result).toMatchObject({ state: "applied" });
});
