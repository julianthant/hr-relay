import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { chromium, type Worker } from "playwright";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachPresentationReference } from "./helpers/presentation-reference.js";
import { installFrozenMonotonic } from "./helpers/app-driver.js";
import { gotoAppState } from "./helpers/app-driver.js";
import {
  assertThemeApplied,
  installTheme,
  PARITY_THEMES,
} from "./helpers/capture.js";
import { dismissWorkflowWindowOverQueue, failOnPageErrors } from "./helpers/reference-harness.js";
import { startQueueAuthorityServer, type QueueAuthorityServer } from "./helpers/queue-authority-server.js";


const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1280x720", width: 1280, height: 720 },
  { name: "1024x768", width: 1024, height: 768 },
] as const;

/** The extension owns one exact test tab; missing or ambiguous ownership fails. */
async function setBrowserZoom(worker: Worker, pageUrl: string, factor: number) {
  return worker.evaluate(async ({ pageUrl, factor }) => {
    const { chrome } = globalThis as unknown as { chrome: { tabs: {
      query: (query: Record<string, never>) => Promise<Array<{ id?: number; url?: string }>>;
      setZoomSettings: (id: number, settings: { mode: "automatic"; scope: "per-tab" }) => Promise<void>;
      setZoom: (id: number, factor: number) => Promise<void>;
      getZoom: (id: number) => Promise<number>;
      getZoomSettings: (id: number) => Promise<{ mode: string; scope: string }>;
    } } };
    const owned = (await chrome.tabs.query({})).filter(tab => tab.url === pageUrl);
    const tabId = owned[0]?.id;
    if (owned.length !== 1 || tabId === undefined) throw new Error(`Expected one owned zoom tab, found ${String(owned.length)}`);
    await chrome.tabs.setZoomSettings(tabId, { mode: "automatic", scope: "per-tab" });
    await chrome.tabs.setZoom(tabId, factor);
    return { tabId, value: await chrome.tabs.getZoom(tabId), settings: await chrome.tabs.getZoomSettings(tabId) };
  }, { pageUrl, factor });
}

test.describe("Queue authority, live commands, and desktop parity", () => {
  let server: QueueAuthorityServer;

  test.beforeAll(async () => {
    server = await startQueueAuthorityServer();
  });

  test.afterAll(async () => {
    if (server !== undefined) await server.close();
  });

  for (const theme of PARITY_THEMES) {
    test(`queue layout, scroll access, and theme application: ${theme.name}`, async ({ page }) => {
      const errors = failOnPageErrors(page);
      await page.setViewportSize(VIEWPORTS[0]);
      await installTheme(page, theme);
      await gotoAppState(page, server.baseUrl, { day: server.day });
      await dismissWorkflowWindowOverQueue(page);
      await assertThemeApplied(page, theme);

      const queue = page.getByRole("region", { name: "Queue", exact: true });
      await expect(queue).toBeVisible();

      // Verify seeded rows are rendered in Queue
      const terminalRow = page.locator(`[data-demo-row-id='${server.runIds.cancelledRun}']`).first();
      await expect(terminalRow).toBeVisible();

      // Resize down to 1024x720 and back to 1440x900
      await page.setViewportSize({ width: 1024, height: 720 });
      await expect(queue).toBeVisible();
      await expect(terminalRow).toBeVisible();

      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(queue).toBeVisible();
      await expect(terminalRow).toBeVisible();

      expect(errors, "page errors during layout and resize").toEqual([]);
    });
  }

  test("dialog focus return, keyboard commands, and escape dismiss", { annotation: [{ type: "required-a11y-evidence", description: "served-delete-confirmation.a11y.yml" }] }, async ({ page }, info) => {
    await installFrozenMonotonic(page);
    const errors = failOnPageErrors(page);
    await page.setViewportSize(VIEWPORTS[0]);
    await installTheme(page, PARITY_THEMES[0]);
    await gotoAppState(page, server.baseUrl, { day: server.day });
    await dismissWorkflowWindowOverQueue(page);

    const terminalRow = page.locator(`[data-demo-row-id='${server.runIds.cancelledRun}']`).first();
    await expect(terminalRow).toBeVisible();

    // Trigger delete action button on the cancelled row
    const deleteButton = terminalRow.getByRole("button", { name: /Delete run/u }).first();
    await deleteButton.focus();
    await page.keyboard.press("Enter");

    // Confirmation dialog opens
    const dialog = page.getByRole("dialog", { name: "Delete this run", exact: true });
    await expect(dialog).toBeVisible();
    const footerId = await terminalRow.locator("span[title]").filter({ hasText: /^[A-Z]+\d{8}$/u }).textContent();
    expect(footerId).toMatch(/^[A-Z]+\d{8}$/u);
    await expect(dialog.locator(".command-confirm-reference")).toHaveText(`${footerId} · revision ${server.authority().authority.runs.get(server.runIds.cancelledRun)?.version}`);
    await expect(dialog.locator("header p")).toHaveCount(0);
    await expect(dialog).not.toHaveAttribute("aria-describedby");
    await attachPresentationReference(page, info, "served-delete-confirmation.png");
    const a11y = await dialog.ariaSnapshot();
    await info.attach("served-delete-confirmation.a11y.yml", { body: a11y, contentType: "text/yaml" });
    info.annotations.push({ type: "a11y-attachment-sha256:served-delete-confirmation.a11y.yml", description: createHash("sha256").update(a11y).digest("hex") });

    // Dismiss with Escape key -> focus returns to triggering button
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(deleteButton).toBeFocused();

    expect(errors, "page errors during dialog keyboard interaction").toEqual([]);
  });

  test("live deletion settlement removes row and commits tombstone in authority", async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.setViewportSize(VIEWPORTS[1]);
    await installTheme(page, PARITY_THEMES[0]);
    await gotoAppState(page, server.baseUrl, { day: server.day });
    await dismissWorkflowWindowOverQueue(page);

    const runId = server.runIds.cancelledRun;
    const terminalRow = page.locator(`[data-demo-row-id='${runId}']`).first();
    await expect(terminalRow).toBeVisible();

    // Check authority before deletion: run exists, no tombstone
    const db = server.authority();
    expect(db.authority.runs.get(runId)).toBeDefined();
    expect(db.authority.deletedRuns.get(runId)).toBeUndefined();

    // Open Delete dialog
    const deleteButton = terminalRow.getByRole("button", { name: /Delete run/u }).first();
    await deleteButton.click();

    const dialog = page.getByRole("dialog", { name: "Delete this run", exact: true });
    await expect(dialog).toBeVisible();

    // Intercept command POST
    const commandPromise = page.waitForRequest(
      (req) => req.method() === "POST" && req.url().includes("/commands"),
    );

    // Confirm deletion
    const confirmButton = dialog.getByRole("button", { name: "Delete", exact: true });
    await confirmButton.click();

    const commandRequest = await commandPromise;
    expect(commandRequest.postDataJSON()).toMatchObject({
      family: "run",
      type: "delete",
      target: { runId },
    });


    await expect(page.locator(`[data-demo-row-id='${runId}']`)).toHaveCount(0);

    // Authority has insert-only tombstone
    const tombstone = db.authority.deletedRuns.get(runId);
    expect(tombstone).toBeDefined();
    expect(tombstone?.origin).toBe("queue");
    expect(db.authority.runs.get(runId)).toBeUndefined();

    expect(errors, "page errors during live deletion settlement").toEqual([]);
  });

  test("lost delete response remains recoverable after its row disappears", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS[0]);
    await gotoAppState(page, server.baseUrl, { day: server.day, run: server.runIds.doneRun });
    await dismissWorkflowWindowOverQueue(page);
    const runId = server.runIds.doneRun;
    const requests: unknown[] = [];
    const responses: unknown[] = [];
    await page.route("**/api/v1/commands", async route => {
      requests.push(route.request().postDataJSON());
      const response = await route.fetch();
      responses.push(await response.json());
      if (requests.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    const row = page.locator(`[data-demo-row-id='${runId}']`).first();
    await row.getByRole("button", { name: /Delete run/u }).click();
    await page.getByRole("dialog", { name: "Delete this run", exact: true })
      .getByRole("button", { name: "Delete", exact: true }).click();
    const recovery = page.getByRole("region", { name: "Commands awaiting recovery" });
    await expect(recovery).toBeVisible();
    expect(responses[0], JSON.stringify(responses[0])).toMatchObject({ state: "applied" });
    await expect(row).toHaveCount(0);
    const tombstone = server.authority().authority.deletedRuns.get(runId);
    expect(tombstone).toBeDefined();
    await recovery.getByRole("button", { name: "Review Delete run (1 run)", exact: true }).click();
    await page.getByRole("dialog", { name: "Recover previous Delete run", exact: true })
      .getByRole("button", { name: "Resend original request", exact: true }).click();
    await expect(recovery).toHaveCount(0);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(server.authority().authority.deletedRuns.get(runId)).toEqual(tombstone);
    await expect(page).not.toHaveURL(new RegExp(`run=${runId}`, "u"));
  });

  test("tree deletion clears selected child and preserves surviving runs", async ({ page }) => {
    const database = server.authority();
    const rootId = server.runIds.groupRun;
    const childId = server.runIds.memberRun;
    const tree = [...database.authority.runs.listChildren(rootId), database.authority.runs.get(rootId)];
    expect(tree).toHaveLength(4);
    const members = tree.slice(0, -1);
    const now = tree[0]?.updatedAt;
    if (now === undefined || members.some(member => member === undefined)) throw new Error("seeded deletion tree has no members");
    const policy = { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" } as const;
    const manifestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const dependencies = members.map((member, index) => {
      if (member === undefined) throw new Error("seeded deletion member is missing");
      return {
        dependencyId: `bbbbbbbb-000${String(index + 1)}-4000-8000-00000000000${String(index + 1)}`,
        manifestId,
        edgeId: "members",
        parentRunId: rootId,
        childRunId: member.envelope.runId,
        childItemId: member.envelope.itemId,
        policy,
        state: "active" as const,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
    });
    database.authority.delegationManifests.insert({
      manifestId, parentRunId: rootId, edgeId: "members",
      inputSchemaHash: "a".repeat(64), resultSchemaHash: "b".repeat(64),
      cardinality: "many", join: "all", policy,
      children: dependencies.map(dependency => ({
        dependencyId: dependency.dependencyId,
        childRunId: dependency.childRunId,
        childItemId: dependency.childItemId,
        canonicalInputFingerprint: "c".repeat(64),
      })),
      createdAt: now, manifestFingerprint: "d".repeat(64),
    });
    for (const dependency of dependencies) database.authority.dependencies.insert(dependency);
    for (const run of tree) {
      if (run === undefined) throw new Error("seeded deletion tree is missing its root");
      expect(database.authority.runs.transition({
        runId: run.envelope.runId, expectedVersion: run.version,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: run.updatedAt }, now: run.updatedAt,
      }).state).toBe("applied");
    }
    await page.setViewportSize(VIEWPORTS[0]);
    await gotoAppState(page, server.baseUrl, { day: server.day, run: childId });
    await dismissWorkflowWindowOverQueue(page);
    const root = page.locator(`[data-demo-row-id='${rootId}']`).first();
    const survivor = page.locator(`[data-demo-row-id='${server.runIds.runningRun}']`).first();
    await root.getByRole("button", { name: /Delete group/u }).click();
    const response = page.waitForResponse(reply => reply.url().endsWith("/api/v1/commands") && reply.request().method() === "POST");
    await page.getByRole("dialog", { name: "Delete this group", exact: true }).getByRole("button", { name: "Delete", exact: true }).click();
    const result: unknown = await (await response).json();
    expect(result, JSON.stringify(result)).toMatchObject({ state: "applied", affectedTargets: expect.arrayContaining([{ family: "run", runId: childId }]) });
    await expect(root).toHaveCount(0);
    await expect(page.locator(`[data-demo-row-id='${childId}']`)).toHaveCount(0);
    await expect(page).not.toHaveURL(new RegExp(`run=${childId}`, "u"));
    await expect(survivor).toBeVisible();
    expect(database.authority.runs.get(server.runIds.runningRun)).toBeDefined();
    for (const run of tree) {
      if (run === undefined) throw new Error("seeded deletion tree is missing its root");
      expect(database.authority.runs.get(run.envelope.runId)).toBeUndefined();
      expect(database.authority.deletedRuns.get(run.envelope.runId)).toBeDefined();
    }
  });

  test("actual 125% and 200% browser zoom preserve accessibility and layout", async ({ browserName }, testInfo) => {
    expect(browserName).toBe("chromium");
    const root = realpathSync(mkdtempSync(join(tmpdir(), "queue-zoom-")));
    writeFileSync(join(root, "manifest.json"), JSON.stringify({
      manifest_version: 3, name: "Owned shell zoom proof", version: "1.0",
      permissions: ["tabs"], background: { service_worker: "worker.js" },
    }));
    writeFileSync(join(root, "worker.js"), "chrome.runtime.onInstalled.addListener(() => {});\n");
    const context = await chromium.launchPersistentContext(join(root, "profile"), {
      channel: "chromium", headless: false,
      args: ["--headless=new", `--disable-extensions-except=${root}`, `--load-extension=${root}`],
      viewport: { width: 1280, height: 720 },
    }).catch((error: unknown) => { rmSync(root, { recursive: true, force: true }); throw error; });
    try {
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker", { timeout: 10_000 });
      const receipts: Array<Record<string, unknown>> = [];
      for (const theme of PARITY_THEMES) {
        const page = await context.newPage();
        const errors = failOnPageErrors(page);
        // Full Chromium requests an implicit favicon; this fixture has none.
        // Serve only that verified cosmetic request, preserving all app error checks.
        await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
        await installTheme(page, theme);
        await gotoAppState(page, server.baseUrl, { day: server.day });
        await dismissWorkflowWindowOverQueue(page);
        await assertThemeApplied(page, theme);
        const baselineDpr = await page.evaluate(() => devicePixelRatio);
        const userAgent = await page.evaluate(() => navigator.userAgent);
        expect(userAgent).toMatch(/(?:HeadlessChrome|Chrome)\/[0-9.]+/u);
        for (const sample of [
          { zoom: 1.25, expectedWidth: 1024, expectedHeight: 576 },
          { zoom: 2, expectedWidth: 640, expectedHeight: 360 },
        ]) {
          const zoomResult = await setBrowserZoom(worker, page.url(), sample.zoom);
          expect(zoomResult.value).toBe(sample.zoom);
          await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
            .toEqual({ width: sample.expectedWidth, height: sample.expectedHeight });
          const geometry = await page.evaluate(() => ({
            innerWidth, innerHeight, dpr: devicePixelRatio,
            cssZoom: document.documentElement.style.zoom,
            bodyCssZoom: document.body.style.zoom,
          }));
          expect(geometry.dpr).toBeCloseTo(baselineDpr * sample.zoom, 5);
          expect(geometry.cssZoom).toBe("");
          expect(geometry.bodyCssZoom).toBe("");
          await expect(page.getByRole("region", { name: "Queue", exact: true })).toBeVisible();
          // This control sits beyond the effective viewport at 200%: scroll,
          // keyboard activation, and focus must still work on the desktop canvas.
          const select = page.getByRole("button", { name: "Sessions", exact: true });
          await select.scrollIntoViewIfNeeded();
          await select.focus();
          await expect(select).toBeFocused();
          await page.keyboard.press("Enter");
          await expect(select).toHaveAttribute("aria-expanded", "true");
          await page.keyboard.press("Enter");
          await expect(select).toHaveAttribute("aria-expanded", "false");
          receipts.push({ theme: theme.name, zoom: sample.zoom, mechanism: "chrome.tabs.setZoom", zoomResult, geometry, baselineDpr, userAgent });
        }
        expect((await setBrowserZoom(worker, page.url(), 1)).value).toBe(1);
        expect(errors).toEqual([]);
        await page.close();
      }
      const proof = testInfo.outputPath("zoom-proof.json");
      writeFileSync(proof, JSON.stringify({ task: "3.1.13", viewport: { width: 1280, height: 720 }, receipts }, null, 2));
      await testInfo.attach("zoom-proof", { path: proof, contentType: "application/json" });
    } finally {
      await context.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("Rerun modal handoff creates no run prior to final submission", async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.setViewportSize(VIEWPORTS[0]);
    await installTheme(page, PARITY_THEMES[0]);
    await gotoAppState(page, server.baseUrl, { day: server.day });
    await dismissWorkflowWindowOverQueue(page);

    const db = server.authority();
    const genBefore = db.getMeta().authorityGeneration;

    // Click Rerun button
    const rerunButton = page.getByRole("button", { name: "Rerun", exact: true }).first();
    if (await rerunButton.isVisible()) {
      await rerunButton.click();
      const rerunDialog = page.getByRole("dialog", { name: "Rerun", exact: true });
      await expect(rerunDialog).toBeVisible();

      // Cancel Rerun modal without submitting
      const cancelButton = rerunDialog.getByRole("button", { name: "Cancel", exact: true });
      if (await cancelButton.isVisible()) {
        await cancelButton.click();
      } else {
        await page.keyboard.press("Escape");
      }
      await expect(rerunDialog).toHaveCount(0);


      const genAfter = db.getMeta().authorityGeneration;
      expect(genAfter).toBe(genBefore);
    }

    expect(errors, "page errors during Rerun inspection").toEqual([]);
  });
});
