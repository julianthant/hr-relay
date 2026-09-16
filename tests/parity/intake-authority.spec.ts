import { createHash } from "node:crypto";
import writeXlsxFile from "write-excel-file/node";
import { test, expect, type Page } from "@playwright/test";
import { PARITY_DIST_DIR, ensureParityBundle } from "./helpers/bundle.js";
import { PARITY_THEMES, PARITY_VIEWPORTS, installTheme } from "./helpers/capture.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { routeUrl, type AppRoute } from "./helpers/app-driver.js";

async function openAuthority(page: Page, baseUrl: string, route: AppRoute) {
  await page.goto(routeUrl(baseUrl, route));
  await expect(page.locator('[data-parity-ready="true"]')).toBeVisible();
}
import { startIntakeAuthorityServer, INTAKE_CSV } from "./helpers/fixture-intake-authority.js";
import { defineIntakeFixtureDescriptor, INTAKE_FIXTURE_WORKFLOW_ID } from "../fixtures/intake-workflow-fixture.js";
import { IntakeSessionWireSchema } from "../../src/domain/intake/wire.js";

for (const theme of PARITY_THEMES) for (const viewport of PARITY_VIEWPORTS) {
  test(`production spreadsheet journey @ ${theme.name} @ ${viewport.name}`, { annotation: [{ type: "required-a11y-evidence", description: `intake-production-${theme.name}-${viewport.name}.a11y.yml` }] }, async ({ page }) => {
    ensureParityBundle();
    const server = await startIntakeAuthorityServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    try {
      await page.setViewportSize(viewport); await installTheme(page, theme);
      await openAuthority(page, server.baseUrl, { day: FIXTURE_DAY });
      await page.getByRole("button", { name: "Start a run", exact: true }).press("Enter");
      await page.getByRole("tab", { name: "Import a spreadsheet" }).click();
      const xlsx = theme.name === "paper-ink";
      const bytes = xlsx ? await writeXlsxFile(INTAKE_CSV.trim().split("\n").map(row => row.split(","))).toBuffer() : Buffer.from(INTAKE_CSV);
      await page.locator('input[type="file"]').setInputFiles({ name: xlsx ? "synthetic.xlsx" : "synthetic.csv", mimeType: xlsx ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv", buffer: bytes });
      await expect(page.getByRole("region", { name: "Spreadsheet intake" })).toBeVisible();
      const id = new URL(page.url()).searchParams.get("intake"); if (id === null) throw new Error("upload did not route to exact session");
      let wire = await server.authority.intake.read(id);
      expect(wire.artifact.bytes).toBe(bytes.length); expect(wire.artifact.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      for (const target of ["emplId", "effectiveDate"]) {
        const field = wire.targets.find(row => row.targetFieldId === target); if (field === undefined) throw new Error("target absent");
        const suggestion = page.getByRole("button", { name: `Bind ${wire.columns[target === "emplId" ? 0 : 1].header}`, exact: true });
        await expect(suggestion).toBeEnabled(); await suggestion.focus(); await suggestion.press("Enter");
        await expect.poll(async () => (await server.authority.intake.read(id)).bindings.find(row => row.targetFieldId === target)?.sourceColumnId).toBe(wire.columns[target === "emplId" ? 0 : 1].sourceColumnId);
      }
      await expect(page.getByRole("button", { name: "Validate", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: "Validate", exact: true }).press("Enter");
      await expect(page.getByRole("button", { name: "Start 2 runs" })).toBeDisabled();
      await page.getByRole("checkbox", { name: /I have read all/ }).press("Space");
      await expect(page.getByRole("button", { name: "Start 2 runs" })).toBeDisabled();
      await page.getByRole("button", { name: "Fix cell" }).press("Enter");
      const correction = page.getByRole("textbox", { name: "Corrected value" }); await expect(correction).toBeFocused();
      await correction.fill("10777777"); await page.getByRole("button", { name: "Re-coerce this cell" }).press("Enter");
      await expect(page.getByRole("button", { name: "Validate", exact: true })).toBeEnabled();
      await expect(page.getByRole("button", { name: "Validate", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: "Validate", exact: true }).press("Enter");
      await expect(page.getByRole("checkbox", { name: /I have read all/ })).toHaveCount(0);
      await page.getByRole("checkbox", { name: "I confirm this reviewed plan" }).press("Space");
      const start = page.getByRole("button", { name: "Start 3 runs" }); await expect(start).toBeEnabled();
      const snapshot = await page.locator("body").ariaSnapshot();
      const name = `intake-production-${theme.name}-${viewport.name}.a11y.yml`;
      test.info().annotations.push({ type: `a11y-attachment-sha256:${name}`, description: createHash("sha256").update(snapshot).digest("hex") });
      await test.info().attach(name, { body: snapshot, contentType: "text/yaml" });
      await test.info().attach("review.png", { body: await page.screenshot(), contentType: "image/png" });
      await start.press("Enter");
      await expect(page.getByRole("table", { name: "Source row dispositions" })).toBeVisible();
      wire = IntakeSessionWireSchema.parse(await (await page.request.get(`${server.baseUrl}/api/v1/intake/${id}`)).json());
      expect(wire.state).toBe("enqueued"); expect(wire.manifest?.validRows.length).toBe(3);
      for (const row of wire.manifest?.validRows ?? []) {
        const runs = server.authority.database.authority.runs.listByItem({ workflow: wire.workflow, itemId: row.itemId });
        expect(runs).toHaveLength(1); expect(runs[0].lifecycle.state).toBe("queued");
      }
      await page.reload(); await expect(page.getByRole("button", { name: "Start 3 runs" })).toBeDisabled();
      await page.getByRole("button", { name: "Close", exact: true }).press("Enter");
      await expect(page.getByRole("region", { name: "Spreadsheet intake" })).toHaveCount(0);
      expect(errors).toEqual([]);
      await test.info().attach("durable-effects.json", { body: JSON.stringify({ sessionId: id, manifest: wire.manifest, sourceSha256: wire.artifact.sha256, root: server.authority.root, externalWorkers: 0, surroundingServices: "fixture-bff" }), contentType: "application/json" });
    } finally { await server.close(); }
  });
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
for (const theme of PARITY_THEMES) test(`explicit comparison and exact recovery @ ${theme.name}`, async ({ page }) => {
  ensureParityBundle(); const server = await startIntakeAuthorityServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
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
    await expect(page.getByRole("table", { name: "Source row dispositions" })).toBeVisible();
    expect(envelopes).toHaveLength(2); expect(envelopes[1]).toEqual(envelopes[0]);
    expect(server.authority.database.authority.runSessions.list()).toHaveLength(2);
    await test.info().attach("comparison-recovered.png", { body: await page.screenshot(), contentType: "image/png" });
  } finally { await server.close(); }
});

test("canceled accepted upload stays closed; same-file retry joins the durable import", async ({ page }) => {
  ensureParityBundle(); const server = await startIntakeAuthorityServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  let accepted!: (id: string) => void; const acceptedId = new Promise<string>(resolve => { accepted = resolve; });
  try {
    await openAuthority(page, server.baseUrl, { day: FIXTURE_DAY });
    const start = page.getByRole("button", { name: "Start a run", exact: true }); await start.focus(); await start.press("Enter");
    await page.getByRole("tab", { name: "Import a spreadsheet" }).press("Enter");
    await page.route("**/api/v1/intake/files?*", async route => {
      const response = await route.fetch(); const wire = IntakeSessionWireSchema.parse(await response.json());
      accepted(wire.intakeSessionId); await held; await route.fulfill({ response });
    });
    const file = { name: "synthetic.csv", mimeType: "text/csv", buffer: Buffer.from(INTAKE_CSV) };
    await page.locator('input[type="file"]').setInputFiles(file); const id = await acceptedId;
    await page.getByRole("button", { name: "Cancel", exact: true }).press("Enter"); release();
    await expect(page.getByRole("dialog", { name: "Start a run", exact: true })).toHaveCount(0); await expect(page.getByRole("region", { name: "Spreadsheet intake" })).toHaveCount(0);
    await page.unrouteAll({ behavior: "wait" });
    await start.focus(); await start.press("Enter"); await page.getByRole("tab", { name: "Import a spreadsheet" }).press("Enter");
    await page.locator('input[type="file"]').setInputFiles(file);
    await expect(page.getByRole("region", { name: "Spreadsheet intake" })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("intake")).toBe(id);
    expect(server.authority.database.authority.runSessions.list()).toHaveLength(0);
  } finally { release(); await server.close(); }
});
