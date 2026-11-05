import { createHash } from "node:crypto";
import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { CommandRequestSchema } from "../../src/rules/commands/commands.js";
import { DashboardDayWireSchema } from "../../src/models/dashboard/projection.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY, uuidOf } from "./helpers/fixture-identity.js";
import { FIXTURE_DAY_WIRE } from "./helpers/fixture-queue.js";


for (const theme of ["light", "dark"] as const) {

test(`workflow batches: Lookup follows served grouping without a toggle, ${theme}`, async ({ page }, _testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const chosen = FIXTURE_DAY_WIRE.queueSurfaces.filter((row) => row.parent === null && (row.surfaceKind === "single" || row.surfaceKind === "preview")).slice(0, 3);
    expect(chosen).toHaveLength(3);
    const ids = new Set(chosen.map((row) => row.runId));
    for (const grouped of [true, false]) {
      const requests: string[] = [];
      const dayWire = DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE,
        queueSurfaces: FIXTURE_DAY_WIRE.queueSurfaces.map((row) => ids.has(row.runId) ? { ...row,
          session: { state: "present", itemScope: "session", sessionId: uuidOf(700), presentation: { layout: grouped ? "batch" : "items", groupInQueue: grouped, version: 4, startedAt: chosen[0].startedAt } },
        } : row),
      });
      const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, dayWire });
      const onRequest = (request: import("@playwright/test").Request) => { if (request.method() === "POST" && request.url().includes("/commands")) requests.push(request.url()); };
      page.on("request", onRequest);
      try {
        await page.addInitScript(value => { Reflect.set(window, "relayParityTheme", value); }, theme);
        await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
        await expect(page.locator("html")).toHaveAttribute("data-demo-theme", theme);
        await expect(page.locator("body")).toHaveAttribute("data-demo-theme", theme);
        await expect(page.locator("[data-app-root]" )).toHaveAttribute("data-demo-theme", theme);
        const queue = page.getByRole("region", { name: "Queue", exact: true });
        await expect(queue.locator("[data-queue-batch-id]")).toHaveCount(grouped ? 1 : 0);
        await expect(queue.getByRole("button", { name: /Group batch|Show separately/u })).toHaveCount(0);
        for (const row of chosen) await expect(queue.locator(`[data-demo-row-id='${row.runId}']`)).toHaveCount(1);
        const first = queue.locator(`[data-demo-row-id='${chosen[0].runId}']`);
        await first.scrollIntoViewIfNeeded();
        await (grouped ? first.locator("button").first() : first).focus();
        await page.keyboard.press("Enter");
        await expect.poll(() => new URL(page.url()).searchParams.get("run")).toBe(chosen[0].runId);
        expect(requests).toEqual([]);
      } finally { page.off("request", onRequest); await server.close(); }
    }
  });
}


for (const theme of ["light", "dark"] as const) for (const width of [1024, 1440]) {
  const a11yName = `lookup-batch-${theme}-${width}.a11y.yml`;
  test(`Lookup batch member keyboard, history and filter scope @ ${theme}-${width}`, {
    annotation: [{ type: "required-a11y-evidence", description: a11yName }],
  }, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 1024 ? 720 : 900 });
    const roots = FIXTURE_DAY_WIRE.queueSurfaces.filter(row => row.parent === null && row.surfaceKind === "single");
    const done = roots.find(row => row.status === "done");
    const failed = roots.find(row => row.status === "failed");
    const running = roots.find(row => row.status === "running");
    const prior = roots.find(row => row.status === "cancelled");
    if (done === undefined || failed === undefined || running === undefined || prior === undefined) throw new Error("Lookup batch fixtures missing");
    const batchId = uuidOf(710);
    const session = { state: "present", itemScope: "session", sessionId: batchId, origin: { kind: "start-plan", startPlanId: uuidOf(711), actorId: "local-operator" },
      presentation: { layout: "batch", groupInQueue: true, version: 3, startedAt: done.startedAt } };
    const ids = new Set([done.runId, failed.runId, running.runId, prior.runId]);
    const dayWire = DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE,
      queueSurfaces: FIXTURE_DAY_WIRE.queueSurfaces.map(row => {
        if (!ids.has(row.runId)) return row;
        return { ...row, session, ...(row.runId === prior.runId ? { itemId: done.itemId, attempt: 1 } : {}),
          ...(row.runId === done.runId ? { attempt: 2, outcome: { label: "Active", tone: "success" } } : {}),
          ...(row.runId === running.runId ? { pauseControl: { state: "running", expectedVersion: row.rowRevision, command: "pause" },
            actions: [{ kind: "command", key: "pause", command: "pause", expectedVersion: row.rowRevision,
              label: "Pause after this step", intent: "neutral", icon: "pause", placement: ["footer"] }, ...row.actions] } : {}) };
      }),
    });
    const requests: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() === "POST" && request.url().includes("/commands")) requests.push(request.url()); });
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, dayWire });
    try {
      await page.addInitScript(value => { Reflect.set(window, "relayParityTheme", value); }, theme);
      await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
      const queue = page.getByRole("region", { name: "Queue", exact: true });
      const group = queue.locator(`[data-queue-batch-id='${batchId}']`);
      await expect(group).toBeVisible();
      await expect(group.locator('tbody tr[data-demo-row-id]')).toHaveCount(3);
      await expect(group).toContainText("3 people on this day");
      await expect(group).toContainText("Active");
      const footer = group.locator('[data-queue-row-footer]');
      const sessionFacts = footer.locator(":scope > div").first();
      const identity = await sessionFacts.innerText();
      for (const row of [done, failed, running]) {
        await expect(sessionFacts).not.toContainText(row.traceId);
        await group.locator(`tr[data-demo-row-id='${row.runId}'] td:last-child`).click();
        await expect.poll(() => new URL(page.url()).searchParams.get("run")).toBe(row.runId);
        const memberActions = group.locator('[data-queue-member-actions]');
        await expect(memberActions).toHaveAccessibleName(`Actions for ${row.title}, attempt ${row.runId === done.runId ? 2 : row.attempt}`);
        for (const action of row.actions.filter(action => action.placement.includes("footer"))) {
          await expect(memberActions.getByRole("button", { name: action.label, exact: true })).toBeVisible();
        }
      }
      await group.locator(`tr[data-demo-row-id='${failed.runId}'] button`).first().focus();
      await page.keyboard.press("Enter");
      await expect.poll(() => new URL(page.url()).searchParams.get("run")).toBe(failed.runId);
      await group.locator(`tr[data-demo-row-id='${running.runId}'] button`).first().focus();
      await page.keyboard.press("Space");
      await expect.poll(() => new URL(page.url()).searchParams.get("run")).toBe(running.runId);
      await expect.poll(() => sessionFacts.innerText()).toBe(identity);
      const memberActions = group.locator('[data-queue-member-actions]');
      await memberActions.getByRole("button", { name: "Cancel run", exact: true }).click();
      const cancel = page.getByRole("dialog", { name: "Cancel this run", exact: true });
      await expect(cancel).toContainText(running.title);
      await expect(cancel).toContainText(running.traceId);
      await expect(cancel).toContainText(`revision ${running.rowRevision}`);
      await cancel.getByRole("button", { name: "Keep it as it is", exact: true }).click();
      await group.locator(`tr[data-demo-row-id='${done.runId}'] td:last-child`).click();
      await memberActions.getByRole("button", { name: "Delete run", exact: true }).click();
      const deletion = page.getByRole("dialog", { name: "Delete this run", exact: true });
      await expect(deletion).toContainText(done.title);
      await expect(deletion).toContainText(`revision ${done.rowRevision}`);
      await deletion.getByRole("button", { name: "Keep it as it is", exact: true }).click();
      const rerunReads: string[] = [];
      await page.route("**/api/v1/runs/*/rerun-values?*", route => {
        rerunReads.push(route.request().url());
        return route.fulfill({ status: 409, json: { state: "refused", code: "source-stale" } });
      });
      await memberActions.getByRole("button", { name: "Rerun", exact: true }).click();
      const rerun = page.getByRole("dialog", { name: "Rerun", exact: true });
      await expect(rerun).toBeVisible();
      await expect.poll(() => rerunReads.length).toBe(1);
      expect(new URL(rerunReads[0]).pathname).toBe(`/api/v1/runs/${done.runId}/rerun-values`);
      expect(new URL(rerunReads[0]).searchParams.get("expectedVersion")).toBe(String(done.rowRevision));
      await expect(rerun).toContainText("source-stale");
      await page.keyboard.press("Escape");
      await expect(rerun).toHaveCount(0);
      const attempts = group.getByRole("button", { name: `Attempts for ${done.title}`, exact: true });
      await attempts.click();
      await page.getByRole("menuitemradio", { name: /#1 Cancelled/u }).focus();
      await page.keyboard.press("Enter");
      await expect.poll(() => new URL(page.url()).searchParams.get("run")).toBe(prior.runId);
      await expect(group.locator('tbody tr[data-demo-row-id]')).toHaveCount(3);
      await page.getByRole("button", { name: "Filter queue by status", exact: true }).click();
      await page.getByRole("menuitemcheckbox", { name: /^Failed /u }).click();
      await page.keyboard.press("Escape");
      await expect(group.locator('tbody tr[data-demo-row-id]')).toHaveCount(3);
      await page.reload();
      await expect(group.locator('tbody tr[data-demo-row-id]')).toHaveCount(3);
      await expect.poll(() => sessionFacts.innerText()).toBe(identity);
      await expect(group.getByRole("button", { name: /Retry|Show separately|Group batch/u })).toHaveCount(0);
      expect(requests).toEqual([]);
      expect(errors).toEqual([]);
      await group.scrollIntoViewIfNeeded();
      await expect(group.locator('[data-queue-row-footer]')).toHaveCount(1);
      const footerLayout = await footer.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const columns = [...element.children].map(child => child.getBoundingClientRect());
        return { height: bounds.height, fits: element.scrollWidth <= element.clientWidth,
          centerDifference: Math.abs(columns[0].y + columns[0].height / 2 - columns[1].y - columns[1].height / 2) };
      });
      expect(footerLayout.height).toBeLessThanOrEqual(34);
      expect(footerLayout.fits).toBe(true);
      expect(footerLayout.centerDifference).toBeLessThanOrEqual(1);
      const image = await group.screenshot();
      await info.attach(`lookup-batch-${theme}-${width}.png`, { body: image, contentType: "image/png" });
      const tree = await page.locator("body").ariaSnapshot();
      info.annotations.push({ type: `a11y-attachment-sha256:${a11yName}`, description: createHash("sha256").update(tree).digest("hex") });
      await info.attach(a11yName, { body: tree, contentType: "text/yaml" });
      const pauseRequests: unknown[] = [];
      await page.route("**/api/v1/commands", route => {
        pauseRequests.push(CommandRequestSchema.parse(route.request().postDataJSON()));
        return route.fulfill({ status: 503, json: { state: "error", code: "COMMAND_OUTCOME_UNCERTAIN", message: "Synthetic lost response", retryable: false } });
      });
      await group.locator(`tr[data-demo-row-id='${running.runId}'] td:last-child`).click();
      await memberActions.getByRole("button", { name: "Pause after this step", exact: true }).click();
      await expect.poll(() => pauseRequests.length).toBe(1);
      expect(pauseRequests[0]).toMatchObject({ family: "run", type: "pause",
        target: { runId: running.runId, expectedVersion: running.rowRevision } });
      expect(requests).toHaveLength(1);
      expect(errors).toEqual([]);
    } finally { await server.close(); }
  });
}
