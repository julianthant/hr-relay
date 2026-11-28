/** Workflow trace: a started run is followed through running, its gate and done, and its write is recorded once. */
import { SEEDED_NOW } from "../support/helpers/dashboard/served-fixtures/seeded-bff.js";
import { answerScriptedGate, seededRequestOver, startScriptedRun } from "../support/helpers/dashboard/served-fixtures/seeded-scripted-executor.js";
import { CRM_DOC_DOWNLOAD_SCRIPT, crmDocEmail, EMERGENCY_CONTACT_SCRIPT, I9_CHECK_START_SCRIPT, ONBOARDING_EMAIL, ONBOARDING_SCRIPT, PERSON_LOOKUP_SCRIPT, SEPARATIONS_SCRIPT } from "../support/helpers/dashboard/served-fixtures/scripted-workflows.js";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { COMPOSITION_EID } from "../support/helpers/separations-composition-fixtures.js";
import { appliedRunIds } from "../support/fixtures/operator-command-fixtures.js";
import { RunDetailWireSchema } from "../../src/models/dashboard/run-detail.js";
import { DashboardStreamEnvelopeSchema } from "../../src/models/dashboard/subscription.js";
import { createDashboardTransport } from "../../src/dashboard/client/transport.js";
import type { SeededServer } from "../support/helpers/dashboard/served-fixtures/seeded-bff.js";
import { SEEDED_PREFERENCE_WRITE } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";
import readXlsxFile from "read-excel-file/node";
import type { Page } from "@playwright/test";
import type { DashboardPage } from "../support/helpers/dashboard/smoke/dashboard-page.js";
import type { PageFailures } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";
import { ONBOARDING_WRITE_REVIEW_GATE, OnboardingWriteApprovalSchema } from "../../src/models/workflows/onboarding/read-write-plan.js";
import { expect, test } from "../support/helpers/dashboard/smoke/scripted-run-fixtures.js";

const abortedRead = (runId: string) => new RegExp(String.raw`^requestfailed: http://127\.0\.0\.1:\d+/api/v1/runs/${runId}(?:/[a-z-]+)? net::ERR_ABORTED$`, "u");
const ABORTED_READ_REASON = "The panel abandons a read of the run in flight when the run's next state arrives, and reads again.";

test("Work-Study: start, gate, one press of Continue anyway, done, then Back, Forward and Reload hold the URL's state", async ({ dashboard, seeded, page, failures }) => {
  const request = seededRequestOver(seeded.baseUrl);
  const status = async (runId: string) => RunDetailWireSchema.parse(await request(`/api/v1/runs/${runId}`)).header.status;
  failures.allow(SEEDED_PREFERENCE_WRITE, "Choosing a workflow saves a preference; the seeded backend wires no settings executor.");
  await dashboard.open();
  await dashboard.openWorkflow("Work-Study");

  const runId = await startScriptedRun(request, SEEDED_NOW, "10812345", seeded.scripted.reviewReference());
  failures.allow(abortedRead(runId), ABORTED_READ_REASON);
  const row = page.locator(`[data-demo-row-id="${runId}"]`);
  await expect(row).toBeVisible();
  await dashboard.openRun(runId);

  const run = await seeded.scripted.drive(runId);
  await expect(row).toContainText("Running");
  expect(await run.advance()).toMatchObject({ at: "settled", outcome: { state: "parked-gate" } });

  // The answer is held in flight: a second press while it is pending must not send a second command.
  const answers: string[] = [];
  let release: () => void = () => undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/v1/commands", async route => {
    answers.push(route.request().url());
    await held;
    await route.continue();
  });
  const approve = dashboard.runPanel.getByRole("button", { name: "Continue anyway", exact: true });
  await approve.click();
  await approve.click({ timeout: 1000 }).catch(() => undefined);
  release();
  await expect.poll(() => status(runId), { message: "the approved run returns to the queue" }).toBe("queued");
  expect(answers).toHaveLength(1);
  await page.unroute("**/api/v1/commands");

  const written = seeded.scripted.writes().length;
  const resumed = await seeded.scripted.drive(runId);
  expect(await resumed.advance()).toEqual({ at: "step", nodeId: "save-transaction" });
  expect(seeded.scripted.writes().length).toBe(written);
  expect(await resumed.advance()).toMatchObject({ at: "settled", outcome: { state: "done" } });
  await expect(row).toContainText("Done");
  await expect(row).not.toContainText("Running");
  expect(seeded.scripted.writes().slice(written)).toEqual([{ runId, nodeId: "save-transaction", eid: "10812345" }]);

  await dashboard.reloadRun(runId);
  await expect(dashboard.runPanel.getByText("Done", { exact: true }).first()).toBeVisible();
  await dashboard.settleReads();
  await page.goBack();
  await expect(page.getByText("No run open")).toBeVisible();
  await page.goForward();
  await dashboard.expectRunOpen(runId);
  await dashboard.settleReads();
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
  await dashboard.expectOneToast({ title: "Run started", line: "1 Work-Study run created." }, "Work-Study has no worker. Open Sessions.");
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
  const started = await dashboard.holdCommands("start-run");
  const menu = dashboard.runPanel.getByRole("button", { name: "More actions" });
  const rerun = page.getByRole("menuitem", { name: "Rerun" });
  await menu.click();
  await rerun.click();
  await expect.poll(started.sent, { message: "the held Rerun reached the server" }).toBe(1);
  // A finished run reruns in one click: no dialog opens, and a second press while it queues is refused.
  await expect(page.getByRole("dialog", { name: "Rerun", exact: true })).toBeHidden();
  await menu.click();
  await rerun.click();
  await expect(page.getByText("Still queuing the last rerun").first()).toBeVisible();
  await dashboard.clearToasts();
  started.release();
  await dashboard.expectOneToast({ title: "Rerun queued", line: "Person Lookup" });
  expect(started.sent(), "a second press while pending sent a second command").toBe(1);
  expect(appliedRunIds(await started.result()).filter(id => id !== runId)).toHaveLength(1);
});

test("Work-Study: Rerun after a failed step opens the dialog and writes once", async ({ dashboard, seeded, page, failures }) => {
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

  await dashboard.clearToasts();
  const rerun = await dashboard.holdCommands("start-run");
  await row.getByRole("button", { name: "Rerun", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Rerun", exact: true });
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  const start = dialog.getByRole("button", { name: "Start live run" });
  await start.click();
  await expect.poll(rerun.sent, { message: "the held Rerun reached the server" }).toBe(1);
  await dashboard.pressAgain(start);
  rerun.release();
  expect(rerun.sent(), "a second press while pending sent a second command").toBe(1);
  const queuedByRetry = appliedRunIds(await rerun.result()).filter(id => id !== runId);
  expect(queuedByRetry).toHaveLength(1);
  const [retried] = queuedByRetry;
  if (retried === undefined) throw new Error("the Rerun queued no run");
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
  await expect(row).toContainText("Running");
  expect(await run.parkWrite()).toMatchObject({ at: "settled", outcome: { state: "parked-write" } });
  await expect.poll(async () => RunDetailWireSchema.parse(await request(`/api/v1/runs/${runId}`)).header.status, { message: "the parked write is not Done" }).toBe("blocked");
  await expect(row).toContainText("Write parked");
  await expect(row).not.toContainText("Running");
  failures.allowSettingsCancellationOnReload();
  await dashboard.reloadRun(runId);
  await expect(row).toContainText("Write parked");
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
  await expect(row).toContainText("Review");
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
  const longest = async () => Math.max(0, ...RunDetailWireSchema.parse(await request(`/api/v1/runs/${runId}`)).timeline.events
    .flatMap(event => event.durationMs?.state === "present" ? [event.durationMs.ms] : []));
  await expect.poll(longest, { message: "the timeline watcher folds the slow step's duration" }).toBeGreaterThanOrEqual(90_000);
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

/** Starts an Emergency Contact run for the people (employee IDs) its PDF holds and drives it through the OCR child's identity lookups to the review gate. */
async function startEmergencyContact(seeded: SeededServer, failures: { allow(pattern: RegExp, reason: string): void }, people: string) {
  const request = seededRequestOver(seeded.baseUrl);
  failures.allow(SEEDED_PREFERENCE_WRITE, "Choosing a workflow saves a preference; the seeded backend wires no settings executor.");
  const submission = await seeded.scripted.submission(EMERGENCY_CONTACT_SCRIPT, people);
  const runId = await startScriptedRun(request, SEEDED_NOW, people, seeded.scripted.ocrRosterReference(), EMERGENCY_CONTACT_SCRIPT, submission);
  failures.allow(abortedRead(runId), ABORTED_READ_REASON);
  return { request, runId };
}

/** Answers the OCR review's gate with the command its approve control sends and drives the run on, from the members' first step. */
async function releaseEmergencyContact(seeded: SeededServer, request: ReturnType<typeof seededRequestOver>, runId: string) {
  const parked = await seeded.scripted.drive(runId);
  let position = parked.position;
  while (position.at === "step") position = await parked.advance();
  expect(position).toMatchObject({ at: "settled", outcome: { state: "parked-gate", gateId: "approve-records" } });
  expect(await request("/api/v1/commands", seeded.scripted.ocrApproval(runId))).toMatchObject({ state: "applied" });
  return seeded.scripted.drive(runId);
}

test("Emergency Contact: start, review released, each step held, one Save per person, done", async ({ dashboard, seeded, page, failures }) => {
  await dashboard.open();
  await dashboard.openWorkflow("Emergency Contact");
  const { request, runId } = await startEmergencyContact(seeded, failures, "10800000,10800001");
  const row = page.locator(`[data-demo-row-id="${runId}"]`);
  await expect(row).toBeVisible();
  await dashboard.openRun(runId);
  const run = await releaseEmergencyContact(seeded, request, runId);
  expect(seeded.scripted.writes()).toHaveLength(0);
  const trail: string[] = [];
  let position = run.position;
  while (position.at === "step") {
    trail.push(position.nodeId);
    if (trail.length === 2) expect(seeded.scripted.writes(), "nothing is saved before the first person's Save step runs").toHaveLength(0);
    position = await run.advance();
  }
  expect(trail).toEqual(Array.from({ length: 2 }, () => ["read-contacts", "contact-preview", "contact-preview", "contact-preview"]).flat());
  expect(position).toMatchObject({ at: "settled", outcome: { state: "done", runId } });
  await expect(row).toContainText("Done");
  await expect(row).toContainText("2/2");
  const writes = seeded.scripted.writes();
  expect(writes.map(write => write.eid).sort()).toEqual(["10800000", "10800001"]);
  expect(new Set(writes.map(write => write.runId)).size).toBe(2);
  expect(writes.every(write => write.nodeId === "contact-preview" && write.runId !== runId)).toBe(true);
  await dashboard.reloadRun(runId);
  await expect(dashboard.runPanel.getByText("Done", { exact: true }).first()).toBeVisible();
  expect(seeded.scripted.writes()).toEqual(writes);
});

test("Emergency Contact: a failed step shows Failed for the person and saves nothing", async ({ dashboard, seeded, page, failures }) => {
  await dashboard.open();
  await dashboard.openWorkflow("Emergency Contact");
  const { request, runId } = await startEmergencyContact(seeded, failures, "10800000");
  const row = page.locator(`[data-demo-row-id="${runId}"]`);
  await expect(row).toBeVisible();
  const run = await releaseEmergencyContact(seeded, request, runId);
  expect(run.position).toEqual({ at: "step", nodeId: "read-contacts" });
  expect(await run.fail()).toMatchObject({ at: "settled" });
  await expect(row).toContainText("0/1");
  await expect(row).toContainText("Failed");
  expect(seeded.scripted.writes()).toHaveLength(0);
});

test("Emergency Contact: a Save whose answer is lost parks the person's run and is asked for once", async ({ dashboard, seeded, page, failures }) => {
  await dashboard.open();
  await dashboard.openWorkflow("Emergency Contact");
  const { request, runId } = await startEmergencyContact(seeded, failures, "10800000");
  const row = page.locator(`[data-demo-row-id="${runId}"]`);
  await expect(row).toBeVisible();
  await dashboard.openRun(runId);
  const run = await releaseEmergencyContact(seeded, request, runId);
  expect(await run.advance()).toEqual({ at: "step", nodeId: "contact-preview" });
  let parked = await run.parkWrite();
  while (parked.at === "step") parked = await run.advance();
  if (parked.at !== "settled" || parked.outcome.state !== "parked-write") throw new Error(`the Save did not park the run: ${JSON.stringify(parked)}`);
  expect(seeded.scripted.writes()).toEqual([{ runId: parked.outcome.runId, nodeId: "contact-preview", eid: "10800000" }]);
  await dashboard.reloadRun(runId);
  await expect(page.locator(`[data-demo-row-id="${runId}"]`)).toContainText("0/1");
  expect(seeded.scripted.writes()).toHaveLength(1);
});

/** Starts an I-9 Check Start run for the two scripted people, then drives it to where both PDF reviews wait; each OCR child parks on its own drive. */
async function startI9ToReview(seeded: SeededServer, request: ReturnType<typeof seededRequestOver>, subject = "10000001,10000002"): Promise<string> {
  const submission = await seeded.scripted.submission(I9_CHECK_START_SCRIPT, subject);
  const runId = await startScriptedRun(request, SEEDED_NOW, "", seeded.scripted.i9Reference(), I9_CHECK_START_SCRIPT, submission);
  for (const _review of subject.split(",")) {
    const parked = await seeded.scripted.drive(runId);
    expect(parked.position).toMatchObject({ at: "settled", outcome: { state: "parked-gate", gateId: "approve-records" } });
  }
  return runId;
}

test("I-9 Check Start: start, both PDF reviews approved, each person checked, done with its children, and one results workbook saved", async ({ dashboard, seeded, page, failures }) => {
  const request = seededRequestOver(seeded.baseUrl);
  failures.allow(SEEDED_PREFERENCE_WRITE, "Choosing a workflow saves a preference; the seeded backend wires no settings executor.");
  await dashboard.open();
  await dashboard.openWorkflow("I-9 Check");
  const runId = await startI9ToReview(seeded, request);
  failures.allow(abortedRead(runId), ABORTED_READ_REASON);
  const row = page.locator(`[data-demo-row-id="${runId}"]`);
  await expect(row).toBeVisible();
  await dashboard.openRun(runId);
  expect(seeded.scripted.writes()).toHaveLength(0);

  await seeded.scripted.approveOcrReviews(request, SEEDED_NOW, runId);
  const run = await seeded.scripted.drive(runId);
  expect(run.position).toEqual({ at: "step", nodeId: "identifier-match" });
  await expect(row).toContainText("Running");
  expect(await run.advance()).toEqual({ at: "step", nodeId: "identifier-match" });
  expect(seeded.scripted.writes()).toHaveLength(0);
  expect(await run.advance()).toMatchObject({ at: "settled", outcome: { state: "done" } });
  await expect(row).toContainText("Done");
  await expect(row).not.toContainText("Running");
  expect(seeded.scripted.writes()).toEqual([{ runId, nodeId: "save-workbook", eid: "" }]);
  const tracker = (await readXlsxFile(join(seeded.scripted.documentsDirectory(), "i9-check-tracker.xlsx"))).find(sheet => sheet.sheet === "I-9 Check");
  expect(tracker?.data.slice(1).map(cells => [cells[0], cells[2], cells[5], cells[6]])).toEqual([
    ["Example, Avery", "10000001", "Yes", "Keep"], ["Example, Blair", "10000002", "Yes", "Keep"]]);

  await dashboard.reloadRun(runId);
  await expect(dashboard.runPanel.getByText("Done", { exact: true }).first()).toBeVisible();
  expect(seeded.scripted.writes()).toHaveLength(1);
});

test("I-9 Check Start: a failed person check fails the run and saves no workbook", async ({ dashboard, seeded, page, failures }) => {
  const request = seededRequestOver(seeded.baseUrl);
  failures.allow(SEEDED_PREFERENCE_WRITE, "Choosing a workflow saves a preference; the seeded backend wires no settings executor.");
  await dashboard.open();
  await dashboard.openWorkflow("I-9 Check");
  const runId = await startI9ToReview(seeded, request);
  failures.allow(abortedRead(runId), ABORTED_READ_REASON);
  const row = page.locator(`[data-demo-row-id="${runId}"]`);
  await expect(row).toBeVisible();
  await seeded.scripted.approveOcrReviews(request, SEEDED_NOW, runId);
  const run = await seeded.scripted.drive(runId);
  expect(run.position).toEqual({ at: "step", nodeId: "identifier-match" });
  expect(await run.fail()).toMatchObject({ at: "settled", outcome: { state: "failed", runId } });
  await expect(row).toContainText("Failed");
  await expect(row).not.toContainText("Running");
  expect(seeded.scripted.writes()).toHaveLength(0);
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
  await dashboard.reloadRun(runId);
  await expect(dashboard.runPanel.getByText("Done", { exact: true }).first()).toBeVisible();
  expect(seeded.scripted.writes()).toHaveLength(2);
});


const onboardingStarted = async ({ dashboard, seeded, page, failures }: { dashboard: DashboardPage; seeded: SeededServer; page: Page; failures: PageFailures }) => {
  const request = seededRequestOver(seeded.baseUrl);
  failures.allow(SEEDED_PREFERENCE_WRITE, "Choosing a workflow saves a preference; the seeded backend wires no settings executor.");
  await dashboard.open();
  await dashboard.openWorkflow("Onboarding");
  const roster = seeded.scripted.onboardingRosterReference([[ONBOARDING_EMAIL, "Fixture Hire"]]);
  const runId = await startScriptedRun(request, SEEDED_NOW, ONBOARDING_EMAIL, roster, ONBOARDING_SCRIPT);
  failures.allow(abortedRead(runId), ABORTED_READ_REASON);
  const row = page.locator(`[data-demo-row-id="${runId}"]`);
  await expect(row).toBeVisible();
  return { request, runId, row };
};
const approveHire = (request: ReturnType<typeof seededRequestOver>, runId: string) =>
  answerScriptedGate(request, SEEDED_NOW, runId, ONBOARDING_WRITE_REVIEW_GATE, OnboardingWriteApprovalSchema, { decision: "new-hire", ruledOut: [] });

test("Onboarding: start, each step held, the hire review answered, done, and the hire submitted once", async ({ dashboard, seeded, page, failures }) => {
  const { request, runId, row } = await onboardingStarted({ dashboard, seeded, page, failures });
  const status = async () => RunDetailWireSchema.parse(await request(`/api/v1/runs/${runId}`)).header.status;
  await dashboard.openRun(runId);
  const run = await seeded.scripted.drive(runId);
  await expect(row).toContainText("Running");
  expect(run.position).toEqual({ at: "step", nodeId: "crm-source" });
  let position = run.position;
  const held: string[] = [];
  while (position.at === "step") { held.push(position.nodeId); position = await run.advance(); }
  expect(held).toEqual(["crm-source", "ucpath-source", "lookup-source", "crm-source", "ucpath-source"]);
  expect(position).toMatchObject({ at: "settled", outcome: { state: "parked-gate", gateId: ONBOARDING_WRITE_REVIEW_GATE } });
  expect(seeded.scripted.writes()).toHaveLength(0);

  await approveHire(request, runId);
  await expect.poll(status, { message: "the approved run returns to the queue" }).toBe("queued");
  const resumed = await seeded.scripted.drive(runId);
  expect(resumed.position).toEqual({ at: "step", nodeId: "crm-source" });
  expect(await resumed.advance()).toEqual({ at: "step", nodeId: "ucpath-source" });
  expect(await resumed.advance()).toEqual({ at: "step", nodeId: "hire-create" });
  expect(seeded.scripted.writes()).toEqual([{ runId, nodeId: "i9-profile-save", eid: ONBOARDING_EMAIL }]);
  expect(await resumed.advance()).toEqual({ at: "step", nodeId: "hire-create" });
  expect(seeded.scripted.writes()).toEqual([{ runId, nodeId: "i9-profile-save", eid: ONBOARDING_EMAIL }, { runId, nodeId: "hire-create", eid: ONBOARDING_EMAIL }]);
  expect(await resumed.advance()).toMatchObject({ at: "settled", outcome: { state: "done" } });
  await expect(row).toContainText("Done");
  await expect(row).not.toContainText("Running");
  expect(seeded.scripted.writes()).toEqual([{ runId, nodeId: "i9-profile-save", eid: ONBOARDING_EMAIL }, { runId, nodeId: "hire-create", eid: ONBOARDING_EMAIL }]);
  await dashboard.reloadRun(runId);
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

test("Onboarding: a failed first read shows Failed on the row and writes nothing", async ({ dashboard, seeded, page, failures }) => {
  const { runId, row } = await onboardingStarted({ dashboard, seeded, page, failures });
  const run = await seeded.scripted.drive(runId);
  expect(run.position).toEqual({ at: "step", nodeId: "crm-source" });
  expect(await run.fail()).toMatchObject({ at: "settled" });
  await expect(row).toContainText("Failed");
  await expect(row).not.toContainText("Running");
  expect(seeded.scripted.writes()).toHaveLength(0);
});

async function holdDayCursor(seeded: SeededServer): Promise<Record<string, string>> {
  const { promise, resolve, reject } = Promise.withResolvers<Record<string, string>>();
  let generation: number | undefined;
  const stream = createDashboardTransport({ baseUrl: seeded.baseUrl }).openStream(`/events/v1?topics=dashboard-day:${seeded.day}`, {
    onMessage: ({ data }) => {
      const envelope = DashboardStreamEnvelopeSchema.parse(JSON.parse(data));
      if (envelope.type === "hello") generation = envelope.projectionGeneration;
      if (envelope.type === "snapshot") {
        if (generation === undefined) throw new Error("day snapshot preceded its stream hello");
        resolve({ "last-event-id": envelope.cursor, "dashboard-projection-generation": String(generation) });
      }
    },
  });
  void stream.done.then(() => reject(new Error("day stream ended before its snapshot")), reject);
  try { return await promise; }
  finally { stream.close(); }
}

test("Onboarding: a hire submit whose answer is lost parks the run and is asked for once", async ({ dashboard, seeded, page, failures }) => {
  // Queuing the hire changes the day counts and publishes a snapshot above this cursor.
  const resume = await holdDayCursor(seeded);
  const { request, runId } = await onboardingStarted({ dashboard, seeded, page, failures });
  const first = await seeded.scripted.drive(runId);
  let position = first.position;
  while (position.at === "step") position = await first.advance();
  await approveHire(request, runId);
  await expect.poll(async () => RunDetailWireSchema.parse(await request(`/api/v1/runs/${runId}`)).header.status).toBe("queued");
  const run = await seeded.scripted.drive(runId);
  expect(await run.advance()).toEqual({ at: "step", nodeId: "ucpath-source" });
  expect(await run.advance()).toEqual({ at: "step", nodeId: "hire-create" });
  expect(await run.advance()).toEqual({ at: "step", nodeId: "hire-create" });
  expect(await run.parkWrite()).toMatchObject({ at: "settled", outcome: { state: "parked-write" } });
  await expect.poll(async () => RunDetailWireSchema.parse(await request(`/api/v1/runs/${runId}`)).header.status, { message: "the parked write is not Done" }).toBe("blocked");
  const resumed = await fetch(`${seeded.baseUrl}/events/v1?topics=dashboard-day:${seeded.day},run:${runId}`, { headers: resume });
  try { expect(resumed.status, "resuming across the queue snapshot opens a fresh stream").toBe(200); }
  finally { await resumed.body?.cancel(); }
  await dashboard.openRun(runId);
  await dashboard.reloadRun(runId);
  await expect(page.locator(`[data-demo-row-id="${runId}"]`)).toContainText("Write parked");
  expect(seeded.scripted.writes()).toEqual([{ runId, nodeId: "i9-profile-save", eid: ONBOARDING_EMAIL }, { runId, nodeId: "hire-create", eid: ONBOARDING_EMAIL }]);
});
