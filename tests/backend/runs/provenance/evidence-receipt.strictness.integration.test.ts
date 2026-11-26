import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";
import { seedPersonLookupExitRun } from "../../../support/fixtures/receipt-run-fixtures.js";
import { RunEvidenceReceiptSchema } from "../../../../src/models/trust/evidence.js";
import { deriveRunEvidenceReceipt } from "../../../../src/backend/runs/provenance/evidence-receipt.js";
import { DESCRIPTORS, CHILD_ONLY_WORKFLOW_MODULES } from "../../../../src/backend/app/registries/workflow-registry.js";
import { STEP_PROOF_DESCRIPTORS } from "../../../../src/backend/app/registries/step-proof-modules.js";

import { separationsKualiFinalizationDescriptor } from "../../../support/helpers/registered-workflows.js";
import { separationsIdentityCheckDescriptor } from "../../../support/helpers/registered-workflows.js";
import {
  GATE_RESOLVED_AT,
  GATE_RESOLVED_BY,
  identityGateReceiptEvidence,
  kualiReceiptEvidence,
} from "../../../support/fixtures/receipt-run-fixtures.js";
import { findGateDecision, gateDecisionFor } from "../../../../src/models/trust/gate-decisions.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { namedFileOutputDescriptor } from "../../../support/fixtures/named-file-output-workflow.js";

const RECEIPT_DESCRIPTORS = [...DESCRIPTORS, ...CHILD_ONLY_WORKFLOW_MODULES.map(module => module.descriptor), ...STEP_PROOF_DESCRIPTORS, namedFileOutputDescriptor];

function kualiReceipt() {
  const evidence = kualiReceiptEvidence();
  return deriveRunEvidenceReceipt({
    descriptor: separationsKualiFinalizationDescriptor,
    run: evidence.run,
    result: evidence.result,
    checkpoints: evidence.checkpoints,
    writes: evidence.writes,
  }).receipt;
}

const profiles: Awaited<ReturnType<typeof createBoundProfileFixture>>[] = [];
const databases: AuthorityDatabase[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const profile of profiles.splice(0)) await profile.close();
});


async function personLookupReceipt() {
  const profile = await createBoundProfileFixture();
  profiles.push(profile);
  const database = AuthorityDatabase.open(
    { path: profile.path, busyTimeoutMs: 250, migrationOwner: "evidence-receipt-guard" },
    manualClock(new Date("2026-08-04T00:11:13.500Z")),
  );
  testWorkerPorts(database, manualClock(new Date("2026-08-04T00:11:13.500Z")), { path: profile.path, descriptor: personLookupDescriptor, poolIndex: 1 });
  databases.push(database);
  const seeded = seedPersonLookupExitRun(database);
  return deriveRunEvidenceReceipt({
    descriptor: personLookupDescriptor,
    run: seeded.run,
    result: database.authority.runResults.get(seeded.run.envelope.runId),
    checkpoints: seeded.checkpoints,
  }).receipt;
}

/* ── half 1: receipt strictness ──────────────────────────────────────────── */

describe("evidence receipt — strictness", () => {
  it("rejects an unknown key at every level of a real receipt", async () => {
    const receipt = JSON.parse(JSON.stringify(await personLookupReceipt())) as Record<string, unknown>;
    assert.equal(RunEvidenceReceiptSchema.safeParse(receipt).success, true);
    assert.equal(
      RunEvidenceReceiptSchema.safeParse({ ...receipt, extra: 1 }).success,
      false,
      "the receipt root accepted an unknown key",
    );
    for (const lane of ["input", "observations", "output", "decisions", "actions", "verification", "reuse"] as const) {
      const rows = receipt[lane];
      assert.ok(Array.isArray(rows) && rows.length > 0, `a real receipt must exercise the ${lane} lane`);
      const typed = rows as Record<string, unknown>[];
      const poisoned = { ...receipt, [lane]: [{ ...typed[0], extra: 1 }, ...typed.slice(1)] };
      assert.equal(
        RunEvidenceReceiptSchema.safeParse(poisoned).success,
        false,
        `${lane} accepted an unknown key`,
      );
    }
  });

  it("carries the graph, config, and input fingerprints a run is bound to", () => {
    const receipt = kualiReceipt();

    assert.equal(
      receipt.descriptorFingerprint,
      RunRecordSchema.parse(kualiReceiptEvidence().run).envelope.contractFingerprint,
    );
    assert.match(receipt.configFingerprint, /^[0-9a-f]{64}$/);
    for (const fact of receipt.input) {
      assert.equal(fact.source.kind, "input");
      if (fact.source.kind !== "input") throw new Error("unreachable");
      assert.match(fact.source.inputFingerprint, /^[0-9a-f]{64}$/);
    }
  });

  it("attributes every observation to a source and dates it, or says it cannot", () => {
    const receipt = kualiReceipt();
    assert.ok(receipt.observations.length > 0);
    for (const fact of receipt.observations) {
      assert.ok(["system", "checkpoint", "derived", "operator-correction"].includes(fact.source.kind));
      if (fact.source.kind === "system" || fact.source.kind === "checkpoint") {
        assert.match(fact.source.observedAt, /^\d{4}-\d{2}-\d{2}T/);
      }
      if (fact.state === "unresolved") assert.ok(fact.reason.length > 0);
    }
  });

  it("files a proof ref for a verified write and never claims a commit was not attempted", () => {
    const receipt = kualiReceipt();
    const commit = receipt.actions.find((action) => action.kind === "commit");
    assert.ok(commit !== undefined);
    assert.equal(commit.writeState, "verified");
    assert.ok(commit.proofRef !== undefined, "a verified write must file its binding proof");

    // Both halves are schema-enforced, so a caller cannot hand-build around them.
    const base = JSON.parse(JSON.stringify(receipt)) as Record<string, unknown>;
    const commitJson = JSON.parse(JSON.stringify(commit)) as Record<string, unknown>;
    const poison = (patch: Record<string, unknown>) => RunEvidenceReceiptSchema.safeParse({
      ...base,
      actions: [{ ...commitJson, ...patch }],
    }).success;
    assert.equal(poison({ proofRef: undefined }), false, "verified without a proof ref was accepted");
    assert.equal(poison({ writeState: "not-attempted", proofRef: undefined }), false,
      "a commit claiming it was never attempted was accepted");
  });

  it("refuses verified-done for every unresolved-evidence condition", () => {
    const base = JSON.parse(JSON.stringify(kualiReceipt())) as Record<string, unknown>;
    assert.equal(base.result, "verified-done");
    const rejects = (patch: Record<string, unknown>, why: string) => {
      assert.equal(RunEvidenceReceiptSchema.safeParse({ ...base, ...patch }).success, false, why);
    };

    rejects({ confidence: "partial" }, "verified-done with non-verified confidence");
    rejects({ failure: { state: "present", value: "11111111-1111-4111-8111-111111111111" } },
      "verified-done carrying a failure id");
    rejects({
      warnings: [{
        id: "22222222-2222-4222-8222-222222222222",
        code: "SOMETHING_UNKNOWN",
        summary: "an uncertainty",
        loadBearing: false,
        evidence: [],
      }],
    }, "verified-done carrying a warning");

    const outputs = base.output as Record<string, unknown>[];
    rejects({
      output: [{
        id: outputs[0].id,
        field: outputs[0].field,
        mandatory: true,
        source: outputs[0].source,
        state: "unresolved",
        reason: "the write could not be read back",
      }, ...outputs.slice(1)],
    }, "verified-done with an unresolved mandatory fact");

    const verification = base.verification as Record<string, unknown>[];
    for (const verdict of ["unknown", "ambiguous"]) {
      rejects({
        verification: [{ ...verification[0], mandatory: true, verdict, evidence: [] }, ...verification.slice(1)],
      }, `verified-done with a ${verdict} mandatory obligation`);
    }
  });

  it("requires unique evidence ids across every lane", () => {
    const base = JSON.parse(JSON.stringify(kualiReceipt())) as Record<string, unknown>;
    const observations = base.observations as Record<string, unknown>[];
    assert.equal(
      RunEvidenceReceiptSchema.safeParse({
        ...base,
        observations: [...observations, observations[0]],
      }).success,
      false,
      "a duplicated evidence id was accepted",
    );
  });

  it("refuses to explain a run that has not settled, and one from another graph", () => {
    const evidence = kualiReceiptEvidence();
    const run = RunRecordSchema.parse(evidence.run);
    const { completion: _completion, ...unsettled } = run;
    assert.throws(() => deriveRunEvidenceReceipt({
      descriptor: separationsKualiFinalizationDescriptor,
      ...evidence,
      run: { ...unsettled, lifecycle: { state: "queued" } },
    }), /a receipt states a settled verdict|only a terminal/);
    assert.throws(() => deriveRunEvidenceReceipt({
      descriptor: separationsKualiFinalizationDescriptor,
      ...evidence,
      run: {
        ...unsettled,
        lifecycle: { state: "terminal", outcome: "interrupted", endedAt: "2026-08-04T17:08:54.867Z" },
      },
    }), /interrupted/);
    assert.throws(() => deriveRunEvidenceReceipt({
      descriptor: RECEIPT_DESCRIPTORS.find(({ id }) => id === "person-lookup") ?? separationsKualiFinalizationDescriptor,
      ...evidence,
    }), /refusing to explain a run with another workflow's graph/);
  });

  it("is a pure function of authority — one run, one byte-identical receipt", () => {
    assert.equal(JSON.stringify(kualiReceipt()), JSON.stringify(kualiReceipt()));
  });


  it("carries a resolved gate's decision, approver and instant instead of `unknown`", () => {
    const evidence = identityGateReceiptEvidence();
    const receipt = deriveRunEvidenceReceipt({
      descriptor: separationsIdentityCheckDescriptor,
      ...evidence,
    }).receipt;

    const gateObligation = receipt.verification.find((row) => row.obligation === "node.identity-approval");
    assert.ok(gateObligation !== undefined, "the gate node emitted no obligation at all");
    assert.equal(gateObligation.verdict, "verified", "a resolved gate is still reported unknown");
    assert.ok(gateObligation.evidence.length > 0, "a verified gate obligation cites nothing");

    const decision = receipt.decisions.find((row) => row.kind === "gate");
    assert.ok(decision !== undefined, "the receipt carries no gate decision");
    assert.equal(decision.outcome, "approved");
    assert.match(decision.reason, /identity-approval/);
    assert.ok(
      decision.reason.includes(GATE_RESOLVED_BY),
      `the gate decision does not name the approver: ${decision.reason}`,
    );
    assert.ok(
      decision.reason.includes(GATE_RESOLVED_AT),
      `the gate decision does not name the instant: ${decision.reason}`,
    );
    assert.ok(
      decision.reason.includes(evidence.evidenceDigest),
      "the gate decision does not name the evidence the approval was bound to",
    );

    // Every fact the gate contributed is sourced from the operator decision,
    // dated by authority's instant — not by a checkpoint that does not exist.
    const gateFacts = receipt.observations.filter((fact) => fact.source.kind === "gate-result");
    assert.ok(gateFacts.length >= 4, "the gate payload contributed no facts");
    for (const fact of gateFacts) {
      assert.equal(fact.source.kind, "gate-result");
      if (fact.source.kind !== "gate-result") continue;
      assert.equal(fact.source.resolvedBy, GATE_RESOLVED_BY);
      assert.equal(fact.source.resolvedAt, GATE_RESOLVED_AT);
    }

    // The gate retains the complete approved EID and its classification.
    const eid = gateFacts.find((fact) => fact.field === "eid");
    assert.ok(eid !== undefined && eid.state === "satisfied");
    const approvedEid = String(
      (evidence.gateResults[0] as { result: { value: { eid: string } } }).result.value.eid,
    );
    assert.deepEqual(eid.value, {
      state: "allowed", key: "eid", classification: "direct-identifier", transform: "allow", value: approvedEid,
    });
  });

  it("refuses a foreign gate row, an undeclared arm, and a gate that left the graph", () => {
    const evidence = identityGateReceiptEvidence();
    const stored = evidence.gateResults[0] as Record<string, unknown>;

    assert.throws(() => deriveRunEvidenceReceipt({
      descriptor: separationsIdentityCheckDescriptor,
      ...evidence,
      gateResults: [{ ...stored, runId: "00000000-0000-4000-8000-000000000001" }],
    }), /refusing to attribute another run's operator decision/);

    assert.throws(() => deriveRunEvidenceReceipt({
      descriptor: separationsIdentityCheckDescriptor,
      ...evidence,
      gateResults: [{ ...stored, gateId: "not-a-node" }],
    }), /gate result node "not-a-node" left the graph/);

    const payload = stored.result as { schemaHash: string; value: Record<string, unknown> };
    assert.throws(() => deriveRunEvidenceReceipt({
      descriptor: separationsIdentityCheckDescriptor,
      ...evidence,
      gateResults: [{
        ...stored,
        result: { ...payload, value: { ...payload.value, decision: "deferred" } },
      }],
    }), /no declared arm matches it|refusing to describe a human decision/);
  });


  it("refuses an undeclared (workflow, gate) pair by name, with no default arm", () => {
    const declaredWorkflow = String(separationsIdentityCheckDescriptor.id);

    // A gate id nobody declared, under a workflow that DOES declare one — the
    // shape a second gate added to an existing graph would have.
    assert.equal(findGateDecision(declaredWorkflow, "second-approval"), undefined);
    assert.throws(
      () => gateDecisionFor(declaredWorkflow, "second-approval"),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /no declared gate decision for /u, message);
        assert.match(message, /second-approval/u, message);

        assert.match(message, /src\/domain\/trust\/gate-decisions\.ts/u, message);
        return true;
      },
    );

    // And a whole workflow nobody declared, which is what a brand-new gated
    // descriptor looks like on its first receipt.
    assert.equal(findGateDecision("no-such-workflow", "identity-approval"), undefined);
    assert.throws(
      () => gateDecisionFor("no-such-workflow", "identity-approval"),
      /no declared gate decision for no-such-workflow\/identity-approval/,
    );

    // The declared pair still resolves, so the two refusals above are about the
    // lookup being SPECIFIC rather than about it being broken.
    assert.equal(
      gateDecisionFor(declaredWorkflow, "identity-approval").gateId,
      "identity-approval",
    );
  });


  it("survives a moved contract closure, and refuses a moved semantic surface", () => {
    const evidence = kualiReceiptEvidence();
    const run = RunRecordSchema.parse(evidence.run);
    const movedClosure = "9".repeat(64);
    const underMovedClosure = (patch: Record<string, unknown> = {}) => ({
      ...evidence,
      run: {
        ...run,
        envelope: { ...run.envelope, contractFingerprint: movedClosure, ...patch },
      },
    });
    const rederived = deriveRunEvidenceReceipt({
      descriptor: separationsKualiFinalizationDescriptor,
      ...underMovedClosure(),
    }).receipt;
    assert.equal(rederived.descriptorFingerprint, movedClosure);
    assert.equal(
      JSON.stringify({ ...rederived, descriptorFingerprint: null }),
      JSON.stringify({ ...kualiReceipt(), descriptorFingerprint: null }),
      "a closure move changed a fact about the run",
    );
    assert.throws(() => deriveRunEvidenceReceipt({
      descriptor: separationsKualiFinalizationDescriptor,
      ...underMovedClosure({ descriptorVersion: 2 }),
    }), /descriptor-version moved/);
  });
});
