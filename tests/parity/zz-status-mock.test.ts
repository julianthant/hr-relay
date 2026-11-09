import { expect, type Page } from "@playwright/test";
import { join } from "node:path";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer, type FixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { STATUS_MOCK_IDS, type StatusMockId } from "../../src/dashboard/surfaces/settings/status-mock/status-mock-model.js";

// Design mock renders for the status pages that leave Settings; output goes to the gitignored .work folder.
const OUT = process.env.STATUS_MOCK_OUT ?? "/Users/julianhein/Projects/hr-relay/.work/next-20261101/settings-status-mock";
const THEMES = (process.env.STATUS_MOCK_THEMES ?? "light").split(",") as ("light" | "dark")[];
const WIDTH = Number(process.env.STATUS_MOCK_WIDTH ?? 1280);
const HEIGHT = 720;
const ONLY = process.env.STATUS_MOCK_ONLY?.split(",");

const SETTINGS_PAGE: Partial<Record<StatusMockId, string>> = {
  "general-a": "general", "general-a-chatgpt-limit": "general", "general-a-chatgpt-disconnected": "general",
  "analytics-a": "activity", "analytics-b": "activity", "search-keyboard": "keyboard", "settings-storage": "storage",
};

let server: FixtureServer;
test.beforeAll(async () => { server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } }); });
test.afterAll(async () => { await server.close(); });

async function settle(page: Page) {
  await page.mouse.move(1, 1);
  await page.waitForTimeout(500);
}

for (const theme of THEMES) test(`status mock @ ${theme} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayParityTheme", value); }, theme);
  for (const id of STATUS_MOCK_IDS.filter(item => ONLY === undefined || ONLY.includes(item))) {
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    const settings = SETTINGS_PAGE[id];
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}${settings ? `&settings=${settings}` : ""}${id === "settings-storage" ? "" : `&statusMock=${id}`}`);
    if (settings) await expect(page.getByRole("navigation", { name: "Settings sections", exact: true })).toBeVisible();
    else if (!id.startsWith("signup")) await expect(page.getByRole("navigation", { name: "Workflows", exact: true })).toBeVisible();
    // A modal dialog blocks pointer clicks, so close the assistant panel through the DOM.
    await page.getByRole("button", { name: "Close assistant", exact: true }).evaluate(el => (el as HTMLElement).click(), undefined, { timeout: 3000 }).catch(() => undefined);
    await page.addStyleTag({ content: ".hub-assistant-launcher { display: none !important; }" });
    const firstToast = { toasts: "Relay is missing files", "toasts-open": "Relay is missing files", "toasts-storage": "Your disk is full", "toasts-restored": "Restored a file from the 6:30 PM backup" }[id as string];
    if (firstToast) await expect(page.getByText(firstToast)).toBeVisible();
    if (id === "queue-toolbar") {
      await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: "Emergency Contact", exact: true }).click();
      await expect(page.getByRole("button", { name: "Start a run", exact: true })).toBeVisible();
    } else if (id === "run-person-lookup" || id === "run-person-lookup-many") {
      await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: "Person Lookup", exact: true }).last().click();
      await page.getByRole("button", { name: "Start a run", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Start a run", exact: true });
      await expect(dialog.getByText("Workflow preview")).toBeVisible();
      await dialog.getByRole("textbox").first().fill(id === "run-person-lookup" ? "10000001" : "10000001; 10000002; Lee, Jordan");
      await expect(dialog.getByText("Parsed input")).toBeVisible();
    } else if (id === "run-options-many") {
      await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: "Separations", exact: true }).last().click();
      await page.getByRole("button", { name: "Start a run", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Start a run", exact: true });
      await dialog.getByRole("textbox").first().fill("48216, 48220");
      await dialog.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(dialog.getByRole("checkbox", { name: "Priority", exact: true })).not.toBeChecked();
    } else if (id === "run-steps" || id === "run-rerun-steps") {
      await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: "Separations", exact: true }).last().click();
      if (id === "run-rerun-steps") {
        await page.getByRole("button", { name: "Rerun", exact: true }).click();
        await expect(page.getByRole("dialog").getByText(/\d+ of \d+ included/)).toBeVisible();
      } else {
        await page.getByRole("button", { name: "Start a run", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Start a run", exact: true });
        await dialog.getByRole("textbox").first().fill("10555001");
        await dialog.getByRole("button", { name: "Continue", exact: true }).click();
        await dialog.getByRole("checkbox", { name: "Customize steps", exact: true }).click();
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
      await page.getByRole("button", { name: "Start a run", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Start a run", exact: true });
      await dialog.locator('input[type="file"]').setInputFiles({ name: "Scan_0412.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF") });
      await expect(dialog.getByText("Scan_0412.pdf").first()).toBeVisible();
      if (id === "run-b" || id === "run-options") {
        await dialog.getByRole("button", { name: "Continue", exact: true }).click();
        await expect(id === "run-b" ? dialog.getByText("ChatGPT is disconnected") : dialog.getByRole("button", { name: /^Start (dry|live) run$/ })).toBeVisible();
      }
    }
    if (settings === "general") await expect(page.getByText(id.endsWith("limit") ? "Usage limit reached" : id.endsWith("disconnected") ? "Disconnected" : "Working · checked 2 min ago").first()).toBeVisible();
    if (settings === "keyboard") await expect(page.getByRole("searchbox", { name: "Search shortcuts" })).toBeVisible();
    if (settings === "activity") await expect(page.getByRole("heading", { name: "Why runs failed" })).toBeVisible();
    await settle(page);
    // Toasts stack collapsed at the top centre; only the "-open" frame hovers the stack.
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
  await page.getByRole("button", { name: "Close assistant", exact: true }).evaluate(el => (el as HTMLElement).click(), undefined, { timeout: 3000 }).catch(() => undefined);
  await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: "Separations", exact: true }).last().click();
  await page.getByRole("button", { name: "Start a run", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Start a run", exact: true });
  const box = dialog.getByRole("textbox").first();
  await expect(dialog.getByText("Enter to continue")).toHaveCount(0);
  // Disabled (nothing typed yet): Enter does nothing and the textbox keeps its content.
  await box.press("Enter");
  await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
  await box.fill("10555001");
  await box.press("Shift+Enter");
  await box.pressSequentially("10555002");
  await expect(box).toHaveValue("10555001\n10555002");
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
    await page.getByRole("button", { name: "Close assistant", exact: true }).evaluate(el => (el as HTMLElement).click(), undefined, { timeout: 3000 }).catch(() => undefined);
    await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: workflow, exact: true }).last().click();
    await page.getByRole("button", { name: "Start a run", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Start a run", exact: true });
    await dialog.getByRole("textbox").first().fill(text);
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    const box = dialog.getByRole("checkbox", { name: "Priority", exact: true });
    const footer = dialog.locator("footer");
    await expect(box).toBeChecked({ checked: ticked });
    await expect(footer).not.toContainText(/Interactive|Bulk/);
    if (ticked) await expect(footer).toContainText("Priority"); else await expect(footer).not.toContainText("Priority");
    await box.click();
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
    await page.getByRole("button", { name: "Close assistant", exact: true }).evaluate(el => (el as HTMLElement).click(), undefined, { timeout: 3000 }).catch(() => undefined);
    await rail.getByRole("button", { name, exact: true }).last().click();
    await page.getByRole("button", { name: "Start a run", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Start a run", exact: true });
    await expect(dialog.getByText("Workflow preview"), `${name}: redesigned dialog`).toBeVisible();
    const file = dialog.locator('input[type="file"]');
    if (await file.count()) await file.setInputFiles({ name: "Scan_0412.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF") });
    else await dialog.getByRole("textbox").first().fill(name === "Onboarding" ? "jordan.lee@example.com" : name === "Separations" ? "48216" : "10000001");
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    const customize = dialog.getByRole("checkbox", { name: "Customize steps", exact: true });
    await expect(customize, `${name}: Customize steps`).toBeVisible();
    await customize.click();
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
    expect(await field.evaluate(node => Math.round(node.closest('[data-slot="search-field-group"]')?.getBoundingClientRect().height ?? 0))).toBe(34);
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
