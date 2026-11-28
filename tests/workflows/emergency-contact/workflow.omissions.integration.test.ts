import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { workflowModuleOf } from "../../../src/backend/app/registries/workflow-registry.js";
import { createOperatorProjection, createOperatorRunDetail } from "../../../src/backend/app/composition/dashboard/operator.js";
import { readQueueRecordMembers } from "../../../src/backend/runs/queries/ocr-record-members.js";
import { readRunPanel } from "../../../src/backend/runs/queries/run-detail.js";
import { projectStartSteps } from "../../../src/backend/runs/start/step-selection.js";
import { createReceiptService } from "../../../src/backend/runs/trust/receipt-service.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import { projectRunLogs } from "../../../src/dashboard/state/run-wiring-adapter.js";
import { logPlainText } from "../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";
import { deriveEvidenceEntryId } from "../../../src/models/trust/evidence-identity.js";
import { EmergencyContactResultSchema } from "../../../src/models/workflows/emergency-contact/result.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import { createEmergencyContactRetryWorld } from "../../support/helpers/backend/emergency-contact-retry-world.js";

const world = createEmergencyContactRetryWorld();
afterEach(world.cleanup);
const { descriptor } = workflowModuleOf("emergency-contact");
const allSteps = projectStartSteps(descriptor).map(({ key }) => key);

type Fixture = Awaited<ReturnType<typeof world.startWithSteps>>;

function operatorDetail(f: Fixture) {
  const { database, clock, resolve } = f;
  const stateRoot = f.harness.authority.stateRoot, reader = f.canonical.lifecycle, descriptors = { resolve };
  const projection = createOperatorProjection({ database, stateRoot, clock, reader, appVersion: "0.1.0",
    descriptorSetHash: FingerprintSchema.parse("a".repeat(64)), ledger: createTransactionHistory(database.authority), descriptors });
  projection.ingestFromTimeline();
  return createOperatorRunDetail({ database, stateRoot, projection, runReader: reader, canonical: { database, reader, descriptors } });
}

function queueMemberStatuses(f: Fixture) {
  const { database, canonical, parentRun: { envelope: { runId } }, resolve } = f;
  const rows = database.withAuthorityReadSnapshot(() => {
    const parent = database.authority.runs.get(runId);
    assert.ok(parent);
    return readQueueRecordMembers(database.authority, canonical.lifecycle, parent, database.authority.runs.listChildren(runId), resolve);
  });
  assert.ok(rows);
  return rows.members.map(({ kind, status, statusLabel }) => [kind, status, statusLabel]);
}

it.each([
  { omitted: ["contact-preview"], saves: 0, imports: 2 },
  { omitted: ["onbase-filing"], saves: 2, imports: 0 },
  { omitted: ["contact-preview", "onbase-filing"], saves: 0, imports: 0 },
])("records $omitted as Done outside Relay for each approved member", async ({ omitted, saves, imports }) => {
  const f = await world.startWithSteps({ selectedStepKeys: allSteps,
    stepOmissions: omitted.map(step => ({ workflow: "emergency-contact-member", step, facts: {} })) });
  const signal = new AbortController().signal;
  const { database, parentRun } = f;
  const execution = await f.canonical.execute(parentRun, signal);
  assert.partialDeepStrictEqual(execution.run?.lifecycle, { state: "terminal", outcome: "done" });
  const result = EmergencyContactResultSchema.parse(database.authority.runResults.get(parentRun.envelope.runId)?.result.value);
  assert.deepEqual(result.members.map(member => member.state === "done" ? member.output.disposition : member.state),
    saves === 0 ? ["omitted", "omitted"] : ["committed", "committed"]);
  assert.equal([...f.persistence.values()].flatMap(({ submissions }) => submissions).length, saves);
  assert.equal(f.filing.imports(), imports);
  assert.deepEqual(queueMemberStatuses(f), [["record", "done", "Done outside Relay"], ["record", "done", "Done outside Relay"]]);

  const detail = operatorDetail(f);
  const children = f.children();
  assert.equal(children.length, 2);
  for (const { envelope: { runId } } of children) {
    assert.equal(database.authority.writeIntents.listByRun(runId).length, saves / 2);
    assert.equal(database.authority.runs.listChildren(runId).length, imports / 2);
    const panel = await readRunPanel(detail, runId, signal);
    const logs = projectRunLogs({ ...panel, unavailableEvidence: [] }, { artifactUrl: () => "unused" });
    for (const step of omitted) {
      const stepId = logs.timeline.find(stage => stage.id === step)?.stepId;
      const line = logs.steps.find(entry => entry.id === stepId);
      assert.ok(line, `missing Logs entry for ${step}`);
      assert.match(logPlainText([line]), /Done outside Relay/u);
    }
  }
});

it.each([false, true])("stops before starting any members when reading existing contacts is off (dry run %s)", async dryRun => {
  const f = await world.startWithSteps({ selectedStepKeys: allSteps.filter(key => key !== "members"),
    stepOmissions: [{ step: "members", facts: {} }] }, dryRun);
  const { database, parentRun } = f;
  const { runId } = parentRun.envelope;
  const signal = new AbortController().signal;
  const execution = await f.canonical.execute(parentRun, signal);
  assert.equal(execution.run?.envelope.dryRun, dryRun);
  assert.partialDeepStrictEqual(execution.run?.lifecycle, { state: "terminal", outcome: "done" });
  assert.equal(database.authority.ocrReviews.snapshots(f.run.envelope.runId)[0]?.records.length, 2);
  assert.deepEqual(f.children(), []);
  assert.equal(f.persistence.size, 0);
  assert.equal(f.filing.imports(), 0);
  assert.deepEqual(queueMemberStatuses(f), [["record", "cancelled", "Skipped"], ["record", "cancelled", "Skipped"]]);
  const panel = await readRunPanel(operatorDetail(f), runId, signal);
  const logs = logPlainText(projectRunLogs({ ...panel, unavailableEvidence: [] }, { artifactUrl: () => "unused" }).steps);
  assert.match(logs, /Required evidence unavailable/u);

  const receipt = createReceiptService({ database, runReader: f.canonical.lifecycle, descriptors: [descriptor] }).ensureReceipt(runId);
  if (!dryRun) {
    assert.deepEqual(database.authority.runResults.get(runId)?.result.value, { state: "stopped", reason: "existing-contacts-not-read" });
    const reason = deriveEvidenceEntryId(receipt.receiptId, "output", "reason");
    assert.partialDeepStrictEqual(receipt.output.find(entry => entry.id === reason),
      { state: "satisfied", value: { value: "existing-contacts-not-read" } });
  }
});
