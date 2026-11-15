import assert from "node:assert/strict";
import { dirname } from "node:path";
import { afterEach, it } from "vitest";
import { composeQueueSummaries } from "../../../src/backend/app/composition/dashboard/queue-summaries.js";
import { createOperatorProjection } from "../../../src/backend/app/composition/dashboard/queue.js";
import { createOperatorRunDetail } from "../../../src/backend/app/composition/dashboard/run-detail.js";
import { createTrustReadDependencies } from "../../../src/backend/app/composition/dashboard/trust.js";
import { buildTerminalAuthorization } from "../../../src/backend/runs/lifecycle/terminal-authorization.js";
import { buildRunDetail, buildRunSection } from "../../../src/backend/runs/queries/run-detail.js";
import { buildNodeFailureRecord } from "../../../src/backend/runtime/execution/run-failure.js";
import { createServerVerifiedArtifactReader } from "../../../src/backend/storage/artifacts/server-verified-artifact-reader.js";
import { createTimelineEmitter } from "../../../src/backend/storage/events/timeline-emitter.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import { deriveJobRowFromCells } from "../../../src/backend/systems/ucpath/driver/person-org-operation.js";
import { readJobSummaryTask } from "../../../src/backend/systems/ucpath/tasks/read-job-summary.js";
import { verifyIdentityApprovalTask } from "../../../src/workflows/separations/tasks/verify-identity-approval.js";
import type { RunRecord } from "../../../src/models/run/record.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../../src/models/workflow/checkpoint.js";
import { MatchIdentityOutputSchema } from "../../../src/models/workflows/separations/match-identity.js";
import { FingerprintSchema, NodeIdSchema } from "../../../src/rules/identity/ids.js";
import { failureCodeFromTaskCode } from "../../../src/models/failures/error-catalog.js";
import { buildIdentityEvidencePacket, deriveIdentityEvidenceDigest } from "../../../src/rules/separations/identity-evidence.js";
import { noSeparationWritePlan } from "../../../src/rules/separations/write-plan.js";
import { APPROVAL_NODE, JOB_SUMMARY_NODE } from "../../../src/workflows/separations/steps/identity-check/step.js";
import { taskImplFingerprint } from "../../../src/workflow-kit/fingerprints.js";
import { taskFailer } from "../../../src/workflow-kit/task.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { sourceBoundHarness } from "../../support/fixtures/integration/source-bound-fixtures.js";
import { protectedSecretSource } from "../../support/helpers/protected-secret-source.js";
import { separationsDescriptor } from "../../support/helpers/registered-workflows.js";

const CHECKED = "10833507";
const NAME_SEARCH = "10800001";
const TYPED = "10800002";

const disposers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose(); });

type Harness = Awaited<ReturnType<typeof sourceBoundHarness>>;

/** The checked person found by a name search with a second candidate, or the person found for the entered ID under a different UCPath name. */
function packetFor(observedAt: string, source: "name-resolved" | "operator-entered") {
  const eid = source === "operator-entered" ? TYPED : CHECKED;
  const rows = [deriveJobRowFromCells(["0", "07/01/2025", "Active", "SDCMP", "40012345", "000414",
    "Housing Dining Hospitality", "004920", "STDT 3", "", "0.500000", "Student"], 0)];
  return buildIdentityEvidencePacket({
    documentNumber: "4510", documentName: "Hernandez, Jose Santos", documentEidText: "the separation document carried no EID",
    emplIdSource: source, documentEidConflicts: false,
    jobSummary: { pageStateId: "ucpath.person-org.detail-ready", emplId: eid as never,
      displayedName: source === "operator-entered" ? "Okafor, Adaeze" : "Hernandez, Jose Santos",
      jobRows: rows, rowCount: rows.length, renderContext: { entry: "auto-detail", searchResultRows: 0, employmentInstances: "already-complete" },
      observedAt: observedAt as never },
    nameSelection: { status: "resolved",
      selected: { emplId: NAME_SEARCH as never, name: "Hernandez, Jose", department: "Housing Dining Hospitality", jobTitle: "STDT 3",
        employeeStatus: "active", hrStatus: "Active", startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "", hdh: true },
      candidateEids: [NAME_SEARCH as never] },
    plan: noSeparationWritePlan("this test composes no separation write plan"),
  });
}

/** Claims the one queued run and moves it to running at `nodeId`, as a worker would. */
function claimRunning(h: Harness, run: RunRecord, nodeId: string) {
  const now = h.clock.now().toISOString();
  const workerId = h.database.authority.workerSlots.list(run.envelope.workflow).find(slot => slot.retiredAt === null)?.workerId;
  assert.ok(workerId);
  const claimed = h.database.authority.runs.claimNext({ workflow: run.envelope.workflow, workerId, now });
  assert.ok(claimed.state === "claimed" && claimed.run.envelope.runId === run.envelope.runId);
  const claim = { workerId, claimGeneration: claimed.run.claimGeneration };
  const fields = { workerId, claimedAt: now, heartbeatAt: now };
  const validating = h.database.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: claimed.run.version, claim,
    lifecycle: { state: "validating", ...fields }, now });
  assert.ok(validating.state === "applied");
  const running = h.database.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: validating.run.version, claim,
    lifecycle: { state: "running", ...fields, currentNodeId: nodeId }, now });
  assert.ok(running.state === "applied");
  return { run: running.run, claim };
}

/** The comparison checkpoint, the gate-opened span and the park the executor writes at the identity gate. */
function parkAtIdentityGate(h: Harness, queued: RunRecord) {
  const { run, claim } = claimRunning(h, queued, "comparison");
  const now = h.clock.now().toISOString();
  const comparison = descriptorRuntimeNodes(separationsDescriptor).find(node => node.kind === "task" && String(node.id) === "comparison");
  assert.ok(comparison?.kind === "task");
  const packet = packetFor(now, "name-resolved");
  h.database.authority.runCheckpoints.insert(RunCheckpointRecordSchema.parse({
    workflowId: run.envelope.workflow, itemId: run.envelope.itemId, nodeId: "comparison", attempt: run.envelope.attempt,
    claimGeneration: run.claimGeneration, runId: run.envelope.runId,
    output: { schemaHash: deriveSchemaHash(comparison.uses.output, "output"),
      value: MatchIdentityOutputSchema.parse({ packet, approvalRequired: true, evidenceDigest: deriveIdentityEvidenceDigest(packet) }) },
    descriptorVersion: run.envelope.descriptorVersion, contractFingerprint: run.envelope.contractFingerprint,
    implFingerprint: taskImplFingerprint(comparison.uses), provenance: [], writtenAt: now,
  }));
  createTimelineEmitter({ repository: h.database.authority.timelineEvents, clock: h.clock }).emit({ t: "gate.opened", ts: now,
    workflow: run.envelope.workflow, runId: run.envelope.runId, attempt: run.envelope.attempt, traceId: run.envelope.traceId,
    spanPath: run.envelope.traceId, gate: "identity-approval" });
  const parked = h.database.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: run.version, claim, now,
    lifecycle: { state: "parked-gate", gateId: "identity-approval", parkedAt: now, resumeAt: "approval" } });
  assert.ok(parked.state === "applied");
  return parked.run;
}

type Outcome = "unknown-id" | "other-person-opened" | "rejected";

/** The replacement fails as the executor fails it, from the real task: UCPath's no-record page, a detail page for another person, or the operator's Reject of the person found. */
async function failReplacement(h: Harness, queued: RunRecord, outcome: Outcome) {
  const nodeId = outcome === "rejected" ? APPROVAL_NODE : JOB_SUMMARY_NODE;
  const { run } = claimRunning(h, queued, nodeId);
  const now = h.clock.now().toISOString();
  const packet = packetFor(now, "operator-entered");
  const task = outcome === "rejected" ? verifyIdentityApprovalTask : readJobSummaryTask;
  const input = outcome === "rejected"
    ? { packet, evidenceDigest: deriveIdentityEvidenceDigest(packet),
      approval: { decision: "rejected", reason: "the operator rejected this person", evidenceDigest: deriveIdentityEvidenceDigest(packet) } }
    : { emplId: TYPED };
  const ctx = { signal: new AbortController().signal, log: { debug() {}, info() {}, warn() {} }, recordData() {},
    captureScreenshot: async () => {}, fail: taskFailer(task.contract as never),
    driver: { system: "ucpath", readJobSummary: async ({ emplId }: { emplId: string }) => outcome === "unknown-id"
      ? { state: "employee-not-found", emplId, observedMarker: "No matching values were found." }
      : { state: "subject-mismatch", observedEid: CHECKED, expectedEid: emplId } } };
  const error = await (task.impl as { run: (input: unknown) => Promise<unknown> }).run({ input, ctx }).then(() => undefined, (thrown: unknown) => thrown);
  assert.ok(error instanceof Error && error.message.includes(`••••${TYPED.slice(-4)}`) && !error.message.includes(TYPED), String(error));
  const failure = buildNodeFailureRecord({ run, failureId: h.ids.uuid(), nodeId: NodeIdSchema.parse(nodeId), taskId: task.contract.id,
    error, occurredAt: now, writes: [] });
  const terminal = h.lifecycle.terminalize({ kind: "failure", commandId: h.ids.uuid(),
    terminal: { failure, authorization: buildTerminalAuthorization({ run, authorizedAt: now, consequence: { kind: "failed", failure } }) },
  }, separationsDescriptor);
  assert.equal(terminal.state, "applied");
  return failure;
}

/** Every served byte of a run: its detail and each section it advertises. */
function servedRun(deps: ReturnType<typeof createOperatorRunDetail>, runId: string) {
  const detail = buildRunDetail(deps, runId);
  return { detail, sections: Object.fromEntries(detail.availableSections.map(section => [section, buildRunSection(deps, runId, section)])) };
}

/** Every served path whose text holds the typed ID. */
function typedPaths(value: unknown, path = ""): string[] {
  if (typeof value === "string") return value.includes(TYPED) ? [path] : [];
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, entry]) => typedPaths(entry, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`));
}

it.each<Readonly<{ outcome: Outcome; code: string; prefilled: boolean }>>([
  { outcome: "unknown-id", code: "employee-not-found", prefilled: true },
  { outcome: "other-person-opened", code: "subject-mismatch", prefilled: false },
  { outcome: "rejected", code: "identity-approval-rejected", prefilled: false },
])("a typed Employee ID lookup ending $outcome serves the full ID only in its own Run data and the rejected-value correction", async ({ outcome, code, prefilled }) => {
  const h = await sourceBoundHarness(separationsDescriptor, undefined, undefined, protectedSecretSource({ profileName: "Synthetic Timekeeper" }));
  disposers.push(h.dispose);
  const artifactReader = createServerVerifiedArtifactReader({ admission: h.profile.admission });
  await artifactReader.ready;
  const steps = separationsDescriptor.timeline.map(step => step.key);
  const source = parkAtIdentityGate(h, h.start(h.planner.plan({ workflowId: separationsDescriptor.id, submissions: [{ documentNumber: "4510" }],
    dryRun: true, selectedStepKeys: steps })));

  const reader = { read: h.lifecycle.read.bind(h.lifecycle), list: h.lifecycle.list.bind(h.lifecycle), withRunTreeSnapshot: h.lifecycle.withRunTreeSnapshot.bind(h.lifecycle),
    summaries: { ...composeQueueSummaries(h.database), activity: () => { throw new Error("unrequested activity"); } } };
  const descriptors = { resolve: (id: string) => id === separationsDescriptor.id ? separationsDescriptor : undefined };
  const projection = createOperatorProjection({ database: h.database, reader, stateRoot: dirname(h.authorityPath), clock: h.clock,
    appVersion: "0.1.0", descriptorSetHash: FingerprintSchema.parse("a".repeat(64)), ledger: createTransactionHistory(h.database.authority), descriptors });
  const trustReads = createTrustReadDependencies({ database: h.database, artifactReader, reader: h.lifecycle });
  const deps = createOperatorRunDetail({ stateRoot: dirname(h.authorityPath), projection, database: h.database, runReader: h.lifecycle,
    canonical: { reader: h.lifecycle, database: h.database, descriptors }, trust: trustReads.trust, captures: trustReads.captures });
  const served = () => { projection.rebuildFromTimeline(); return deps; };

  const gate = buildRunSection(served(), source.envelope.runId, "identity-gate");
  assert.ok(gate.section === "identity-gate" && gate.payload.state === "available");
  const correction = gate.payload.value.correction;
  assert.ok(correction);
  assert.equal(gate.payload.value.decision?.type, "pick-person");

  // The dashboard's Confirm: preview the served request with the typed ID, then the final start.
  const plan = h.planner.plan({ ...correction.request, submissions: [{ operatorEmployeeId: TYPED }] });
  assert.deepEqual(plan.refused, []);
  assert.equal(h.kernel.execute(h.command(plan)).state, "applied");
  assert.deepEqual(h.fresh(source).lifecycle.state === "terminal" && h.fresh(source).lifecycle, { state: "terminal", outcome: "superseded", endedAt: h.clock.now().toISOString() });
  const replacement = h.database.authority.runs.listByWorkflow(separationsDescriptor.id).find(run => run.envelope.runId !== source.envelope.runId);
  assert.ok(replacement);
  assert.equal((replacement.input.parsed.value as Record<string, unknown>).operatorEmployeeId, TYPED);
  const failure = await failReplacement(h, replacement, outcome);

  const sourceServed = servedRun(served(), source.envelope.runId);
  const replacementServed = servedRun(served(), replacement.envelope.runId);
  const failed = replacementServed.sections.failure;
  assert.ok(failed?.section === "failure" && failed.payload.state === "available");
  assert.equal(failed.payload.value.failureId, failure.failureId);
  assert.equal(failed.payload.value.code, failureCodeFromTaskCode(code));
  assert.equal(failed.payload.value.recovery?.prefill, prefilled ? TYPED : undefined);
  if (prefilled) assert.equal(failed.payload.value.decision?.type, "correct-value");
  const logs = sourceServed.sections.logs;
  assert.ok(logs !== undefined);
  assert.ok(JSON.stringify(logs).includes("Replaced: Relay is looking up the Employee ID you entered."));

  const day = projection.buildDashboardDayWire(h.clock.now().toISOString().slice(0, 10));
  assert.ok(JSON.stringify(day).includes(replacement.envelope.runId), "the day wire lists the replacement");
  // Local evidence keeps the run's complete input (`retainLocalEvidenceValue`), so Run data shows the entered ID like every other input value.
  assert.deepEqual(typedPaths({ source: sourceServed, replacement: replacementServed, day }).sort(), [
    ...(prefilled ? [".replacement.sections.failure.payload.value.decision.options[0].input.prefill",
      ".replacement.sections.failure.payload.value.recovery.prefill"] : []),
    ".replacement.sections.receipt.payload.value.input[1].value.value",
  ]);
});
