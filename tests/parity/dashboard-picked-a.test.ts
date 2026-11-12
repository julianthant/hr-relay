import { expect, test, type Page } from "@playwright/test";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { pickedRunWorld, pickedSignupState, PICKED_RUN_STATES, PICKED_SAFETY_STATES, PICKED_SIGNUP_STATES } from "../support/helpers/dashboard/picked-dashboard.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { expectRunningPill, installFrozenMonotonic } from "./helpers/app-driver.js";

async function prepare(page: Page, theme: "light" | "dark") {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installFrozenMonotonic(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(value => { Reflect.set(window, "relayParityTheme", value); Reflect.set(window, "relayParityMotion", false); }, theme);
}

for (const theme of ["light", "dark"] as const) {
  for (const state of [...PICKED_RUN_STATES, ...PICKED_SAFETY_STATES]) {
    test(`picked A ${state} ${theme}`, async ({ page }) => {
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
        expect(world.day.queueSurfaces.filter(row => row.workflowId === "onboarding")).toHaveLength(0);
        await expectRunningPill(page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: "Onboarding", exact: true }), 0);
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
          // Each submit capture is its own screenshot row: before above after, at the same size.
          const rows = page.locator(".log-capture-group--submit");
          await expect(rows).toHaveCount(2);
          await expect(rows.locator("figure")).toHaveCount(2);
          await expect(rows.locator("figcaption")).toContainText(["Before submit", "After submit"]);
          await expect(rows.locator("img").first()).toHaveJSProperty("naturalWidth", 850);
          const cards = await rows.locator("figure").evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return { top: box.top, width: box.width, height: box.height }; }));
          expect(cards[1].top).toBeGreaterThan(cards[0].top);
          expect({ width: cards[1].width, height: cards[1].height }).toEqual({ width: cards[0].width, height: cards[0].height });
        }
        if (state === "dry-run") await expect(page.getByRole("region", { name: "Full dry-run preview", exact: true })).toBeVisible();
        if (state === "pre-submit-failed") await expect(page.getByText("Submit not clicked", { exact: true })).toBeVisible();
        if (state === "post-submit-unknown") await expect(page.getByText("Write outcome unknown", { exact: true })).toBeVisible();
        if (state === "post-submit-proved") await expect(page.getByText("Browser closed first", { exact: true })).toBeVisible();
        expect(errors).toEqual([]);
      } finally { await server.close(); }
    });
  }
  for (const state of PICKED_SIGNUP_STATES) {
    test(`picked A sign-up ${state} ${theme}`, async ({ page }) => {
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
          await expect(page.locator(".method-list > li")).toHaveCount(2);
          if (state === "cancel-confirm") {
            await page.getByRole("button", { name: "Cancel sign-up", exact: true }).click();
            await expect(page.getByRole("dialog", { name: "Cancel sign-up?", exact: true })).toBeVisible();
            await expect(page.getByRole("button", { name: "Keep setting up", exact: true })).toBeFocused();
          }
        }
        expect(writes).toEqual([]); expect(errors).toEqual([]);
      } finally { await server.close(); }
    });
  }
}
