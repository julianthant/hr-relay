/**
 * `evidence-receipt` — ref guards-and-tests §3.10's guard, activated with the D82 receipt
 * builder (D140/D141).
 *
 * Its spec has two halves and both are executed here:
 *
 * 1. **Strictness.** Every terminal run produces a STRICT receipt carrying the
 *    input/config/graph fingerprints, node outcomes, provenance,
 *    proof/failure refs, exclusions, and an explicit confidence. `done`
 *    requires all mandatory evidence and no unresolved write/subject/storage
 *    condition — proven by violating fixtures, not only by a happy path.
 * 2. **Classified values.** Current receipts retain complete supplied values
 *    and their original declared classifications. Undeclared leaves and malformed
 *    declarations refuse; values not supplied by evidence are never invented.
 *
 * The classification-coverage arm is what keeps half 2 honest as the program
 * grows: it walks EVERY registered descriptor's canonical-input samples and
 * every used contract's sealed `example`, and requires a declared
 * classification for every leaf. A new contract lands unclassified and this
 * guard goes red before any receipt could quietly drop its fields.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../../src/domain/clock.js";
import { BUILD_MANIFEST } from "../../../src/domain/workflow/build-manifest.js";
import { RunRecordSchema } from "../../../src/domain/run/record.js";
import { AuthorityDatabase } from "../../helpers/synthetic-storage-admission.js";
import { seedPersonLookupExitRun } from "../../fixtures/receipt-run-fixtures.js";
import {
  workflowProjections,
  workflowTerminalResultExecution,
} from "../../../src/base/workflow.js";
import { canonicalInputSamples } from "../../../src/domain/workflow/canonical-input.js";
import {
  EVIDENCE_FIELD_CLASSIFICATIONS,
  EvidenceFieldClassificationSchema,
  EvidenceValueScopeSchema,
  classifyEvidenceLeaf,
  evidenceLeaves,
  evidenceScopeKey,
  redactEvidenceLeaf,
  type EvidenceValueScope,
} from "../../../src/domain/trust/evidence-classification.js";
import { EVIDENCE_OBLIGATIONS } from "../../../src/domain/trust/evidence-obligations.js";
import { RunEvidenceReceiptSchema } from "../../../src/domain/trust/evidence.js";
import { SECRET_SPECS } from "../../../src/domain/secrets.js";
import { buildRunEvidenceReceipt } from "../../../src/core/evidence-receipt.js";
import { WORKFLOW_DESCRIPTORS } from "../../../src/workflows/descriptor-registry.js";
import { HISTORICAL_STEP_PROOF_DESCRIPTORS } from "../../../src/control/step-proof-modules.js";

import { separationsKualiFinalizationDescriptor } from "../../helpers/registered-workflows.js";
import { separationsIdentityCheckDescriptor } from "../../helpers/registered-workflows.js";
import {
  GATE_RESOLVED_AT,
  GATE_RESOLVED_BY,
  identityGateReceiptEvidence,
  kualiReceiptEvidence,
} from "../../fixtures/receipt-run-fixtures.js";
import {
  GATE_DECISIONS,
  findGateDecision,
  gateDecisionFor,
} from "../../../src/domain/trust/gate-decisions.js";
import {
  WRITE_FIXTURE_TASK_IDS,
  WriteFixtureCommit,
  WriteFixtureSaveCommit,
} from "../../fixtures/write-sequencer-fixtures.js";
import { personLookupDescriptor } from "../../helpers/registered-workflows.js";

const RECEIPT_DESCRIPTORS = [...WORKFLOW_DESCRIPTORS, ...HISTORICAL_STEP_PROOF_DESCRIPTORS];

function kualiReceipt() {
  const evidence = kualiReceiptEvidence();
  return buildRunEvidenceReceipt({
    descriptor: separationsKualiFinalizationDescriptor,
    run: evidence.run,
    result: evidence.result,
    checkpoints: evidence.checkpoints,
    writes: evidence.writes,
  });
}

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * The read-only exit run. It is the receipt that exercises the REUSE lane: a
 * commit contract declares no freshness budget, so a write-only graph
 * truthfully carries no reuse row and cannot stand in for this.
 */
function personLookupReceipt() {
  const root = mkdtempSync(join(tmpdir(), "hrauto-receipt-guard-"));
  roots.push(root);
  const database = AuthorityDatabase.open(
    { path: join(root, "state.sqlite"), busyTimeoutMs: 250, migrationOwner: "evidence-receipt-guard" },
    manualClock(new Date("2026-08-04T00:11:13.500Z")),
  );
  databases.push(database);
  const seeded = seedPersonLookupExitRun(database);
  return buildRunEvidenceReceipt({
    descriptor: personLookupDescriptor,
    run: seeded.run,
    result: database.authority.runResults.get(seeded.run.envelope.runId),
    checkpoints: seeded.checkpoints,
  });
}

/* ── half 1: receipt strictness ──────────────────────────────────────────── */

describe("evidence receipt — strictness", () => {
  it("rejects an unknown key at every level of a real receipt", () => {
    const receipt = JSON.parse(JSON.stringify(personLookupReceipt())) as Record<string, unknown>;
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
    // D199: the closure the RUN executed under, read from its own envelope. It
    // equals the current build's here only because the fixture run was planned
    // under this build — a receipt that takes `descriptor.contractFingerprint`
    // instead strands every settled run on the next unrelated edit.
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
    assert.throws(() => buildRunEvidenceReceipt({
      descriptor: separationsKualiFinalizationDescriptor,
      ...evidence,
      run: { ...unsettled, lifecycle: { state: "queued" } },
    }), /a receipt states a settled verdict|only a terminal/);
    assert.throws(() => buildRunEvidenceReceipt({
      descriptor: separationsKualiFinalizationDescriptor,
      ...evidence,
      run: {
        ...unsettled,
        lifecycle: { state: "terminal", outcome: "interrupted", endedAt: "2026-08-04T17:08:54.867Z" },
      },
    }), /interrupted/);
    assert.throws(() => buildRunEvidenceReceipt({
      descriptor: RECEIPT_DESCRIPTORS.find(({ id }) => id === "person-lookup") ?? separationsKualiFinalizationDescriptor,
      ...evidence,
    }), /refusing to explain a run with another workflow's graph/);
  });

  it("is a pure function of authority — one run, one byte-identical receipt", () => {
    assert.equal(JSON.stringify(kualiReceipt()), JSON.stringify(kualiReceipt()));
  });

  /**
   * D204 — ref write-safety §14.6 risk 6, closed on the evidence side.
   *
   * A gate has no checkpoint and never will, so a receipt derived from
   * checkpoints alone listed the ALWAYS-GATE node `unknown` and dropped the one
   * fact the whole gate exists to record: which human decided, and when. The
   * approver is authority's own column on the `gate_results` row — never a
   * value the resolving payload claimed — so the assertions below read it off
   * the stored row, not out of the result value.
   */
  it("carries a resolved gate's decision, approver and instant instead of `unknown`", () => {
    const evidence = identityGateReceiptEvidence();
    const receipt = buildRunEvidenceReceipt({
      descriptor: separationsIdentityCheckDescriptor,
      ...evidence,
    });

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

    assert.throws(() => buildRunEvidenceReceipt({
      descriptor: separationsIdentityCheckDescriptor,
      ...evidence,
      gateResults: [{ ...stored, runId: "00000000-0000-4000-8000-000000000001" }],
    }), /refusing to attribute another run's operator decision/);

    assert.throws(() => buildRunEvidenceReceipt({
      descriptor: separationsIdentityCheckDescriptor,
      ...evidence,
      gateResults: [{ ...stored, gateId: "not-a-node" }],
    }), /gate result node "not-a-node" left the graph/);

    const payload = stored.result as { schemaHash: string; value: Record<string, unknown> };
    assert.throws(() => buildRunEvidenceReceipt({
      descriptor: separationsIdentityCheckDescriptor,
      ...evidence,
      gateResults: [{
        ...stored,
        result: { ...payload, value: { ...payload.value, decision: "deferred" } },
      }],
    }), /no declared arm matches it|refusing to describe a human decision/);
  });

  /**
   * D204's OTHER refusal, which had no negative control at all.
   *
   * The unlisted-ARM arm above is pinned; the undeclared `(workflow, gate)` PAIR
   * was not, and it is the one that guards the whole table's reason for
   * existing. `gateDecisionFor` is the only route from a stored row to a
   * `DecisionEvidence.outcome` — the positive test below walks every registered
   * gate node through it — so if this refusal ever softened into a default, a
   * gate somebody forgot to declare would land on an operator-facing receipt as
   * whatever the default said a human decided.
   *
   * It cannot be reached through `buildRunEvidenceReceipt` against a registered
   * descriptor, and that is the point rather than a gap: every registered gate
   * node IS declared (the positive test proves it in one direction and the
   * orphan test in the other), and `evidence-graph` refuses a row whose node
   * left the graph before any declaration is looked up. The undeclared pair is
   * reachable by asking directly — which is exactly what a NEW gate node's first
   * derivation does.
   */
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
        // The refusal names where to fix it. A declaration is a reviewed entry,
        // so an error that only said "unknown gate" would send the next author
        // looking for a bug instead of writing one.
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

  /**
   * D199. The purity above is worth nothing if it only holds within one commit:
   * a receipt is read months later, and the descriptor's ~31-file closure moves
   * constantly. `receipt-derivation-binding.test.ts` owns the full check table;
   * this arm keeps the guard from silently re-pinning the old, closure-bound
   * behaviour.
   */
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
    const rederived = buildRunEvidenceReceipt({
      descriptor: separationsKualiFinalizationDescriptor,
      ...underMovedClosure(),
    });
    assert.equal(rederived.descriptorFingerprint, movedClosure);
    assert.equal(
      JSON.stringify({ ...rederived, descriptorFingerprint: null }),
      JSON.stringify({ ...kualiReceipt(), descriptorFingerprint: null }),
      "a closure move changed a fact about the run",
    );
    assert.throws(() => buildRunEvidenceReceipt({
      descriptor: separationsKualiFinalizationDescriptor,
      ...underMovedClosure({ descriptorVersion: 2 }),
    }), /descriptor-version moved/);
  });
});

/* ── half 2: redaction ───────────────────────────────────────────────────── */

const CANARIES = Object.freeze({
  password: "hunter2-CORRECT-HORSE",
  cookie: "sessionid=abc123; Path=/; HttpOnly",
  storageState: '{"cookies":[{"name":"JSESSIONID","value":"S3CR3T"}]}',
  ssn: "951-57-1700",
  privateKey: "-----BEGIN PRIVATE KEY-----MIIEvQ-----END PRIVATE KEY-----",
});

describe("evidence receipt — redaction", () => {
  it("never invents unsupplied secret, cookie, storage-state, or SSN values", () => {
    const serialized = JSON.stringify(kualiReceipt());
    for (const [name, canary] of Object.entries(CANARIES)) {
      assert.ok(!serialized.includes(canary), `receipt invented the unsupplied ${name} canary`);
    }
  });

  it("retains the complete supplied value and its original classification", () => {
    const scope = EvidenceValueScopeSchema.parse({ kind: "workflow-input", workflowId: "person-lookup" });
    const redacted = redactEvidenceLeaf(scope, { path: "emplId", field: "emplId", value: CANARIES.ssn });
    assert.deepEqual(redacted, {
      state: "allowed",
      key: "emplId",
      classification: "direct-identifier",
      transform: "allow",
      value: CANARIES.ssn,
    });
    assert.ok(JSON.stringify(redacted).includes(CANARIES.ssn));
  });

  it("admits complete values for every classification and refuses malformed declarations", () => {
    const scope = EvidenceValueScopeSchema.parse({ kind: "workflow-input", workflowId: "person-lookup" });
    for (const classification of ["secret", "credential-file", "direct-identifier", "sensitive-hr", "safe-diagnostic"] as const) {
      const declaration = { scope, path: "supplied", classification, transform: "allow" };
      assert.deepEqual(EvidenceFieldClassificationSchema.parse(declaration), declaration);
      for (const invalid of [
        { ...declaration, classification: "undeclared-classification" },
        { ...declaration, transform: "undeclared-transform" },
        { ...declaration, scope: { kind: "undeclared-scope", workflowId: "person-lookup" } },
        { ...declaration, undeclared: true },
      ]) assert.equal(EvidenceFieldClassificationSchema.safeParse(invalid).success, false);
    }
  });

  it("drops nothing silently: an undeclared leaf fails loud", () => {
    const scope = EvidenceValueScopeSchema.parse({ kind: "workflow-input", workflowId: "person-lookup" });
    assert.throws(
      () => redactEvidenceLeaf(scope, { path: "unknownField", field: "unknownField", value: "x" }),
      /no declared evidence classification/,
    );
  });

  it("agrees with `domain/secrets.ts` wherever both classify the same field name", () => {
    const bySecretName = new Map(SECRET_SPECS.map((secret) => [String(secret.name), secret.classification]));
    for (const entry of EVIDENCE_FIELD_CLASSIFICATIONS) {
      const leaf = entry.path.split(".").at(-1);
      const declared = leaf === undefined ? undefined : bySecretName.get(leaf);
      if (declared === undefined) continue;
      assert.equal(
        entry.classification,
        declared,
        `${evidenceScopeKey(entry.scope)} field "${entry.path}" is ${entry.classification} here and `
        + `${declared} in domain/secrets.ts; one field cannot carry two classifications`,
      );
    }
  });
});

/* ── coverage: the registry keeps pace with the registered graphs ────────── */

describe("evidence receipt — declared classification coverage", () => {
  it("classifies every leaf of every registered canonical-input sample", () => {
    for (const descriptor of RECEIPT_DESCRIPTORS) {
      const scope: EvidenceValueScope = { kind: "workflow-input", workflowId: descriptor.id };
      for (const sample of canonicalInputSamples(descriptor.canonicalInput)) {
        for (const leaf of evidenceLeaves(sample)) classifyEvidenceLeaf(scope, leaf.path);
      }
    }
  });

  it("classifies every leaf of every used contract's sealed example", () => {
    for (const descriptor of RECEIPT_DESCRIPTORS) {
      for (const contract of workflowProjections(descriptor).contracts) {
        const scope: EvidenceValueScope = { kind: "task-output", taskId: contract.id };
        for (const leaf of evidenceLeaves(contract.example)) classifyEvidenceLeaf(scope, leaf.path);
      }
    }
  });

  it("declares a result classification for every registered workflow", () => {
    for (const descriptor of RECEIPT_DESCRIPTORS) {
      const key = evidenceScopeKey({ kind: "workflow-result", workflowId: descriptor.id });
      assert.ok(
        EVIDENCE_FIELD_CLASSIFICATIONS.some((entry) => evidenceScopeKey(entry.scope) === key),
        `${descriptor.id} declares no result-field classifications, so its outputs could not be shown`,
      );
      // The terminal dependency set must be real, or an obligation could name
      // a node the graph does not have.
      assert.ok(workflowTerminalResultExecution(descriptor).dependsOn.length > 0);
    }
  });

  /**
   * D204. A gate that reaches the graph without a declaration would derive a
   * receipt that says `unknown` about a decision authority holds in full —
   * which is the exact defect this decision closed, re-introduced by omission.
   */
  it("declares a decision and a classification for every registered gate node", () => {
    let gateNodes = 0;
    for (const descriptor of RECEIPT_DESCRIPTORS) {
      for (const node of descriptor.nodes) {
        if (node.kind !== "gate") continue;
        gateNodes++;
        const declaration = gateDecisionFor(String(descriptor.id), String(node.id));
        const scope: EvidenceValueScope = EvidenceValueScopeSchema.parse({
          kind: "gate-result",
          workflowId: descriptor.id,
          gateId: node.id,
        });
        // The declared paths must classify, or the very leaves the decision is
        // read from could not be shown beside it.
        classifyEvidenceLeaf(scope, declaration.decisionPath);
        if (declaration.boundEvidencePath !== undefined) {
          classifyEvidenceLeaf(scope, declaration.boundEvidencePath);
        }
      }
    }
    assert.ok(gateNodes > 0, "no registered descriptor has a gate node to cover");
  });

  it("has no orphan classification or obligation", () => {
    const gateNodeKeys = new Set(RECEIPT_DESCRIPTORS.flatMap((descriptor) =>
      descriptor.nodes
        .filter((node) => node.kind === "gate")
        .map((node) => `${String(descriptor.id)} ${String(node.id)}`)));
    for (const declaration of GATE_DECISIONS) {
      assert.ok(
        gateNodeKeys.has(`${String(declaration.workflowId)} ${String(declaration.gateId)}`),
        `orphan gate decision ${declaration.workflowId}/${declaration.gateId}`,
      );
    }
    const workflowIds = new Set(RECEIPT_DESCRIPTORS.map(({ id }) => String(id)));
    /*
     * A task-output scope is an orphan when it names a task this RUNTIME cannot
     * execute — which is the build manifest's task set, not the narrower set
     * today's descriptors happen to compose.
     *
     * D184's rule (a declaration nobody can produce is one nobody can act on)
     * is what this guards, and D270 is what widened it: the observed-log
     * emission redacts by declaration for EVERY task the executor runs, and the
     * executor runs whatever a composed descriptor names — including the
     * executor's own fixture descriptors. The ordinary executor fixture borrows
     * a manifest-known id because it resolves the production fingerprint; the
     * transaction fixture injects a fixed fingerprint and exports the exact ids
     * of its sealed task contracts. A registered task that no descriptor
     * composes YET is exactly the case the narrower rule refused and the wider
     * one still catches when the task is deleted.
     */
    const descriptorTaskIds = new Set(RECEIPT_DESCRIPTORS.flatMap((descriptor) =>
      workflowProjections(descriptor).contracts.map((contract) => String(contract.id))));
    const taskIds = new Set([
      ...descriptorTaskIds,
      ...BUILD_MANIFEST.tasks.map(({ id }) => String(id)),
      ...WRITE_FIXTURE_TASK_IDS.map(String),
    ]);
    /*
     * A write-proof scope is an orphan unless its task is a COMMIT contract —
     * the completion proof is the commit contract's own declaration, so a
     * write-proof declaration for a read task is a table row no derivation
     * can ever reach (ledger 2 D16–D22).
     */
    const commitTaskIds = new Set([
      ...RECEIPT_DESCRIPTORS.flatMap((descriptor) =>
        descriptor.nodes.flatMap((node) =>
          node.kind === "transaction" ? [String(node.commit.uses.id)] : [])),
      String(WriteFixtureCommit.id),
      String(WriteFixtureSaveCommit.id),
    ]);
    for (const entry of EVIDENCE_FIELD_CLASSIFICATIONS) {
      if (entry.scope.kind === "task-output") {
        assert.ok(taskIds.has(String(entry.scope.taskId)), `orphan classification scope ${evidenceScopeKey(entry.scope)}`);
      } else if (entry.scope.kind === "write-proof") {
        assert.ok(
          commitTaskIds.has(String(entry.scope.taskId)),
          `orphan classification scope ${evidenceScopeKey(entry.scope)} — not a registered commit contract`,
        );
      } else if (entry.scope.kind === "gate-result") {
        assert.ok(
          gateNodeKeys.has(`${String(entry.scope.workflowId)} ${String(entry.scope.gateId)}`),
          `orphan classification scope ${evidenceScopeKey(entry.scope)}`,
        );
      } else {
        assert.ok(workflowIds.has(String(entry.scope.workflowId)), `orphan classification scope ${evidenceScopeKey(entry.scope)}`);
      }
    }
    for (const obligation of EVIDENCE_OBLIGATIONS) {
      assert.ok(workflowIds.has(String(obligation.workflowId)), `orphan obligation ${obligation.obligation}`);
      const descriptor = RECEIPT_DESCRIPTORS.find(({ id }) => String(id) === String(obligation.workflowId));
      assert.ok(descriptor !== undefined);
      const nodeIds = new Set(descriptor.nodes.map((node) => String(node.id)));
      for (const source of obligation.sources) {
        if (source.kind !== "node-output") continue;
        assert.ok(
          nodeIds.has(String(source.nodeId)),
          `obligation ${obligation.obligation} names node "${source.nodeId}", which ${descriptor.id} does not have`,
        );
      }
    }
  });
});
