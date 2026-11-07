import { IntakeCommandRequestSchema } from "../../src/rules/commands/commands.js";
import { IntakeCommandResultWireSchema } from "../../src/models/dashboard/workbooks.js";
import { expect, type Page } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { PARITY_THEMES, installTheme } from "./helpers/capture.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { routeUrl, type AppRoute } from "./helpers/app-driver.js";
import { startIntakeAuthorityServer, INTAKE_CSV } from "../support/fixtures/dashboard/fixture-intake-authority.js";
import { defineIntakeFixtureDescriptor, INTAKE_FIXTURE_WORKFLOW_ID } from "../support/fixtures/intake-workflow-fixture.js";


async function openAuthority(page: Page, baseUrl: string, route: AppRoute) {
  await page.goto(routeUrl(baseUrl, route));
  await expect(page.locator('[data-parity-ready="true"]')).toBeVisible();
}




async function prepared(server: Awaited<ReturnType<typeof startIntakeAuthorityServer>>, csv = INTAKE_CSV) {
  let wire = (await server.authority.upload(csv)).session;
  for (const [target, column] of [["emplId", 0], ["effectiveDate", 1]] as const) {
    const response = await server.authority.post(server.authority.request(wire, "confirm-intake-mapping", { targetFieldId: target, sourceColumnId: wire.columns[column].sourceColumnId, headerFingerprint: wire.headerFingerprint }));
    expect(response.status).toBe(200); wire = await server.authority.intake.read(wire.intakeSessionId);
  }
  for (const [type, payload] of [["exclude-intake-row", { sourceRow: 2, reason: "Synthetic rejected source" }], ["validate-intake", undefined]] as const) {
    expect((await server.authority.post(server.authority.request(wire, type, payload))).status).toBe(200);
    wire = await server.authority.intake.read(wire.intakeSessionId);
  }
  return wire;
}
for (const theme of PARITY_THEMES)

test(`explicit comparison and exact recovery @ ${theme.name}`, async ({ page }) => {
  const server = await startIntakeAuthorityServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  try {
    const first = await prepared(server);
    expect((await server.authority.post(server.authority.request(first, "enqueue-intake-manifest", { dryRun: false, reviewBinding: first.reviewBinding }))).status).toBe(200);
    const prior = await server.authority.intake.read(first.intakeSessionId); expect(prior.intakeManifestId).toBeTruthy();
    server.authority.setDescriptor(defineIntakeFixtureDescriptor({ id: INTAKE_FIXTURE_WORKFLOW_ID, code: "if", contractFingerprint: "f".repeat(64), enqueue: "allow-parallel", canonicalDepartmentMaxLength: 200 }));
    let next = await prepared(server, INTAKE_CSV.replace("10998801", "10888888"));
    expect((await server.authority.post(server.authority.request(next, "confirm-intake-mapping", { targetFieldId: "department", sourceColumnId: next.columns[2].sourceColumnId, headerFingerprint: next.headerFingerprint }))).status).toBe(200);
    next = await server.authority.intake.read(next.intakeSessionId);
    expect((await server.authority.post(server.authority.request(next, "validate-intake"))).status).toBe(200);
    next = await server.authority.intake.read(next.intakeSessionId);
    await installTheme(page, theme); await page.setViewportSize({ width: 1280, height: 720 });
    await openAuthority(page, server.baseUrl, { day: FIXTURE_DAY, intake: next.intakeSessionId });
    await page.getByRole("checkbox", { name: "I confirm this reviewed plan" }).press("Space");
    await page.getByRole("tab", { name: "Rerun diff", exact: true }).press("Enter");
    await page.getByRole("textbox", { name: "Earlier import manifest" }).fill(prior.intakeManifestId ?? "");
    await page.getByRole("button", { name: "Compare import", exact: true }).press("Enter");
    const confirmation = page.getByRole("checkbox", { name: /I confirm comparison with/ });
    await expect(confirmation).not.toBeChecked(); await expect(page.getByRole("button", { name: "Start 2 runs" })).toBeDisabled();
    await expect(page.getByText("the file", { exact: true })).toBeVisible();
    await expect(page.getByText("the input schema", { exact: true })).toBeVisible();
    await expect(page.getByText("the mapping", { exact: true })).toBeVisible();
    const compared = await server.authority.intake.read(next.intakeSessionId); expect(compared.rerun?.diff.kind).toBe("changed");
    await page.reload(); await expect(confirmation).not.toBeChecked();
    await page.getByRole("tab", { name: "Rerun diff", exact: true }).press("Enter");
    await page.getByRole("button", { name: "Show full prior manifest and changed-axis hashes" }).press("Enter");
    await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: "Show full prior manifest and changed-axis hashes" })).toBeFocused();
    await confirmation.press("Space");
    const envelopes: unknown[] = [];
    const receiptReads: { url: string; body: unknown }[] = [];
    await page.route("**/api/v1/intake/*/commands/*", async route => {
      const response = await route.fetch();
      const body: unknown = await response.json();
      receiptReads.push({ url: route.request().url(), body });
      await route.fulfill({ response });
    });
    await page.route("**/api/v1/commands", async route => {
      const body: unknown = route.request().postDataJSON(); envelopes.push(body);
      const response = await route.fetch();
      if (envelopes.length === 1) await route.abort("failed"); else await route.fulfill({ response });
    });
    await page.getByRole("button", { name: "Start 2 runs" }).press("Enter");
    await expect(page.getByRole("button", { name: "Recover exact command" })).toBeVisible();
    expect((await server.authority.intake.read(next.intakeSessionId)).state).toBe("enqueued");
    await expect(page.getByRole("button", { name: "Start 2 runs" })).toBeDisabled();
    await page.getByRole("button", { name: "Recover exact command" }).press("Enter");
    await expect.poll(() => receiptReads.length).toBe(1);
    expect(envelopes).toHaveLength(1);
    expect(receiptReads).toHaveLength(1);
    const receipt = IntakeCommandResultWireSchema.parse(receiptReads[0].body);
    expect(receipt.state).toBe("recorded");
    if (receipt.state !== "recorded") throw new Error("Actual durable receipt missing");
    const submitted = IntakeCommandRequestSchema.parse(envelopes[0]);
    expect(receipt.request).toEqual({ ...submitted, requestedAt: receipt.request.requestedAt });
    expect(receipt.request.requestedAt).toBe(server.authority.clock.now().toISOString());
    expect(receiptReads[0].url).toBe(`${server.baseUrl}/api/v1/intake/${next.intakeSessionId}/commands/${receipt.request.commandId}`);
    expect(receipt.result.commandId).toBe(receipt.request.commandId);
    await expect(page.getByRole("table", { name: "Source row dispositions" })).toBeVisible();
    expect(server.authority.database.authority.runSessions.list()).toHaveLength(2);
  } finally { await server.close(); }
});
