/** Sessions dock smoke: the console sits flush under the queue and the log, its icon and × move focus, arrows resize it, and frames of it for review. */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DashboardDayWireSchema, WorkerCardWireSchema } from "../../src/models/dashboard/projection.js";
import { workerPoolMember, WorkerSlotRecordSchema } from "../../src/models/run/worker-slot.js";
import { SEEDED_NOW } from "../support/helpers/dashboard/served-fixtures/seeded-bff.js";
import { expect, SEEDED_PREFERENCE_WRITE, test } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";

const FRAMES = join(import.meta.dirname, ".output/states/sessions-dock-frames");
const VIEWPORTS = [{ width: 1280, height: 720 }, { width: 1600, height: 900 }] as const;

for (const viewport of VIEWPORTS) {
  test.describe(`sessions dock at ${String(viewport.width)}x${String(viewport.height)}`, () => {
    test.use({ viewport });

    test("opens from its icon with focus inside, resizes by arrow keys, and × returns focus to the icon", async ({ dashboard, failures, page }) => {
      failures.allow(SEEDED_PREFERENCE_WRITE, "the seeded backend cannot save the chosen workflow");
      mkdirSync(FRAMES, { recursive: true });
      // The seeded world has no workers: serve one running a seeded run and one idle.
      await page.route("**/api/v1/dashboard?day=*", async route => {
        const response = await route.fetch(), day = DashboardDayWireSchema.parse(await response.json());
        const run = day.queueSurfaces[0];
        if (run === undefined) throw new Error("the seeded day has no run");
        const workers = [{ ordinal: 98, workflowId: run.workflowId, running: true }, { ordinal: 99, workflowId: run.workflowId, running: false }].map(({ ordinal, workflowId, running }) => {
          const slot = WorkerSlotRecordSchema.parse({ workerId: `${workflowId}-worker-${String(ordinal)}`, workflow: workflowId, ordinal, poolIndex: 1, paused: false, retiredAt: null, createdAt: SEEDED_NOW, updatedAt: SEEDED_NOW });
          return { slot, card: WorkerCardWireSchema.parse({ workerId: slot.workerId, member: workerPoolMember(slot), workflowId, state: running ? "running" : "idle", directive: "run", startedAt: SEEDED_NOW,
            currentRun: running ? { state: "present", runId: run.runId, traceId: run.traceId } : { state: "absent", reason: "no current run" },
            browserRequirements: { state: "present", systems: ["crm", "ucpath"] }, browsers: [], revision: 1 }) };
        });
        if (day.workerAuthority.state !== "present") throw new Error("the seeded day has no worker authority");
        await route.fulfill({ response, json: DashboardDayWireSchema.parse({ ...day,
          workerAuthority: { state: "present", members: [...day.workerAuthority.members, ...workers.map(worker => worker.slot)] },
          workerCards: [...day.workerCards, ...workers.map(worker => worker.card)] }) });
      });
      await dashboard.open();
      const shot = (name: string) => page.screenshot({ path: join(FRAMES, `${name}-${String(viewport.width)}.png`), animations: "disabled" });
      const toggle = page.getByRole("button", { name: "Sessions console", exact: true });
      await expect(toggle.locator("xpath=..").locator("[data-sessions-dot]")).toHaveAttribute("data-sessions-dot", "running");
      await shot("closed");

      await toggle.focus();
      await page.keyboard.press("Enter");
      const panel = page.locator("#sessions-console");
      await expect(panel).toBeFocused();
      // The seeded world serves its own workers too.
      await expect(panel.getByRole("article", { name: /^Worker 9[89] / })).toHaveCount(2);
      await shot("console");

      const box = async (selector: string) => {
        const found = await page.locator(selector).boundingBox();
        if (found === null) throw new Error(`${selector} is not drawn`);
        return found;
      };
      const dock = await box("#sessions-console"), rail = await box("aside:has([aria-controls='sessions-console'])"), log = await box(".dashboard-log-column");
      expect(Math.round(dock.x), "flush to the sidebar").toBe(Math.round(rail.x + rail.width));
      expect(Math.round(dock.x + dock.width), "flush to the right edge").toBe(viewport.width);
      expect(Math.round(dock.y + dock.height), "flush to the bottom edge").toBe(viewport.height);
      expect(log.y + log.height, "the log ends above the console").toBeLessThanOrEqual(dock.y + 1);
      expect(await page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight)).toBe(0);

      const grip = page.getByRole("separator", { name: "Resize Sessions" });
      await grip.focus();
      await page.keyboard.press("ArrowDown");
      await expect.poll(async () => (await box("#sessions-console")).height).toBeLessThan(dock.height);

      const close = page.getByRole("button", { name: "Close Sessions", exact: true });
      await close.focus();
      await page.keyboard.press("Enter");
      await expect(toggle).toBeFocused();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
    });
  });
}
