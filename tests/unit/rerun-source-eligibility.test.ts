import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { requireLifecycleApplied } from "../../src/core/run-record-service.js";
import { archivedRunContentDigest, ArchivedRunContentSchema, ArchivedRunRecordSchema, VersionBumpApplicationSchema } from "../../src/domain/archive/model.js";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { StartPlanWireSchema } from "../../src/domain/dashboard/start-plan.js";
import type { RunRecord } from "../../src/domain/run/record.js";
import { RerunPlanSchema } from "../../src/domain/run/rerun.js";
import { StartPlanRecordSchema, derivePlannedInputFingerprint } from "../../src/domain/run/start-plan.js";
import { sha256Hex } from "../../src/domain/sha256.js";
import { RerunRefusedError } from "../../src/services/start/rerun.js";
import { ARCHIVED_RUN, VERSION_PLAN_ROW, VERSION_BUMP_APPLICATION } from "./fixtures/archive-fixtures.js";
import { sourceBoundHarness } from "./fixtures/source-bound-fixtures.js";
import { sourceBoundReadDescriptor, sourceBoundReadStores } from "./fixtures/source-bound-read-fixtures.js";

const disposers: (() => void)[] = [];
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); });
type Harness = ReturnType<typeof sourceBoundHarness>;
function harness() {
  const h = sourceBoundHarness(sourceBoundReadDescriptor, sourceBoundReadStores);
  disposers.push(h.dispose); return h;
}

function archivedRecord(run: RunRecord) {
  if (run.lifecycle.state !== "terminal") throw new Error("archive fixture requires a terminal run");
  const { contentDigest: _digest, ...template } = ARCHIVED_RUN;
  const status = run.lifecycle.outcome === "interrupted" ? "blocked"
    : run.lifecycle.outcome === "failed" ? "failed"
      : run.lifecycle.outcome === "done" ? "done" : "cancelled";
  const detailOutcome = run.lifecycle.outcome === "interrupted"
    ? { state: "absent" as const, reason: "run interrupted; ref write-safety recovery will requeue or settle it" }
    : {
        state: "terminal" as const,
        result: run.lifecycle.outcome === "done" ? run.envelope.dryRun ? "partial" as const : "verified-done" as const
          : run.lifecycle.outcome === "failed" ? "failed" as const : "cancelled" as const,
        completedAt: run.lifecycle.endedAt,
        ...(run.lifecycle.outcome === "done" && run.envelope.dryRun ? { rehearsal: true as const } : {}),
      };
  const content = ArchivedRunContentSchema.parse({
    ...template,
    runId: run.envelope.runId,
    workflowId: run.envelope.workflow,
    traceId: run.envelope.traceId,
    archivedIdentity: {
      workflowId: run.envelope.workflow,
      descriptorVersion: run.envelope.descriptorVersion,
      contractFingerprint: run.envelope.contractFingerprint,
    },
    input: run.input,
    row: {
      ...template.row,
      runId: run.envelope.runId,
      itemId: run.envelope.itemId,
      workflowId: run.envelope.workflow,
      traceId: run.envelope.traceId,
      attempt: run.envelope.attempt,
      descriptorVersion: run.envelope.descriptorVersion,
      descriptorHash: run.envelope.contractFingerprint,
      configFingerprint: run.envelope.configFingerprint,
      dryRun: run.envelope.dryRun,
      priority: run.envelope.priority,
      runNumber: run.runNumber === undefined
        ? { state: "absent", reason: "historical run had no ordinal" }
        : { state: "present", value: run.runNumber },
      rowRevision: run.version,
      status,
      endedAt: { state: "present", value: run.lifecycle.endedAt },
    },
    detail: {
      ...template.detail,
      runId: run.envelope.runId,
      rowRevision: run.version,
      header: {
        ...template.detail.header,
        runId: run.envelope.runId,
        traceId: run.envelope.traceId,
        workflowId: run.envelope.workflow,
        status,
        attempt: run.envelope.attempt,
      },
      outcome: detailOutcome,
    },
  });
  return ArchivedRunRecordSchema.parse({
    ...content,
    contentDigest: archivedRunContentDigest(content),
  });
}

async function sourceOf(h: Harness, kind: "archived" | "cancelled" | "discarded" | "superseded") {
  const queued = h.start(h.proposal());
  if (kind !== "archived") return requireLifecycleApplied(h.lifecycle.transition({
    commandId: h.ids.uuid(), runId: queued.envelope.runId, expectedVersion: queued.version,
    lifecycle: { state: "terminal", outcome: kind, endedAt: h.clock.now().toISOString() },
  }));
  assert.equal((await h.execute(queued)).state, "done");
  const terminal = h.fresh(queued);
  h.database.authority.versionPlans.insert(VERSION_PLAN_ROW);
  h.database.authority.versionBumpApplications.insert(VersionBumpApplicationSchema.parse({
    ...VERSION_BUMP_APPLICATION, archivedRunIds: [terminal.envelope.runId],
  }));
  const archived = requireLifecycleApplied(h.lifecycle.archive({
    commandId: h.ids.uuid(), expectedVersion: terminal.version, archive: archivedRecord(terminal),
  }));
  assert.equal(h.lifecycle.read(archived.envelope.runId).state, "present");
  assert.equal(h.database.authority.archivedRuns.isArchived(archived.envelope.runId), true);
  return archived;
}

// A strict, persisted pre-fix plan is a compatibility input to consumption. Its
// read-only descriptor has no transaction warnings, so all warning facts are known.
function storedPreEligibilityPlan(h: Harness, source: RunRecord) {
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
    archive: h.database.authority.archivedRuns.get(source.envelope.runId) ?? null,
    intents: h.database.authority.writeIntents.listByRun(source.envelope.runId),
    checkpoints: h.database.authority.runCheckpoints.listByItem(h.descriptor.id, source.envelope.itemId),
    identities: h.lifecycleIds.minted(), queueRoots: h.queueRoots });
}

describe("Rerun source eligibility at planning and final consumption", () => {
  for (const kind of ["archived", "cancelled", "discarded", "superseded"] as const) {
    it(`refuses ${kind} source planning without persisting a plan or lifecycle effects`, async () => {
      const h = harness(); const source = await sourceOf(h, kind);
      const before = snapshot(h, source); const planIdsBefore = h.planIds.minted().length;
      assert.throws(() => h.proposal(source), (error) => error instanceof RerunRefusedError && error.code === "invalid-state");
      assert.equal(snapshot(h, source), before);
      for (const id of h.planIds.minted().slice(planIdsBefore)) assert.equal(h.database.authority.startPlans.get(id), undefined);
    });
    it(`refuses a persisted pre-fix ${kind} plan without consuming it or creating work`, async () => {
      const h = harness(); const source = await sourceOf(h, kind);
      const plan = storedPreEligibilityPlan(h, source); const command = h.command(plan);
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
