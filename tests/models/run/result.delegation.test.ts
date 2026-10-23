import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DelegationTerminalDependencySchema, ChildTerminalDependencySchema, RunResultRecordSchema } from "../../../src/models/run/result.js";
import { RunRecordSchema } from "../../../src/models/run/record.js";
import { RunDisplayNameSchema, CommandRequestSchema } from "../../../src/rules/commands/commands.js";
import { DelegationManifestSchema } from "../../../src/rules/workflow/dependencies.js";
import { QUEUED_RUN } from "../../support/fixtures/phase1f-run-fixtures.js";
import { NOW } from "../../support/fixtures/phase1c-contract-fixtures.js";

const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const digest = "a".repeat(64);
function receipt(join: "all-settled" | "none" = "all-settled", count = 2) {
  const manifest = DelegationManifestSchema.parse({ manifestId: id(1), parentRunId: id(2), edgeId: "children",
    inputSchemaHash: digest, resultSchemaHash: digest, cardinality: "many", join,
    policy: { cascadeCancel: "independent", onChildFailed: "allow-partial", afterChildRetry: "resume-parent", visibility: "inline" },
    children: Array.from({ length: count }, (_, index) => ({ dependencyId: id(10 + index), childRunId: id(20 + index),
      childItemId: id(30 + index), canonicalInputFingerprint: digest })), createdAt: NOW, manifestFingerprint: digest });
  return { state: "delegation-resolved", nodeId: "children", parentRunId: manifest.parentRunId,
    edgeId: manifest.edgeId, invocationCommandId: id(3), manifest,
    members: join === "none" ? [] : manifest.children.map(child => ({ dependencyId: child.dependencyId, runId: child.childRunId,
      itemId: child.childItemId, workflowId: "fixture-child", attempt: 1, descriptorVersion: 1,
      contractFingerprint: digest, resultSchemaHash: digest, resultDigest: digest, dependencyDigest: digest, lifecycle: "done" })) };
}

describe("current additive terminal delegation records", () => {
  it("initializes the real command/run/result import graph without changing display-name validation", () => {
    assert.equal(RunDisplayNameSchema.parse("Synthetic run"), "Synthetic run");
    assert.equal(RunDisplayNameSchema.safeParse(" Synthetic run").success, false);
    assert.equal(RunDisplayNameSchema.safeParse("Synthetic\nrun").success, false);
    assert.equal(RunRecordSchema.parse(QUEUED_RUN).envelope.runId, QUEUED_RUN.envelope.runId);
    assert.ok(RunResultRecordSchema);
    assert.equal(CommandRequestSchema.parse({ commandId: id(99), requestedAt: NOW, requestedBy: "local-operator", source: "dashboard",
      family: "run", type: "rename", target: { runId: QUEUED_RUN.envelope.runId, expectedVersion: QUEUED_RUN.version },
      payload: { displayName: "Synthetic run" } }).type, "rename");
  });

  it("admits exact ordered group, empty and unawaited receipts without inventing terminal members", () => {
    assert.equal(DelegationTerminalDependencySchema.parse(receipt()).members.length, 2);
    assert.equal(DelegationTerminalDependencySchema.parse(receipt("all-settled", 0)).members.length, 0);
    assert.equal(DelegationTerminalDependencySchema.parse(receipt("none")).manifest.children.length, 2);
    const unawaited = receipt("none"), populated = receipt();
    assert.equal(DelegationTerminalDependencySchema.safeParse({ ...unawaited, members: populated.members }).success, false);
  });

  it("refuses missing, reordered, duplicated, foreign and unrelated lineage membership", () => {
    const value = receipt(), first = value.members[0];
    assert.ok(first);
    for (const changed of [
      { ...value, members: value.members.slice(1) },
      { ...value, members: [...value.members].reverse() },
      { ...value, members: [first, first] },
      { ...value, parentRunId: id(88) },
      { ...value, members: [{ ...first, runId: value.parentRunId }, ...value.members.slice(1)] },
      { ...value, members: [{ ...first, resultSchemaHash: "b".repeat(64) }, ...value.members.slice(1)] },
      { ...value, operationSources: [] },
    ]) assert.equal(DelegationTerminalDependencySchema.safeParse(changed).success, false);
  });

  it("retains the existing single-success record shape and rejects new fields on that arm", () => {
    const value = receipt(), first = value.members[0];
    assert.ok(first);
    const original = { state: "child-resolved", nodeId: value.nodeId, parentRunId: value.parentRunId, edgeId: value.edgeId,
      child: { runId: first.runId, itemId: first.itemId, workflowId: first.workflowId, attempt: first.attempt,
        descriptorVersion: first.descriptorVersion, contractFingerprint: first.contractFingerprint,
        resultSchemaHash: first.resultSchemaHash, resultDigest: first.resultDigest, dependencyDigest: first.dependencyDigest } };
    assert.deepEqual(ChildTerminalDependencySchema.parse(original), original);
    assert.equal(ChildTerminalDependencySchema.safeParse({ ...original, manifest: value.manifest }).success, false);
  });
});
