import { chooseSelect } from "./helpers/select-choice.js";
import { createHash } from "node:crypto";
import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { installRunOperationsRoutes } from "../support/fixtures/run-operations.js";
import { startSetupPreflightServer } from "./helpers/fixture-setup-preflight.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_THEMES, installTheme } from "./helpers/capture.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { dismissWorkflowWindow, failOnPageErrors } from "./helpers/reference-harness.js";

for (const theme of PARITY_THEMES) test(`Setup repair and launch share admission authority: ${theme.name}`, {
  annotation: [{ type: "required-a11y-evidence", description: `run-operations-${theme.name}.a11y.yml` }],
}, async ({ page }, info) => {
  let operations: ReturnType<typeof installRunOperationsRoutes> | undefined;
  const server = await startSetupPreflightServer("secret-missing", (app, runtime) => { operations = installRunOperationsRoutes(app, runtime); });
  try {
    const h = operations; if (h === undefined) throw new Error("missing combined operations fixture");
    const errors = failOnPageErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 }); await page.clock.setFixedTime(new Date(server.now)); await installTheme(page, theme);
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, settings: "preflight" }); await dismissWorkflowWindow(page);
    const setup = page.getByRole("region", { name: "Preflight", exact: true });
    await chooseSelect(setup.getByRole("combobox"), server.scope);
    await expect(setup).toContainText("UCPath sign-in"); await expect(setup.getByText("Blocked", { exact: true }).first()).toBeVisible();
    const rejected = await page.request.post(`${server.baseUrl}/api/v1/start-plans`, {
      headers: { origin: server.baseUrl }, data: { workflowId: server.scope, submissions: [{ emplId: "10873698" }], dryRun: false },
    });
    expect(rejected.status()).toBe(409); expect(h.runs()).toEqual([]); expect(h.publications).toBe(0); expect(h.mintedRunIdentities).toBe(0);
    h.repair();
    const recheck = setup.getByRole("button", { name: "Run preflight", exact: true }); await recheck.focus(); await page.keyboard.press("Enter");
    await expect(setup.getByText("Blocked", { exact: true })).toHaveCount(0);
    await expect(setup.locator("time")).toHaveAttribute("datetime", server.now);
    expect(server.requests.some(request => request.path === "/api/v1/preflight/rerun" && request.status === 200)).toBe(true);
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, start: true });
    const dialog = page.getByRole("dialog", { name: "Start a run", exact: true });
    await dialog.getByRole("textbox", { name: /Employee IDs/u }).fill("10873698");
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    // Person Lookup has no transaction; its ordinary queued run has no dry-run variant.
    await expect(dialog.getByRole("switch", { name: "Dry run Fill and check every step without submitting.", exact: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Preview plan", exact: true }).click();
    const submit = dialog.getByRole("button", { name: "Start 1 run", exact: true }); await expect(submit).toBeVisible();
    expect(h.runs()).toEqual([]); expect(h.publications).toBe(0); expect(h.mintedRunIdentities).toBe(0);
    await submit.focus(); await page.keyboard.press("Enter"); await expect(page.getByRole("status", { name: "Run started", exact: true })).toBeVisible(); await expect(dialog).toHaveCount(0);
    expect(h.runs()).toHaveLength(1); expect(h.publications).toBe(1); expect(h.commands).toHaveLength(1);
    const run = h.runs()[0]; expect(run.lifecycle.state).toBe("queued"); expect(run.claimGeneration).toBe(0); expect(run.envelope.dryRun).toBe(false);
    const name = `run-operations-${theme.name}.a11y.yml`; const tree = await page.locator("body").ariaSnapshot();
    info.annotations.push({ type: `a11y-attachment-sha256:${name}`, description: createHash("sha256").update(tree).digest("hex") });
    await info.attach(name, { body: tree, contentType: "text/yaml" });
    await info.attach("combined-authority", { body: JSON.stringify({ runId: run.envelope.runId, traceId: run.envelope.traceId,
      lifecycle: run.lifecycle, publications: h.publications, requests: server.requests }), contentType: "application/json" });
    expect(errors).toEqual([]);
  } finally { await page.close(); await server.close(); }
});
