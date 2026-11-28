import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { taskStoreRegistry } from "../../../src/backend/app/registries/task-registry.js";
import {
  descriptorRuntimeNodes,
  workflowProjections,
  workflowTerminalResultExecution,
} from "../../../src/workflow-kit/workflow.js";
import { canonicalInputSamples } from "../../../src/models/workflow/canonical-input.js";
import {
  EVIDENCE_FIELD_CLASSIFICATIONS,
  EvidenceFieldClassificationSchema,
  EvidenceValueScopeSchema,
  classifyEvidenceLeaf,
  evidenceLeaves,
  evidenceScopeKey,
  redactEvidenceLeaf,
  type EvidenceValueScope,
} from "../../../src/models/trust/evidence-classification.js";
import { EVIDENCE_OBLIGATIONS } from "../../../src/models/trust/evidence-obligations.js";
import { RedactedFieldSchema, retainLocalEvidenceValue } from "../../../src/rules/redaction/redaction.js";
import { SECRET_SPECS } from "../../../src/models/config/secrets.js";
import { deriveRunEvidenceReceipt } from "../../../src/backend/runs/provenance/evidence-receipt.js";
import { DESCRIPTORS, CHILD_ONLY_WORKFLOW_MODULES } from "../../../src/backend/app/registries/workflow-registry.js";
import { STEP_PROOF_DESCRIPTORS } from "../../../src/backend/app/registries/step-proof-modules.js";

import { separationsKualiFinalizationDescriptor } from "../../support/helpers/registered-workflows.js";
import { kualiReceiptEvidence } from "../../support/fixtures/receipt-run-fixtures.js";
import {
  GATE_DECISIONS,
  SNAPSHOT_APPROVAL_DECISIONS,
  findSnapshotApprovalDecision,
  findGateDecision,
  gateDecisionFor,
} from "../../../src/models/trust/gate-decisions.js";
import {
  WRITE_FIXTURE_TASK_IDS,
  WriteFixtureCommit,
  WriteFixtureSaveCommit,
} from "../../support/fixtures/write-sequencer-fixtures.js";
import { namedFileOutputDescriptor } from "../../support/fixtures/named-file-output-workflow.js";

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

/* ── half 2: redaction ───────────────────────────────────────────────────── */

const CANARIES = Object.freeze({
  password: "hunter2-CORRECT-HORSE",
  cookie: "sessionid=abc123; Path=/; HttpOnly",
  storageState: '{"cookies":[{"name":"JSESSIONID","value":"S3CR3T"}]}',
  ssn: "902-48-1357",
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

  it("keeps declarations closed and retains complete local values for every classification", () => {
    const scope = EvidenceValueScopeSchema.parse({ kind: "workflow-input", workflowId: "person-lookup" });
    for (const classification of ["secret", "credential-file", "direct-identifier", "sensitive-hr", "safe-diagnostic"] as const) {
      const transform = classification === "safe-diagnostic" ? "allow" : "drop";
      const declaration = { scope, path: "supplied", classification, transform };
      const value = { supplied: CANARIES, nested: [classification, 42, null] };
      const retained = { key: "supplied", ...retainLocalEvidenceValue(classification, "allow", value) };
      assert.deepEqual(retained, { key: "supplied", state: "allowed", classification, transform: "allow", value });
      assert.deepEqual(RedactedFieldSchema.parse(retained), retained);
      if (classification !== "safe-diagnostic") {
        assert.equal(EvidenceFieldClassificationSchema.safeParse({ ...declaration, transform: "allow" }).success, false);
      }
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
      assert.ok(workflowTerminalResultExecution(descriptor).dependsOn.length > 0, descriptor.id);
    }
  });


  it("declares a decision and a classification for every registered gate node", () => {
    let gateNodes = 0;
    for (const descriptor of RECEIPT_DESCRIPTORS) {
      for (const node of descriptorRuntimeNodes(descriptor)) {
        if (node.kind !== "gate") continue;
        gateNodes++;
        const scope: EvidenceValueScope = EvidenceValueScopeSchema.parse({
          kind: "gate-result",
          workflowId: descriptor.id,
          gateId: node.id,
        });
        const snapshot = findSnapshotApprovalDecision(String(descriptor.id), String(node.id));
        if (snapshot !== undefined) {
          assert.equal(node.result, snapshot.result);
          for (const path of Object.keys(snapshot.result.shape)) classifyEvidenceLeaf(scope, path);
          assert.equal(findGateDecision(String(descriptor.id), String(node.id)), undefined);
          continue;
        }
        const declaration = gateDecisionFor(String(descriptor.id), String(node.id));
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
    for (const declaration of SNAPSHOT_APPROVAL_DECISIONS) {
      assert.ok(gateNodeKeys.has(`${declaration.workflowId} ${declaration.gateId}`),
        `orphan snapshot approval ${declaration.workflowId}/${declaration.gateId}`);
    }
    const workflowIds = new Set(RECEIPT_DESCRIPTORS.map(({ id }) => String(id)));

    const descriptorTaskIds = new Set(RECEIPT_DESCRIPTORS.flatMap((descriptor) =>
      workflowProjections(descriptor).contracts.map((contract) => String(contract.id))));
    const taskIds = new Set([
      ...descriptorTaskIds,
      ...taskStoreRegistry.stores.flatMap(store => Object.values(store.tasks).map(task => String(task.contract.id))),
      ...WRITE_FIXTURE_TASK_IDS.map(String),
    ]);

    const commitTaskIds = new Set([
      ...RECEIPT_DESCRIPTORS.flatMap((descriptor) =>
        descriptorRuntimeNodes(descriptor).flatMap((node) =>
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
