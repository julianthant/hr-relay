import { chooseSelect } from "./helpers/select-choice.js";
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
import { explorerGraphTotals } from "../../src/dashboard/surfaces/explorer/explorer-model.js";
import { EXPLORER_TIMELINE_BROWSER_WIRE, EXPLORER_TIMELINE_PARENT_ID } from "../fixtures/explorer-timeline-wire.js";

type Server = Awaited<ReturnType<typeof startExplorerAuthorityServer>>;
type Field = "label" | "icon" | "category";
const PERSON_LOOKUP_VERSION_LINE = "Descriptor v1";

async function expectWorkflowIdentity(page: Page, label: string, served?: ExplorerWorkflowWire): Promise<void> {
  await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
  await expect(page.getByText(PERSON_LOOKUP_VERSION_LINE)).toBeVisible();
  if (served !== undefined) {
    const totals = explorerGraphTotals(served);
    await expect(page.getByRole("complementary", { name: "Workflow context" })).toContainText(`${String(totals.nodes)} nodes`);
    await page.getByRole("button", { name: `What is this graph? — ${label}` }).click();
    await expect(page.getByText(new RegExp(`^${String(totals.reads)} reads? and ${String(totals.writes)} writes? count FIELDS`, "u"))).toBeVisible();
    await page.keyboard.press("Escape");
  }
}

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
  const workflowDetails = page.getByRole("button", { name: "Workflow details", exact: true });
  if (await workflowDetails.getAttribute("aria-expanded") !== "true") await workflowDetails.click();
  const door = page.getByRole("button", { name: `Edit workflow ${field}`, exact: true });
  await door.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole(field === "label" ? "textbox" : "combobox", { name: `Workflow ${field}`, exact: true });
  await expect(input).toBeFocused();
  if (field === "label") await input.fill(value);
  else await chooseSelect(input, value);
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
      await expectWorkflowIdentity(page, "Person Lookup", workflow(server));
      await assertShellGeometry(page, "Explorer authority graph");
      await capture(page, info, "graph");
      await page.setViewportSize({ width: 1024, height: 720 });
      await expect(page.getByRole("region", { name: "Registered workflows" })).toBeInViewport();
      await expect(page.getByRole("heading", { name: "Person Lookup", exact: true })).toBeInViewport();
      await expect(page.getByText(PERSON_LOOKUP_VERSION_LINE)).toBeInViewport();
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
      await expectWorkflowIdentity(page, "People search reviewed");
      const fresh = await browser.newContext({ viewport, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
      try {
        const independent = await fresh.newPage();
        independent.on("pageerror", error => errors.push(error.message));
        await installTheme(independent, theme);
        await gotoAppState(independent, server.baseUrl, { day: FIXTURE_DAY, explore: "person-lookup" });
        await expectWorkflowIdentity(independent, "People search reviewed");
        for (const field of fields) {
          await review(independent, field, original[field]);
          await apply(independent, server, field, original[field], ++revision);
          await closeEdit(independent, field);
        }
        expect(revision).toBe(6);
        await capture(independent, info, "fresh-context-restored");
      } finally { await fresh.close(); }
      await page.reload();
      await expectWorkflowIdentity(page, "Person Lookup");
      await page.getByRole("button", { name: "What is this graph? — Person Lookup", exact: true }).click();
      await expect(page.getByText("src/workflows/person-lookup/workflow.ts", { exact: true }).first()).toBeVisible();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Version registry", exact: true }).click();
      await expect(page).toHaveURL(/archiveView=versions/u);
      await expect(page.getByRole("region", { name: "Plan a version bump" })).toBeVisible();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("link", { name: "UI catalog", exact: true }).click();
      await expect(page.getByRole("region", { name: "Settings", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Dashboard", exact: true })).toHaveCount(1);
      const search = page.getByRole("searchbox", { name: "Search the UI catalog by id, label, system or search term" });
      await search.fill("kuali");
      const rail = page.getByRole("listbox", { name: "Catalog entries" });
      const before = await rail.getAttribute("aria-activedescendant");
      await rail.getByRole("option", { selected: true }).focus();
      await page.keyboard.press("ArrowDown");
      await expect(rail).not.toHaveAttribute("aria-activedescendant", before ?? "");
      await expect(rail.getByRole("option", { selected: true })).toBeFocused();
      const selected = rail.getByRole("option", { selected: true });
      await expect(selected).toHaveCount(1);
      const rowGaps = await rail.locator(".settings-reference-catalog-screen").evaluateAll(groups => groups.flatMap(group => {
        const rows = [...group.querySelectorAll(":scope > [role=option]")];
        return rows.slice(1).map((row, index) => row.getBoundingClientRect().top - rows[index].getBoundingClientRect().bottom);
      }));
      expect(rowGaps.length).toBeGreaterThan(1);
      expect(Math.min(...rowGaps)).toBeGreaterThanOrEqual(4);
      const hovered = selected.locator("xpath=following-sibling::*[1]");
      await hovered.hover();
      const selectedHoverGap = await selected.evaluate(element => {
        const next = element.nextElementSibling;
        if (next === null) throw new Error("selected catalog option has no adjacent hover target");
        return next.getBoundingClientRect().top - element.getBoundingClientRect().bottom;
      });
      expect(selectedHoverGap).toBeGreaterThanOrEqual(4);
      const id = await selected.getAttribute("title");
      expect(id).not.toBeNull();
      const catalogResponse = await page.request.get(`${server.baseUrl}/api/v1/ui-catalog`);
      const catalog = await catalogResponse.json() as { entries: { id: string; label: string; sourceLink: string; verification: { verifiedAt: string; fixtureEvidenceRef: string; liveReadOnlyEvidenceRef: string } }[] };
      const entry = catalog.entries.find(row => row.id === id);
      if (entry === undefined) throw new Error("selected catalog id absent from production query");
      const optionName = await selected.getAttribute("aria-label");
      expect(optionName).toContain(entry.label);
      expect(optionName).toContain(entry.id);
      const provenance = page.locator(".settings-reference-catalog-record");
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
        await page.getByRole("button", { name: "Graph and source evidence", exact: true }).click();
        await expect(page.getByText(/^unresolved: /u).first()).toBeVisible();
      } else await expect(page.getByText("The committed UI catalog could not be served", { exact: true })).toBeVisible();
      expect(server.database.authority.explorerOverrides.readAll()).toEqual([]);
      await capture(page, info, fault);
    } finally { await server.close(); expect(existsSync(server.root)).toBe(false); }
  });
}

test("E4 branch and child path controls stay keyboard-readable and launch no execution", evidence("e4-interaction", ["branch-b"]), async ({ page }, info) => {
  const server = await startExplorerAuthorityServer();
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") writes.push(`${request.method()} ${request.url()}`);
  });
  try {
    await page.route("**/api/v1/explorer", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EXPLORER_TIMELINE_BROWSER_WIRE) });
    });
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, explore: EXPLORER_TIMELINE_PARENT_ID });
    await expect(page.getByRole("heading", { name: "Branching timeline fixture", exact: true })).toBeVisible();

    const routeChoice = page.getByRole("combobox", { name: "Path preview for Select route", exact: true });
    await routeChoice.focus();
    await routeChoice.press("r");
    await expect(routeChoice).toHaveValue("Route B");
    await expect(routeChoice).toBeFocused();
    await expect(page.getByTitle("Nested timeline child steps for Call child B", { exact: true })).toBeVisible();
    await expect(page.getByTitle("Nested timeline child steps for Call child A", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Shared continuation", { exact: true })).toBeVisible();
    await expect(page.getByText("Path rejoins after Select route", { exact: true })).toBeVisible();
    await capture(page, info, "branch-b");

    const nestedDoor = page.getByTitle("Nested timeline child steps for Call child B", { exact: true }).getByRole("button").first();
    await nestedDoor.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("combobox", { name: "Path preview for Child outcome in Call child B", exact: true })).toBeHidden();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("combobox", { name: "Path preview for Child outcome in Call child B", exact: true })).toBeVisible();

    const inspect = page.getByRole("button", { name: "Inspect After B", exact: true });
    await inspect.focus();
    await page.keyboard.press("Enter");
    await chooseSelect(routeChoice, "Route A");
    await expect(page.getByRole("button", { name: "Close step inspection", exact: true })).toHaveCount(0);
    await routeChoice.focus();
    await routeChoice.press("r");
    await expect(routeChoice).toHaveValue("Route B");
    await inspect.focus();
    await page.keyboard.press("Enter");
    const close = page.getByRole("button", { name: "Close step inspection", exact: true });
    await close.click();
    await expect(inspect).toBeFocused();

    const evidenceDoor = page.getByRole("button", { name: "Graph and source evidence", exact: true });
    await evidenceDoor.click();
    const evidenceNode = page.getByRole("button", { name: /after-b/u });
    await evidenceNode.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Close step inspection", exact: true }).click();
    await expect(evidenceNode).toBeFocused();

    await routeChoice.focus();
    await page.keyboard.press("Escape");
    await expect(routeChoice).toHaveValue("Route B");
    await expect(page.getByTitle("Nested timeline child steps for Call child B", { exact: true })).toBeVisible();
    await expect(page.getByTitle("Nested timeline child steps for Call child A", { exact: true })).toHaveCount(0);
    expect(writes).toEqual([]);
  } finally { await server.close(); expect(existsSync(server.root)).toBe(false); }
});

test("unregistered deep link offers a real registered destination", evidence("unregistered", ["registered-control"]), async ({ page }, info) => {
  const server = await startExplorerAuthorityServer();
  try {
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, explore: "unregistered-workflow" });
    await expect(page.getByText('No workflow is registered as "unregistered-workflow"', { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open person-lookup", exact: true }).click();
    await expectWorkflowIdentity(page, "Person Lookup");
    await capture(page, info, "registered-control");
  } finally { await server.close(); expect(existsSync(server.root)).toBe(false); }
});

test("transaction contract stays readable and keyboard reachable at the desktop floor", async ({ page }) => {
  const server = await startExplorerAuthorityServer();
  try {
    await page.setViewportSize({ width: 1024, height: 720 });
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, explore: "separations" });
    const step = page.getByRole("button", { name: "Inspect Finalize Kuali Document" });
    await step.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Finalize Kuali Document", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Full contract" }).click();
    const dialog = page.getByRole("dialog", { name: "Finalize Kuali Document contract" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Write safety")).toHaveCount(1);
    await expect(dialog.getByText("probe→fence")).toHaveCount(1);
    await expect(dialog).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Full contract" })).toBeFocused();
    await page.getByRole("button", { name: "Close step inspection" }).click();
    await expect(step).toBeFocused();
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
