import { createCommandKernelTestWorld, type Harness } from "../../../support/helpers/backend/command-kernel-harness.js";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { deriveGateResultCheckpointFingerprint } from "../../../../src/backend/runs/commands/command-kernel.js";
import { planStart } from "../../../../src/backend/runs/start/plan.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import type { RunCheckpointRecord } from "../../../../src/models/workflow/checkpoint.js";
import { checkpointLookupKey } from "../../../../src/models/workflow/checkpoint.js";
import { MatchIdentityOutputSchema } from "../../../../src/models/workflows/separations/match-identity.js";
import { deriveStableUuid } from "../../../../src/rules/identity/identifiers.js";
import { IdentityApprovalResultSchema } from "../../../../src/rules/separations/identity-approval.js";
import { deriveIdentityEvidenceDigest } from "../../../../src/rules/separations/identity-evidence.js";
import { noSeparationWritePlan } from "../../../../src/rules/separations/write-plan.js";
import { BUILD_MANIFEST, resolveTaskImplFingerprint } from "../../../../src/workflow-kit/validation/build-manifest.js";
import { descriptorRuntimeNodes } from "../../../../src/workflow-kit/workflow.js";
import { singleAppliedRunId } from "../../../support/fixtures/operator-command-fixtures.js";
import { HASH_A, NOW, UUID_4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const { roots, openDatabases, identityCheckDescriptor, createHarness, nextCommandId, _createPlan } = createCommandKernelTestWorld();


afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function startCommand(plan: ReturnType<typeof _createPlan>, commandId = nextCommandId()) {
  return {
    commandId,
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "dashboard",
    family: "start",
    type: "start-run",
    target: { workflowId: plan.workflowId, startPlanId: plan.startPlanId, expectedVersion: plan.version },
    payload: {
      descriptorFingerprint: plan.descriptorFingerprint,
      configFingerprint: plan.configFingerprint,
      ingressSchemaHash: plan.ingressSchemaHash,
      canonicalInputSchemaHash: plan.canonicalInputSchemaHash,
      inputFingerprint: plan.inputFingerprint,
    },
  };
}

describe("gate resolution", () => {
  function stageIdentityGateRun(
    harness: Harness,
    source: "name-resolved" | "document-eid" = "name-resolved",
    planChange?: Readonly<{ currentReason: string; previousReason: string }>,
  ): { runId: string; version: number; evidenceDigest: string; eid: string; checkpoint: RunCheckpointRecord } {
    const submission = source === "name-resolved"
      ? {
        documentNumber: "4502",
        employeeName: "Hernandez, Jose Santos",
        emplId: "10401814",
        emplIdSource: "name-resolved" as const,
        documentEid: { state: "absent" as const, reason: "the separation document's EID field was blank" },
      }
      : {
        documentNumber: "4510",
        employeeName: "Battistessa, Johnnie",
        emplId: "10873698",
        emplIdSource: "document-eid" as const,
        documentEid: { state: "present" as const, value: "10873698" },
      };
    const plan = planStart(
      { authority: harness.database, clock: harness.clock, ids: harness.plannerIds, planTtlMs: 600_000 },
      {
        descriptor: identityCheckDescriptor,
        submissions: [submission],
        dryRun: false,
        priority: "bulk",
        shape: "single",
        configFingerprint: harness.database.authority.runtimeConfig.get()!.configFingerprint,
        configSnapshotId: UUID_4,
        plannedBy: "local-operator",
      },
    );
    assert.equal(harness.database.authority.startPlans.create(plan).state, "inserted");
    const started = harness.kernel.execute(startCommand(plan));
    assert.equal(started.state, "applied");
    const runId = singleAppliedRunId(started);
    const claimed = harness.database.authority.runs.claimNext({ workflow: identityCheckDescriptor.id, workerId: "worker-1", now: NOW });
    assert.equal(claimed.state, "claimed");
    if (claimed.state !== "claimed") throw new Error("unreachable");
    const claim = { workerId: "worker-1", claimGeneration: claimed.run.claimGeneration };
    const task = descriptorRuntimeNodes(identityCheckDescriptor)
      .find((node) => node.kind === "task" && String(node.id) === "comparison");
    assert.ok(task !== undefined && task.kind === "task");
    const example = MatchIdentityOutputSchema.parse(task.uses.example);
    const packet = {
      ...example.packet,
      ...(planChange === undefined ? {} : { plan: noSeparationWritePlan(planChange.currentReason) }),
      emplIdSource: source,
      documentEidText: source === "document-eid"
        ? example.packet.emplId
        : "the separation document's EID field was blank",
    };
    const output = MatchIdentityOutputSchema.parse({
      packet,
      evidenceDigest: deriveIdentityEvidenceDigest(packet),
    });
    const checkpoint = harness.database.authority.runCheckpoints.insert({
      workflowId: identityCheckDescriptor.id,
      itemId: claimed.run.envelope.itemId,
      nodeId: "comparison",
      attempt: claimed.run.envelope.attempt,
      claimGeneration: claimed.run.claimGeneration,
      runId,
      output: { schemaHash: deriveSchemaHash(task.uses.output, "output"), value: output },
      descriptorVersion: identityCheckDescriptor.version,
      contractFingerprint: identityCheckDescriptor.contractFingerprint,
      implFingerprint: resolveTaskImplFingerprint(BUILD_MANIFEST, task.uses.id),
      provenance: [],
      writtenAt: NOW,
    });
    assert.equal(checkpoint.state, "inserted");
    if (checkpoint.state !== "inserted") throw new Error("identity checkpoint fixture was not inserted");
    const checkpointEvent = harness.database.authority.timelineEvents.get(deriveStableUuid(
      "timeline-checkpoint-recorded",
      checkpointLookupKey(
        checkpoint.record.workflowId,
        checkpoint.record.itemId,
        checkpoint.record.nodeId,
        checkpoint.record.attempt,
        checkpoint.record.claimGeneration,
      ),
    ));
    assert.equal(checkpointEvent?.payload.kind, "checkpoint-recorded");
    if (checkpointEvent?.payload.kind !== "checkpoint-recorded") {
      throw new Error("identity checkpoint fixture did not persist its timeline authority link");
    }
    assert.equal(checkpointEvent.payload.runId, runId);
    assert.equal(checkpointEvent.payload.workflow, identityCheckDescriptor.id);
    assert.equal(checkpointEvent.payload.attempt, claimed.run.envelope.attempt);
    assert.equal(Number(checkpointEvent.payload.claimGeneration), Number(claimed.run.claimGeneration));
    const lifecycleBase = { workerId: "worker-1", claimedAt: NOW, heartbeatAt: NOW };
    let version: number = claimed.run.version;
    for (const state of ["validating", "running"] as const) {
      const outcome = harness.database.authority.runs.transition({
        runId, expectedVersion: version, claim, lifecycle: { state, ...lifecycleBase }, now: NOW,
      });
      assert.equal(outcome.state, "applied");
      version += 1;
    }
    const parked = harness.database.authority.runs.transition({
      runId, expectedVersion: version, claim,
      lifecycle: { state: "parked-gate", gateId: "identity-approval", parkedAt: NOW, resumeAt: "approval" },
      now: NOW,
    });
    assert.equal(parked.state, "applied");
    if (parked.state !== "applied") throw new Error("unreachable");
    return {
      runId,
      version: parked.run.version,
      evidenceDigest: output.evidenceDigest,
      eid: packet.emplId,
      checkpoint: checkpoint.record,
    };
  }

  function gateCommand(runId: string, expectedVersion: number, result: unknown, gateId = "identity-approval") {
    return {
      commandId: nextCommandId(),
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "gate",
      type: "resolve-gate",
      target: { runId, gateId, expectedVersion },
      payload: { result },
    };
  }

  function identityResult(staged: { evidenceDigest: string; eid: string }, digest = staged.evidenceDigest) {
    return {
      schemaHash: deriveSchemaHash(IdentityApprovalResultSchema, "output"),
      value: { decision: "approved", eid: staged.eid, chosenFrom: "checked", evidenceDigest: digest },
    };
  }

  function assertGateRefusalHasNoMutation(
    harness: Harness,
    runId: string,
    command: ReturnType<typeof gateCommand>,
    expectedCode: "invalid-state" | "schema-mismatch",
  ) {
    const beforeRun = harness.database.authority.runs.get(runId);
    const beforeEvents = harness.database.authority.timelineEvents.page({});
    const beforeGeneration = harness.database.getMeta().authorityGeneration;
    const result = harness.kernel.execute(command);
    assert.equal(result.state, "rejected");
    if (result.state === "rejected") assert.equal(result.code, expectedCode);
    assert.deepEqual(harness.database.authority.runs.get(runId), beforeRun);
    assert.equal(harness.database.authority.gateResults.get(`${runId}:${command.target.gateId}`), undefined);
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
    assert.equal(harness.database.getMeta().authorityGeneration, beforeGeneration);
    assert.deepEqual(harness.database.authority.timelineEvents.page({}), beforeEvents);
    return result;
  }

  it("rolls back gate result, resume and command when the required SQLite event cannot persist", () => {
    const harness = createHarness();
    const staged = stageIdentityGateRun(harness);
    const gate = descriptorRuntimeNodes(identityCheckDescriptor)
      .find((node) => node.kind === "gate" && String(node.id) === "identity-approval");
    assert.ok(gate?.kind === "gate");
    const command = gateCommand(staged.runId, staged.version, identityResult(staged));
    const before = harness.database.authority.runs.get(staged.runId);
    const generation = harness.database.getMeta().authorityGeneration;
    const history = harness.database.authority.timelineEvents.page({});
    using raw = new DatabaseSync(join(harness.stateRoot, "kernel.sqlite"));
    raw.exec("CREATE TRIGGER injected_gate_event_failure BEFORE INSERT ON timeline_events BEGIN SELECT RAISE(ABORT, 'injected gate event failure'); END");
    assert.throws(() => harness.kernel.execute(command), /injected gate event failure/);
    assert.deepEqual(harness.database.authority.runs.get(staged.runId), before);
    assert.equal(harness.database.authority.gateResults.get(`${staged.runId}:identity-approval`), undefined);
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
    assert.equal(harness.database.getMeta().authorityGeneration, generation);
    assert.deepEqual(harness.database.authority.timelineEvents.page({}), history);
    raw.exec("DROP TRIGGER injected_gate_event_failure");
    assert.equal(harness.kernel.execute(command).state, "applied");
    const stored = harness.database.authority.gateResults.get(`${staged.runId}:identity-approval`);
    assert.ok(stored !== undefined);
    assert.ok(!("source" in stored));
    assert.equal(stored.resolvedBy, "local-operator");
    assert.equal(stored.resolvedAt, NOW);
    assert.deepEqual(stored.result.value, IdentityApprovalResultSchema.parse(identityResult(staged).value));
    const resolved = harness.database.authority.timelineEvents.page({}).filter((event) => event.payload.kind === "span" && event.payload.event.t === "gate.resolved");
    assert.equal(resolved.length, 1);
    assert.equal(harness.kernel.execute(command).state, "already-applied");
    assert.equal(harness.database.authority.timelineEvents.page({}).filter((event) => event.payload.kind === "span" && event.payload.event.t === "gate.resolved").length, 1);
  });

  it("parses the descriptor's exact gate schema, stores the result, and resumes at the parked node", () => {
    const harness = createHarness();
    const staged = stageIdentityGateRun(harness);
    const gateNode = descriptorRuntimeNodes(identityCheckDescriptor)
      .find((node) => node.kind === "gate" && String(node.id) === "identity-approval");
    assert.ok(gateNode !== undefined && gateNode.kind === "gate");
    const schemaHash = deriveSchemaHash(gateNode.result, "output");

    assertGateRefusalHasNoMutation(harness, staged.runId, gateCommand(staged.runId, staged.version, {
      ...identityResult(staged), schemaHash: HASH_A,
    }), "schema-mismatch");

    assertGateRefusalHasNoMutation(harness, staged.runId, gateCommand(staged.runId, staged.version, {
      schemaHash,
      value: { decision: "approved", eid: staged.eid, chosenFrom: "checked", evidenceDigest: "malformed" },
    }), "schema-mismatch");

    const stale = harness.kernel.execute(gateCommand(staged.runId, staged.version + 2, {
      ...identityResult(staged), schemaHash,
    }));
    assert.equal(stale.state, "conflict");

    const resolved = harness.kernel.execute(gateCommand(staged.runId, staged.version, identityResult(staged)));
    assert.equal(resolved.state, "applied");
    const stored = harness.database.authority.gateResults.get(`${staged.runId}:identity-approval`);
    assert.ok(stored !== undefined);
    assert.deepEqual(stored.result, { schemaHash, value: identityResult(staged).value });
    assert.equal(stored.checkpointFingerprint, deriveGateResultCheckpointFingerprint(stored.result));
    const resumed = harness.database.authority.runs.get(staged.runId);
    assert.equal(resumed?.lifecycle.state, "queued");
    assert.equal(resumed?.envelope.startAt, "approval");
  });

  it("refuses a decision bound to the previous write plan before writing authority", () => {
    const harness = createHarness();
    const staged = stageIdentityGateRun(harness, "name-resolved", {
      currentReason: "the current run does not compose a separation write plan",
      previousReason: "the approved packet showed a prior write plan",
    });
    const currentPacket = MatchIdentityOutputSchema.parse(staged.checkpoint.output.value).packet;
    const staleDigest = deriveIdentityEvidenceDigest({
      ...currentPacket,
      plan: noSeparationWritePlan("the approved packet showed a prior write plan"),
    });
    assertGateRefusalHasNoMutation(
      harness,
      staged.runId,
      gateCommand(staged.runId, staged.version, identityResult(staged, staleDigest)),
      "invalid-state",
    );
  });

  it("records an explicit rejection by the command actor and resumes at the declared node", () => {
    const harness = createHarness();
    const staged = stageIdentityGateRun(harness);
    const result = harness.kernel.execute(gateCommand(staged.runId, staged.version, {
      schemaHash: deriveSchemaHash(IdentityApprovalResultSchema, "output"),
      value: { decision: "rejected", reason: "the packet does not establish this identity", evidenceDigest: staged.evidenceDigest },
    }));
    assert.equal(result.state, "applied");
    const stored = harness.database.authority.gateResults.get(`${staged.runId}:identity-approval`);
    assert.ok(stored !== undefined && !("source" in stored));
    assert.equal(stored.resolvedBy, "local-operator");
    assert.equal(stored.resolvedAt, NOW);
    assert.equal(IdentityApprovalResultSchema.parse(stored.result.value).decision, "rejected");
    const resumed = harness.database.authority.runs.get(staged.runId);
    assert.equal(resumed?.lifecycle.state, "queued");
    assert.equal(resumed?.envelope.startAt, "approval");
  });

  it("refuses a newer item checkpoint from an unlinked claim before writing authority", () => {
    const harness = createHarness();
    const staged = stageIdentityGateRun(harness);
    const sibling = harness.database.authority.runCheckpoints.insert({
      ...staged.checkpoint,
      runId: staged.runId,
      claimGeneration: Number(staged.checkpoint.claimGeneration) + 1,
    });
    assert.equal(sibling.state, "inserted");
    assertGateRefusalHasNoMutation(
      harness,
      staged.runId,
      gateCommand(staged.runId, staged.version, identityResult(staged)),
      "invalid-state",
    );
  });

  it("refuses a gate whose declared condition is now false before writing authority", () => {
    const harness = createHarness();
    const staged = stageIdentityGateRun(harness, "document-eid");
    assertGateRefusalHasNoMutation(
      harness,
      staged.runId,
      gateCommand(staged.runId, staged.version, identityResult(staged)),
      "invalid-state",
    );
  });
});
