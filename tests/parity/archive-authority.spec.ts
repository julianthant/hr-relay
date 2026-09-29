import { expect, test, type Download, type Page, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { existsSync, writeFileSync } from "node:fs";
import { SavedArchiveDetailWireSchema, SavedArchiveIndexWireSchema, SavedRuntimeVersionIndexWireSchema } from "../../src/domain/dashboard/archive.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { assertThemeApplied, installTheme } from "./helpers/capture.js";
import { startArchiveAuthorityServer } from "./helpers/fixture-archive-authority.js";

const reviewedChanges = new WeakMap<Page, string>();
async function reviewChange(page: Page): Promise<void> {
  const pending = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith("/api/v1/commands") && (request.postDataJSON() as { type?: unknown })?.type === "plan-runtime-version");
  await page.getByRole("dialog", { name: "Plan a version bump" }).getByRole("button", { name: "Review change" }).click();
  const request = (await pending).postDataJSON() as { commandId: string };
  reviewedChanges.set(page, request.commandId);
}

async function expectReviewedCounts(page: Page, runs: number, blockers: number, archived: number, applying = false): Promise<void> {
  const review = page.getByRole("region", { name: applying ? "Version change applying" : "Reviewed version change", exact: true });
  await expect(review).toBeVisible();
  await expect.poll(async () => {
    const wire = SavedRuntimeVersionIndexWireSchema.parse(await (await page.request.get(`${new URL(page.url()).origin}/api/v1/archive/runtime-versions`)).json());
    const change = wire.changes.find(row => row.changeId === (applying ? wire.applyingChangeId : reviewedChanges.get(page)));
    return change === undefined ? null : [change.members.length, change.members.filter(member => member.state !== "terminal").length, change.completedRunIds.length];
  }).toEqual([runs, blockers, archived]);
}

async function bytes(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  if (stream === null) throw new Error("browser exposed no downloaded bytes");
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    if (!(chunk instanceof Uint8Array)) throw new Error("download returned a non-byte chunk");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function workflowName(workflowId: string): RegExp {
  return new RegExp(workflowId.split(/[-_\s]+/u).join("[\\s_-]+"), "iu");
}

async function openWorkflowFolder(page: Page, workflowId: string): Promise<void> {
  await page.getByRole("button", { name: workflowName(workflowId) }).click();
  await expect(page.getByRole("table").first()).toBeVisible();
}

async function selectSavedRun(page: Page, title: string): Promise<void> {
  await page.getByRole("table").first().getByRole("button", { name: title, exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true, level: 1 })).toBeVisible();
}

async function capture(page: Page, info: TestInfo, name: string): Promise<void> {
  await page.screenshot({ path: info.outputPath(`${name}.png`), animations: "disabled" });
  const tree = await page.locator("body").ariaSnapshot();
  const evidenceName = `${name}.a11y.yml`;
  writeFileSync(info.outputPath(evidenceName), tree);
  const declaration = info.annotations.find(annotation =>
    annotation.type === "required-a11y-evidence" && annotation.description === evidenceName);
  if (declaration === undefined) throw new Error(`missing static a11y declaration for ${name}`);
  info.annotations.push({
    type: `a11y-attachment-sha256:${evidenceName}`,
    description: createHash("sha256").update(tree).digest("hex"),
  });
  await info.attach(evidenceName, { body: tree, contentType: "text/yaml" });
}

function evidence(names: readonly string[]) {
  return { annotation: names.map(name => ({ type: "required-a11y-evidence", description: `${name}.a11y.yml` })) };
}

for (const view of [
  { viewport: { width: 1024, height: 768 }, theme: { name: "graphite-warm", attribute: "dark" } },
  { viewport: { width: 1024, height: 720 }, theme: { name: "paper-ink", attribute: "light" } },
] as const) {
  test(`${view.theme.name} real Archive browse, export, image, version review and zoom`,
    evidence([`${view.theme.name}-image-open`, `${view.theme.name}-versions-zoom125`]), async ({ page }, info) => {
    const server = await startArchiveAuthorityServer();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.setViewportSize(view.viewport);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await installTheme(page, view.theme);
      const indexResponse = await page.request.get(`${server.baseUrl}/api/v1/archive/reports?limit=50`);
      expect(indexResponse.status()).toBe(200);
      const index = SavedArchiveIndexWireSchema.parse(await indexResponse.json());
      expect(index.items).toHaveLength(1);
      const report = index.items[0];
      const detailResponse = await page.request.get(`${server.baseUrl}/api/v1/archive/reports/${server.runId}`);
      const detail = SavedArchiveDetailWireSchema.parse(await detailResponse.json());
      expect(detail.state).toBe("available");
      if (detail.state !== "available") throw new Error("real Archive seed has no saved report");

      await gotoAppState(page, server.baseUrl, { day: server.day, archive: "" });
      await assertThemeApplied(page, view.theme);
      const workflow = page.getByRole("button", { name: workflowName(report.workflow) });
      await workflow.click();
      const titleFilter = page.getByRole("textbox", { name: "Search all public archive fields" });
      await titleFilter.fill("does-not-match");
      await expect(page.getByRole("cell", { name: /No saved reports match this scope/ })).toBeVisible();
      await titleFilter.fill(report.title);
      await expect(titleFilter).toHaveValue(report.title);
      await expect(page.getByRole("table").first()).toBeVisible();
      await selectSavedRun(page, report.title);
      await expect(page).toHaveURL(new RegExp(`archive=${server.runId}`, "u"));
      const article = page.getByRole("article", { name: "Saved archive report" });
      await expect(article).toBeVisible();

      const exportPending = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export run", exact: true }).click();
      await page.getByRole("button", { name: "JSON", exact: true }).click();
      const exported = await exportPending;
      expect(exported.suggestedFilename()).toBe(`archive-${server.runId}.json`);
      expect(JSON.parse((await bytes(exported)).toString("utf8"))).toEqual(detail);

      await article.getByRole("button", { name: "Retained files", exact: true }).click();
      const imageLink = article.getByRole("link", { name: `Download ${server.file.name}`, exact: true });
      const nativePending = page.waitForEvent("download");
      await imageLink.click();
      expect(await bytes(await nativePending)).toEqual(server.bytes);
      const inspect = article.getByRole("button", { name: `Inspect ${server.file.name}`, exact: true });
      await inspect.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: server.file.name, exact: true });
      await expect(dialog.getByRole("img", { name: server.file.name })).toBeVisible();
      await capture(page, info, `${view.theme.name}-image-open`);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(inspect).toBeFocused();

      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`archive=${server.runId}`, "u"));
      await expect(article).toBeVisible();
      await page.goBack();
      await expect.poll(() => { const params = new URL(page.url()).searchParams; return [params.get("archive"), params.get("archiveDashboard"), params.get("archiveWorkflow")]; }).toEqual(["", "unrecorded", "person-lookup"]);
      await page.goForward();
      await expect(page).toHaveURL(new RegExp(`archive=${server.runId}`, "u"));
      await expect(article).toBeVisible();
      await page.goForward();
      await expect(article.getByRole("button", { name: "Retained files", exact: true })).toHaveAttribute("aria-current", "page");
      await page.getByRole("button", { name: "Plan a bump", exact: true }).first().click();
      const versions = page.getByRole("dialog", { name: "Plan a version bump" });
      await expect(versions).toContainText("Archived workflow person-lookup is no longer registered");
      await versions.getByRole("button", { name: "Choose a registered workflow" }).click();
      await expect(versions).toContainText("Selected workflow");
      await expect(versions).toContainText("No eligible workflows are registered for a version change.");
      await expect(versions).toContainText("Dashboard");
      await page.evaluate(() => { document.documentElement.style.zoom = "1.25"; });
      await expect(versions).toBeVisible();
      await capture(page, info, `${view.theme.name}-versions-zoom125`);
      expect(errors).toEqual([]);
      expect(server.exchanges().some(exchange => exchange.path === "/api/v1/archive/reports" && exchange.status === 200)).toBe(true);
      expect(server.exchanges().some(exchange => exchange.path.includes("/artifacts/v1/archive/") && exchange.status === 200)).toBe(true);
      expect(info.config.workers).toBeLessThanOrEqual(4);
    } finally {
      await server.close();
      expect(existsSync(server.root)).toBe(false);
    }
  });
}

test("interrupted deletion survives reload and resumes the exact retained request",
  evidence(["archive-delete-pending-reload"]), async ({ page }, info) => {
  const server = await startArchiveAuthorityServer();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    const index = SavedArchiveIndexWireSchema.parse(await (await page.request.get(`${server.baseUrl}/api/v1/archive/reports?limit=50`)).json());
    const report = index.items.find(item => item.runId === server.runId);
    if (report === undefined) throw new Error("saved report is absent from the served list");
    await gotoAppState(page, server.baseUrl, { day: server.day, archive: "" });
    await openWorkflowFolder(page, report.workflow);
    await selectSavedRun(page, report.title);
    server.interruptNextAudit();
    await page.getByRole("button", { name: "Delete saved report", exact: true }).click();
    await page.getByRole("button", { name: "Delete this report", exact: true }).click();
    const status = page.getByRole("region", { name: "Saved report deletion status" });
    await expect(status).toContainText("Saved report deleted");
    await expect(status).toContainText("final operator command audit is still pending");
    const pendingResponse = await page.request.get(`${server.baseUrl}/api/v1/archive/reports/${server.runId}`);
    const pending = SavedArchiveDetailWireSchema.parse(await pendingResponse.json());
    expect(pending.state).toBe("deleted");
    if (pending.state !== "deleted" || pending.deletion.command.state !== "pending"
      || pending.deletion.command.resumeRequest === undefined) {
      throw new Error("interrupted deletion retained no authenticated resume request");
    }
    const retained = pending.deletion.command.resumeRequest;
    await page.goto("about:blank");
    await server.restart();
    await gotoAppState(page, server.baseUrl, { day: server.day, archive: server.runId });
    await expect(status).toContainText("final operator command audit is still pending");
    await capture(page, info, "archive-delete-pending-reload");
    await page.getByRole("button", { name: "Resume deletion cleanup", exact: true }).click();
    await expect(status).toContainText("Command settlement: complete");
    expect(server.database.authority.commands.get(retained.commandId)).toEqual(retained);
    expect(server.database.authority.commandAudits.findByCommand(retained.commandId)?.request).toEqual(retained);
    expect(server.exchanges().filter(exchange => exchange.path === "/api/v1/commands")).toHaveLength(2);
    expect(errors).toEqual([]);
  } finally {
    await server.close();
  }
});

test("real major review renews changed membership and resumes a partial transfer after restart",
  evidence(["archive-major-resumed"]), async ({ page }, info) => {
  const server = await startArchiveAuthorityServer({ seed: "live" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await gotoAppState(page, server.baseUrl, { day: server.day, archive: "", archiveView: "versions" });
    const bump = page.getByRole("dialog", { name: "Plan a version bump" });
    await bump.getByRole("radio", { name: "All workflows" }).check();
    await reviewChange(page);
    await expectReviewedCounts(page, 1, 0, 0);
    await page.screenshot({ path: info.outputPath("reviewed-current.png"), animations: "disabled" });
    const added = server.addRun(91001);
    await bump.getByRole("button", { name: "Apply reviewed change", exact: true }).click();
    await expect(bump.getByText("Review is stale. Review again.", { exact: true })).toBeVisible();
    await reviewChange(page);
    await expectReviewedCounts(page, 2, 0, 0);
    expect(server.database.savedReportOwner(server.runId).state).toBe("live");
    expect(server.database.savedReportOwner(added).state).toBe("live");
    server.interruptTransfer("verified", 2);
    await bump.getByRole("button", { name: "Apply reviewed change", exact: true }).click();
    await expect(bump.getByRole("status").filter({ hasText: /injected|failed|500/i })).toBeVisible();
    const before = server.database.readRuntimeVersionIndex().changes.find(row => row.state === "applying");
    if (before === undefined) throw new Error("partial apply claim missing");
    expect(before.completedRunIds).toHaveLength(1);
    const published = server.database.lifecycleArchive(true).readPublished(before.completedRunIds[0]);
    expect(published).toBeDefined();
    await page.goto("about:blank");
    await server.restart();
    await gotoAppState(page, server.baseUrl, { day: server.day, archive: "", archiveView: "versions" });
    await expectReviewedCounts(page, 2, 0, 1, true);
    const wire = SavedRuntimeVersionIndexWireSchema.parse(await (await page.request.get(`${server.baseUrl}/api/v1/archive/runtime-versions`)).json());
    const applying = wire.changes.find(change => change.state === "applying");
    if (applying?.resumeRequest === undefined) throw new Error("authenticated original request missing");
    const retainedChange = server.database.readRuntimeVersionChange(applying.changeId);
    expect(retainedChange?.applicationCommandId).toBe(applying.resumeRequest.commandId);
    expect(retainedChange?.applicationRequestFingerprint).toBe(createHash("sha256").update(canonicalJsonStringify(applying.resumeRequest)).digest("hex"));
    expect(retainedChange?.applicationRequest).toEqual(applying.resumeRequest);
    const competing = await page.request.post(`${server.baseUrl}/api/v1/commands`, { headers: { origin: server.baseUrl }, data: {
      ...applying.resumeRequest, commandId: "00000000-0000-4000-8000-000000019999",
    } });
    expect(competing.status()).toBe(422);
    const afterCompeting = server.database.readRuntimeVersionChange(applying.changeId);
    expect(afterCompeting?.applicationCommandId).toBe(applying.resumeRequest.commandId);
    expect(afterCompeting?.applicationRequestFingerprint).toBe(retainedChange?.applicationRequestFingerprint);
    expect(afterCompeting?.applicationRequest).toEqual(applying.resumeRequest);
    expect(server.database.lifecycleArchive(true).readPublished(before.completedRunIds[0])).toEqual(published);
    const resumedRequest = page.waitForRequest(request => request.url().endsWith("/api/v1/commands") && request.method() === "POST");
    await bump.getByRole("button", { name: "Resume version change" }).click();
    expect((await resumedRequest).postDataJSON()).toEqual(applying.resumeRequest);
    await expect(bump.getByRole("status").filter({ hasText: "Version change applied." })).toBeVisible();
    expect(server.database.authority.commands.get(applying.resumeRequest.commandId)?.requestedAt).toBe(applying.resumeRequest.requestedAt);
    expect(server.database.lifecycleArchive(true).readPublished(before.completedRunIds[0])).toEqual(published);
    expect(server.database.readRuntimeVersionAuthority().state.dashboard).toEqual({ major: 2, minor: 0 });
    await capture(page, info, "archive-major-resumed");
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});

test("real workflow minor review waits for active runs and archives that workflow only",
  evidence(["archive-workflow-minor"]), async ({ page }, info) => {
  const server = await startArchiveAuthorityServer({ seed: "live" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    const active = server.addRun(91002, false);
    await gotoAppState(page, server.baseUrl, { day: server.day, archive: "", archiveView: "versions" });
    const bump = page.getByRole("dialog", { name: "Plan a version bump" });
    await expect(bump.getByRole("button", { name: "Workflow to bump" })).toContainText(/Person lookup/iu);
    await reviewChange(page);
    await expectReviewedCounts(page, 2, 1, 0);
    await expect(bump.getByRole("button", { name: "Apply reviewed change" })).toHaveCount(0);
    await expect(bump.getByRole("button", { name: "Review change" })).toBeEnabled();
    server.finishRun(active);
    await reviewChange(page);
    await expectReviewedCounts(page, 2, 0, 0);
    await bump.getByRole("button", { name: "Apply reviewed change", exact: true }).click();
    await expect(bump.getByRole("status").filter({ hasText: "Version change applied." })).toBeVisible();
    expect(server.database.savedReportOwner(server.runId).state).toBe("archived");
    expect(server.database.savedReportOwner(active).state).toBe("archived");
    const state = server.database.readRuntimeVersionAuthority().state;
    expect(state.dashboard).toEqual({ major: 1, minor: 0 });
    expect(state.workflows.find(row => row.workflowId === "person-lookup")?.version).toEqual({ major: 1, minor: 1 });
    expect(state.workflows.find(row => row.workflowId === "other-workflow")?.version).toEqual({ major: 1, minor: 0 });
    expect(SavedArchiveIndexWireSchema.parse(await (await page.request.get(`${server.baseUrl}/api/v1/archive/reports?limit=50`)).json()).items).toHaveLength(2);
    await capture(page, info, "archive-workflow-minor");
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});

test("real bounded pages retain history selection outside the current page and ignore late list/detail replies", async ({ page }) => {
  const server = await startArchiveAuthorityServer({ reportCount: 52 });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const releases: Array<() => void> = [];
  try {
    const query = `${server.baseUrl}/api/v1/archive/reports?limit=50`;
    const first = SavedArchiveIndexWireSchema.parse(await (await page.request.get(query)).json());
    expect(first.items).toHaveLength(50);
    expect(first.next).not.toBeNull();
    const next = SavedArchiveIndexWireSchema.parse(await (await page.request.get(`${query}&after=${encodeURIComponent(JSON.stringify(first.next))}`)).json());
    expect(next.items).toHaveLength(2);
    expect(new Set([...first.items, ...next.items].map(report => report.runId)).size).toBe(52);
    const chosen = first.items[0];
    const other = first.items[1];
    const secondPageRun = next.items[0];
    if (chosen === undefined || other === undefined || secondPageRun === undefined) throw new Error("bounded Archive fixture page is incomplete");
    await gotoAppState(page, server.baseUrl, { day: server.day, archive: "" });
    await openWorkflowFolder(page, chosen.workflow);
    const old = server.delayNextResponse(`/api/v1/archive/reports/${chosen.runId}`); releases.push(old.release);
    await page.getByRole("table").first().getByRole("button", { name: chosen.title, exact: true }).click();
    await old.ready;
    await page.getByRole("navigation", { name: "Archive path" }).getByRole("button", { name: workflowName(chosen.workflow) }).click();
    await expect(page.getByRole("table").first()).toBeVisible();
    await selectSavedRun(page, other.title);
    await expect(page.getByRole("heading", { name: other.title, exact: true, level: 1 })).toBeVisible();
    const oldResponse = page.waitForResponse(response => response.url().endsWith(`/reports/${chosen.runId}`));
    old.release(); await oldResponse;
    await expect(page.getByRole("heading", { name: other.title, exact: true, level: 1 })).toBeVisible();
    await page.getByRole("navigation", { name: "Archive path" }).getByRole("button", { name: workflowName(other.workflow) }).click();
    await expect(page.getByRole("table").first()).toBeVisible();
    await page.getByRole("button", { name: "Next reports", exact: true }).click();
    const table = page.getByRole("table").first();
    await expect(table.getByRole("button", { name: secondPageRun.title, exact: true })).toBeVisible();
    await expect(table.getByRole("button", { name: other.title, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "First reports", exact: true })).toBeVisible();
    // Page navigation is route-owned; revisit the retained report through its exact route.
    await page.goBack();
    await expect(page.getByRole("table").first()).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: other.title, exact: true, level: 1 })).toBeVisible();
    await page.getByRole("navigation", { name: "Archive path" }).getByRole("button", { name: "Archive", exact: true }).click();
    await page.getByRole("button", { name: workflowName(other.workflow) }).click();
    const delayedList = server.delayNextResponse("/api/v1/archive/reports?"); releases.push(delayedList.release);
    const search = page.getByRole("textbox", { name: "Search all public archive fields" });
    await search.fill("old-query");
    await delayedList.ready;
    await search.fill(other.title);
    await expect(page.getByRole("table").first()).toBeVisible();
    const listResponse = page.waitForResponse(response => response.url().includes("search=old-query"));
    delayedList.release(); await listResponse;
    await expect(page.getByRole("table").first()).toBeVisible();
    await expect(page.getByRole("cell", { name: /No saved reports match this scope/ })).toHaveCount(0);
    await page.getByRole("button", { name: /Clear filters/ }).first().click();
    await expect(search).toHaveValue("");
    expect(errors).toEqual([]);
  } finally { for (const release of releases) release(); await server.close(); }
});

test("late real deletion of A leaves B selected and history reads A's current disposition", async ({ page }) => {
  const server = await startArchiveAuthorityServer({ reportCount: 2 });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const delayed = server.delayNextResponse("/api/v1/commands");
  try {
    await gotoAppState(page, server.baseUrl, { day: server.day, archive: "" });
    const index = SavedArchiveIndexWireSchema.parse(await (await page.request.get(`${server.baseUrl}/api/v1/archive/reports?limit=50`)).json());
    const reportA = index.items.find(report => report.runId === server.runId);
    if (reportA === undefined) throw new Error("saved report A is absent from the served list");
    const reportB = index.items.find(report => report.runId !== server.runId);
    if (reportB === undefined) throw new Error("saved report B is absent from the served list");
    await openWorkflowFolder(page, reportA.workflow);
    await selectSavedRun(page, reportA.title);
    await page.getByRole("navigation", { name: "Archive path" }).getByRole("button", { name: workflowName(reportA.workflow) }).click();
    await selectSavedRun(page, reportB.title);
    await page.getByRole("navigation", { name: "Archive path" }).getByRole("button", { name: workflowName(reportA.workflow) }).click();
    await selectSavedRun(page, reportA.title);
    await expect(page.getByRole("heading", { name: reportA.title, exact: true, level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Delete saved report", exact: true }).click();
    await expect(page.getByText(/A later run may submit the same work again/)).toBeVisible();
    await page.getByRole("button", { name: "Delete this report", exact: true }).click();
    await delayed.ready;
    await page.goBack();
    await expect(page.getByRole("table").first()).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Synthetic report 91001", exact: true, level: 1 })).toBeVisible();
    const reply = page.waitForResponse(response => response.url().endsWith("/api/v1/commands"));
    delayed.release(); await reply;
    await expect(page.getByRole("heading", { name: "Synthetic report 91001", exact: true, level: 1 })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole("table").first()).toBeVisible();
    await page.goForward();
    await expect(page.getByRole("region", { name: "Saved report deletion status" })).toContainText("Command settlement: complete");
    expect(errors).toEqual([]);
  } finally { delayed.release(); await server.close(); }
});
