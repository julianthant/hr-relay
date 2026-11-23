/** Workflow trace: a started run is followed through running, its gate and done, and its write is recorded once. */
import { SEEDED_NOW } from "../support/helpers/dashboard/served-fixtures/seeded-bff.js";
import { answerScriptedGate, approveScriptedGate, seededRequestOver, sendScriptedRunCommand, startScriptedRun } from "../support/helpers/dashboard/served-fixtures/seeded-scripted-executor.js";
import { CRM_DOC_DOWNLOAD_SCRIPT, crmDocEmail, EMERGENCY_CONTACT_SCRIPT, ONBOARDING_EMAIL, ONBOARDING_SCRIPT, PERSON_LOOKUP_SCRIPT } from "../support/helpers/dashboard/served-fixtures/scripted-workflows.js";
import { ONBOARDING_WRITE_REVIEW_GATE, OnboardingWriteApprovalSchema } from "../../src/models/workflows/onboarding/read-write-plan.js";
import type { Page } from "@playwright/test";
import type { DashboardPage } from "../support/helpers/dashboard/smoke/dashboard-page.js";
import type { PageFailures } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";
import { readdirSync } from "node:fs";
import { appliedRunIds } from "../support/fixtures/operator-command-fixtures.js";
import { RunDetailWireSchema } from "../../src/models/dashboard/run-detail.js";
import type { SeededServer } from "../support/helpers/dashboard/served-fixtures/seeded-bff.js";
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

const SETTINGS_READ_ABORTED = /^requestfailed: http:\/\/127\.0\.0\.1:\d+\/api\/v1\/settings\/editable net::ERR_ABORTED$/u;

/** Starts an Emergency Contact run for the people (employee IDs) its PDF holds and drives it through the OCR child's identity lookups to the review gate. */
async function startEmergencyContact(seeded: SeededServer, failures: { allow(pattern: RegExp, reason: string): void }, people: string) {
  const request = seededRequestOver(seeded.baseUrl);
  failures.allow(SEEDED_PREFERENCE_WRITE, "Choosing a workflow saves a preference; the seeded backend wires no settings executor.");
  failures.allow(SETTINGS_READ_ABORTED, "The settings read is abandoned when the page re-reads it.");
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
  await dashboard.settleReads();
  await page.reload();
  await dashboard.expectRunOpen(runId);
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
  await dashboard.settleReads();
  await page.reload();
  await dashboard.expectRunOpen(runId);
  await expect(page.locator(`[data-demo-row-id="${runId}"]`)).toContainText("0/1");
  expect(seeded.scripted.writes()).toHaveLength(1);
});

const onboardingStarted = async ({ dashboard, seeded, page, failures }: { dashboard: DashboardPage; seeded: SeededServer; page: Page; failures: PageFailures }) => {
  const request = seededRequestOver(seeded.baseUrl);
  failures.allow(SEEDED_PREFERENCE_WRITE, "Choosing a workflow saves a preference; the seeded backend wires no settings executor.");
  await dashboard.open();
  await dashboard.openWorkflow("Onboarding");
  const roster = seeded.scripted.onboardingRosterReference([[ONBOARDING_EMAIL, "Fixture Hire"]]);
  const runId = await startScriptedRun(request, SEEDED_NOW, ONBOARDING_EMAIL, roster, ONBOARDING_SCRIPT);
  failures.allow(abortedRead(runId), ABORTED_READ_REASON);
  failures.allow(new RegExp(String.raw`^(?:http 409: GET |console: Failed to load resource: the server responded with a status of 409 \(Conflict\) )http://127\.0\.0\.1:\d+/api/v1/runs/${runId}/identity-gate$`, "u"),
    "The panel asks for an identity review of the parked hire review, which holds none, and offers no answer control (#580).");
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
  while (position.at === "step") position = await run.advance();
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

  await dashboard.settleReads();
  await page.reload();
  await dashboard.expectRunOpen(runId);
  await expect(dashboard.runPanel.getByText("Done", { exact: true }).first()).toBeVisible();
  expect(seeded.scripted.writes()).toHaveLength(2);
});

test("Onboarding: a failed first read shows Failed on the row and writes nothing", async ({ dashboard, seeded, page, failures }) => {
  const { runId, row } = await onboardingStarted({ dashboard, seeded, page, failures });
  const run = await seeded.scripted.drive(runId);
  expect(run.position).toEqual({ at: "step", nodeId: "crm-source" });
  expect(await run.fail()).toMatchObject({ at: "settled" });
  await expect(row).toContainText("Failed");
  await expect(row).not.toContainText("Running");
  expect(seeded.scripted.writes()).toHaveLength(0);
});

test("Onboarding: a hire submit whose answer is lost parks the run and is asked for once", async ({ dashboard, seeded, page, failures }) => {
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
  await dashboard.openRun(runId);
  await dashboard.settleReads();
  await page.reload();
  await dashboard.expectRunOpen(runId);
  await expect(page.locator(`[data-demo-row-id="${runId}"]`)).toContainText("Write parked");
  expect(seeded.scripted.writes()).toEqual([{ runId, nodeId: "i9-profile-save", eid: ONBOARDING_EMAIL }, { runId, nodeId: "hire-create", eid: ONBOARDING_EMAIL }]);
});
