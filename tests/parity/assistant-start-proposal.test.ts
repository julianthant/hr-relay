import { expect, type Page, type TestInfo } from "@playwright/test";
import { resolve } from "node:path";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { ASSISTANT_START_MULTI_PROPOSAL, ASSISTANT_START_PROPOSAL } from "../support/fixtures/dashboard/assistant-start.js";
import { assistantProposalDigest } from "../../src/dashboard/surfaces/assistant/assistant-controller-model.js";
import { ASSISTANT_UNKNOWN_NOTICE } from "../../src/dashboard/surfaces/assistant/assistant-model.js";
import { AssistantActionDecisionSchema, AssistantRequestSchema } from "../../src/models/dashboard/assistant.js";
import { captureParityPair } from "./helpers/capture.js";
import { PARITY_CHAT_ID, serveAssistantHistory } from "./helpers/assistant-history.js";
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

const PLANS = {
  "": { proposal: ASSISTANT_START_PROPOSAL, facts: [["Person", "Sample, Avery 10101010"], ["Options", "Read only"]], resolved: "Sample, Avery" },
  "multi-": { proposal: ASSISTANT_START_MULTI_PROPOSAL, facts: [["Person", "Sample, Avery 10101010"], ["Person", "Vega, Morgan 20202020"],
    ["Person", "Rivera, Alex 30303030"], ["Total", "3"], ["Options", "Read only"]], resolved: "3 people" },
} as const;
for (const theme of ["light", "dark"]) for (const [plan, { proposal, facts, resolved }] of Object.entries(PLANS)) for (const outcome of ["applied", "cancelled", "unknown"] as const) {
  test(`selected-run ${plan}start ${outcome} ${theme}`, async ({ page }, info) => {
    const decisions: unknown[] = [], requests: unknown[] = [], errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await installFrozenMonotonic(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(value => { Reflect.set(window, "relayParityTheme", value); Reflect.set(window, "relayParityMotion", false); }, theme);
    await page.route("**/api/v1/settings/chatgpt-account", route => route.fulfill({ json: {
      state: "connected", name: "Fixture Operator", email: "operator@example.edu", expiresAt: "2099-10-19T00:00:00Z", planUsage: "enabled",
    } }));
    await serveAssistantHistory(page);
    await page.route("**/api/v1/assistant/respond", route => {
      requests.push(AssistantRequestSchema.parse(route.request().postDataJSON()));
      return route.fulfill({ json: { kind: "result", result: { state: "action-proposal", proposal } } });
    });
    await page.route("**/api/v1/assistant/action", route => {
      decisions.push(AssistantActionDecisionSchema.parse(route.request().postDataJSON()));
      return outcome === "unknown" ? route.abort("failed") : route.fulfill({ json: { state: outcome, actionId: proposal.actionId } });
    });
    await page.goto(`${server.baseUrl}/?fixture=hub-served&day=${FIXTURE_DAY}&run=${FIXTURE_IDS.doneRun}`);
    const panel = page.locator("#hub-panel-assistant");
    // A click before the shell hydrates is dropped; open until the panel is shown.
    await expect(async () => { if (!await panel.isVisible()) await page.getByRole("button", { name: "Assistant", exact: true }).click(); await expect(panel).toBeVisible({ timeout: 1000 }); }).toPass();
    const field = panel.getByRole("textbox", { name: "Message Relay", exact: true });
    await expect(field).toBeEnabled(); await field.fill("start selected workflow"); await field.press("Enter");
    const card = panel.getByRole("article", { name: "Proposed Start Person Lookup", exact: true });
    await expect(card).toBeVisible();
    expect(await card.locator("dt").evaluateAll(terms => terms.map(term => [term.textContent, term.nextElementSibling?.textContent]))).toEqual(facts);
    await expect(card).toContainText("Read only");
    for (const hidden of ["Effects and stop points", "Fingerprint", "Headed", "Captures", "None", "Person Lookup ·"]) await expect(card).not.toContainText(hidden);
    const start = card.getByRole("button", { name: "Confirm", exact: true });
    await expect(start).toBeEnabled(); expect(decisions).toEqual([]);
    const selected = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.runId === FIXTURE_IDS.doneRun); expect(selected).toBeDefined();
    expect(requests).toEqual([{ conversationId: PARITY_CHAT_ID, expectedRevision: 1, messageId: expect.any(String), message: "start selected workflow", subjectRef: `run_${FIXTURE_IDS.doneRun}_${selected!.rowRevision}` }]);
    const contrast = await start.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }));
    expect(contrast.background).not.toBe(contrast.color);
    if (outcome === "applied") await capture(page, info, `${plan}proposal`, theme);
    const action = outcome === "cancelled" ? card.getByRole("button", { name: "Cancel", exact: true }) : start;
    await action.focus(); await page.keyboard.press("Enter");
    await expect.poll(() => decisions.length).toBe(1);
    expect(decisions[0]).toEqual({ chatId: proposal.chatId, actionId: proposal.actionId, revision: proposal.revision,
      ...(outcome === "cancelled" ? { decision: "cancel" } : { decision: "confirm", reviewedDigest: await assistantProposalDigest(proposal) }) });
    if (outcome === "unknown") {
      await expect(panel.getByText(ASSISTANT_UNKNOWN_NOTICE, { exact: true })).toHaveCount(1);
      await expect(card).toHaveCount(0); await expect(panel.getByRole("button", { name: /^(Confirm|Cancel)$/u })).toHaveCount(0);
      await expect(field).toBeDisabled(); await expect(panel.getByRole("button", { name: "Retry reply", exact: true })).toHaveCount(0);
      await page.keyboard.press("Enter"); expect(decisions).toHaveLength(1);
    } else {
      await expect(panel.getByLabel("Resolved proposal", { exact: true })).toContainText(outcome === "applied" ? "Started" : "Not started");
      await expect(panel.getByLabel("Resolved proposal", { exact: true })).toContainText(resolved);
      await expect(card).toHaveCount(0); await expect(field).toBeFocused();
      await expect(panel.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(0);
    }
    await capture(page, info, `${plan}${outcome}`, theme);
    await page.setViewportSize({ width: 1024, height: 720 });
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(errors).toEqual([]); expect(decisions).toHaveLength(1);
  });
}
