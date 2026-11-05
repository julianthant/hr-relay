import { createHash } from "node:crypto";
import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { installFrozenMonotonic } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { FIXTURE_DAY, uuidOf } from "./helpers/fixture-identity.js";
import { FIXTURE_DAY_WIRE } from "./helpers/fixture-queue.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { createDashboardModelFixtures } from "../support/helpers/dashboard-model-fixtures.js";
import { DashboardDayWireSchema } from "../../src/models/dashboard/projection.js";
import { RunDetailWireSchema, RunDetailSectionResponseSchema } from "../../src/models/dashboard/run-detail.js";
import { CommandRequestSchema } from "../../src/rules/commands/commands.js";

for (const theme of ["light", "dark"] as const) for (const width of [1024, 1440]) {
  const a11yName = `person-retry-header-${theme}-${width}.a11y.yml`;
  test(`failed Lookup batch person header Retry keeps keyboard and pending authority, ${theme}-${width}`, {
    annotation: [{ type: "required-a11y-evidence", description: a11yName }],
  }, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 1024 ? 720 : 900 });
    const source = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.parent === null && row.status === "failed");
    const sibling = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.parent === null && row.status === "done");
    if (source === undefined || sibling === undefined) throw new Error("person retry fixture missing");
    const session = { state: "present", sessionId: uuidOf(950), origin: { kind: "start-plan", startPlanId: uuidOf(951), actorId: "local-operator" },
      presentation: { groupInQueue: true, version: 1, startedAt: source.startedAt } };
    const day = DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, queueSurfaces: [source, sibling].map(row => ({ ...row, workflowId: "person-lookup", session,
      ...(row === source ? { actions: [{ kind: "command", command: "retry", key: "retry-batch-member", label: "Retry", icon: "retry", intent: "neutral", placement: ["banner"], expectedVersion: row.rowRevision }] } : {}) })) });
    const selected = day.queueSurfaces[0], f = createDashboardModelFixtures();
    const detail = RunDetailWireSchema.parse({ ...f.DETAIL, runId: selected.runId, rowRevision: selected.rowRevision, timeline: { steps: [], events: [] },
      header: { runId: selected.runId, workflowId: selected.workflowId, traceId: selected.traceId, title: selected.title, status: selected.status, attempt: selected.attempt },
      gate: { state: "absent", reason: "fixture" }, outcome: { state: "absent", reason: "fixture" }, availableSections: ["logs"] });
    const logs = RunDetailSectionResponseSchema.parse({ section: "logs", payload: { runId: selected.runId, rows: [], notes: [], confirmedActions: [], confirmedActionBindings: [], nextCursor: { state: "absent", reason: "end-of-page" } } });
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, dayWire: day });
    const requests: unknown[] = [];
    let release: (() => void) | undefined;
    const wait = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**/api/v1/runs/${selected.runId}`, route => route.fulfill({ json: detail }));
    await page.route(`**/api/v1/runs/${selected.runId}/sections/logs*`, route => route.fulfill({ json: logs }));
    await page.route("**/api/v1/commands", async route => {
      const request = CommandRequestSchema.parse(route.request().postDataJSON()); requests.push(request); await wait;
      await route.fulfill({ status: 422, json: { state: "rejected", commandId: request.commandId, code: "policy-refused", message: "Synthetic refusal" } });
    });
    try {
      await page.addInitScript(value => { Reflect.set(window, "relayParityTheme", value); }, theme);
      await installFrozenMonotonic(page);
      await page.goto(`${server.baseUrl}/?fixture=picked-a&day=${FIXTURE_DAY}&run=${selected.runId}`);
      const logsPanel = page.getByRole("region", { name: "Selected run logs" });
      const retry = logsPanel.locator("header").getByRole("button", { name: "Retry", exact: true });
      await expect(retry).toHaveCount(1); await expect(retry).toBeEnabled();
      await page.getByRole("button", { name: "Close assistant" }).click();
      await expect(page.getByRole("region", { name: "Assistant panel" })).toBeHidden();
      await expect(page.getByRole("region", { name: "Queue", exact: true }).getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
      await retry.focus(); await page.keyboard.press("Enter");
      await expect.poll(() => requests.length).toBe(1); await expect(retry).toBeDisabled();
      const request = CommandRequestSchema.parse(requests[0]);
      expect(request.family).toBe("run"); expect(request.type).toBe("retry"); expect(request.target).toEqual({ runId: selected.runId, expectedVersion: selected.rowRevision });
      release?.(); await expect(retry).toBeEnabled(); expect(requests).toHaveLength(1);
      const tree = await logsPanel.ariaSnapshot();
      info.annotations.push({ type: `a11y-attachment-sha256:${a11yName}`, description: createHash("sha256").update(tree).digest("hex") });
      await info.attach(a11yName, { body: tree, contentType: "text/yaml" });
      await info.attach(`person-retry-header-${theme}-${width}.png`, { body: await logsPanel.screenshot(), contentType: "image/png" });
    } finally { release?.(); await server.close(); }
  });
}
