/** Scripted run smoke: a started run goes through its steps and gate to done while the open dashboard follows it, and its write is recorded once. */
import { SEEDED_NOW } from "../support/helpers/dashboard/served-fixtures/seeded-bff.js";
import { seededRequestOver, startScriptedRun } from "../support/helpers/dashboard/served-fixtures/seeded-scripted-executor.js";
import { RunDetailWireSchema } from "../../src/models/dashboard/run-detail.js";
import { expect, test } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";

test("a started run reaches its gate, is approved in Logs and finishes with one recorded write", async ({ dashboard, seeded, page, failures }) => {
  const request = seededRequestOver(seeded.baseUrl);
  const status = async (runId: string) => RunDetailWireSchema.parse(await request(`/api/v1/runs/${runId}`)).header.status;
  const written = seeded.scripted.writes().length;
  await dashboard.open();
  await dashboard.openWorkflow("Work-Study");

  // The run starts after the page loaded, so its row and every later state reach the page over the event stream.
  const runId = await startScriptedRun(request, SEEDED_NOW, "10812345", seeded.scripted.reviewReference());
  failures.allow(new RegExp(String.raw`^requestfailed: http://127\.0\.0\.1:\d+/api/v1/runs/${runId}(?:/[a-z-]+)? net::ERR_ABORTED$`, "u"),
    "The panel abandons a read of the run in flight when the run's next state arrives, and reads again.");
  const row = page.locator(`[data-demo-row-id="${runId}"]`);
  await expect(row).toBeVisible();
  await dashboard.openRun(runId);

  const run = await seeded.scripted.drive(runId);
  expect(run.position).toEqual({ at: "step", nodeId: "paypath-position" });
  await expect(row).toContainText("Running");
  expect(await run.advance()).toMatchObject({ at: "settled", outcome: { state: "parked-gate" } });
  expect(seeded.scripted.writes().length).toBe(written);

  await dashboard.runPanel.getByRole("button", { name: "Continue anyway", exact: true }).click();
  await expect.poll(() => status(runId), { message: "the approved run returns to the queue" }).toBe("queued");

  const resumed = await seeded.scripted.drive(runId);
  expect(await resumed.advance()).toEqual({ at: "step", nodeId: "save-transaction" });
  expect(seeded.scripted.writes().length).toBe(written);
  expect(await resumed.advance()).toMatchObject({ at: "settled", outcome: { state: "done" } });

  await expect(row).toContainText("Done");
  await expect(dashboard.runPanel.getByText("Done", { exact: true }).first()).toBeVisible();
  expect(seeded.scripted.writes().slice(written)).toEqual([{ runId, nodeId: "save-transaction", eid: "10812345" }]);
});
