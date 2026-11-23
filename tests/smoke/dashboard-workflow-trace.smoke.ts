/** Workflow trace: a started run is followed through running, its gate and done, and its write is recorded once. */
import { SEEDED_NOW } from "../support/helpers/dashboard/served-fixtures/seeded-bff.js";
import { approveScriptedGate, seededRequestOver, sendScriptedRunCommand, startScriptedRun } from "../support/helpers/dashboard/served-fixtures/seeded-scripted-executor.js";
import { CRM_DOC_DOWNLOAD_SCRIPT, crmDocEmail, PERSON_LOOKUP_SCRIPT, SEPARATIONS_SCRIPT } from "../support/helpers/dashboard/served-fixtures/scripted-workflows.js";
import { readdirSync } from "node:fs";
import { COMPOSITION_EID } from "../support/helpers/separations-composition-fixtures.js";
import { appliedRunIds } from "../support/fixtures/operator-command-fixtures.js";
import { RunDetailWireSchema } from "../../src/models/dashboard/run-detail.js";
import { SEEDED_PREFERENCE_WRITE } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";
import { expect, test } from "../support/helpers/dashboard/smoke/scripted-run-fixtures.js";

const abortedRead = (runId: string) => new RegExp(String.raw`^requestfailed: http://127\.0\.0\.1:\d+/api/v1/runs/${runId}(?:/[a-z-]+)? net::ERR_ABORTED$`, "u");
const ABORTED_READ_REASON = "The panel abandons a read of the run in flight when the run's next state arrives, and reads again.";

test("Work-Study: start, gate, answered once, done, then Back, Forward and Reload hold the URL's state", async ({ dashboard, seeded, page, failures }) => {
  const request = seededRequestOver(seeded.baseUrl);
  const status = async (runId: string) => RunDetailWireSchema.parse(await request(`/api/v1/runs/${runId}`)).header.status;
  failures.allow(SEEDED_PREFERENCE_WRITE, "Choosing a workflow saves a preference; the seeded backend wires no settings executor.");
  await dashboard.open();
  await dashboard.openWorkflow("Work-Study");

  const runId = await startScriptedRun(request, SEEDED_NOW, "10812345", seeded.scripted.reviewReference());
  failures.allow(abortedRead(runId), ABORTED_READ_REASON);
  failures.allow(new RegExp(String.raw`^(?:http 409: GET |console: Failed to load resource: the server responded with a status of 409 \(Conflict\) )http://127\.0\.0\.1:\d+/api/v1/runs/${runId}/identity-gate$`, "u"),
    "The panel asks for an identity review of the parked reference-check gate, which holds none, and offers no answer control (#580).");
  const row = page.locator(`[data-demo-row-id="${runId}"]`);
  await expect(row).toBeVisible();
  await dashboard.openRun(runId);

  const run = await seeded.scripted.drive(runId);
  await expect(row).toContainText("Running");
  expect(await run.advance()).toMatchObject({ at: "settled", outcome: { state: "parked-gate" } });

  // The shipped Logs panel offers no control for this reference-check gate (#580), so the answer is the command a gate control would send.
  await approveScriptedGate(request, SEEDED_NOW, runId);
  await expect.poll(() => status(runId), { message: "the approved run returns to the queue" }).toBe("queued");

  const written = seeded.scripted.writes().length;
  const resumed = await seeded.scripted.drive(runId);
  expect(await resumed.advance()).toEqual({ at: "step", nodeId: "save-transaction" });
  expect(seeded.scripted.writes().length).toBe(written);
  expect(await resumed.advance()).toMatchObject({ at: "settled", outcome: { state: "done" } });
  await expect(row).toContainText("Done");
  await expect(row).not.toContainText("Running");
  expect(seeded.scripted.writes().slice(written)).toEqual([{ runId, nodeId: "save-transaction", eid: "10812345" }]);

  await dashboard.settleReads();
  await page.reload();
  await dashboard.expectRunOpen(runId);
  await expect(dashboard.runPanel.getByText("Done", { exact: true }).first()).toBeVisible();
  await dashboard.settleReads();
  await page.goBack();
  await expect(page.getByText("No run open")).toBeVisible();
  await page.goForward();
  await dashboard.expectRunOpen(runId);
  expect(seeded.scripted.writes().slice(written)).toHaveLength(1);
});

test("Work-Study: a failed step shows Failed on the row and writes nothing", async ({ dashboard, seeded, page, failures }) => {
  const request = seededRequestOver(seeded.baseUrl);
  failures.allow(SEEDED_PREFERENCE_WRITE, "Choosing a workflow saves a preference; the seeded backend wires no settings executor.");
  await dashboard.open();
  await dashboard.openWorkflow("Work-Study");
  const written = seeded.scripted.writes().length;
  const runId = await startScriptedRun(request, SEEDED_NOW, "10812346");
  failures.allow(abortedRead(runId), ABORTED_READ_REASON);
  const row = page.locator(`[data-demo-row-id="${runId}"]`);
  await expect(row).toBeVisible();
  const run = await seeded.scripted.drive(runId);
  expect(await run.fail()).toMatchObject({ at: "settled" });
  await expect(row).toContainText("Failed");
  await expect(row).not.toContainText("Running");
  expect(seeded.scripted.writes().length).toBe(written);
});


test("Work-Study: Retry after a failed step runs it again and writes once", async ({ dashboard, seeded, page, failures }) => {
  const request = seededRequestOver(seeded.baseUrl);
  failures.allow(SEEDED_PREFERENCE_WRITE, "Choosing a workflow saves a preference; the seeded backend wires no settings executor.");
  await dashboard.open();
  await dashboard.openWorkflow("Work-Study");
  const runId = await startScriptedRun(request, SEEDED_NOW, "10812345");
  failures.allow(abortedRead(runId), ABORTED_READ_REASON);
  const row = page.locator(`[data-demo-row-id="${runId}"]`);
  await expect(row).toBeVisible();
  const failed = await seeded.scripted.drive(runId);
  await failed.fail();
  await expect(row).toContainText("Failed");
  expect(seeded.scripted.writes()).toHaveLength(0);

  // A retry applies to the failed run and the new run it queues.
  const queuedByRetry = appliedRunIds(await sendScriptedRunCommand(request, SEEDED_NOW, runId, "retry")).filter(id => id !== runId);
  expect(queuedByRetry).toHaveLength(1);
  const [retried] = queuedByRetry;
  if (retried === undefined) throw new Error("the retry queued no run");
  failures.allow(abortedRead(retried), ABORTED_READ_REASON);
  const again = await seeded.scripted.drive(retried);
  await expect(page.locator(`[data-demo-row-id="${retried}"]`)).toContainText("Running");
  expect(await again.finish()).toMatchObject({ state: "done" });
  await expect(page.locator(`[data-demo-row-id="${retried}"]`)).toContainText("Done");
  expect(seeded.scripted.writes()).toEqual([{ runId: retried, nodeId: "save-transaction", eid: "10812345" }]);
});

test("Work-Study: a write whose answer is lost parks the run and is asked for once", async ({ dashboard, seeded, page, failures }) => {
  const request = seededRequestOver(seeded.baseUrl);
  failures.allow(SEEDED_PREFERENCE_WRITE, "Choosing a workflow saves a preference; the seeded backend wires no settings executor.");
  await dashboard.open();
  await dashboard.openWorkflow("Work-Study");
  const runId = await startScriptedRun(request, SEEDED_NOW, "10812345");
  failures.allow(abortedRead(runId), ABORTED_READ_REASON);
  const row = page.locator(`[data-demo-row-id="${runId}"]`);
  await expect(row).toBeVisible();
  await dashboard.openRun(runId);
  const run = await seeded.scripted.drive(runId);
  expect(await run.advance()).toEqual({ at: "step", nodeId: "save-transaction" });
  expect(await run.parkWrite()).toMatchObject({ at: "settled", outcome: { state: "parked-write" } });
  await expect.poll(async () => RunDetailWireSchema.parse(await request(`/api/v1/runs/${runId}`)).header.status, { message: "the parked write is not Done" }).toBe("blocked");
  await dashboard.settleReads();
  await page.reload();
  await dashboard.expectRunOpen(runId);
  await expect(page.locator(`[data-demo-row-id="${runId}"]`)).toContainText("Write parked");
  expect(seeded.scripted.writes()).toEqual([{ runId, nodeId: "save-transaction", eid: "10812345" }]);
});

test("Work-Study: Cancel on a run parked at its gate ends it as Cancelled and writes nothing", async ({ dashboard, seeded, page, failures }) => {
  const request = seededRequestOver(seeded.baseUrl);
  failures.allow(SEEDED_PREFERENCE_WRITE, "Choosing a workflow saves a preference; the seeded backend wires no settings executor.");
  await dashboard.open();
  await dashboard.openWorkflow("Work-Study");
  const runId = await startScriptedRun(request, SEEDED_NOW, "10812345", seeded.scripted.reviewReference());
  failures.allow(abortedRead(runId), ABORTED_READ_REASON);
  const row = page.locator(`[data-demo-row-id="${runId}"]`);
  await expect(row).toBeVisible();
  const run = await seeded.scripted.drive(runId);
  expect(await run.advance()).toMatchObject({ at: "settled", outcome: { state: "parked-gate" } });
  expect(await sendScriptedRunCommand(request, SEEDED_NOW, runId, "cancel")).toMatchObject({ state: "applied" });
  await expect(row).toContainText("Cancelled");
  expect(seeded.scripted.writes()).toHaveLength(0);
});

test("Work-Study: a slow step keeps the run Running and its duration is recorded", async ({ dashboard, seeded, page, failures }) => {
  const request = seededRequestOver(seeded.baseUrl);
  failures.allow(SEEDED_PREFERENCE_WRITE, "Choosing a workflow saves a preference; the seeded backend wires no settings executor.");
  await dashboard.open();
  await dashboard.openWorkflow("Work-Study");
  const runId = await startScriptedRun(request, SEEDED_NOW, "10812345");
  failures.allow(abortedRead(runId), ABORTED_READ_REASON);
  const row = page.locator(`[data-demo-row-id="${runId}"]`);
  await expect(row).toBeVisible();
  const run = await seeded.scripted.drive(runId);
  await expect(row).toContainText("Running");
  await run.advance(90_000);
  await expect(row).toContainText("Running");
  expect(await run.advance()).toMatchObject({ at: "settled" });
  const durations = RunDetailWireSchema.parse(await request(`/api/v1/runs/${runId}`)).timeline.events.flatMap(event => event.durationMs?.state === "present" ? [event.durationMs.ms] : []);
  expect(Math.max(0, ...durations)).toBeGreaterThanOrEqual(90_000);
});

test("Person Lookup: start, each step held, done, and nothing written", async ({ dashboard, seeded, page, failures }) => {
  const request = seededRequestOver(seeded.baseUrl);
  failures.allow(SEEDED_PREFERENCE_WRITE, "Choosing a workflow saves a preference; the seeded backend wires no settings executor.");
  await dashboard.open();
  await dashboard.openWorkflow("Person Lookup");
  const runId = await startScriptedRun(request, SEEDED_NOW, "10000001", undefined, PERSON_LOOKUP_SCRIPT);
  failures.allow(abortedRead(runId), ABORTED_READ_REASON);
  const row = page.locator(`[data-demo-row-id="${runId}"]`);
  await expect(row).toBeVisible();
  const run = await seeded.scripted.drive(runId);
  await expect(row).toContainText("Running");
  expect(run.position).toMatchObject({ at: "step" });
  let position = run.position;
  while (position.at === "step") position = await run.advance();
  expect(position).toMatchObject({ at: "settled", outcome: { state: "done" } });
  await expect(row).toContainText("Done");
  expect(seeded.scripted.writes()).toHaveLength(0);
});

const crmDocFiles = (directory: string): string[] => { try { return readdirSync(directory, { recursive: true, encoding: "utf8" }).filter(name => name.endsWith(".zip")); } catch { return []; } };

/** The workflow is a hidden source (#437): it has no sidebar entry or queue, so the run is reached by URL and the rest is asserted through the API. */
async function openHiddenRun(page: import("@playwright/test").Page, baseUrl: string, day: string, runId: string): Promise<void> {
  const url = new URL("/", baseUrl);
  url.searchParams.set("day", day);
  url.searchParams.set("run", runId);
  await page.goto(url.toString());
}

test("CRM Document Download: started through the API, each step held, done in the run panel, one archive published and nothing written", async ({ dashboard, seeded, page, failures }) => {
  const request = seededRequestOver(seeded.baseUrl);
  const status = async (runId: string) => RunDetailWireSchema.parse(await request(`/api/v1/runs/${runId}`)).header.status;
  failures.allow(SEEDED_PREFERENCE_WRITE, "Choosing a workflow saves a preference; the seeded backend wires no settings executor.");
  const roster = seeded.scripted.rosterReference([[crmDocEmail("10000001"), "Legal", "Fixture"]]);
  const runId = await startScriptedRun(request, SEEDED_NOW, "10000001", roster, CRM_DOC_DOWNLOAD_SCRIPT);
  failures.allow(abortedRead(runId), ABORTED_READ_REASON);
  await openHiddenRun(page, seeded.baseUrl, seeded.day, runId);
  await dashboard.expectRunOpen(runId);
  const run = await seeded.scripted.drive(runId);
  expect(run.position).toEqual({ at: "step", nodeId: "document-records" });
  await expect.poll(() => status(runId), { message: "the held run is running" }).toBe("running");
  expect(await run.advance()).toEqual({ at: "step", nodeId: "document-pdfs" });
  expect(crmDocFiles(seeded.scripted.documentsDirectory())).toHaveLength(0);
  expect(await run.advance()).toMatchObject({ at: "settled", outcome: { state: "done" } });
  await expect.poll(() => status(runId), { message: "the finished run is done" }).toBe("done");
  await expect(dashboard.runPanel.getByText("Done", { exact: true }).first()).toBeVisible();
  expect(seeded.scripted.writes()).toHaveLength(0);
  expect(crmDocFiles(seeded.scripted.documentsDirectory())).toEqual(["July 6/July 6.zip"]);
});

test("CRM Document Download: a failed download shows Failed in the run panel and publishes nothing", async ({ dashboard, seeded, page, failures }) => {
  const request = seededRequestOver(seeded.baseUrl);
  failures.allow(SEEDED_PREFERENCE_WRITE, "Choosing a workflow saves a preference; the seeded backend wires no settings executor.");
  const roster = seeded.scripted.rosterReference([[crmDocEmail("10000002"), "Legal", "Fixture"]]);
  const runId = await startScriptedRun(request, SEEDED_NOW, "10000002", roster, CRM_DOC_DOWNLOAD_SCRIPT);
  failures.allow(abortedRead(runId), ABORTED_READ_REASON);
  await openHiddenRun(page, seeded.baseUrl, seeded.day, runId);
  await dashboard.expectRunOpen(runId);
  const run = await seeded.scripted.drive(runId);
  expect(await run.advance()).toEqual({ at: "step", nodeId: "document-pdfs" });
  expect(await run.fail()).toMatchObject({ at: "settled" });
  await expect(dashboard.runPanel.getByText("Failed", { exact: true }).first()).toBeVisible();
  expect(seeded.scripted.writes()).toHaveLength(0);
  expect(crmDocFiles(seeded.scripted.documentsDirectory())).toHaveLength(0);
});

const SEPARATION_STEPS = ["resolve-action", "document", "name-search", "job-summary", "timecard-search", "timecard", "pending-set", "clear-pending", "file-termination", "filing-presence", "finalize-kuali"];

test("Separations: start, each step held, done, and one write to UCPath and one to Kuali", async ({ dashboard, seeded, page, failures }) => {
  const request = seededRequestOver(seeded.baseUrl);
  failures.allow(SEEDED_PREFERENCE_WRITE, "Choosing a workflow saves a preference; the seeded backend wires no settings executor.");
  await dashboard.open();
  await dashboard.openWorkflow("Separations");
  const runId = await startScriptedRun(request, SEEDED_NOW, "4501", undefined, SEPARATIONS_SCRIPT);
  failures.allow(abortedRead(runId), ABORTED_READ_REASON);
  const row = page.locator(`[data-demo-row-id="${runId}"]`);
  await expect(row).toBeVisible();
  await dashboard.openRun(runId);
  const run = await seeded.scripted.drive(runId);
  await expect(row).toContainText("Running");
  const held: string[] = [];
  let position = run.position;
  while (position.at === "step") {
    held.push(position.nodeId);
    position = await run.advance();
  }
  expect(position).toMatchObject({ at: "settled", outcome: { state: "done" } });
  expect(held, "each system-touching step is held once, in order").toEqual(SEPARATION_STEPS);
  await expect(row).toContainText("Done");
  await expect(row).not.toContainText("Running");
  expect(seeded.scripted.writes()).toEqual([
    { runId, nodeId: "file-termination", eid: COMPOSITION_EID },
    { runId, nodeId: "finalize-kuali", eid: COMPOSITION_EID },
  ]);
  await dashboard.settleReads();
  await page.reload();
  await dashboard.expectRunOpen(runId);
  await expect(dashboard.runPanel.getByText("Done", { exact: true }).first()).toBeVisible();
  expect(seeded.scripted.writes()).toHaveLength(2);
});

/** Each step, broken, ends the run as Failed; the writes before it stand and the ones after it never happen. */
for (const [step, writesBefore] of [["resolve-action", 0], ["document", 0], ["name-search", 0], ["job-summary", 0], ["timecard-search", 0], ["timecard", 0], ["file-termination", 0], ["finalize-kuali", 1]] as const) {
  test(`Separations: a failed ${step} step shows Failed on the row and leaves ${String(writesBefore)} write${writesBefore === 1 ? "" : "s"}`, async ({ dashboard, seeded, page, failures }) => {
    const request = seededRequestOver(seeded.baseUrl);
    failures.allow(SEEDED_PREFERENCE_WRITE, "Choosing a workflow saves a preference; the seeded backend wires no settings executor.");
    await dashboard.open();
    await dashboard.openWorkflow("Separations");
    const runId = await startScriptedRun(request, SEEDED_NOW, "4502", undefined, SEPARATIONS_SCRIPT);
    failures.allow(abortedRead(runId), ABORTED_READ_REASON);
    const row = page.locator(`[data-demo-row-id="${runId}"]`);
    await expect(row).toBeVisible();
    const run = await seeded.scripted.drive(runId);
    let position = run.position;
    while (position.at === "step" && position.nodeId !== step) position = await run.advance();
    expect(position).toEqual({ at: "step", nodeId: step });
    expect(await run.fail()).toMatchObject({ at: "settled" });
    await expect(row).toContainText("Failed");
    await expect(row).not.toContainText("Running");
    expect(seeded.scripted.writes()).toHaveLength(writesBefore);
  });
}
