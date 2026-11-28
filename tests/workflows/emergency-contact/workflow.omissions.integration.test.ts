import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { workflowModuleOf } from "../../../src/backend/app/registries/workflow-registry.js";
import { createOperatorProjection, createOperatorRunDetail } from "../../../src/backend/app/composition/dashboard/operator.js";
import { readRunPanel } from "../../../src/backend/runs/queries/run-detail.js";
import { projectStartSteps } from "../../../src/backend/runs/start/step-selection.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import { projectRunLogs } from "../../../src/dashboard/state/run-wiring-adapter.js";
import { logPlainText } from "../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";
import { EmergencyContactResultSchema } from "../../../src/models/workflows/emergency-contact/result.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import { createEmergencyContactRetryWorld } from "../../support/helpers/backend/emergency-contact-retry-world.js";

const world = createEmergencyContactRetryWorld();
afterEach(world.cleanup);
const { descriptor } = workflowModuleOf("emergency-contact");
const allSteps = projectStartSteps(descriptor).map(({ key }) => key);

it.each(["contact-preview", "onbase-filing"] as const)("records %s as Done outside Relay for each approved member", async step => {
  const f = await world.startWithSteps({ selectedStepKeys: allSteps, stepOmissions: [{ workflow: "emergency-contact-member", step, facts: {} }] });
  const signal = new AbortController().signal;
  const { database, clock, parentRun, resolve } = f;
  const execution = await f.canonical.execute(parentRun, signal);
  assert.partialDeepStrictEqual(execution.run?.lifecycle, { state: "terminal", outcome: "done" });
  const result = EmergencyContactResultSchema.parse(database.authority.runResults.get(parentRun.envelope.runId)?.result.value);
  const omitSave = step === "contact-preview";
  assert.deepEqual(result.members.map(member => member.state === "done" ? member.output.disposition : member.state),
    omitSave ? ["omitted", "omitted"] : ["committed", "committed"]);
  assert.equal([...f.persistence.values()].flatMap(({ submissions }) => submissions).length, omitSave ? 0 : 2);
  assert.equal(f.filing.imports(), omitSave ? 2 : 0);

  const stateRoot = f.harness.authority.stateRoot, reader = f.canonical.lifecycle, descriptors = { resolve };
  const projection = createOperatorProjection({ database, stateRoot, clock, reader, appVersion: "0.1.0",
    descriptorSetHash: FingerprintSchema.parse("a".repeat(64)), ledger: createTransactionHistory(database.authority), descriptors });
  projection.ingestFromTimeline();
  const detail = createOperatorRunDetail({ database, stateRoot, projection, runReader: reader, canonical: { database, reader, descriptors } });
  const children = f.children();
  assert.equal(children.length, 2);
  for (const { envelope: { runId } } of children) {
    assert.equal(database.authority.writeIntents.listByRun(runId).length, omitSave ? 0 : 1);
    assert.equal(database.authority.runs.listChildren(runId).length, omitSave ? 1 : 0);
    const panel = await readRunPanel(detail, runId, signal);
    const logs = logPlainText(projectRunLogs({ ...panel, unavailableEvidence: [] }, { artifactUrl: () => "unused" }).steps);
    assert.match(logs, /Done outside Relay/u);
  }
});

it("stops before starting any members when reading existing contacts is off", async () => {
  const f = await world.startWithSteps({ selectedStepKeys: allSteps.filter(key => key !== "members"), stepOmissions: [{ step: "members", facts: {} }] });
  const { database, parentRun } = f;
  const execution = await f.canonical.execute(parentRun, new AbortController().signal);
  assert.partialDeepStrictEqual(execution.run?.lifecycle, { state: "terminal", outcome: "done" });
  assert.equal(database.authority.ocrReviews.snapshots(f.run.envelope.runId)[0]?.records.length, 2);
  assert.deepEqual(f.children(), []);
  assert.equal(f.persistence.size, 0);
  assert.equal(f.filing.imports(), 0);
  assert.deepEqual(database.authority.runResults.get(parentRun.envelope.runId)?.result.value,
    { state: "stopped", reason: "existing-contacts-not-read" });
});
