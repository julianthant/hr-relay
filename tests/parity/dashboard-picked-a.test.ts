import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { resolve } from "node:path";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { pickedRunWorld, pickedSignupState, PICKED_RUN_STATES, PICKED_SAFETY_STATES, PICKED_SIGNUP_STATES } from "../support/helpers/dashboard/picked-dashboard.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installFrozenMonotonic } from "./helpers/app-driver.js";
import { captureParityPair } from "./helpers/capture.js";
import { attachShellA11y } from "./helpers/shell-proof.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";

async function prepare(page: Page, theme: "light" | "dark") {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installFrozenMonotonic(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(theme => { localStorage.setItem("rebuild-demo.theme", theme); localStorage.setItem("relay.animations", "off"); }, theme);
}
async function capture(page: Page, info: TestInfo, state: string, theme: string, descriptorHash: string = FIXTURE_DESCRIPTOR_HASH) {
  const evidence = `picked-a-${state}-${theme}.a11y.yml`;
  await captureParityPair(page, resolve("tests/parity/references"), { stateId: `picked-a-${state}`, theme,
    viewport: "1280x720", adapter: "fixture", fixtureId: "picked-dashboard-a", descriptorHash,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default" });
  await attachShellA11y(page, info, evidence);
}

for (const theme of ["light", "dark"] as const) {
  for (const state of [...PICKED_RUN_STATES, ...PICKED_SAFETY_STATES]) {
    test(`picked A ${state} ${theme}`, { annotation: [{ type: "required-a11y-evidence", description: `picked-a-${state}-${theme}.a11y.yml` }] }, async ({ page }, info) => {
      const world = pickedRunWorld(state);
      const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, dayWire: world.day,
        profile: { bootstrap: world.bootstrap, day: world.day, descriptorHash: world.day.descriptorHash } });
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      try {
        await prepare(page, theme);
        await page.route("**/api/v1/application-lifecycle", route => route.fulfill({ json: world.lifecycle }));
        await page.route(`**/api/v1/runs/${world.row.runId}`, route => route.fulfill({ json: world.detail }));
        await page.route(`**/api/v1/runs/${world.row.runId}/logs`, route => route.fulfill({ json: world.logs }));
        if (world.captureSection !== undefined) await page.route(`**/api/v1/runs/${world.row.runId}/captures`, route => route.fulfill({ json: world.captureSection }));
        if (world.failureSection !== undefined) await page.route(`**/api/v1/runs/${world.row.runId}/failure`, route => route.fulfill({ json: world.failureSection }));
        for (const artifact of world.artifactIds) await page.route(`**/artifacts/v1/${artifact}`, route => route.fulfill({ contentType: "image/png", body: world.bytes }));
        await page.goto(`${server.baseUrl}/?fixture=picked-a&day=${world.day.day}&run=${world.row.runId}&view=${encodeURIComponent(JSON.stringify({ workflow: world.row.workflowId, preview: null }))}`);
        await expect(page.getByRole("region", { name: "Run logs", exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Close assistant", exact: true }).click();
        expect(world.day.queueSurfaces.filter(row => row.workflowId === "onboarding")).toHaveLength(0);
        await expect(page.getByRole("navigation", { name: "Workflows", exact: true })
          .getByLabel("0 active of 0 in Onboarding", { exact: true })).toHaveText("0 · 0");
        if (state === "quit-confirm" || state === "quitting") {
          await expect(page.getByRole("button", { name: "Pause all runs", exact: true })).toBeEnabled();
          await page.keyboard.press("Control+q");
          const dialog = page.getByRole("dialog", { name: "Pause all and quit?", exact: true });
          await expect(dialog.getByRole("list")).toHaveCount(0);
          if (state === "quitting") {
            await page.route("**/api/v1/commands", route => route.fulfill({ status: 503, json: { state: "error", code: "COMMAND_OUTCOME_UNCERTAIN", message: "Synthetic lost response", retryable: false } }));
            await dialog.getByRole("button", { name: "Pause all and quit", exact: true }).click();
            await expect(page.getByText("Relay quits after runs pause", { exact: true })).toBeVisible();
          }
        }
        if (state === "captures") {
          await expect(page.locator(".log-capture-group figure")).toHaveCount(1);
          await expect(page.locator(".log-capture-group img")).toHaveJSProperty("naturalWidth", 850);
        }
        if (state === "before-after") {
          const pair = page.locator(".log-capture-group--submit");
          await expect(pair.locator("figure")).toHaveCount(2);
          await expect(pair.locator("figcaption")).toContainText(["Before submit", "After submit"]);
          await expect(pair.locator("img").first()).toHaveJSProperty("naturalWidth", 850);
          const cards = await pair.locator("figure").evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return { top: box.top, width: box.width, height: box.height }; }));
          expect(cards[0]).toEqual(cards[1]);
        }
        if (state === "dry-run") await expect(page.getByRole("region", { name: "Full dry-run preview", exact: true })).toBeVisible();
        if (state === "pre-submit-failed") await expect(page.getByText("Submit not clicked", { exact: true })).toBeVisible();
        if (state === "post-submit-unknown") await expect(page.getByText("Write outcome unknown", { exact: true })).toBeVisible();
        if (state === "post-submit-proved") await expect(page.getByText("Browser closed first", { exact: true })).toBeVisible();
        await capture(page, info, state, theme, world.day.descriptorHash);
        expect(errors).toEqual([]);
      } finally { await server.close(); }
    });
  }
  for (const state of PICKED_SIGNUP_STATES) {
    test(`picked A sign-up ${state} ${theme}`, { annotation: [{ type: "required-a11y-evidence", description: `picked-a-signup-${state}-${theme}.a11y.yml` }] }, async ({ page }, info) => {
      const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
      const writes: string[] = [], errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("request", request => { if (request.method() !== "GET") writes.push(new URL(request.url()).pathname); });
      try {
        await prepare(page, theme);
        await page.route("**/api/v1/profile/state", route => route.fulfill({ json: pickedSignupState(state) }));
        await page.goto(`${server.baseUrl}/?fixture=picked-onboarding&onboarding=signup`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        if (state !== "details" && state !== "both-added") {
          const chips = page.locator(".method-chip");
          await expect(chips).toHaveCount(2);
          const tops = await chips.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
          expect(tops[0]).toBe(tops[1]);
          if (state === "cancel-confirm") {
            await page.getByRole("button", { name: "Cancel sign-up", exact: true }).click();
            await expect(page.getByRole("dialog", { name: "Cancel sign-up?", exact: true })).toBeVisible();
            await expect(page.getByRole("button", { name: "Keep setting up", exact: true })).toBeFocused();
          }
        }
        await capture(page, info, `signup-${state}`, theme);
        expect(writes).toEqual([]); expect(errors).toEqual([]);
      } finally { await server.close(); }
    });
  }
}
