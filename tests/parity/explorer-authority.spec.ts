import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { existsSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { startExplorerAuthorityServer } from "./helpers/fixture-explorer-authority.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_THEMES, PARITY_VIEWPORTS, installTheme, assertThemeApplied } from "./helpers/capture.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { assertShellGeometry } from "./helpers/geometry.js";
import { CommandRequestSchema } from "../../src/domain/commands.js";
import type { ExplorerWorkflowWire } from "../../src/domain/dashboard/explorer.js";

type Server = Awaited<ReturnType<typeof startExplorerAuthorityServer>>;
type Field = "label" | "icon" | "category";

function workflow(server: Server): ExplorerWorkflowWire {
  const row = server.read().workflows.find(w => w.id === "person-lookup");
  if (row === undefined) throw new Error("registered person-lookup missing");
  return row;
}

function evidence(prefix: string, states: readonly string[]) {
  return { annotation: states.map(name => ({ type: "required-a11y-evidence", description: `explorer-${prefix}-${name}.a11y.yml` })) };
}

async function capture(page: Page, info: TestInfo, name: string): Promise<void> {
  await page.screenshot({ path: info.outputPath(`${name}.png`), animations: "disabled" });
  const tree = await page.locator("body").ariaSnapshot();
  writeFileSync(info.outputPath(`${name}.a11y.yaml`), tree);
  const attachment = info.annotations.find(a => a.type === "required-a11y-evidence" && a.description?.endsWith(`-${name}.a11y.yml`))?.description;
  if (attachment === undefined) throw new Error(`missing static a11y declaration for ${name}`);
  info.annotations.push({ type: `a11y-attachment-sha256:${attachment}`, description: createHash("sha256").update(tree).digest("hex") });
  await info.attach(attachment, { body: tree, contentType: "text/yaml" });
}

async function review(page: Page, field: Field, value: string): Promise<void> {
  const door = page.getByRole("button", { name: `Edit workflow ${field}`, exact: true });
  await door.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole(field === "label" ? "textbox" : "combobox", { name: `Workflow ${field}`, exact: true });
  await expect(input).toBeFocused();
  if (field === "label") await input.fill(value);
  else await input.selectOption(value);
  await dialog.getByRole("textbox", { name: "Operator reason (required)" }).fill(`Review ${field} appearance`);
  await dialog.getByRole("button", { name: "Review change", exact: true }).click();
  await expect(dialog.getByRole("region", { name: "Draft review" })).toContainText(`presentation.${field}`);
  await expect(dialog.getByRole("button", { name: "Apply presentation change" })).toBeEnabled();
}

async function apply(page: Page, server: Server, field: Field, value: string, revision: number): Promise<void> {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Apply presentation change" }).click();
  await expect(dialog).toContainText("Applied and read back exactly");
  await expect(dialog).toContainText(`override r${String(revision)}`);
  await expect(dialog.getByRole("button", { name: "Apply presentation change" })).toHaveCount(0);
  expect(workflow(server)[field]).toBe(value);
  expect(workflow(server).edit.overrideRevision).toBe(revision);
  const saved = server.database.authority.explorerOverrides.read("person-lookup");
  expect(saved?.revision).toBe(revision);
  if (saved === undefined) throw new Error("successful UI has no persisted override");
  expect(server.database.authority.commandAudits.findByCommand(saved.appliedCommandId)?.result.state).toBe("applied");
}

async function closeEdit(page: Page, field: Field): Promise<void> {
  await page.getByRole("dialog").getByRole("contentinfo").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Edit workflow ${field}`, exact: true })).toBeFocused();
}

for (const viewport of PARITY_VIEWPORTS) for (const theme of PARITY_THEMES) {
  test(`${theme.name} ${viewport.name}: reviewed edits, fresh context restore, catalog/help and resize`, evidence(`${theme.name}-${viewport.name}`, ["graph", "graph-minimum", "editor-minimum", "catalog-minimum", "label-review", "label-success", "icon-review", "icon-success", "category-review", "category-success", "fresh-context-restored", "catalog-selected", "catalog-vocabulary", "keyboard-help"]), async ({ page, browser }, info) => {
    const server = await startExplorerAuthorityServer();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      expect(info.config.workers).toBeLessThanOrEqual(4);
      await page.setViewportSize(viewport);
      await installTheme(page, theme);
      await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, explore: "person-lookup" });
      await assertThemeApplied(page, theme);
      await expect(page.getByRole("heading", { name: "Person Lookup v1", exact: true })).toBeVisible();
      await assertShellGeometry(page, "Explorer authority graph");
      await capture(page, info, "graph");
      await page.setViewportSize({ width: 1024, height: 720 });
      await expect(page.getByRole("region", { name: "Registered workflows" })).toBeInViewport();
      await expect(page.getByRole("heading", { name: "Person Lookup v1", exact: true })).toBeInViewport();
      await capture(page, info, "graph-minimum");
      await page.setViewportSize(viewport);
      const original = workflow(server);
      const fields: readonly Field[] = ["label", "icon", "category"];
      let revision = 0;
      for (const field of fields) {
        const value = field === "label" ? "People search reviewed" : field === "icon" ? "Users" : "operations";
        await review(page, field, value);
        await page.setViewportSize({ width: 1024, height: 720 });
        const applyButton = page.getByRole("dialog").getByRole("button", { name: "Apply presentation change" });
        await applyButton.focus();
        await expect(applyButton).toBeInViewport();
        await expect(applyButton).toBeFocused();
        if (field === "label") await capture(page, info, "editor-minimum");
        await page.setViewportSize(viewport);
        await capture(page, info, `${field}-review`);
        await apply(page, server, field, value, ++revision);
        await capture(page, info, `${field}-success`);
        await closeEdit(page, field);
      }
      await page.reload();
      await expect(page.getByRole("heading", { name: "People search reviewed v1", exact: true })).toBeVisible();
      const fresh = await browser.newContext({ viewport, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
      try {
        const independent = await fresh.newPage();
        independent.on("pageerror", error => errors.push(error.message));
        await installTheme(independent, theme);
        await gotoAppState(independent, server.baseUrl, { day: FIXTURE_DAY, explore: "person-lookup" });
        await expect(independent.getByRole("heading", { name: "People search reviewed v1", exact: true })).toBeVisible();
        for (const field of fields) {
          await review(independent, field, original[field]);
          await apply(independent, server, field, original[field], ++revision);
          await closeEdit(independent, field);
        }
        expect(revision).toBe(6);
        await capture(independent, info, "fresh-context-restored");
      } finally { await fresh.close(); }
      await page.reload();
      await expect(page.getByRole("heading", { name: "Person Lookup v1", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "What is this graph? — Person Lookup", exact: true }).click();
      await expect(page.getByText("src/workflows/person-lookup/workflow.ts", { exact: true }).first()).toBeVisible();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Version registry", exact: true }).click();
      await expect(page).toHaveURL(/archiveView=versions/u);
      await expect(page.getByText("Versions & bumps", { exact: true }).first()).toBeVisible();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("link", { name: "UI catalog", exact: true }).click();
      await expect(page.getByRole("region", { name: "Settings", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Back to the dashboard", exact: true })).toHaveCount(1);
      const search = page.getByRole("searchbox", { name: "Search the UI catalog by id, label, system or search term" });
      await search.fill("kuali");
      const rail = page.getByRole("listbox", { name: "Catalog entries" });
      const before = await rail.getAttribute("aria-activedescendant");
      await rail.getByRole("option", { selected: true }).focus();
      await page.keyboard.press("ArrowDown");
      await expect(rail).not.toHaveAttribute("aria-activedescendant", before ?? "");
      await expect(rail.getByRole("option", { selected: true })).toBeFocused();
      const selected = rail.getByRole("option", { selected: true });
      const id = await selected.getAttribute("title");
      expect(id).not.toBeNull();
      const catalogResponse = await page.request.get(`${server.baseUrl}/api/v1/ui-catalog`);
      const catalog = await catalogResponse.json() as { entries: { id: string; sourceLink: string; verification: { verifiedAt: string; fixtureEvidenceRef: string; liveReadOnlyEvidenceRef: string } }[] };
      const entry = catalog.entries.find(row => row.id === id);
      if (entry === undefined) throw new Error("selected catalog id absent from production query");
      const provenance = page.getByRole("region", { name: "Provenance", exact: true });
      for (const fact of [entry.verification.verifiedAt, entry.verification.fixtureEvidenceRef, entry.verification.liveReadOnlyEvidenceRef, entry.sourceLink]) await expect(provenance).toContainText(fact);
      await page.setViewportSize({ width: 1024, height: 720 });
      await expect(search).toBeInViewport();
      await expect(rail).toBeInViewport();
      await capture(page, info, "catalog-minimum");
      await page.setViewportSize(viewport);
      await capture(page, info, "catalog-selected");
      await search.fill("no-matching-explorer-entry");
      await expect(page.getByText("Nothing in the catalog matches “no-matching-explorer-entry”", { exact: true })).toBeVisible();
      await search.fill("");
      await page.getByRole("tab", { name: "Rows & panels", exact: true }).click();
      await expect(page.getByRole("region", { name: "Queue row shapes" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Not served here" })).toBeAttached();
      await capture(page, info, "catalog-vocabulary");
      await page.getByRole("link", { name: "Keyboard", exact: true }).click();
      await expect(page).toHaveURL(/settings=keyboard/u);
      await expect(page.getByRole("heading", { name: "Keyboard", exact: true })).toBeVisible();
      await capture(page, info, "keyboard-help");
      expect(errors).toEqual([]);
      writeFileSync(info.outputPath("service-evidence.json"), JSON.stringify({ workers: info.config.workers,
        real: ["Explorer read/validate", "catalog query", "command ingress/service/kernel", "SQLite overrides/commands/audits"],
        synthetic: ["shell", "Settings", "Archive", "SSE"], revision, exchanges: server.exchanges() }, null, 2));
      expect(server.exchanges().filter(e => e.path === "/api/v1/commands" && e.status === 200)).toHaveLength(6);
    } finally { await server.close(); expect(existsSync(server.root)).toBe(false); }
  });
}

test("competing edit refuses stale apply and a newly reviewed restore remains usable", evidence("competing", ["competing-edit-refused"]), async ({ page }, info) => {
  const server = await startExplorerAuthorityServer();
  try {
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, explore: "person-lookup" });
    const original = workflow(server);
    await review(page, "label", "Losing edit");
    const command = CommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: "2026-09-14T12:00:00Z", requestedBy: "local-operator",
      source: "dashboard", reason: "Competing reviewed edit", family: "explorer", type: "apply-explorer-edit",
      target: { workflowId: original.id, expectedVersion: original.version, contractFingerprint: original.contractFingerprint, expectedOverrideRevision: 0 },
      payload: { changes: [{ kind: "workflow-label", value: "Winning edit" }] } });
    const response = await page.request.post(`${server.baseUrl}/api/v1/commands`, { data: command, headers: { origin: server.baseUrl } });
    expect(response.status()).toBe(200);
    await page.getByRole("button", { name: "Apply presentation change" }).click();
    await expect(page.getByRole("dialog")).toContainText("Explorer edit was not applied");
    expect(workflow(server).label).toBe("Winning edit");
    expect(workflow(server).edit.overrideRevision).toBe(1);
    await capture(page, info, "competing-edit-refused");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
    await page.reload();
    await review(page, "label", original.label);
    await apply(page, server, "label", original.label, 2);
  } finally { await server.close(); expect(existsSync(server.root)).toBe(false); }
});

for (const fault of ["failed-readback", "mismatched-readback", "lost-command-response"] as const) {
  test(`${fault} stays distinct and blocks automatic resubmission`, evidence(fault, [fault]), async ({ page }, info) => {
    const server = await startExplorerAuthorityServer();
    try {
      await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, explore: "person-lookup" });
      await review(page, "label", "Durable uncertain edit");
      if (fault === "lost-command-response") await page.route("**/api/v1/commands", async route => { await route.fetch(); await route.abort("failed"); });
      else await page.route("**/api/v1/explorer", async route => {
        if (fault === "failed-readback") { await route.abort("failed"); return; }
        const response = await route.fetch();
        const wire = await response.json() as { workflows: ExplorerWorkflowWire[] };
        await route.fulfill({ response, json: { ...wire, workflows: wire.workflows.map(w => w.id === "person-lookup" ? { ...w, label: "Mismatched readback" } : w) } });
      });
      await page.getByRole("button", { name: "Apply presentation change" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText(fault === "lost-command-response" ? "Explorer edit result is unknown" : "Explorer edit applied but unverified");
      await expect(dialog.getByRole("button", { name: "Apply presentation change" })).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: "Review change" })).toHaveCount(0);
      await expect(dialog).not.toContainText("Applied and read back exactly");
      expect(workflow(server).label).toBe("Durable uncertain edit");
      expect(workflow(server).edit.overrideRevision).toBe(1);
      await page.waitForTimeout(250);
      expect(server.exchanges().filter(e => e.path === "/api/v1/commands")).toHaveLength(1);
      await capture(page, info, fault);
    } finally { await server.close(); expect(existsSync(server.root)).toBe(false); }
  });
}

for (const fault of ["empty-registry", "unresolved-sources", "stale-catalog", "malformed-catalog"] as const) {
  test(`${fault} reports the actual unavailable state`, evidence(fault, [fault]), async ({ page }, info) => {
    const server = await startExplorerAuthorityServer(fault);
    try {
      await gotoAppState(page, server.baseUrl, fault.endsWith("catalog") ? { day: FIXTURE_DAY, settings: "ui-catalog" } : { day: FIXTURE_DAY, explore: "person-lookup" });
      if (fault === "empty-registry") {
        await expect(page.getByText("The server serves an empty registry, so there is no graph to explore.", { exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Open person-lookup", exact: true })).toHaveCount(0);
      } else if (fault === "unresolved-sources") {
        await expect(page.getByText(/^unresolved: /u).first()).toBeVisible();
      } else await expect(page.getByText("The committed UI catalog could not be served", { exact: true })).toBeVisible();
      expect(server.database.authority.explorerOverrides.readAll()).toEqual([]);
      await capture(page, info, fault);
    } finally { await server.close(); expect(existsSync(server.root)).toBe(false); }
  });
}

test("unregistered deep link offers a real registered destination", evidence("unregistered", ["registered-control"]), async ({ page }, info) => {
  const server = await startExplorerAuthorityServer();
  try {
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, explore: "unregistered-workflow" });
    await expect(page.getByText('No workflow is registered as "unregistered-workflow"', { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open person-lookup", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Person Lookup v1", exact: true })).toBeVisible();
    await capture(page, info, "registered-control");
  } finally { await server.close(); expect(existsSync(server.root)).toBe(false); }
});

test("real HTTP admission refuses hostile origin, Host, media type and actor before a valid control", async ({ page }) => {
  const server = await startExplorerAuthorityServer();
  try {
    const original = workflow(server);
    const draft = { draftVersion: 1, workflowId: original.id, baseDescriptorVersion: original.version,
      baseContractFingerprint: original.contractFingerprint, baseOverrideRevision: 0, changes: [{ kind: "workflow-label", value: "Admitted control" }] };
    for (const [headers, status, code] of [
      [{}, 403, "OPERATOR_MUTATION_ORIGIN_REFUSED"],
      [{ origin: "https://hostile.invalid" }, 403, "OPERATOR_MUTATION_ORIGIN_REFUSED"],
      [{ origin: server.baseUrl, host: "hostile.invalid" }, 403, "OPERATOR_MUTATION_ORIGIN_REFUSED"],
      [{ origin: server.baseUrl, "content-type": "text/plain" }, 415, "OPERATOR_MUTATION_MEDIA_TYPE_REFUSED"],
    ] as const) {
      const response = await page.request.post(`${server.baseUrl}/api/v1/explorer/validate`, { data: draft, headers });
      expect(response.status()).toBe(status);
      expect(await response.text()).toContain(code);
      expect(server.database.authority.explorerOverrides.readAll()).toEqual([]);
    }
    const command = { commandId: randomUUID(), requestedAt: "2026-09-14T12:00:00Z", requestedBy: "another-operator", source: "dashboard",
      reason: "Review HTTP admission", family: "explorer", type: "apply-explorer-edit", target: {
        workflowId: original.id, expectedVersion: original.version, contractFingerprint: original.contractFingerprint, expectedOverrideRevision: 0,
      }, payload: { changes: draft.changes } };
    const refused = await page.request.post(`${server.baseUrl}/api/v1/commands`, { data: command, headers: { origin: server.baseUrl } });
    expect(refused.status()).toBe(403);
    expect(await refused.text()).toContain("REQUEST_IDENTITY_REFUSED");
    expect(server.database.authority.commands.get(command.commandId)).toBeUndefined();
    expect(server.database.authority.commandAudits.findByCommand(command.commandId)).toBeUndefined();
    expect(server.database.authority.explorerOverrides.readAll()).toEqual([]);
    const validation = await page.request.post(`${server.baseUrl}/api/v1/explorer/validate`, { data: draft, headers: { origin: server.baseUrl } });
    expect(validation.status()).toBe(200);
    expect(await validation.text()).toContain("ready-to-apply");
    const applied = await page.request.post(`${server.baseUrl}/api/v1/commands`, { data: { ...command, requestedBy: "local-operator" }, headers: { origin: server.baseUrl } });
    expect(applied.status()).toBe(200);
    expect(workflow(server).label).toBe("Admitted control");
    expect(workflow(server).edit.overrideRevision).toBe(1);
  } finally { await server.close(); expect(existsSync(server.root)).toBe(false); }
});
