import { expect, type Page, type TestInfo } from "@playwright/test";
import { resolve } from "node:path";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { ASSISTANT_START_PROPOSAL } from "../support/fixtures/dashboard/assistant-start.js";
import { AssistantActionDecisionSchema, AssistantRequestSchema } from "../../src/models/dashboard/assistant.js";
import { captureParityPair } from "./helpers/capture.js";
import { attachShellA11y } from "./helpers/shell-proof.js";
import { installFrozenMonotonic } from "./helpers/app-driver.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";
import { FIXTURE_IDS, FIXTURE_DAY_WIRE } from "./helpers/fixture-queue.js";

let server: Awaited<ReturnType<typeof startFixtureServer>>;
test.beforeAll(async () => { server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } }); });
test.afterAll(async () => { if (server) await server.close(); });

async function capture(page: Page, info: TestInfo, state: string, theme: string) {
  const name = `assistant-start-${state}-${theme}.a11y.yml`;
  info.annotations.push({ type: "required-a11y-evidence", description: name });
  await attachShellA11y(page, info, name);
  await captureParityPair(page, resolve("tests/parity/references"), { stateId: `assistant-start-${state}`, theme,
    viewport: "1440x900", adapter: "fixture", fixtureId: "hub-served", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default" });
}

for (const theme of ["light", "dark"]) for (const outcome of ["applied", "cancelled", "unknown"] as const) {
  test(`selected-run start ${outcome} ${theme}`, async ({ page }, info) => {
    const decisions: unknown[] = [], requests: unknown[] = [], errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await installFrozenMonotonic(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(value => { Reflect.set(window, "relayParityTheme", value); Reflect.set(window, "relayParityMotion", false); }, theme);
    await page.route("**/api/v1/settings/chatgpt-account", route => route.fulfill({ json: {
      state: "connected", name: "Fixture Operator", email: "operator@example.edu", expiresAt: "2099-10-19T00:00:00Z", planUsage: "enabled",
    } }));
    await page.route("**/api/v1/assistant/respond", route => {
      requests.push(AssistantRequestSchema.parse(route.request().postDataJSON()));
      return route.fulfill({ json: { state: "action-proposal", proposal: ASSISTANT_START_PROPOSAL } });
    });
    await page.route("**/api/v1/assistant/action", route => {
      decisions.push(AssistantActionDecisionSchema.parse(route.request().postDataJSON()));
      return outcome === "unknown" ? route.abort("failed") : route.fulfill({ json: { state: outcome, actionId: ASSISTANT_START_PROPOSAL.actionId } });
    });
    await page.goto(`${server.baseUrl}/?fixture=hub-served&day=${FIXTURE_DAY}&run=${FIXTURE_IDS.doneRun}`);
    await page.getByRole("button", { name: "Assistant", exact: true }).click();
    const panel = page.locator("#hub-panel-assistant"), field = panel.getByRole("textbox", { name: "Message Relay", exact: true });
    await expect(field).toBeEnabled(); await field.fill("start selected workflow"); await field.press("Enter");
    const card = panel.getByRole("article", { name: "Proposed Start Person Lookup", exact: true });
    await expect(card.getByText("Name", { exact: true })).toBeVisible(); await expect(card.getByText("Avery Sample", { exact: true })).toBeVisible();
    await expect(card.getByText("EID", { exact: true })).toBeVisible(); await expect(card.getByText("10101010", { exact: true })).toBeVisible();
    await expect(card).toContainText("Read only");
    for (const hidden of ["Effects and stop points", "Fingerprint", "Headed", "Captures", "None", "Person Lookup ·"]) await expect(card).not.toContainText(hidden);
    const start = card.getByRole("button", { name: "Confirm", exact: true });
    await expect(start).toBeEnabled(); expect(decisions).toEqual([]);
    const selected = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.runId === FIXTURE_IDS.doneRun); expect(selected).toBeDefined();
    expect(requests).toEqual([{ message: "start selected workflow", subjectRef: `run_${FIXTURE_IDS.doneRun}_${selected!.rowRevision}` }]);
    const contrast = await start.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }));
    expect(contrast.background).not.toBe(contrast.color);
    if (outcome === "applied") await capture(page, info, "proposal", theme);
    const action = outcome === "cancelled" ? card.getByRole("button", { name: "Cancel", exact: true }) : start;
    await action.focus(); await page.keyboard.press("Enter");
    await expect.poll(() => decisions.length).toBe(1);
    expect(decisions[0]).toEqual({ chatId: ASSISTANT_START_PROPOSAL.chatId, actionId: ASSISTANT_START_PROPOSAL.actionId,
      revision: ASSISTANT_START_PROPOSAL.revision, decision: outcome === "cancelled" ? "cancel" : "confirm" });
    if (outcome === "unknown") {
      await expect(card).toContainText("Action outcome is unknown. Do not retry this action.");
      await expect(start).toBeDisabled(); await expect(card.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
      await expect(field).toBeDisabled(); await expect(panel.getByRole("button", { name: "Retry reply", exact: true })).toHaveCount(0);
      await page.keyboard.press("Enter"); expect(decisions).toHaveLength(1);
    } else {
      await expect(panel.getByLabel("Resolved proposal", { exact: true })).toContainText(outcome === "applied" ? "Started" : "Not started");
      await expect(panel.getByLabel("Resolved proposal", { exact: true })).toContainText("Avery Sample");
      await expect(card).toHaveCount(0); await expect(field).toBeFocused();
      await expect(panel.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(0);
    }
    await capture(page, info, outcome, theme);
    await page.setViewportSize({ width: 1024, height: 720 });
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(errors).toEqual([]); expect(decisions).toHaveLength(1);
  });
}
