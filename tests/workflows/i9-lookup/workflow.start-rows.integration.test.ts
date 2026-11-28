import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { projectStartRows, projectStartSteps, resolveStartStepOmissions, startRowWire } from "../../../src/backend/runs/start/step-selection.js";
import { readRerunValues } from "../../../src/backend/runs/start/rerun-values.js";
import { projectTypedSteps } from "../../../src/backend/runs/queries/run-detail/typed-values.js";
import { deriveRunEvidenceReceipt } from "../../../src/backend/runs/provenance/evidence-receipt.js";
import { lastIncludedSwitch, rowOpenFold, startRowsOf, stepEntries } from "../../../src/dashboard/surfaces/run-start/run-steps-model.js";
import { canonicalChildExecution } from "../../support/helpers/backend/canonical-child-execution.js";
import { createRunExecutorTestWorld } from "../../support/helpers/backend/run-executor-world.js";
import { sessionFactoryHarness } from "../../support/helpers/phase1f-executor-harness.js";
import { i9LookupModule } from "../../support/helpers/registered-workflows.js";

const { descriptor } = i9LookupModule;
const world = createRunExecutorTestWorld();
afterEach(world.cleanup);

it("refuses invalid lookup results in Steps before starting", () => {
  const [row] = startRowsOf({ steps: projectStartSteps(descriptor), rows: projectStartRows(descriptor).map(startRowWire) });
  assert.ok(row?.form);
  const historical = { i9Status: "historical", signerName: "", profileId: "900001", i9Id: "900002" };
  for (const invalid of [
    { ...historical, profileId: "" },
    { ...historical, i9Id: "" },
    { ...historical, profileId: "invalid" },
    { ...historical, i9Id: "0" },
    { ...historical, signerName: "Example Representative" },
    { ...historical, i9Status: "signed", signerName: "Example Representative", profileId: "invalid" },
    { ...historical, i9Status: "not-found" },
    { ...historical, i9Status: "unable-to-access", profileId: "", i9Id: "", signerName: "Example Representative" },
  ]) assert.equal(stepEntries([rowOpenFold(row, row.form, invalid)]), null, JSON.stringify(invalid));
  assert.ok(stepEntries([rowOpenFold(row, row.form, historical)]));
  for (const i9Status of ["unsigned", "not-found", "unable-to-access"]) {
    assert.ok(stepEntries([rowOpenFold(row, row.form, { i9Status, signerName: "", profileId: "", i9Id: "" })]));
  }
});

it("uses the typed lookup result without opening I-9 Complete", async () => {
  assert.deepEqual(projectStartRows(descriptor).map(({ key, kind, off }) => [key, kind, off]), [
    ["lookup", "switch", "values"],
  ]);
  const signer = { i9Status: "signed", signerName: "Example Representative", profileId: "900001", i9Id: "900002" };
  const rows = startRowsOf({ steps: projectStartSteps(descriptor), rows: projectStartRows(descriptor).map(startRowWire) });
  const row = rows[0]; assert.ok(row?.form);
  assert.equal(lastIncludedSwitch(row, rows, ["lookup"], []), false);
  assert.equal(stepEntries([rowOpenFold(row, row.form, { ...signer, signerName: "" })]), null);
  assert.deepEqual(stepEntries([rowOpenFold(row, row.form, signer)]), [{ step: "lookup", facts: signer }]);
  assert.throws(() => resolveStartStepOmissions(descriptor, [], [{ step: "lookup", facts: { ...signer, signerName: null } }]), /facts are invalid.*signerName/u);
  assert.throws(() => resolveStartStepOmissions(descriptor, [], [{ step: "lookup", facts: { ...signer, i9Id: "incorrect" } }]), /facts are invalid.*i9Id/u);
  const h = await world.executorHarness({ descriptor, sessions: sessionFactoryHarness({ i9: () => {
    throw new Error("A typed lookup must not open I-9 Complete");
  } }) });
  const { database, path } = h.authority;
  const execution = canonicalChildExecution(h.deps, database, path, id => id === descriptor.id ? descriptor : undefined);
  const run = execution.start(descriptor, { lastName: "Example", firstName: "Person" }, {
    dryRun: false, selectedStepKeys: [], stepOmissions: [{ step: "lookup", facts: signer }],
  });
  const { run: settled } = await execution.execute(run, world.SIGNAL);
  assert.ok(settled?.lifecycle.state === "terminal" && settled.lifecycle.outcome === "done");
  const retained = database.authority.runResults.get(run.envelope.runId);
  assert.ok(retained);
  assert.deepEqual(retained.result.value, signer);
  const checkpoints = database.authority.runCheckpoints.listByItem(descriptor.id, run.envelope.itemId);
  const typed = checkpoints.find(checkpoint => checkpoint.nodeId === "lookup-source");
  assert.equal(typed?.assertion?.step, "lookup");
  assert.deepEqual(typed?.output.value, signer);
  assert.ok(retained.dependencies.some(dependency => dependency.nodeId === "lookup" && dependency.state === "resolved"));
  const { receipt } = deriveRunEvidenceReceipt({ descriptor, run: settled, result: retained, checkpoints });
  assert.ok(receipt.output.some(fact => fact.field === "i9Status"));

  const detail = projectTypedSteps(settled, descriptor).get("lookup")?.typedValues;
  assert.deepEqual(detail?.fields.filter(field => "withheld" in field).map(({ key }) => key), ["profileId", "i9Id"]);
  const rerun = readRerunValues({ reader: execution.lifecycle, database, descriptors: { resolve: id => id === descriptor.id ? descriptor : undefined } },
    { runId: settled.envelope.runId, expectedVersion: settled.version });
  assert.ok(rerun.state === "available", JSON.stringify(rerun));
  assert.ok(!rerun.snapshot.typed?.some(entry => entry.step === "lookup"));
  for (const privateValue of [signer.profileId, signer.i9Id]) {
    assert.ok(!JSON.stringify(detail).includes(privateValue), "manual values in Logs must withhold record identifiers");
    assert.ok(!JSON.stringify(rerun).includes(privateValue), "Rerun must withhold record identifiers");
  }
});
