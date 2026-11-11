import assert from "node:assert/strict";
import { it } from "vitest";
import { z } from "zod";
import * as resultModule from "../../../src/models/run/result.js";
import { RunDelegatedDryRunPreviewResultSchema, RunDryRunPreviewResultSchema, isRunPreviewSchemaHash, readRunPreviewResult, resolveDelegationEvidenceOutput, delegationEvidenceOutput, terminalDelegationDependencyRecord, deriveRunResultDigest, deriveTerminalDependencyDigest, RunResultRecordSchema, DelegationTerminalEvidenceSchema } from "../../../src/models/run/result.js";
import { JsonValueSchema } from "../../../src/rules/validation/canonical-json.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";

import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import { RunRecordSchema } from "../../../src/models/run/record.js";
import { DelegationManifestSchema } from "../../../src/rules/workflow/dependencies.js";
import { QUEUED_RUN } from "../../support/fixtures/phase1f-run-fixtures.js";

const local = { kind: "dry-run-preview", externalCommit: "none", coverage: { state: "full" },
  steps: [{ nodeId: "read", state: "exercised" }] } as const;
const delegated = { kind: "delegated-dry-run-preview", externalCommit: "none", coverage: { state: "full" },
  steps: [{ nodeId: "lookup", state: "exercised" }, { nodeId: "members", state: "delegation-preview" }] } as const;
const bound = (schema: z.ZodType, value: unknown) => {
  const schemaHash = deriveSchemaHash(schema, "output");
  return { resultSchemaHash: schemaHash, result: { schemaHash, value: JsonValueSchema.parse(value) } };
};

it("preserves the current local preview schema hash and serialized value", () => {
  const result = bound(RunDryRunPreviewResultSchema, local);
  assert.equal(result.resultSchemaHash, "56c14ccc71d195b045352f4a0c198b9fa0b87245ff4e399ff6f9ad4fe1589a1c");
  assert.deepEqual(readRunPreviewResult(result), local);
  assert.equal(isRunPreviewSchemaHash(result.resultSchemaHash), true);
});

it("distinguishes delegated preview accounting from ordinary workflow observations", () => {
  const result = bound(RunDelegatedDryRunPreviewResultSchema, delegated);
  assert.deepEqual(readRunPreviewResult(result), delegated);
  assert.equal(isRunPreviewSchemaHash(result.resultSchemaHash), true);
  assert.equal(result.resultSchemaHash, "06bdc474498e86c00a7982fce5a5b223704504ccd91f8c4ed2f9fb5384c6984f");
  assert.notEqual(result.resultSchemaHash, deriveSchemaHash(RunDryRunPreviewResultSchema, "output"));
  const observed = bound(z.strictObject({ state: z.literal("observed") }), { state: "observed" });
  assert.equal(isRunPreviewSchemaHash(observed.resultSchemaHash), false);
  assert.equal(readRunPreviewResult(observed), undefined);
});

it("refuses mismatched preview kinds, malformed steps and claimed commits under a known hash", () => {
  assert.throws(() => readRunPreviewResult(bound(RunDryRunPreviewResultSchema, delegated)));
  assert.throws(() => readRunPreviewResult(bound(RunDelegatedDryRunPreviewResultSchema, local)));
  assert.throws(() => readRunPreviewResult(bound(RunDelegatedDryRunPreviewResultSchema, { ...delegated, externalCommit: "saved" })));
  assert.throws(() => readRunPreviewResult(bound(RunDelegatedDryRunPreviewResultSchema, { ...delegated, steps: [{ nodeId: "members", state: "done" }] })));
});

const publication = { kind: "publication-dry-run-preview", externalCommit: "none", coverage: { state: "full" },
  steps: [{ nodeId: "read", state: "exercised" }, { nodeId: "save", state: "publication-preview" },
    { nodeId: "publish", state: "unavailable", reason: "requires-unsubmitted-output" }] } as const;
const publicationSchema = () => {
  assert.ok(resultModule.RunPublicationDryRunPreviewResultSchema, "RunPublicationDryRunPreviewResultSchema must be exported");
  return resultModule.RunPublicationDryRunPreviewResultSchema as unknown as z.ZodType;
};

it("round-trips a publication preview and keeps it distinct from the other preview kinds", () => {
  const result = bound(publicationSchema(), publication);
  assert.deepEqual(readRunPreviewResult(result), publication);
  assert.equal(isRunPreviewSchemaHash(result.resultSchemaHash), true);
  assert.notEqual(result.resultSchemaHash, deriveSchemaHash(RunDryRunPreviewResultSchema, "output"));
  assert.notEqual(result.resultSchemaHash, deriveSchemaHash(RunDelegatedDryRunPreviewResultSchema, "output"));
});

it("refuses a publication-preview step under the local and delegated preview kinds", () => {
  const step = { nodeId: "save", state: "publication-preview" };
  assert.throws(() => readRunPreviewResult(bound(RunDryRunPreviewResultSchema, { ...local, steps: [...local.steps, step] })));
  assert.throws(() => readRunPreviewResult(bound(RunDelegatedDryRunPreviewResultSchema, { ...delegated, steps: [...delegated.steps, step] })));
});

function previewEvidence(dryRun = true) {
  const parentRunId = "00000000-0000-4000-8000-000000000901";
  const manifestId = "00000000-0000-4000-8000-000000000902";
  const resultValue = bound(RunDryRunPreviewResultSchema, local).result;
  const result = RunResultRecordSchema.parse({ runId: QUEUED_RUN.envelope.runId, attempt: 1, workflowId: QUEUED_RUN.envelope.workflow,
    descriptorVersion: 1, contractFingerprint: QUEUED_RUN.envelope.contractFingerprint,
    configFingerprint: QUEUED_RUN.envelope.configFingerprint, configSnapshotId: QUEUED_RUN.envelope.configSnapshotId,
    resultSchemaHash: resultValue.schemaHash, result: resultValue, resultDigest: deriveRunResultDigest(resultValue),
    dependencies: [], dependencyDigest: deriveTerminalDependencyDigest([]), createdAt: QUEUED_RUN.createdAt });
  const run = RunRecordSchema.parse({ ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope, dryRun,
    parent: { runId: parentRunId, edgeId: "records", tracePrefix: QUEUED_RUN.envelope.traceId } },
    claimGeneration: 1, version: 2, lifecycle: { state: "terminal", outcome: "done", endedAt: QUEUED_RUN.createdAt },
    completion: { kind: "done", schemaVersion: 1, expectedVersion: 1, claim: { workerId: "worker-1", claimGeneration: 1 },
      authorizedAt: QUEUED_RUN.createdAt, resultDigest: result.resultDigest } });
  const target = z.strictObject({ state: z.literal("observed") });
  const manifest = DelegationManifestSchema.parse({ manifestId, parentRunId, edgeId: "records", inputSchemaHash: "a".repeat(64),
    resultSchemaHash: deriveSchemaHash(target, "output"), cardinality: "one", join: "one",
    policy: { cascadeCancel: "cascade", onChildFailed: "fail-parent", afterChildRetry: "resume-parent", visibility: "inline" },
    children: [{ dependencyId: "00000000-0000-4000-8000-000000000903", childRunId: run.envelope.runId,
      childItemId: run.envelope.itemId, canonicalInputFingerprint: "a".repeat(64) }],
    createdAt: QUEUED_RUN.createdAt, manifestFingerprint: "a".repeat(64) });
  return { target, evidence: DelegationTerminalEvidenceSchema.parse({ state: "delegation-resolved" as const, nodeId: "members",
    parentRunId: manifest.parentRunId, edgeId: manifest.edgeId, invocationCommandId: "00000000-0000-4000-8000-000000000904", manifest,
    children: [{ run, result }] }) };
}

it("keeps a joined child preview distinct from typed output and single-child operation lineage", () => {
  const { target, evidence } = previewEvidence();
  assert.deepEqual(resolveDelegationEvidenceOutput(evidence, target), { kind: "preview", output: {
    state: "delegation-preview", nodeId: "members", parentRunId: evidence.parentRunId, manifestId: evidence.manifest.manifestId,
  } });
  assert.throws(() => delegationEvidenceOutput(evidence, target), /delegation-preview-is-not-workflow-output/u);
  const receipt = terminalDelegationDependencyRecord(evidence);
  assert.equal(receipt.state, "delegation-resolved");
  assert.equal(receipt.operationLineage, undefined);
  assert.equal(receipt.operationSources, undefined);
});

it("refuses child previews without the dry-run flag or an exact completion digest", () => {
  const live = previewEvidence(false);
  assert.throws(() => resolveDelegationEvidenceOutput(live.evidence, live.target), /delegation-preview-dry-run-required/u);
  const { target, evidence } = previewEvidence();
  const child = evidence.children[0]; assert.ok(child);
  assert.ok(child.run.completion?.kind === "done");
  child.run.completion = { ...child.run.completion, resultDigest: FingerprintSchema.parse("b".repeat(64)) };
  assert.throws(() => resolveDelegationEvidenceOutput(evidence, target), /delegation-outcome-result-mismatch/u);
});
