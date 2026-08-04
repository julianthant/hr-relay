/**
 * `evidence-receipt` — doc 10 §3.10's guard, activated with the D82 receipt
 * builder (D136/D137).
 *
 * Its spec has two halves and both are executed here:
 *
 * 1. **Strictness.** Every terminal run produces a STRICT receipt carrying the
 *    input/config/graph fingerprints, node outcomes, provenance,
 *    proof/failure refs, exclusions, and an explicit confidence. `done`
 *    requires all mandatory evidence and no unresolved write/subject/storage
 *    condition — proven by violating fixtures, not only by a happy path.
 * 2. **Redaction.** The receipt is built from declared classifications, and no
 *    env value, cookie, storage state, or raw SSN reaches it. Canaries are
 *    pushed through the real classification path, so a transform that started
 *    passing values through would fail here rather than in production.
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
import { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import { personLookupDescriptor } from "../../../src/workflows/person-lookup/descriptor.js";
import { seedPersonLookupExitRun } from "../fixtures/receipt-run-fixtures.js";
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
import { kualiTimekeeperAnnotationDescriptor } from "../../../src/workflows/kuali-timekeeper-annotation/descriptor.js";
import { kualiReceiptEvidence } from "../fixtures/receipt-run-fixtures.js";

function kualiReceipt() {
  const evidence = kualiReceiptEvidence();
  return buildRunEvidenceReceipt({
    descriptor: kualiTimekeeperAnnotationDescriptor,
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
    assert.equal(receipt.descriptorFingerprint, kualiTimekeeperAnnotationDescriptor.contractFingerprint);
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
    const run = evidence.run as { lifecycle: unknown };
    assert.throws(() => buildRunEvidenceReceipt({
      descriptor: kualiTimekeeperAnnotationDescriptor,
      ...evidence,
      run: { ...run, lifecycle: { state: "queued" } },
    }), /a receipt states a settled verdict|only a terminal/);
    assert.throws(() => buildRunEvidenceReceipt({
      descriptor: kualiTimekeeperAnnotationDescriptor,
      ...evidence,
      run: {
        ...run,
        lifecycle: { state: "terminal", outcome: "interrupted", endedAt: "2026-08-04T17:08:54.867Z" },
      },
    }), /interrupted/);
    assert.throws(() => buildRunEvidenceReceipt({
      descriptor: WORKFLOW_DESCRIPTORS.find(({ id }) => id === "person-lookup") ?? kualiTimekeeperAnnotationDescriptor,
      ...evidence,
    }), /refusing to explain a run with another workflow's graph/);
  });

  it("is a pure function of authority — one run, one byte-identical receipt", () => {
    assert.equal(JSON.stringify(kualiReceipt()), JSON.stringify(kualiReceipt()));
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
  it("never lets a real receipt carry an env, cookie, storage-state, or SSN value", () => {
    const serialized = JSON.stringify(kualiReceipt());
    for (const [name, canary] of Object.entries(CANARIES)) {
      assert.ok(!serialized.includes(canary), `receipt leaked the ${name} canary`);
    }
    // Every SCREAMING_SNAKE value in the secret registry is an env key name.
    const envKeys = SECRET_SPECS.flatMap((secret) => Object.values(secret)
      .filter((value): value is string => typeof value === "string" && /^[A-Z][A-Z0-9_]{3,}$/.test(value)));
    assert.ok(envKeys.length > 0, "the secret registry must contribute env key names to check");
    for (const key of envKeys) {
      assert.ok(!serialized.includes(key), `receipt named the ${key} environment variable`);
    }
  });

  it("emits only the declared transform for a secret or identifier leaf", () => {
    const scope = EvidenceValueScopeSchema.parse({ kind: "workflow-input", workflowId: "person-lookup" });
    // `emplId` is declared direct-identifier/last4: the raw value never appears.
    const redacted = redactEvidenceLeaf(scope, { path: "emplId", field: "emplId", value: CANARIES.ssn });
    assert.deepEqual(redacted, {
      state: "transformed",
      key: "emplId",
      classification: "direct-identifier",
      transform: "last4",
      value: "6789",
    });
    assert.ok(!JSON.stringify(redacted).includes(CANARIES.ssn));
  });

  it("refuses a transform the classification does not permit", () => {
    const scope = EvidenceValueScopeSchema.parse({ kind: "workflow-input", workflowId: "person-lookup" });
    for (const classification of ["secret", "credential-file", "direct-identifier", "sensitive-hr"] as const) {
      assert.equal(
        EvidenceFieldClassificationSchema.safeParse({
          scope, path: "leaked", classification, transform: "allow",
        }).success,
        false,
        `${classification} was allowed to pass a value through untouched`,
      );
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
    for (const descriptor of WORKFLOW_DESCRIPTORS) {
      const scope: EvidenceValueScope = { kind: "workflow-input", workflowId: descriptor.id };
      for (const sample of canonicalInputSamples(descriptor.canonicalInput)) {
        for (const leaf of evidenceLeaves(sample)) classifyEvidenceLeaf(scope, leaf.path);
      }
    }
  });

  it("classifies every leaf of every used contract's sealed example", () => {
    for (const descriptor of WORKFLOW_DESCRIPTORS) {
      for (const contract of workflowProjections(descriptor).contracts) {
        const scope: EvidenceValueScope = { kind: "task-output", taskId: contract.id };
        for (const leaf of evidenceLeaves(contract.example)) classifyEvidenceLeaf(scope, leaf.path);
      }
    }
  });

  it("declares a result classification for every registered workflow", () => {
    for (const descriptor of WORKFLOW_DESCRIPTORS) {
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

  it("has no orphan classification or obligation", () => {
    const workflowIds = new Set(WORKFLOW_DESCRIPTORS.map(({ id }) => String(id)));
    const taskIds = new Set(WORKFLOW_DESCRIPTORS.flatMap((descriptor) =>
      workflowProjections(descriptor).contracts.map((contract) => String(contract.id))));
    for (const entry of EVIDENCE_FIELD_CLASSIFICATIONS) {
      if (entry.scope.kind === "task-output") {
        assert.ok(taskIds.has(String(entry.scope.taskId)), `orphan classification scope ${evidenceScopeKey(entry.scope)}`);
      } else {
        assert.ok(workflowIds.has(String(entry.scope.workflowId)), `orphan classification scope ${evidenceScopeKey(entry.scope)}`);
      }
    }
    for (const obligation of EVIDENCE_OBLIGATIONS) {
      assert.ok(workflowIds.has(String(obligation.workflowId)), `orphan obligation ${obligation.obligation}`);
      const descriptor = WORKFLOW_DESCRIPTORS.find(({ id }) => String(id) === String(obligation.workflowId));
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
