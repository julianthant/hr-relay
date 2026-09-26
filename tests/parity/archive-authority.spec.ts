import { expect, test, type Download, type Page, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { existsSync, writeFileSync } from "node:fs";
import { SavedArchiveDetailWireSchema, SavedArchiveIndexWireSchema, SavedRuntimeVersionIndexWireSchema } from "../../src/domain/dashboard/archive.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { assertThemeApplied, installTheme } from "./helpers/capture.js";
import { startArchiveAuthorityServer } from "./helpers/fixture-archive-authority.js";

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
      const titleFilter = page.getByRole("textbox", { name: "Search reports and retained files" });
      await titleFilter.fill("does-not-match");
      await expect(page.getByText("No saved reports match these filters.", { exact: true })).toBeVisible();
      await titleFilter.fill(report.title);
      await page.getByRole("button", { name: new RegExp(`${report.title}.*Open report`,"u") }).focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`archive=${server.runId}`, "u"));
      const article = page.getByRole("article", { name: "Saved archive report" });
      await expect(article).toBeVisible();

      const exportPending = page.waitForEvent("download");
      await article.getByRole("link", { name: "Export report", exact: true }).click();
      const exported = await exportPending;
      expect(exported.suggestedFilename()).toBe(`archive-${server.runId}.json`);
      expect(JSON.parse((await bytes(exported)).toString("utf8"))).toEqual(detail);

      const imageLink = article.getByRole("link", { name: server.file.name, exact: true });
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
      await expect(page).toHaveURL(/archive=$/u);
      await page.goForward();
      await expect(page).toHaveURL(new RegExp(`archive=${server.runId}`, "u"));
      await expect(article).toBeVisible();
      await page.getByRole("button", { name: "Plan a bump", exact: true }).first().click();
      const versions = page.getByRole("region", { name: "Plan a version bump" });
      await expect(versions).toContainText("Workflow version");
      await expect(versions).toContainText("Dashboard version");
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
    await gotoAppState(page, server.baseUrl, { day: server.day, archive: server.runId });
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
    const bump = page.getByRole("region", { name: "Plan a version bump" });
    await bump.getByRole("button", { name: /Dashboard version Advance every workflow/u }).click();
    await bump.getByRole("button", { name: "Review affected runs" }).click();
    await expect(bump).toContainText("1 affected runs · 0 blockers · 0 archived");
    const added = server.addRun(91001);
    await bump.getByRole("button", { name: "Apply reviewed change", exact: true }).click();
    await expect(bump.getByRole("status").filter({ hasText: /stale|changed|review/i })).toBeVisible();
    await bump.getByRole("button", { name: "Review affected runs" }).click();
    await expect(bump).toContainText("2 affected runs · 0 blockers · 0 archived");
    expect(server.database.savedReportOwner(server.runId).state).toBe("live");
    expect(server.database.savedReportOwner(added).state).toBe("live");
    server.interruptTransfer("verified", 2);
    await bump.getByText("2 affected runs · 0 blockers · 0 archived").locator("..").getByRole("button", { name: "Apply reviewed change" }).click();
    await expect(bump.getByRole("status").filter({ hasText: /injected|failed|500/i })).toBeVisible();
    const before = server.database.readRuntimeVersionIndex().changes.find(row => row.state === "applying");
    if (before === undefined) throw new Error("partial apply claim missing");
    expect(before.completedRunIds).toHaveLength(1);
    const published = server.database.lifecycleArchive(true).readPublished(before.completedRunIds[0]);
    expect(published).toBeDefined();
    await page.goto("about:blank");
    await server.restart();
    await gotoAppState(page, server.baseUrl, { day: server.day, archive: "", archiveView: "versions" });
    await expect(bump).toContainText("2 affected runs · 0 blockers · 1 archived");
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
    await expect(bump.getByRole("status").filter({ hasText: "Version review updated." })).toBeVisible();
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
    const bump = page.getByRole("region", { name: "Plan a version bump" });
    await expect(bump.getByRole("checkbox", { name: /Person Lookup/i })).toBeChecked();
    await bump.getByRole("button", { name: "Review affected runs" }).click();
    await expect(bump).toContainText("2 affected runs · 1 blockers · 0 archived");
    await expect(bump.getByRole("button", { name: "Apply reviewed change" })).toBeDisabled();
    server.finishRun(active);
    await bump.getByRole("button", { name: "Review affected runs" }).click();
    await expect(bump).toContainText("2 affected runs · 0 blockers · 0 archived");
    await bump.getByText("2 affected runs · 0 blockers · 0 archived").locator("..").getByRole("button", { name: "Apply reviewed change" }).click();
    await expect(bump.getByRole("status").filter({ hasText: "Version review updated." })).toBeVisible();
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

test("real bounded pages retain exact history selection outside the filtered page and ignore late list/detail replies", async ({ page }) => {
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
    await gotoAppState(page, server.baseUrl, { day: server.day, archive: "" });
    const old = server.delayNextResponse(`/api/v1/archive/reports/${chosen.runId}`); releases.push(old.release);
    await page.getByRole("button", { name: new RegExp(`${chosen.title}.*Open report`,"u") }).click();
    await old.ready;
    await page.getByRole("button", { name: new RegExp(`${other.title}.*Open report`,"u") }).click();
    await expect(page.getByRole("article")).toContainText(other.title);
    const oldResponse = page.waitForResponse(response => response.url().endsWith(`/reports/${chosen.runId}`));
    old.release(); await oldResponse;
    await expect(page.getByRole("article")).toContainText(other.title);
    await page.getByRole("button", { name: /View all 52 reports and attachments/u }).click();
    await page.getByRole("button", { name: "Next reports", exact: true }).click();
    await expect(page.getByRole("article")).toContainText(other.title);
    await expect(page.getByRole("button", { name: "First reports", exact: true })).toBeVisible();
    // Paging changes the list while the route-owned selected report stays visible.
    await expect(page.getByRole("button", { name: new RegExp(`${other.title}.*Open report`,"u") })).toHaveCount(0);
    await page.getByRole("button", { name: "First reports", exact: true }).click();
    await expect(page.getByRole("article")).toContainText(other.title);
    const delayedList = server.delayNextResponse("/api/v1/archive/groups?search=old-query"); releases.push(delayedList.release);
    const search = page.getByRole("textbox", { name: "Search reports and retained files" });
    await search.fill("old-query");
    await delayedList.ready;
    await search.fill(other.title);
    await expect(page.getByRole("button", { name: new RegExp(`${other.title}.*Open report`,"u") })).toBeVisible();
    const listResponse = page.waitForResponse(response => response.url().endsWith("search=old-query"));
    delayedList.release(); await listResponse;
    await expect(page.getByRole("button", { name: new RegExp(`${other.title}.*Open report`,"u") })).toBeVisible();
    await expect(page.getByText("No saved reports match these filters.", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Dashboard", exact: true }).click();
    await gotoAppState(page, server.baseUrl, { day: server.day, archive: "" });
    await expect(page.getByRole("textbox", { name: "Search reports and retained files" })).toHaveValue("");
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
    await page.getByRole("button", { name: new RegExp(`${reportA.title}.*Open report`,"u") }).click();
    await expect(page.getByRole("article")).toContainText(reportA.title);
    await page.getByRole("button", { name: /Synthetic report 91001.*Open report/u }).click();
    await expect(page.getByRole("article")).toContainText("Synthetic report 91001");
    await page.getByRole("button", { name: new RegExp(`${reportA.title}.*Open report`,"u") }).click();
    await expect(page.getByRole("article")).toContainText(reportA.title);
    await page.getByRole("button", { name: "Delete saved report", exact: true }).click();
    await expect(page.getByText(/permanent idempotency keys/)).toBeVisible();
    await page.getByRole("button", { name: "Delete this report", exact: true }).click();
    await delayed.ready;
    await page.goBack();
    await expect(page.getByRole("article")).toContainText("Synthetic report 91001");
    const reply = page.waitForResponse(response => response.url().endsWith("/api/v1/commands"));
    delayed.release(); await reply;
    await expect(page.getByRole("article")).toContainText("Synthetic report 91001");
    await page.goBack();
    await expect(page.getByRole("region", { name: "Saved report deletion status" })).toContainText("Command settlement: complete");
    expect(errors).toEqual([]);
  } finally { delayed.release(); await server.close(); }
});
