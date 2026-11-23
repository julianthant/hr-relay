/** Workflow trace: a started run is followed through running, its gate and done, and its write is recorded once. */
import { SEEDED_NOW } from "../support/helpers/dashboard/served-fixtures/seeded-bff.js";
import { approveScriptedGate, seededRequestOver, startScriptedRun } from "../support/helpers/dashboard/served-fixtures/seeded-scripted-executor.js";
import { CRM_DOC_DOWNLOAD_SCRIPT, crmDocEmail, PERSON_LOOKUP_SCRIPT } from "../support/helpers/dashboard/served-fixtures/scripted-workflows.js";
import { readdirSync } from "node:fs";
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


test("Work-Study: the Start run dialog starts one run, a second press while pending sends nothing, and the run finishes", async ({ dashboard, seeded, page, failures }) => {
  failures.allow(SEEDED_PREFERENCE_WRITE, "Choosing a workflow saves a preference; the seeded backend wires no settings executor.");
  await dashboard.open();
  await dashboard.openWorkflow("Work-Study");
  await dashboard.openStartDialog();
  await dashboard.fillStartDialog("10812345");
  await dashboard.clearToasts();
  const start = await dashboard.holdCommands("start-run");
  const startButton = dashboard.dialog.getByRole("button", { name: "Start live run" });
  await startButton.click();
  await expect.poll(start.sent, { message: "the held Start reached the server" }).toBe(1);
  await dashboard.pressAgain(startButton);
  start.release();
  await dashboard.expectOneToast("Run started: 1 Work-Study run created.");
  await expect(dashboard.dialog).toBeHidden();
  expect(start.sent(), "a second press while pending sent a second command").toBe(1);
  const row = page.locator("[data-demo-row-id]");
  await expect(row).toHaveCount(1);
  const runId = await row.getAttribute("data-demo-row-id");
  if (runId === null) throw new Error("the started run has no row");
  failures.allow(abortedRead(runId), ABORTED_READ_REASON);
  const run = await seeded.scripted.drive(runId);
  expect(await run.finish()).toMatchObject({ state: "done" });
  await expect(row).toContainText("Done");
  expect(seeded.scripted.writes()).toEqual([{ runId, nodeId: "save-transaction", eid: "10812345" }]);

  // Logs opens from a press on the row itself.
  await page.goto(page.url().replace(/[?&]run=[^&]*/u, ""));
  await expect(page.getByText("No run open")).toBeVisible();
  await row.click();
  await dashboard.expectRunOpen(runId);
  await expect(dashboard.runPanel.getByRole("region", { name: "Run logs" })).toBeVisible();
});

test("Person Lookup: Rerun starts one new run, a second press while pending sends nothing", async ({ dashboard, seeded, page, failures }) => {
  const request = seededRequestOver(seeded.baseUrl);
  failures.allow(SEEDED_PREFERENCE_WRITE, "Choosing a workflow saves a preference; the seeded backend wires no settings executor.");
  await dashboard.open();
  await dashboard.openWorkflow("Person Lookup");
  const runId = await startScriptedRun(request, SEEDED_NOW, "10000001", undefined, PERSON_LOOKUP_SCRIPT);
  failures.allow(abortedRead(runId), ABORTED_READ_REASON);
  failures.allow(new RegExp(String.raw`^(?:http 500: GET |console: Failed to load resource: the server responded with a status of 500 \(Internal Server Error\) )http://127\.0\.0\.1:\d+/api/v1/runs/${runId}/logs$`, "u"),
    "The seeded Person Lookup run's logs cannot resolve a data origin for its UCPath search, so the panel's Logs read fails; Rerun does not need it.");
  const row = page.locator(`[data-demo-row-id="${runId}"]`);
  await expect(row).toBeVisible();
  expect(await (await seeded.scripted.drive(runId)).finish()).toMatchObject({ state: "done" });
  await expect(row).toContainText("Done");

  await dashboard.openRun(runId);

  await dashboard.clearToasts();
  await dashboard.runPanel.getByRole("button", { name: "Rerun" }).click();
  const rerun = page.getByRole("dialog", { name: "Rerun", exact: true });
  for (const stage of ["Steps", "Values", "Options"]) {
    await expect(rerun.getByRole("list", { name: "Run configuration path" }).getByRole("listitem").filter({ hasText: stage })).toHaveAttribute("aria-current", "step");
    await rerun.getByRole("button", { name: "Continue" }).click();
  }
  const started = await dashboard.holdCommands("start-run");
  const rerunStart = rerun.getByRole("button", { name: "Start run" });
  await rerunStart.click();
  await expect.poll(started.sent, { message: "the held Rerun reached the server" }).toBe(1);
  await dashboard.pressAgain(rerunStart);
  started.release();
  await dashboard.expectOneToast("Rerun created: 1 Person Lookup run created.");
  await expect(rerun).toBeHidden();
  expect(started.sent(), "a second press while pending sent a second command").toBe(1);
  expect(appliedRunIds(await started.result()).filter(id => id !== runId)).toHaveLength(1);
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

  // The failed run's retry control is Recover completed steps: it queues a new run for the unfinished steps.
  await dashboard.clearToasts();
  const recover = await dashboard.holdCommands("recover-run");
  await page.getByRole("button", { name: "Recover completed steps" }).click();
  const confirm = page.getByRole("dialog", { name: "Recover completed steps?" });
  const recoverButton = confirm.getByRole("button", { name: "Recover", exact: true });
  await recoverButton.click();
  await expect.poll(recover.sent, { message: "the held Recover reached the server" }).toBe(1);
  await dashboard.pressAgain(recoverButton);
  recover.release();
  expect(recover.sent(), "a second press while pending sent a second command").toBe(1);
  await dashboard.expectNoToast();
  const queuedByRetry = appliedRunIds(await recover.result()).filter(id => id !== runId);
  expect(queuedByRetry).toHaveLength(1);
  const [retried] = queuedByRetry;
  if (retried === undefined) throw new Error("the Recover queued no run");
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
  await dashboard.clearToasts();
  const cancel = await dashboard.holdCommands("cancel");
  await page.getByRole("button", { name: "Cancel run" }).click();
  const confirm = page.getByRole("dialog", { name: "Cancel this run?" });
  const cancelButton = confirm.getByRole("button", { name: "Cancel the run", exact: true });
  await cancelButton.click();
  await expect.poll(cancel.sent, { message: "the held Cancel reached the server" }).toBe(1);
  await dashboard.pressAgain(cancelButton);
  cancel.release();
  await expect(row).toContainText("Cancelled");
  expect(cancel.sent(), "a second press while pending sent a second command").toBe(1);
  await dashboard.expectNoToast();
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
