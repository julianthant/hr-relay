import { expect, type Page } from "@playwright/test";
import { join } from "node:path";
import { test } from "./helpers/fixtures.js";
import { MOCK_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer, type FixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { serveSettings } from "./helpers/served-settings.js";
import { STATUS_MOCK_IDS, type StatusMockId } from "../../src/dashboard/surfaces/settings/status-mock/status-mock-model.js";

// Design mock renders for the status pages that leave Settings; output goes to the gitignored .work folder.
const OUT = process.env.STATUS_MOCK_OUT ?? "/Users/julianhein/Projects/hr-relay/.work/next-20261101/settings-status-mock";
const THEMES = (process.env.STATUS_MOCK_THEMES ?? "light").split(",") as ("light" | "dark")[];
const WIDTH = Number(process.env.STATUS_MOCK_WIDTH ?? 1280);
const HEIGHT = 720;
const ONLY = process.env.STATUS_MOCK_ONLY?.split(",");
// 2 renders at the Codex references' scale for pixel comparison.
test.use({ deviceScaleFactor: Number(process.env.STATUS_MOCK_SCALE ?? 1) });

const SETTINGS_PAGE: Partial<Record<StatusMockId, string>> = {
  "general-a": "general", "general-a-browser": "general", "general-a-date": "general",
  "search-keyboard": "keyboard",
};

let server: FixtureServer;
test.beforeAll(async () => { server = await startFixtureServer({ distDir: MOCK_DIST_DIR, bundle: { proof: "working-tree" } }); });
test.afterAll(async () => { await server.close(); });

async function settle(page: Page) {
  await page.mouse.move(1, 1);
  await page.waitForTimeout(500);
}

for (const theme of THEMES) test(`status mock @ ${theme} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, theme);
  for (const id of STATUS_MOCK_IDS.filter(item => ONLY === undefined || ONLY.includes(item))) {
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    const settings = SETTINGS_PAGE[id];
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}${settings ? `&settings=${settings}` : ""}&statusMock=${id}`);
    // The modal frames open with their dialog, which hides the page behind it from the accessibility tree.
    if (settings) await expect(page.locator("nav.settings-panel-nav")).toBeVisible();
    else if (!id.startsWith("signup")) await expect(page.getByRole("navigation", { name: "Workflows", exact: true })).toBeVisible();
    // A modal dialog blocks pointer clicks, so close the assistant panel through the DOM.
    await page.addStyleTag({ content: ".hub-assistant-launcher { display: none !important; }" });
    const firstToast = { toasts: "Relay is missing files", "toasts-open": "Relay is missing files", "toasts-storage": "Your disk is full", "toasts-restored": "Restored a file from the 6:30 PM backup" }[id as string];
    if (firstToast) await expect(page.getByText(firstToast)).toBeVisible();
    if (id.startsWith("rail")) {
      const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
      await expect(rail.getByRole("button", { name: "Emergency Contact", exact: true })).toBeVisible();
      // The minimized state is remembered per browser, so each frame sets the one it needs.
      const want = id === "rail" ? "Collapse sidebar" : "Expand sidebar";
      const toggle = page.getByRole("button", { name: /^(Collapse|Expand) sidebar$/ });
      if (await toggle.getAttribute("aria-label") !== want) await toggle.click();
      await expect(page.getByRole("button", { name: want, exact: true })).toBeVisible();
      if (id === "rail-min-bell") { await page.getByRole("button", { name: /^Notifications/ }).click(); await expect(page.getByRole("button", { name: "Collapse sidebar", exact: true })).toBeVisible(); }
    } else if (id === "queue-toolbar") {
      await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: "Emergency Contact", exact: true }).click();
      await expect(page.getByRole("button", { name: "Start run", exact: true })).toBeVisible();
    } else if (id === "run-person-lookup" || id === "run-person-lookup-many") {
      await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: "Person Lookup", exact: true }).last().click();
      await page.getByRole("button", { name: "Start run", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Start run", exact: true });
      await expect(dialog.getByText("Workflow preview")).toBeVisible();
      await dialog.getByRole("textbox").first().fill(id === "run-person-lookup" ? "10000001" : "10000001; 10000002; Lee, Jordan");
      await expect(dialog.getByText("Parsed input")).toBeVisible();
    } else if (id === "run-options-many") {
      await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: "Separations", exact: true }).last().click();
      await page.getByRole("button", { name: "Start run", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Start run", exact: true });
      await dialog.getByRole("textbox").first().fill("48216, 48220");
      await dialog.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(dialog.getByRole("switch", { name: "Priority", exact: true })).not.toBeChecked();
    } else if (id === "run-steps" || id === "run-rerun-steps") {
      await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: "Separations", exact: true }).last().click();
      if (id === "run-rerun-steps") {
        await page.getByRole("button", { name: "Rerun", exact: true }).click();
        await expect(page.getByRole("dialog").getByText(/\d+ of \d+ included/)).toBeVisible();
      } else {
        await page.getByRole("button", { name: "Start run", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Start run", exact: true });
        await dialog.getByRole("textbox").first().fill("10555001");
        await dialog.getByRole("button", { name: "Continue", exact: true }).click();
        await dialog.getByRole("switch", { name: "Customize steps", exact: true }).dispatchEvent("click");
        await dialog.getByRole("button", { name: "Continue", exact: true }).click();
        await expect(dialog.getByText(/\d+ of \d+ included/)).toBeVisible();
      }
    } else if (id === "run-rerun-options") {
      await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: "Emergency Contact", exact: true }).click();
      await page.getByRole("button", { name: "Rerun", exact: true }).click();
      const dialog = page.getByRole("dialog");
      for (let step = 0; step < 2; step++) await dialog.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(dialog.getByText("ChatGPT is disconnected")).toBeVisible();
    } else if (id === "run-rerun") {
      // Reruns happen only in the Rerun dialog: Emergency Contact in the rail, the run's Rerun button, then Continue to the Values stage.
      await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: "Emergency Contact", exact: true }).click();
      await page.getByRole("button", { name: "Rerun", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(dialog.getByText("Reference spreadsheets")).toBeVisible();
    } else if (id.startsWith("run")) {
      // The way the operator opens it: Emergency Contact in the rail, then Start a run, then choose the scan.
      await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: "Emergency Contact", exact: true }).click();
      await page.getByRole("button", { name: "Start run", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Start run", exact: true });
      await dialog.locator('input[type="file"]').setInputFiles({ name: "Scan_0412.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF") });
      await expect(dialog.getByText("Scan_0412.pdf").first()).toBeVisible();
      if (id === "run-sheets-open") await dialog.getByRole("button", { name: "Onboarding hires worksheets, 2 worksheets" }).click();
      if (id === "run-sheets-add" || id === "run-sheets-search" || id === "run-sheets-nopins") await dialog.getByRole("button", { name: "Add spreadsheet" }).click();
      if (id === "run-sheets-search") await page.getByRole("textbox", { name: "Find a spreadsheet" }).fill("sheet");
      if (id === "run-sheets-nopins") await expect(page.getByText("Pin spreadsheets in Spreadsheets to list them here.")).toBeVisible();
      if (id === "run-sheets-fix") await expect(dialog.getByText("Aug 17 hires · Employee ID")).toBeVisible();
      if (id === "run-sheets") await expect(dialog.getByRole("button", { name: "Onboarding hires worksheets, 2 worksheets" })).toBeVisible();
      if (id === "run-b" || id === "run-options") {
        await dialog.getByRole("button", { name: "Continue", exact: true }).click();
        await expect(id === "run-b" ? dialog.getByText("ChatGPT is disconnected") : dialog.getByRole("button", { name: /^Start (dry|live) run$/ })).toBeVisible();
      }
    }
    if (id === "general-a-browser") await page.getByRole("combobox", { name: "Browser window" }).or(page.getByRole("button", { name: "Browser window" })).first().click();
    if (id === "general-a-date") await page.getByRole("button", { name: /Choose job end date/i }).first().click();
    if (settings === "keyboard") await expect(page.getByRole("searchbox", { name: "Search shortcuts" })).toBeVisible();
    if (settings === "activity") await expect(page.getByRole("heading", { name: "Why runs failed" })).toBeVisible();
    await settle(page);
    // Toasts stack collapsed at the top centre; only the "-open" frame hovers the stack.
    if (id === "rail-min-tooltip") { await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: "Emergency Contact", exact: true }).hover(); await expect(page.getByRole("tooltip")).toBeVisible(); }
    if (id === "toasts-open") { await page.mouse.move(WIDTH / 2, 40); await page.waitForTimeout(800); }
    await page.screenshot({ path: join(OUT, `${id}-${theme}-${WIDTH}.png`) });
    // The Run dialog body scrolls too; a second frame shows its lower half (picker note, blockers, facts).
    const body = page.locator(".launch-content");
    if (id.startsWith("run") && await body.count() && await body.evaluate(node => node.scrollHeight - node.clientHeight > 8)) {
      await body.evaluate(node => { node.scrollTop = node.scrollHeight; });
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(OUT, `${id}-${theme}-${WIDTH}-more.png`) });
    }
    // Settings pages scroll inside the window; a second full-window frame shows what sits below the fold.
    const scroller = page.locator("#dashboard-settings-content");
    if (settings && await scroller.evaluate(node => node.scrollHeight - node.clientHeight > 8)) {
      await scroller.evaluate(node => { node.scrollTop = node.scrollHeight; });
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(OUT, `${id}-${theme}-${WIDTH}-more.png`) });
    }
  }
  expect(errors).toEqual([]);
});

// Every button variant on the kit page.
test(`kit buttons ${WIDTH}`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(`${server.baseUrl.replace(/\/$/u, "")}/kit.html`, { waitUntil: "domcontentloaded" });
  const actions = page.locator("#actions");
  await expect(actions).toBeVisible();
  await page.mouse.move(1, 1);
  await actions.screenshot({ path: join(OUT, `kit-buttons-${WIDTH}.png`) });
  expect(errors).toEqual([]);
});

// The shared confirm dialog on the kit page: destructive (soft red) and non-destructive (blue), no close ×, Cancel focused and ringed, Escape closes.
for (const [trigger, title, button, destructive] of [["Open destructive dialog", "Delete this spreadsheet?", "Delete spreadsheet", true], ["Open confirm dialog", "Start a live run?", "Start live run", false]] as const) {
  test(`kit confirm dialog ${destructive ? "destructive" : "primary"} ${WIDTH}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    await page.goto(`${server.baseUrl.replace(/\/$/u, "")}/kit.html`, { waitUntil: "domcontentloaded" });
    for (const theme of ["dark", "light"] as const) {
      await page.evaluate(value => { for (const el of [document.documentElement, document.body]) { el.setAttribute("data-demo-theme", value); el.classList.toggle("dark", value === "dark"); } }, theme);
      await page.getByRole("button", { name: trigger, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: title });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Close", exact: true })).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
      expect(await dialog.getByRole("button", { name: "Cancel", exact: true }).evaluate(node => getComputedStyle(node).outlineStyle)).toBe("solid");
      await expect(dialog.getByRole("button", { name: button, exact: true })).toBeVisible();
      await page.mouse.move(1, 1);
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(OUT, `kit-confirm-${destructive ? "destructive" : "primary"}-${theme}-${WIDTH}.png`) });
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
    expect(errors).toEqual([]);
  });
}

// The two-way switch's thumb slides to the chosen side, and does not under reduced motion.
for (const motion of ["no-preference", "reduce"] as const) test(`kit switch slide ${motion}`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: motion });
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(`${server.baseUrl.replace(/\/$/u, "")}/kit.html`, { waitUntil: "domcontentloaded" });
  const group = page.getByRole("group", { name: "Theme" });
  const thumb = group.locator("span[aria-hidden]").first();
  await group.scrollIntoViewIfNeeded();
  const offset = () => thumb.evaluate(node => new DOMMatrixReadOnly(getComputedStyle(node).transform).m41);
  expect(await offset()).toBe(0);
  await group.getByText("Dark", { exact: true }).click();
  await page.waitForTimeout(70);
  const middle = await offset();
  await page.screenshot({ path: join(OUT, `kit-switch-${motion}-mid-${WIDTH}.png`), clip: await group.boundingBox() ?? undefined });
  await page.waitForTimeout(400);
  const end = await offset();
  expect(end).toBeGreaterThan(20);
  if (motion === "reduce") expect(middle).toBe(end);
  else { expect(middle).toBeGreaterThan(0); expect(middle).toBeLessThan(end); }
  await page.screenshot({ path: join(OUT, `kit-switch-${motion}-end-${WIDTH}.png`), clip: await group.boundingBox() ?? undefined });
  expect(errors).toEqual([]);
});

// Enter continues in the Run dialog (starts on the last step unless disabled); Shift+Enter keeps its newline in a textbox.
test("run dialog keys", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&statusMock=run-options`);
  await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: "Separations", exact: true }).last().click();
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Start run", exact: true });
  const box = dialog.getByRole("textbox").first();
  await expect(dialog.getByText("Enter to continue")).toHaveCount(0);
  // Disabled (nothing typed yet): Enter does nothing and the textbox keeps its content.
  await box.press("Enter");
  await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
  await box.fill("10555001");
  await box.press("Shift+Enter");
  await box.pressSequentially("10000002");
  await expect(box).toHaveValue("10555001\n10000002");
  await expect(dialog.getByText("Enter to continue")).toBeVisible();
  await box.press("Enter");
  await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
  await expect(dialog.getByText("Enter to start")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^Start (dry|live) run$/ })).toBeEnabled();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});

// Priority follows the run's size (ticked for one person, unticked for several) until the operator changes it; the footer names it only when ticked.
test("run dialog priority", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  for (const [workflow, text, ticked] of [["Separations", "48216", true], ["Separations", "48216, 48220", false], ["Person Lookup", "10000001", true], ["Person Lookup", "10000001; 10000002", false]] as const) {
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&statusMock=run-options`);
    await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: workflow, exact: true }).last().click();
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Start run", exact: true });
    await dialog.getByRole("textbox").first().fill(text);
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    const box = dialog.getByRole("switch", { name: "Priority", exact: true });
    const footer = dialog.locator("footer");
    await expect(box).toBeChecked({ checked: ticked });
    await expect(footer).not.toContainText(/Interactive|Bulk/);
    if (ticked) await expect(footer).toContainText("Priority"); else await expect(footer).not.toContainText("Priority");
    await box.dispatchEvent("click");
    await expect(box).toBeChecked({ checked: !ticked });
    if (ticked) await expect(footer).not.toContainText("Priority"); else await expect(footer).toContainText("Priority");
  }
  expect(errors).toEqual([]);
});

// Ticking Customize steps adds the Steps step after Options, enables its tab, and moves the start button there, for every workflow in the rail, Person Lookup included.
test("customize steps every workflow", async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
  const reached: string[] = [];
  for (const name of ["Person Lookup", "Separations", "I-9 Check", "Onboarding", "Oath Signature", "Oath Upload", "Emergency Contact", "Work-Study", "Kronos Pay Rule"]) {
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&statusMock=run-options`);
    await rail.getByRole("button", { name, exact: true }).last().click();
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Start run", exact: true });
    await expect(dialog.getByText("Workflow preview"), `${name}: redesigned dialog`).toBeVisible();
    const file = dialog.locator('input[type="file"]');
    if (await file.count()) await file.setInputFiles({ name: "Scan_0412.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF") });
    else await dialog.getByRole("textbox").first().fill(name === "Onboarding" ? "jordan.lee@example.com" : name === "Separations" ? "48216" : "10000001");
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    const customize = dialog.getByRole("switch", { name: "Customize steps", exact: true });
    await expect(customize, `${name}: Customize steps`).toBeVisible();
    await customize.dispatchEvent("click");
    await expect(dialog.getByRole("button", { name: "3 Steps", exact: true }), `${name}: Steps tab`).toBeEnabled();
    await expect(dialog.getByRole("button", { name: /^Start (dry|live) run$/ }), `${name}: start moved`).toHaveCount(0);
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog.getByText(/\d+ of \d+ included/), `${name}: Steps step`).toBeVisible();
    await expect(dialog.getByRole("button", { name: /^Start (dry|live) run$|^Start run$/ }), `${name}: start on Steps`).toBeVisible();
    reached.push(name);
  }
  expect(reached).toEqual(["Person Lookup", "Separations", "I-9 Check", "Onboarding", "Oath Signature", "Oath Upload", "Emergency Contact", "Work-Study", "Kronos Pay Rule"]);
  expect(errors).toEqual([]);
});

// The Input step of every workflow's Run dialog, light and dark.
for (const theme of THEMES) test(`run input every workflow @ ${theme} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, theme);
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
  for (const name of ["Person Lookup", "Separations", "I-9 Check", "Onboarding", "Oath Signature", "Oath Upload", "Emergency Contact", "Work-Study", "Kronos Pay Rule"]) {
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&statusMock=run-options`);
    await page.addStyleTag({ content: ".hub-assistant-launcher { display: none !important; }" });
    await rail.getByRole("button", { name, exact: true }).last().click();
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Start run", exact: true });
    await expect(dialog.getByText("Workflow preview")).toBeVisible();
    await settle(page);
    await page.screenshot({ path: join(OUT, `run-input-${name.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}-${theme}-${WIDTH}.png`) });
  }
  expect(errors).toEqual([]);
});

// The shared search field on the kit page: a 34px pill, and the 28px size inside a dropdown menu.
test(`kit search ${WIDTH}`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(`${server.baseUrl.replace(/\/$/u, "")}/kit.html`, { waitUntil: "domcontentloaded" });
  for (const theme of ["dark", "light"] as const) {
    await page.evaluate(value => { for (const el of [document.documentElement, document.body]) { el.setAttribute("data-demo-theme", value); el.classList.toggle("dark", value === "dark"); } }, theme);
    const field = page.getByRole("searchbox", { name: "Search the specimen" });
    await field.scrollIntoViewIfNeeded();
    expect(await field.evaluate(node => Math.round(node.closest('[data-slot="search-field-group"]')?.getBoundingClientRect().height ?? 0))).toBe(32);
    expect(await page.getByRole("button", { name: "Tags", exact: true }).evaluate(node => Math.round(node.getBoundingClientRect().height))).toBe(28);
    await page.getByRole("button", { name: "Tags", exact: true }).click();
    const menuField = page.getByRole("searchbox", { name: "Find a tag" });
    await expect(menuField).toBeVisible();
    await page.waitForTimeout(500);
    expect(Math.abs(await menuField.evaluate(node => node.closest('[data-slot="search-field-group"]')?.getBoundingClientRect().height ?? 0) - 28)).toBeLessThanOrEqual(1);
    await page.mouse.move(1, 1);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, `kit-search-${theme}-${WIDTH}.png`) });
    await page.keyboard.press("Escape");
  }
  expect(errors).toEqual([]);
});

// The one menu style on the kit page (plain, icons, sections, two-line) and the one row size, light and dark.
test(`kit menus and rows ${WIDTH}`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(`${server.baseUrl.replace(/\/$/u, "")}/kit.html`, { waitUntil: "domcontentloaded" });
  for (const theme of ["dark", "light"] as const) {
    await page.evaluate(value => { for (const el of [document.documentElement, document.body]) { el.setAttribute("data-demo-theme", value); el.classList.toggle("dark", value === "dark"); } }, theme);
    for (const name of ["Plain list", "With icons", "With sections", "Two-line items"]) {
      const trigger = page.getByRole("button", { name, exact: true });
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click();
      await expect(page.getByRole("menu")).toBeVisible();
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(OUT, `kit-menu-${name.toLowerCase().replace(/\W+/gu, "-")}-${theme}-${WIDTH}.png`) });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toBeHidden();
    }
    const rows = page.getByRole("region", { name: "One-line and two-line rows" });
    await rows.scrollIntoViewIfNeeded();
    await page.mouse.move(1, 1);
    await page.screenshot({ path: join(OUT, `kit-rows-${theme}-${WIDTH}.png`) });
  }
  expect(errors).toEqual([]);
});

// Every Settings page, to audit that they share the row tokens.
for (const theme of THEMES) test(`settings pages @ ${theme} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, theme);
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  for (const id of ["general", "activity", "keyboard"]) {
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&settings=${id}${id === "general" ? "&statusMock=general-a" : id === "activity" ? "" : "&statusMock=general-a"}`);
    await expect(page.getByRole("navigation", { name: "Settings sections", exact: true })).toBeVisible();
    await page.addStyleTag({ content: ".hub-assistant-launcher { display: none !important; }" });
    await settle(page);
    await page.screenshot({ path: join(OUT, `settings-${id}-${theme}-${WIDTH}.png`) });
    const scroller = page.locator("#dashboard-settings-content");
    if (await scroller.evaluate(node => node.scrollHeight - node.clientHeight > 8)) {
      await scroller.evaluate(node => { node.scrollTop = node.scrollHeight; });
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(OUT, `settings-${id}-${theme}-${WIDTH}-more.png`) });
    }
  }
  expect(errors).toEqual([]);
});

// Analytics states: the open Workflows row, both toolbar menus, and the hover card on every chart (the Assistant charts after scrolling to each).
for (const theme of THEMES) test(`analytics states @ ${theme} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, theme);
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&settings=activity`);
  await expect(page.getByRole("heading", { name: "Why runs failed" })).toBeVisible();
  const shot = async (name: string) => { await page.waitForTimeout(300); await page.screenshot({ path: join(OUT, `analytics-${name}-${theme}-${WIDTH}.png`) }); };
  const scroller = page.locator("#dashboard-settings-content");
  const scrollTo = (top: number) => scroller.evaluate((node, value) => { node.scrollTop = value; }, top);
  await shot("top");
  for (let top = 640, n = 1; n < 8; top += 640, n++) {
    await scrollTo(top);
    await shot(`page-${n}`);
    if (await scroller.evaluate(node => node.scrollTop + node.clientHeight >= node.scrollHeight - 2)) break;
  }
  await scrollTo(0);
  await page.getByRole("button", { name: "Custom…" }).click();
  await shot("menu-custom");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /By workflow/ }).click();
  await shot("menu-workflow");
  await page.getByRole("menuitemradio", { name: "Separations" }).dispatchEvent("click");
  await expect(page.getByRole("button", { name: "Separations" }).first()).toBeVisible();
  await shot("filtered");
  await page.getByRole("button", { name: "Separations" }).first().click();
  await page.getByRole("menuitemradio", { name: "All workflows" }).dispatchEvent("click");
  const tip = page.locator(".ds-chart-tip");
  await page.getByRole("img", { name: /^Wed 23: Done/ }).hover();
  await expect(tip).toBeVisible();
  await shot("hover-runs");
  await page.mouse.move(1, 1);
  await expect(tip).toHaveCount(0);
  await page.getByRole("button", { name: "Show Separations details" }).click();
  await scrollTo(420);
  await shot("workflows-open");
  // Every chart: scroll it fully into view, hover a day and check the card stays inside its chart.
  const hoverChart = async (name: string, figure: string, day: RegExp) => {
    await page.getByRole("figure", { name: figure }).evaluate(node => node.scrollIntoView({ block: "center" }));
    await page.getByRole("img", { name: day }).hover();
    await expect(tip).toBeVisible();
    const inside = await tip.evaluate(node => { const box = node.getBoundingClientRect(), card = node.closest("figure")!.getBoundingClientRect(); return box.left >= card.left && box.right <= card.right && box.top >= card.top && box.bottom <= card.bottom; });
    expect(inside, `${name} card inside its chart`).toBe(true);
    await shot(`hover-${name}`);
    await page.mouse.move(1, 1);
  };
  await hoverChart("time", "Typical time per day", /^Thu 24: Separations/);
  // One period control drives every chart: 30d turns each into month days.
  await scrollTo(0);
  await page.getByRole("group", { name: "Report period" }).getByText("30d").click();
  await hoverChart("runs-30d", "Runs per day", /^Sep 23: Done/);
  await expect(tip).toHaveCount(0);
  await page.getByRole("group", { name: "Report period" }).getByText("7d").click();
  // Keyboard focus on a day shows the same card; arrow keys move on, Escape hides it.
  await page.getByRole("img", { name: /^Mon 21: Done/ }).focus();
  await expect(tip).toContainText("Sep 21, 2026");
  await page.keyboard.press("ArrowRight");
  await expect(tip).toContainText("Sep 22, 2026");
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);
  expect(errors).toEqual([]);
});

// General's toggles and pickers on the mock fixtures; served Account and Subscription controls are covered in settings-served-pages.test.ts.
test("general interactions", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&settings=general&statusMock=general-a`);
  await expect(page.getByRole("group", { name: "General", exact: true })).toBeVisible();
  for (const name of ["Downloads", "Job end date", "Theme", "Animations", "Browser window"]) await expect(page.getByRole("group", { name: "General", exact: true }).getByText(name, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Run without a browser window")).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "Full access" })).toHaveCount(0);
  await expect(page.getByText("Default permissions")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Change Downloads", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

// Under any statusMock, every sidebar page shows its mock design; old and new links resolve.
test("sidebar click-through shows the mock pages", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await serveSettings(page, "dark");
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&statusMock=general-a`);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const nav = page.locator("nav.settings-panel-nav");
  const marks: Record<string, () => Promise<void>> = {
    General: () => expect(page.getByRole("group", { name: "General", exact: true }).getByText("Browser window", { exact: true })).toBeVisible(),
    Account: () => expect(page.getByRole("group", { name: "Relay account", exact: true })).toBeVisible(),
    Subscription: () => expect(page.getByRole("group", { name: "Connected account" })).toBeVisible(),
    Spreadsheets: () => expect(page.getByRole("region", { name: "Spreadsheets", exact: true })).toBeVisible(),
    Explorer: () => expect(page.locator("#dashboard-settings-content")).toBeVisible(),
    Analytics: () => expect(page.getByRole("heading", { name: "Why runs failed" })).toBeVisible(),
    Keyboard: () => expect(page.getByRole("searchbox", { name: "Search shortcuts" })).toBeVisible(),
  };
  for (const [name, check] of Object.entries(marks)) {
    await nav.getByRole("link", { name, exact: true }).click();
    await check();
    await expect(page.getByText("No such settings section")).toHaveCount(0);
  }
  for (const id of ["account", "credentials", "subscription", "spreadsheets", "activity"]) {
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&settings=${id}&statusMock=general-a`);
    await expect(nav).toBeVisible();
    await expect(page.getByText("No such settings section")).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

// Logs footer states: waiting for review (Records) and failed (Rerun), with the footer tooltips; the old assistant launcher is hidden so the footer's right group shows.
for (const theme of THEMES) test(`logs footer states @ ${theme} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, theme);
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&notificationsPreview=centre&assistantOpen=0`);
  const logs = page.locator(".dashboard-log-column");
  const shot = async (name: string) => { await settle(page); await page.screenshot({ path: join(OUT, `${name}-${theme}-${WIDTH}.png`) }); };
  await page.getByRole("button", { name: "Emergency Contact" }).first().click();
  await page.getByRole("button", { name: /emergency-contacts\.pdf/ }).first().click();
  await expect(logs.getByRole("button", { name: /^Records \d+$/ })).toBeVisible();
  await shot("logs-waiting");
  await logs.getByRole("button", { name: /^Records \d+$/ }).hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, `logs-waiting-tooltip-${theme}-${WIDTH}.png`) });
  await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&notificationsPreview=centre&assistantOpen=0`);
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await page.locator(".notification-panel").getByRole("button", { name: /Run failed/ }).click();
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await expect(logs.getByRole("button", { name: "Rerun", exact: true })).toBeVisible();
  await shot("logs-failed");
  await logs.getByRole("button", { name: "Rerun", exact: true }).hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, `logs-failed-tooltip-${theme}-${WIDTH}.png`) });
  expect(errors).toEqual([]);
});

// Sidebar collapse: the queue column keeps --ds-w-queue-column and the Logs column takes every freed pixel.
for (const theme of THEMES) test(`sidebar collapse widens logs @ ${theme} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, theme);
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&notificationsPreview=centre&assistantOpen=0`);
  await page.getByRole("button", { name: "Emergency Contact" }).first().click();
  await page.getByRole("button", { name: /emergency-contacts\.pdf/ }).first().click();
  const width = (selector: string) => page.locator(selector).evaluate(node => Math.round(node.getBoundingClientRect().width));
  await expect(page.getByRole("button", { name: "Collapse sidebar", exact: true })).toBeVisible();
  await settle(page);
  const expanded = { queue: await width(".dashboard-queue-column"), logs: await width(".dashboard-log-column") };
  await page.screenshot({ path: join(OUT, `sidebar-expanded-${theme}-${WIDTH}.png`) });
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
  await settle(page);
  const collapsed = { queue: await width(".dashboard-queue-column"), logs: await width(".dashboard-log-column") };
  await page.screenshot({ path: join(OUT, `sidebar-collapsed-${theme}-${WIDTH}.png`) });
  expect(collapsed.queue).toBe(expanded.queue);
  expect(collapsed.logs - expanded.logs).toBe(312 - 56);
  expect(errors).toEqual([]);
});

// Banner audit: command results that used to be inline strips above the columns are sticky toasts; the bulk result opens in a dialog.
for (const theme of THEMES) test(`command result toasts @ ${theme} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, theme);
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&statusMock=command-results&assistantOpen=0`);
  const queueTop = () => page.locator(".dashboard-log-column").evaluate(node => Math.round(node.getBoundingClientRect().top));
  const toasts = page.locator("[data-slot=toast]");
  await expect(toasts).toHaveCount(3);
  // Toasts float over the shell: the log column keeps its 12px gutter.
  expect(await queueTop()).toBe(12);
  await settle(page);
  await page.screenshot({ path: join(OUT, `command-results-toasts-${theme}-${WIDTH}.png`) });
  await expect(toasts.locator("button")).toHaveCount(0);
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const panel = page.locator(".notification-panel");
  await expect(panel.getByText("Retry: partial result")).toBeVisible();
  await settle(page);
  await page.screenshot({ path: join(OUT, `command-results-notifications-${theme}-${WIDTH}.png`) });
  await panel.getByRole("button", { name: /Retry: partial result/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await settle(page);
  const gap = await page.getByRole("dialog").evaluate(node => Math.round(node.querySelector("[data-queue-bulk-result] button")!.getBoundingClientRect().top - document.getElementById(node.getAttribute("aria-describedby")!)!.getBoundingClientRect().bottom));
  expect(gap).toBe(16);
  await page.screenshot({ path: join(OUT, `command-results-review-${theme}-${WIDTH}.png`) });
  expect(errors).toEqual([]);
});

// A lost command response is a sticky toast that only notifies; its Priority notification opens the recovery review.
for (const theme of THEMES) test(`command unknown toast @ ${theme} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, theme);
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&statusMock=command-unknown&assistantOpen=0`);
  const toast = page.locator("[data-slot=toast]");
  await expect(toast).toHaveCount(1);
  await expect(toast.locator("button")).toHaveCount(0);
  await settle(page);
  await page.screenshot({ path: join(OUT, `command-unknown-toast-${theme}-${WIDTH}.png`) });
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const panel = page.locator(".notification-panel");
  await expect(panel.getByText("Pause all: outcome unknown")).toBeVisible();
  await settle(page);
  await page.screenshot({ path: join(OUT, `command-unknown-notification-${theme}-${WIDTH}.png`) });
  await panel.getByRole("button", { name: /Pause all: outcome unknown/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(errors).toEqual([]);
});

// Logs cards: identity review, held and failure cards, image viewer, batch member Logs.
const LOGS_OUT = process.env.LOGS_CARDS_OUT ?? OUT;
const LOGS_ONLY = process.env.LOGS_CARDS_ONLY?.split(",");
const LOGS_HEIGHT = Number(process.env.LOGS_CARDS_HEIGHT ?? 1100);
for (const theme of THEMES) test(`logs cards @ ${theme} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, theme);
  await page.setViewportSize({ width: WIDTH, height: LOGS_HEIGHT });
  await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&notificationsPreview=centre&assistantOpen=0`);
  const logs = page.locator(".dashboard-log-column");
  const shot = async (name: string) => { await settle(page); await page.screenshot({ path: join(LOGS_OUT, `${name}-${theme}-${WIDTH}.png`) }); };
  const wanted = (name: string) => LOGS_ONLY === undefined || LOGS_ONLY.includes(name);
  await page.getByRole("button", { name: "Person Lookup" }).first().click();
  const queue = page.locator(".dashboard-queue-column");
  const open = async (name: string | RegExp) => { await queue.getByText(name).first().click(); await page.waitForTimeout(400); };
  if (wanted("identity")) { await open("Waiting on identity review"); await shot("logs-identity"); }
  if (wanted("held")) { await open("EID 10333015"); await shot("logs-held"); }
  if (wanted("viewer")) {
    await open("EID 10333015");
    await logs.getByRole("button", { name: /Enlarge screenshot/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await shot("logs-viewer");
    await page.keyboard.press("Escape");
  }
  if (wanted("member")) {
    await open("EID 10480021");
    await expect(logs.getByRole("button", { name: "Pause EID 10480021" })).toBeVisible();
    await expect(logs.getByRole("button", { name: "Stop EID 10480021" })).toBeVisible();
    await shot("logs-member-running");
    await logs.getByRole("button", { name: "Stop EID 10480021" }).click();
    await expect(page.getByRole("alertdialog").or(page.getByRole("dialog"))).toBeVisible();
    await shot("logs-member-stop");
    await page.keyboard.press("Escape");
  }
  if (wanted("timeline")) {
    const stepButton = (state: string) => logs.locator(`nav[aria-label="Run timeline"] button[aria-label*="${state}"]`).first();
    const hoverFrame = async (name: string, state: string, run: string) => {
      await open(run);
      await stepButton(state).hover();
      await expect(page.getByRole("tooltip").first()).toBeVisible();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(LOGS_OUT, `logs-step-${name}-${theme}-${WIDTH}.png`) });
      await page.mouse.move(1, 1);
    };
    await hoverFrame("done", "Completed", "EID 10333015");
    await hoverFrame("waiting", "Waiting", "EID 10333015");
    await hoverFrame("pending", "Upcoming", "EID 10480021");
    await logs.locator('nav[aria-label="Run timeline"] button').first().focus();
    await expect(page.getByRole("tooltip").first()).toBeVisible();
  }
  if (wanted("failed")) { await open("EID 10555001"); await shot("logs-failed"); }
  if (wanted("parked")) { await open("EID 10777012"); await shot("logs-parked"); }
  // Answered cards keep their content; the actions become one outcome line.
  const fresh = async (row: string) => {
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&notificationsPreview=centre&assistantOpen=0`);
    await page.getByRole("button", { name: "Person Lookup" }).first().click();
    await open(row);
  };
  const outcome = logs.locator("p[data-answered]");
  if (wanted("identity-approved")) {
    await fresh("Waiting on identity review");
    await logs.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(outcome).toContainText(/^Match approved · \d\d:\d\d · Alex Rivera$/u);
    await expect(logs.locator(".log-failed-field")).toContainText("Approved");
    await shot("logs-identity-approved");
  }
  if (wanted("identity-rejected")) {
    await fresh("Waiting on identity review");
    await logs.getByRole("button", { name: /Next step/ }).click();
    await page.getByRole("menuitemradio", { name: "Reject match" }).click();
    await logs.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(outcome).toContainText(/^Match rejected · /u);
    await expect(logs.locator(".log-failed-field")).toContainText("Rejected");
    await shot("logs-identity-rejected");
  }
  if (wanted("identity-cancelled")) {
    await fresh("Waiting on identity review");
    await logs.getByRole("button", { name: "Cancel run" }).click();
    await expect(outcome).toContainText(/^Run cancelled · /u);
    await shot("logs-identity-cancelled");
  }
  if (wanted("failed-retried")) {
    await fresh("EID 10555001");
    await logs.getByRole("button", { name: "Retry search" }).click();
    await expect(outcome).toContainText(/^Retried · /u);
    await shot("logs-failed-retried");
  }
  if (wanted("failed-cancelled")) {
    await fresh("EID 10555001");
    await logs.getByRole("button", { name: "Cancel run" }).click();
    await expect(outcome).toContainText(/^Run cancelled · /u);
    await shot("logs-failed-cancelled");
  }
  if (wanted("parked-confirmed")) {
    await fresh("EID 10777012");
    await logs.getByRole("button", { name: /Answer$/ }).click();
    await page.getByRole("menuitemradio", { name: "Saved in UCPath" }).click();
    await logs.getByLabel("Transaction number").fill("T00000417");
    await logs.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(outcome).toContainText(/^Transaction confirmed · T00000417 · /u);
    await shot("logs-parked-confirmed");
  }
  expect(errors).toEqual([]);
});
