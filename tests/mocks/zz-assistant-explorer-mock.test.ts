import { expect, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { AssistantActivityWireSchema, AssistantHistoryOperationSchema } from "../../src/models/dashboard/assistant.js";
import { FrontendBootstrapWireSchema, WorkflowBootstrapPrimitiveSchema } from "../../src/models/dashboard/bootstrap.js";
import { test } from "./helpers/fixtures.js";
import { MOCK_DIST_DIR } from "./helpers/bundle.js";
import { FIXTURE_START_PICKER_BOOTSTRAP, FIXTURE_START_PICKER_DAY_WIRE, FIXTURE_START_PICKER_DESCRIPTOR_HASH } from "../support/fixtures/dashboard/fixture-start.js";
import { assistantHistoryServer } from "../support/helpers/dashboard/assistant-history-server.js";
import { startFixtureServer, type FixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_ACTIVE_PROFILE_STATE } from "../support/helpers/dashboard/profiles/fixture-profile-setup.js";
import { chatGptStatusFixture } from "../support/helpers/chatgpt-status-fixture.js";
import { personLookupDescriptor } from "../support/helpers/registered-workflows.js";
import { FIXTURE_DAY, uuidOf } from "./helpers/fixture-identity.js";
import { mockOutDir } from "./helpers/out-dir.js";

// Design mock renders for the floating Sessions dock, the assistant launcher and Explorer; output goes to the gitignored .work folder.
const OUT = mockOutDir(process.env.AX_MOCK_OUT, "assistant-explorer-mock");
const THEMES = (process.env.AX_MOCK_THEMES ?? "light,dark").split(",");
const WIDTH = Number(process.env.AX_MOCK_WIDTH ?? 1280);
const ONLY = process.env.AX_MOCK_ONLY?.split(",");
test.use({ deviceScaleFactor: Number(process.env.AX_MOCK_SCALE ?? 1) });

type Frame = { id: string; query?: string; view?: Record<string, unknown>; settings?: string; act?: (page: Page) => Promise<void>; keepHover?: boolean };
const RUN = { preview: "separations", mockRun: "mock:separations:sample" };
const personLookupSearchStep = (page: Page) => page.getByRole("region", { name: "Workflow explorer preview" })
  .getByRole("heading", { name: "Search for person", exact: true });

async function pickPersonLookup(page: Page) {
  const picker = page.getByRole("combobox", { name: "Explorer workflow", exact: true });
  await picker.click();
  await page.getByRole("option", { name: "Person Lookup", exact: true }).click();
  await expect(picker).toContainText("Person Lookup");
  await expect(personLookupSearchStep(page)).toBeVisible();
}

const launcherFrames: Frame[] = [
  { id: "launcher-closed", query: "assistantOpen=0", view: RUN },
  { id: "launcher-needs", query: "assistantOpen=0&assistantNeeds=2", view: RUN },
  ...(["thinking", "working", "done", "error"] as const).map(state => ({ id: `launcher-${state}`, query: `assistantOpen=0&assistantMark=${state}`, view: RUN })),
  ...(["launcher-tooltip:Assistant", "bar-add-tooltip:Add workers", "bar-settings-tooltip:Settings", "bar-logout-tooltip:Log out"] as const).map(item => {
    const [id, name] = item.split(":");
    return { id, query: "assistantOpen=0", view: RUN, keepHover: true, act: async (page: Page) => {
      const trigger = id === "launcher-tooltip" ? page.locator("[data-assistant-launcher]") : page.getByRole("button", { name, exact: true }).first();
      await trigger.hover();
      await expect(page.getByRole("tooltip")).toBeVisible();
    } };
  }),
  { id: "launcher-open", query: "assistantOpen=1&assistantNeeds=2", view: RUN },
];
const FRAMES: Frame[] = [
  { id: "r2-open", query: "assistantOpen=1", view: RUN },
  { id: "r2-open-sessions", query: "assistantOpen=1", view: { ...RUN, sessions: true } },
  { id: "r2-history-chats", query: "assistantOpen=1", view: RUN, act: async page => { await page.getByRole("button", { name: "History", exact: true }).click(); } },
  { id: "r2-history-hover", query: "assistantOpen=1", view: RUN, keepHover: true, act: async page => { await page.getByRole("button", { name: "History", exact: true }).click(); await page.locator(".hub-chat-row").nth(1).hover(); } },
  { id: "r2-history-activity", query: "assistantOpen=1", view: RUN, act: async page => { await page.getByRole("button", { name: "History", exact: true }).click(); await page.getByRole("radio", { name: "Activity" }).check({ force: true }); } },
  { id: "r2-new-chat", query: "assistantOpen=1", view: RUN, act: async page => { await page.getByRole("button", { name: "New chat", exact: true }).click(); } },
  { id: "r2-approval-menu", query: "assistantOpen=1&assistantFullAccess=1", view: RUN, act: async page => { await page.getByRole("button", { name: "Ask before every action" }).click(); } },
  { id: "r2-full-access", query: "assistantOpen=1&assistantFullAccess=1", view: RUN, act: async page => { await page.getByRole("button", { name: "Ask before every action" }).click(); await page.getByRole("menuitemradio", { name: /Full access/u }).click(); } },
  { id: "dock-closed", query: "assistantOpen=0", view: RUN },
  { id: "dock-open", query: "assistantOpen=0", view: { ...RUN, sessions: true } },
  { id: "dock-open-assistant", query: "assistantOpen=1", view: { ...RUN, sessions: true } },
  { id: "dock-rail-collapsed", query: "assistantOpen=0", view: RUN, act: async page => { await page.locator(".workspace-rail-actions button").first().click(); } },
  { id: "dock-open-end", query: "assistantOpen=0", view: { ...RUN, sessions: true }, act: async page => { await page.locator("[data-session-strip]").evaluate(strip => { strip.scrollLeft = strip.scrollWidth; }); } },
  { id: "dock-open-rail-collapsed", query: "assistantOpen=0", view: { ...RUN, sessions: true }, act: async page => { await page.locator(".workspace-rail-actions button").first().click(); } },
  { id: "rail-footer", query: "assistantOpen=0", view: RUN },
  ...launcherFrames,
  { id: "explorer-settings", settings: "explorer", query: "assistantOpen=0", act: pickPersonLookup },
  { id: "settings-sessions-open", settings: "explorer", query: "assistantOpen=0", view: { sessions: true }, act: async page => {
    await expect(personLookupSearchStep(page)).toBeVisible();
  } },
  { id: "explorer-pick", settings: "explorer", query: "assistantOpen=0", act: async page => {
    await pickPersonLookup(page);
    await personLookupSearchStep(page).scrollIntoViewIfNeeded();
    await page.locator("main").evaluate(main => { main.scrollBy(0, 140); });
  } },
  { id: "explorer-bottom", settings: "explorer", query: "assistantOpen=0", act: async page => {
    await pickPersonLookup(page);
    await page.evaluate(() => { for (const el of document.querySelectorAll<HTMLElement>("*")) if (/auto|scroll/u.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 200) el.scrollTop = el.scrollHeight; });
  } },
  { id: "explorer-takeover", query: "assistantOpen=0&explore=person-lookup", act: pickPersonLookup },
];

let server: FixtureServer;
let history: ReturnType<typeof assistantHistoryServer> | undefined;
test.beforeAll(async () => {
  const workflows = WorkflowBootstrapPrimitiveSchema.array().parse(FIXTURE_START_PICKER_BOOTSTRAP.workflows);
  const bootstrap = FrontendBootstrapWireSchema.parse({
    ...FIXTURE_START_PICKER_BOOTSTRAP,
    workflows: workflows.map(workflow => workflow.id === personLookupDescriptor.id
      ? { ...workflow, start: { ...workflow.start, version: personLookupDescriptor.version } }
      : workflow),
  });
  server = await startFixtureServer({
    distDir: MOCK_DIST_DIR,
    bundle: { proof: "working-tree" },
    profile: {
      bootstrap,
      day: FIXTURE_START_PICKER_DAY_WIRE,
      descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
    },
  });
});
test.afterAll(async () => { await server.close(); });
test.beforeEach(async ({ context }) => {
  const account = chatGptStatusFixture({
    state: "connected", name: "Fixture Operator", email: "operator@example.test", expiresAt: "2099-10-19T00:00:00Z", planUsage: "enabled",
  });
  await context.route("**/api/v1/settings/chatgpt-account", route => route.fulfill({ json: account }));
  const activity = AssistantActivityWireSchema.parse({
    day: FIXTURE_DAY,
    rows: [
      { id: uuidOf(801), label: "Person Lookup", at: `${FIXTURE_DAY}T17:00:00Z` },
      { id: uuidOf(802), label: "Checked Smart HR", at: `${FIXTURE_DAY}T16:00:00Z` },
    ],
  });
  await context.route("**/api/v1/assistant/activity", route => route.fulfill({ json: activity }));

  if (FIXTURE_ACTIVE_PROFILE_STATE.state !== "active") throw new Error("Assistant fixture requires an active profile");
  const fixture = assistantHistoryServer(FIXTURE_ACTIVE_PROFILE_STATE.profileId);
  history = fixture;
  const conversationId = uuidOf(803);
  const seeded = await fixture.client.assistantHistoryWrite({
    operation: "import", conversationId, title: "What failed today?", draft: "", composer: "", notice: null,
    total: 1, start: 1, messages: [{ messageId: uuidOf(804), role: "assistant", text: "3 failed today" }],
  });
  if (seeded.state !== "saved") throw new Error("Assistant fixture could not seed the initial conversation");
  const other = await fixture.client.assistantHistoryWrite({
    operation: "import", conversationId: uuidOf(805), title: "Check employment", draft: "", composer: "", notice: null,
    total: 0, start: 1, messages: [],
  });
  expect(other.state).toBe("saved");
  const selected = await fixture.client.assistantHistoryWrite({ operation: "select", conversationId, expectedRevision: seeded.revision });
  expect(selected.state).toBe("saved");

  await context.route("**/api/v1/assistant/history", async route => {
    const request = route.request();
    const json = request.method() === "POST"
      ? await fixture.client.assistantHistoryWrite(AssistantHistoryOperationSchema.parse(request.postDataJSON()))
      : await fixture.client.assistantHistory();
    await route.fulfill({ json });
  });
  await context.route("**/api/v1/assistant/conversations/*", async route => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    if (!id) throw new Error("Assistant fixture conversation ID is missing");
    await route.fulfill({ json: await fixture.client.assistantConversation(id) });
  });
});
test.afterEach(() => { history?.close(); history = undefined; });

for (const theme of THEMES) test(`assistant explorer mock @ ${theme} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, theme);
  for (const frame of FRAMES.filter(item => ONLY === undefined || ONLY.includes(item.id))) {
    await page.setViewportSize({ width: WIDTH, height: 720 });
    const view = frame.view ? `&view=${encodeURIComponent(JSON.stringify(frame.view))}` : "";
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}${frame.settings ? `&settings=${frame.settings}` : ""}${view}${frame.query ? `&${frame.query}` : ""}&statusMock=general-a`);
    if (frame.settings || frame.query?.includes("explore=")) await expect(page.getByRole("heading", { name: "Explorer", exact: true })).toBeVisible();
    else await expect(page.getByRole("navigation", { name: "Workflows", exact: true })).toBeVisible();
    await frame.act?.(page);
    if (!frame.keepHover) await page.mouse.move(1, 1);
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, `${frame.id}-${theme}.png`) });
    if (frame.id === "dock-open") {
      const sizes = await page.evaluate(() => ({ dock: document.querySelector<HTMLElement>(".session-dock")?.offsetHeight, cards: [...document.querySelectorAll<HTMLElement>("[data-session-strip] article")].map(card => ({ label: card.getAttribute("aria-label"), width: card.offsetWidth, height: card.offsetHeight })) }));
      writeFileSync(join(OUT, `${frame.id}-${theme}-${WIDTH}.json`), JSON.stringify(sizes, null, 1));
    }
    await page.evaluate(() => { window.localStorage.removeItem("relay.workflow-rail.collapsed"); });
  }
  expect(errors).toEqual([]);
});

const url = (query: string) => `${server.baseUrl}/?day=${FIXTURE_DAY}&view=${encodeURIComponent(JSON.stringify(RUN))}&${query}&statusMock=general-a`;

for (const theme of THEMES) test(`assistant panel header, History and composer @ ${theme} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(20_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, theme);
  await page.setViewportSize({ width: WIDTH, height: 720 });
  await page.goto(url("assistantOpen=1"));
  await expect(page.getByRole("log", { name: "Assistant conversation" })).toContainText("3 failed today");
  const slot = page.locator("#hub-shell-assistant");
  const headerFill = () => page.evaluate(() => {
    const header = document.querySelector<HTMLElement>(".hub-slot-header:not([hidden]), #hub-panel-assistant > .hub-panel-header"), slot = document.querySelector<HTMLElement>("#hub-shell-assistant");
    const visible = [...document.querySelectorAll<HTMLElement>(".hub-slot-header, #hub-panel-assistant > .hub-panel-header")].find(element => element.offsetParent !== null) ?? header!;
    const style = getComputedStyle(visible);
    return { fill: style.backgroundColor, border: style.borderBottomWidth, slotFill: getComputedStyle(slot!).backgroundColor };
  });
  const chat = await headerFill();
  expect(chat.border).toBe("0px");
  expect(chat.fill).toBe("rgba(0, 0, 0, 0)");

  // Shape: 480px wide, 70% of the viewport height capped at 560px, 8px above the Sessions bar, 16px corners, composer measured against Codex.
  const shape = await page.evaluate(() => {
    const box = document.querySelector<HTMLElement>("#hub-shell-assistant")!.getBoundingClientRect(), dock = document.querySelector<HTMLElement>(".session-dock")!.getBoundingClientRect();
    const composer = document.querySelector<HTMLElement>("#hub-panel-assistant .hub-composer")!, send = document.querySelector<HTMLElement>("#hub-send")!.getBoundingClientRect();
    const style = getComputedStyle(composer), text = composer.querySelector("textarea")!, bar = composer.querySelector<HTMLElement>(".hub-toolbar")!.getBoundingClientRect();
    return { width: box.width, height: box.height, gapToBar: dock.top - box.bottom, radius: getComputedStyle(document.querySelector("#hub-shell-assistant")!).borderTopLeftRadius,
      composerHeight: composer.getBoundingClientRect().height, composerRadius: style.borderTopLeftRadius, composerBorder: style.borderTopWidth, composerFill: style.backgroundColor, textPadding: getComputedStyle(text).paddingTop, send: [send.width, send.height], toolbarHeight: bar.height, innerHeight };
  });
  expect(shape.width).toBe(480);
  expect(Math.abs(shape.height - Math.min(560, shape.innerHeight * 0.7))).toBeLessThanOrEqual(1);
  expect(shape.gapToBar).toBe(8);
  expect(shape.radius).toBe("16px");
  expect(shape.composerBorder).toBe("0px");
  expect(shape.send).toEqual([28, 28]);
  expect(Math.abs(shape.composerHeight - 98)).toBeLessThanOrEqual(2);
  // The model and effort are plain muted text beside Send, not a control.
  await expect(page.locator("#hub-model-text")).toHaveText("GPT-6.1 Sol · Medium");
  await expect(page.getByRole("button", { name: /^Model:/u })).toHaveCount(0);
  // Send is the filled circle even when empty: aria-disabled, never dimmed.
  const send = page.locator("#hub-send");
  await expect(send).toHaveAttribute("aria-disabled", "true");
  expect(await send.evaluate(element => getComputedStyle(element).opacity)).toBe("1");
  writeFileSync(join(OUT, `panel-measure-${theme}-${WIDTH}.json`), JSON.stringify(shape, null, 1));
  await page.screenshot({ path: join(OUT, `panel-chat-${theme}.png`) });

  // New chat starts a fresh, empty chat.
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByText("How can I help?")).toBeVisible();
  await expect(page.getByRole("log", { name: "Assistant conversation" })).not.toContainText("3 failed today");
  await expect(page.getByRole("textbox", { name: "Message Relay" })).toHaveValue("");
  await page.screenshot({ path: join(OUT, `panel-new-chat-${theme}.png`) });

  // History opens and closes with the clock; its header matches the chat header.
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "Search chats" })).toBeVisible();
  expect(await headerFill()).toEqual(chat);
  await page.screenshot({ path: join(OUT, `panel-history-chats-${theme}.png`) });
  // The search pill and the Chats/Activity toggle are both 32px.
  const bar = await page.evaluate(() => { const field = document.querySelector<HTMLElement>(".hub-history-bar [data-slot=search-field-group]")!.getBoundingClientRect(), toggle = document.querySelector<HTMLElement>(".hub-history-bar .ds-segment")!.getBoundingClientRect(); return { field: field.height, toggle: toggle.height, centres: Math.abs((field.top + field.bottom) / 2 - (toggle.top + toggle.bottom) / 2) }; });
  expect(bar.field).toBe(32);
  expect(bar.toggle).toBe(32);
  expect(bar.centres).toBeLessThanOrEqual(0.5);
  // Row actions appear on row hover or focus only, 24px with 6px corners.
  const rowIcon = page.locator(".hub-chat-row").nth(1).getByRole("button", { name: /Rename|Delete/u }).first();
  await expect(rowIcon).toHaveCSS("opacity", "0");
  await page.locator(".hub-chat-row").nth(1).hover();
  await expect(rowIcon).toHaveCSS("opacity", "1");
  expect(await rowIcon.evaluate(element => { const box = element.getBoundingClientRect(); return [box.width, box.height, getComputedStyle(element).borderTopLeftRadius]; })).toEqual([24, 24, "6px"]);
  await page.mouse.move(0, 0);
  await page.getByRole("searchbox", { name: "Search chats" }).fill("Check employment");
  await expect(page.locator(".hub-chat-open")).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Search chats" }).fill("");
  await page.getByRole("radio", { name: "Activity" }).check({ force: true });
  await expect(page.getByRole("searchbox", { name: "Search activity" })).toBeVisible();
  expect(await headerFill()).toEqual(chat);
  const activityRows = slot.locator(".hub-history .hub-transcript");
  await expect(activityRows.getByText("Person Lookup", { exact: true })).toBeVisible();
  await expect(activityRows.getByText("Checked Smart HR", { exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search activity" }).fill("lookup");
  await expect(activityRows.getByText("Person Lookup", { exact: true })).toHaveCount(1);
  await expect(activityRows.getByText("Checked Smart HR", { exact: true })).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search activity" }).fill("");
  await page.screenshot({ path: join(OUT, `panel-history-activity-${theme}.png`) });
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "Search activity" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Message Relay" })).toBeVisible();

  // Served Activity rows are read-only and Close still dismisses the panel.
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.getByRole("radio", { name: "Activity" }).check({ force: true });
  await expect(activityRows.getByRole("button")).toHaveCount(0);
  const beforeActivityClick = page.url();
  await activityRows.getByText("Checked Smart HR", { exact: true }).click();
  await expect(slot).toBeVisible();
  await expect(page).toHaveURL(beforeActivityClick);
  await page.getByRole("button", { name: "Close assistant", exact: true }).click();
  await expect(slot).toBeHidden();

  // The history row opens a chat; the approval menu offers one option until full access is allowed in Settings.
  await page.locator("[data-assistant-launcher]").click();
  await page.getByRole("button", { name: "Ask before every action" }).click();
  await expect(page.getByRole("menuitemradio")).toHaveCount(1);
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});

for (const theme of THEMES) test(`assistant full access and Ask mark @ ${theme} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(300_000); page.setDefaultTimeout(20_000);
  await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, theme);
  await page.setViewportSize({ width: WIDTH, height: 720 });
  await page.goto(url("assistantOpen=1&assistantFullAccess=1"));
  await page.getByRole("button", { name: "Ask before every action" }).click();
  await expect(page.getByRole("menuitemradio")).toHaveCount(2);
  await page.screenshot({ path: join(OUT, `approval-menu-${theme}.png`) });
  await page.getByRole("menuitemradio", { name: /Full access/u }).click();
  const full = page.getByRole("button", { name: "Full access", exact: true });
  await expect(full).toHaveText("Full access");
  await expect(full).toHaveCSS("color", theme === "dark" ? "rgb(229, 138, 79)" : "rgb(180, 86, 26)");
  await page.mouse.move(1, 1);
  await page.screenshot({ path: join(OUT, `composer-full-access-${theme}.png`) });

  // The Settings toggle turns the option off again.
  await page.goto(url("assistantOpen=0&assistantFullAccess=1&settings=general"));
  await expect(page.getByRole("switch", { name: "Full access" })).toBeChecked();
  await page.screenshot({ path: join(OUT, `settings-assistant-${theme}.png`) });
  await page.getByRole("switch", { name: "Full access" }).click();
  await expect(page.getByRole("switch", { name: "Full access" })).not.toBeChecked();

  // The Orbit mark circles slowly at idle and faster while hovered.
  await page.goto(url("assistantOpen=0&notificationsPreview=empty"));
  await expect(page.locator("[data-assistant-launcher] .assistant-mark")).toHaveAttribute("data-state", "idle");
  const satellite = page.locator("[data-assistant-launcher] .mark-spin");
  const angle = () => satellite.evaluate(element => { const match = /rotate\(([-\d.]+)deg\)/u.exec(element.style.transform); return match ? Number(match[1]) : 0; });
  const turned = async (ms: number) => { const first = await angle(); await page.waitForTimeout(ms); return ((await angle()) - first + 360) % 360; };
  const idle = await turned(500);
  expect(idle).toBeGreaterThan(5);
  await page.locator("[data-assistant-launcher]").hover();
  await page.waitForTimeout(500);
  const hover = await turned(500);
  expect(hover).toBeGreaterThan(idle * 2);
});

test("Ask mark states video", async ({ browser }) => {
  test.setTimeout(300_000);
  const context = await browser.newContext({ viewport: { width: 640, height: 360 }, recordVideo: { dir: join(OUT, "mark-video"), size: { width: 640, height: 360 } } });
  const page = await context.newPage();
  await page.addInitScript(() => { Reflect.set(window, "relayMockTheme", "dark"); });
  const states: [string, number][] = [["", 2500], ["hover", 2500], ["thinking", 2200], ["working", 2200], ["needs", 2200], ["done", 1800], ["error", 1800]];
  for (const [state, hold] of states) {
    const mark = state === "" || state === "hover" ? "" : `&assistantMark=${state === "needs" ? "needs-you" : state}`;
    if (state !== "hover") {
      await page.goto(url(`assistantOpen=0${mark}`));
      await expect(page.locator("[data-assistant-launcher]")).toBeVisible();
      await page.addStyleTag({ content: ".assistant-launcher{height:auto!important;padding:20px!important}.assistant-launcher .assistant-mark{width:80px!important;height:80px!important}" });
    } else await page.locator("[data-assistant-launcher]").hover();
    await page.waitForTimeout(hold);
  }
  await context.close();
});

const MODEL_VIEW = { profileId: "00000000-0000-4000-8000-0000000000a1", epoch: 1 };
for (const theme of THEMES) test(`assistant model and effort in Settings @ ${theme} ${WIDTH}`, async ({ page, context }) => {
  test.setTimeout(300_000); page.setDefaultTimeout(20_000);
  let preference = { slug: "gpt-6.1-sol", effort: "medium" }, revision = 0;
  await context.route("**/api/v1/assistant/models", route => route.fulfill({ json: { models: [{ slug: "gpt-6.1-sol", displayName: "GPT-6.1 Sol" }, { slug: "gpt-6.1-terra", displayName: "GPT-6.1 Terra" }] } }));
  await context.route("**/api/v1/assistant/model-preference", route => route.fulfill({ json: { ...MODEL_VIEW, revision, preference } }));
  const turns: string[] = [];
  await context.route("**/api/v1/assistant/respond", route => { turns.push(route.request().url()); return route.abort(); });
  await context.route("**/api/v1/commands", async route => {
    const command = route.request().postDataJSON() as { commandId: string; family: string; payload: typeof preference; target: { profileId: string; expectedRevision: number } };
    if (command.family !== "assistant-model-preference") return route.fallback();
    preference = command.payload; revision = command.target.expectedRevision + 1;
    await route.fulfill({ json: { state: "applied", commandId: command.commandId, affectedTargets: [{ family: "assistant-model-preference", profileId: command.target.profileId, revision }] } });
  });
  await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, theme);
  await page.setViewportSize({ width: WIDTH, height: 720 });
  await page.goto(url("assistantOpen=0&assistantFullAccess=1&settings=general"));
  const effort = page.getByRole("combobox", { name: "Effort", exact: true });
  await expect(page.getByRole("combobox", { name: "Model", exact: true })).toHaveAttribute("data-value", "gpt-6.1-sol");
  await expect(effort).toHaveAttribute("data-value", "medium");
  const rows = await page.locator('[data-settings-path^="assistant."], [data-settings-path="chatgpt.account"]').evaluateAll(items => items.map(item => ({ path: item.getAttribute("data-settings-path"), height: Math.round(item.getBoundingClientRect().height) })));
  writeFileSync(join(OUT, `settings-assistant-rows-${theme}-${WIDTH}.json`), JSON.stringify(rows, null, 1));
  await page.screenshot({ path: join(OUT, `settings-assistant-group-${theme}-${WIDTH}.png`) });
  await effort.click();
  await page.screenshot({ path: join(OUT, `settings-assistant-effort-open-${theme}-${WIDTH}.png`) });
  await page.getByRole("option", { name: "High", exact: true }).click();
  await expect(effort).toHaveAttribute("data-value", "high");
  await expect.poll(() => preference.effort).toBe("high");
  expect(turns).toEqual([]);
  // The pick survives a reload and shows in the composer.
  await page.goto(url("assistantOpen=0&assistantFullAccess=1&settings=general"));
  await expect(page.getByRole("combobox", { name: "Effort", exact: true })).toHaveAttribute("data-value", "high");
  await page.goto(url("assistantOpen=1"));
  await expect(page.locator("#hub-model-text")).toHaveText("GPT-6.1 Sol · High");
  await page.mouse.move(1, 1);
  await page.screenshot({ path: join(OUT, `composer-changed-model-${theme}-${WIDTH}.png`) });
});
