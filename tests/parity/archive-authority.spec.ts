import { expect, test, type Download, type Page, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { SavedArchiveDetailWireSchema, SavedArchiveIndexWireSchema } from "../../src/domain/dashboard/archive.js";
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
      const titleFilter = page.getByRole("textbox", { name: "Title" });
      await titleFilter.fill("does-not-match");
      await expect(page.getByText("No saved reports match this query.", { exact: true })).toBeVisible();
      await titleFilter.fill(report.title);
      await page.getByRole("button", { name: report.title, exact: true }).focus();
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
      await page.getByRole("button", { name: "Versions & bumps", exact: true }).click();
      const versions = page.getByRole("region", { name: "Versions and saved changes" });
      await expect(versions).toContainText("Major change");
      await expect(versions).toContainText("Reviewed membership");
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
    await page.getByRole("button", { name: "Confirm deletion", exact: true }).click();
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
    await page.reload();
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
