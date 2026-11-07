import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";

import { RerunRefusedError } from "../../../../src/backend/runs/start/rerun.js";
import { StartPlanWireSchema } from "../../../../src/models/dashboard/start-plan.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { RerunPlanSchema } from "../../../../src/models/run/rerun.js";
import { StartPlanRecordSchema,derivePlannedInputFingerprint } from "../../../../src/models/run/start-plan.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { sourceBoundHarness } from "../../../support/fixtures/integration/source-bound-fixtures.js";
import { sourceBoundReadDescriptor,sourceBoundReadStores } from "../../../support/fixtures/source-bound-read-fixtures.js";

const disposers: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose(); });
type Harness = Awaited<ReturnType<typeof sourceBoundHarness>>;
async function harness() {
  const h = await sourceBoundHarness(sourceBoundReadDescriptor, sourceBoundReadStores);
  disposers.push(h.dispose); return h;
}


function sourceOf(h: Harness, kind: "cancelled" | "discarded" | "superseded") {
  const queued=h.start(h.proposal());
  return requireLifecycleApplied(h.lifecycle.transition({commandId:h.ids.uuid(),runId:queued.envelope.runId,
    expectedVersion:queued.version,lifecycle:{state:"terminal",outcome:kind,endedAt:h.clock.now().toISOString()}}));
}

function storedIneligibleSourcePlan(h: Harness, source: RunRecord) {
  const ordinary = h.proposal();
  const template = h.database.authority.startPlans.get(ordinary.startPlanId); assert.ok(template);
  const selectedStepKeys = h.descriptor.timeline.map((step) => step.key);
  const sourceCoordinate = { runId: source.envelope.runId, expectedVersion: source.version, intent: "rerun", selectedStepKeys };
  const warningDigest = sha256Hex(`hrauto:rerun-warnings:v1\0${canonicalJsonStringify({
    runId: source.envelope.runId, expectedVersion: source.version,
    descriptorFingerprint: h.descriptor.contractFingerprint, selectedStepKeys: [...selectedStepKeys].sort(), warnings: [],
  })}`);
  const rerun = RerunPlanSchema.parse({ source: sourceCoordinate, warnings: [], warningDigest });
  const record = StartPlanRecordSchema.parse({ ...template, startPlanId: h.planIds.uuid(), rerun,
    inputFingerprint: derivePlannedInputFingerprint(template.planned, template.ingressSchemaHash, template.canonicalInputSchemaHash, rerun, template.stepOmissions) });
  assert.equal(h.database.authority.startPlans.create(record).state, "inserted");
  return StartPlanWireSchema.parse({ ...ordinary, startPlanId: record.startPlanId, rerun,
    fingerprints: { ...ordinary.fingerprints, inputFingerprint: record.inputFingerprint } });
}
function snapshot(h: Harness, source: RunRecord) {
  return canonicalJsonStringify({ generation: h.database.getMeta().authorityGeneration,
    runs: h.database.authority.runs.listByWorkflow(h.descriptor.id),
    intents: h.database.authority.writeIntents.listByRun(source.envelope.runId),
    checkpoints: h.database.authority.runCheckpoints.listByItem(h.descriptor.id, source.envelope.itemId),
    identities: h.lifecycleIds.minted(), queueRoots: h.queueRoots });
}

describe("Rerun source eligibility at planning and final consumption", () => {
  for (const kind of ["cancelled", "discarded", "superseded"] as const) {
    it(`refuses ${kind} source planning without persisting a plan or lifecycle effects`, async () => {
      const h = await harness(); const source = sourceOf(h, kind);
      const before = snapshot(h, source); const planIdsBefore = h.planIds.minted().length;
      assert.throws(() => h.proposal(source), (error) => error instanceof RerunRefusedError && error.code === "invalid-state");
      assert.equal(snapshot(h, source), before);
      for (const id of h.planIds.minted().slice(planIdsBefore)) assert.equal(h.database.authority.startPlans.get(id), undefined);
    });
    it(`refuses a persisted ineligible ${kind} plan without consuming it or creating work`, async () => {
      const h = await harness(); const source = sourceOf(h, kind);
      const plan = storedIneligibleSourcePlan(h, source); const command = h.command(plan);
      const before = snapshot(h, source);
      const result = h.kernel.execute(command);
      assert.equal(result.state, "rejected");
      if (result.state !== "rejected") throw new Error("ineligible source created work");
      assert.equal(result.code, "invalid-state");
      assert.equal(snapshot(h, source), before);
      assert.equal(h.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
      assert.equal(h.database.authority.commands.get(command.commandId), undefined);
    });
  }
});
