import { ContractFieldPathSchema } from "../task/task-contract.js";
import { DeclaredActionIdentitySchema, OperationInputLineageSchema } from "../workflow/operation-action-identity.js";
import { valueFreeProtectedData } from "../write-safety/protected-input.js";
/** Durable terminal workflow results and the exact checkpoint identities they were derived from. */
import { z } from "zod";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import {
  CommandIdSchema,
  CommandAuditIdSchema,
  ConfigSnapshotIdSchema,
  DelegationEdgeIdSchema,
  DependencyIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  ItemIdSchema,
  NodeIdSchema,
  PositiveIntSchema,
  RunIdSchema,
  WorkflowIdSchema,
} from "../../rules/identity/ids.js";
import type { Fingerprint } from "../../rules/identity/ids.js";
import { FailureTerminalAuthorizationRecordSchema } from "./terminal-authorization.js";
import { RunRecordSchema, type RunRecord } from "./record.js";
import { DelegationManifestSchema, delegationJoinDisposition } from "../../rules/workflow/dependencies.js";
import { childRunOutcomeSchema, DelegationManifestRefSchema } from "../workflow/graph.js";
import { FailureRecordSchema, type FailureRecord } from "../trust/failure.js";
import { deriveSchemaHash, SchemaBoundCanonicalValueSchema } from "../validation/schema-bound-value.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import { RunCheckpointRecordSchema } from "../workflow/checkpoint.js";
import { TransactionDryRunPreviewSchema } from "../../rules/write-safety/write-safety-primitives.js";

export const TerminalNotRunReasonSchema = z.enum([
  "condition-false",
  "branch-not-selected",
    /* ONE vocabulary across result, span and timeline: an omitted step's producer-rebuilt node is `operator-asserted` on its span and the `asserted` arm in the terminal record. */
  "operator-asserted",
    /** A transaction, or a task no producer rebuilds, in a step the operator omitted. */
  "step-omitted",
]);

export const ResolvedTerminalDependencySchema = z.strictObject({
  state: z.literal("resolved"),
  nodeId: NodeIdSchema,
  checkpoint: z.strictObject({
    workflowId: WorkflowIdSchema,
    itemId: ItemIdSchema,
    attempt: PositiveIntSchema,
    claimGeneration: PositiveIntSchema,
    runId: RunIdSchema,
  }),
  outputSchemaHash: FingerprintSchema,
  descriptorVersion: PositiveIntSchema,
  contractFingerprint: FingerprintSchema,
  implFingerprint: FingerprintSchema,
  outputDigest: FingerprintSchema,
  provenanceDigest: FingerprintSchema,
  operationSources: z.array(z.strictObject({ path: ContractFieldPathSchema, identity: DeclaredActionIdentitySchema })).optional(),
});

export const NotRunTerminalDependencySchema = z.strictObject({
  state: z.literal("not-run"),
  nodeId: NodeIdSchema,
  reason: TerminalNotRunReasonSchema,
});

/** A node the operator asserted at start instead of running, bound to the schema and digest of the asserted output. */
export const AssertedTerminalDependencySchema = z.strictObject({
  state: z.literal("asserted"),
  nodeId: NodeIdSchema,
  step: z.string().min(1),
  assertedAt: IsoInstantSchema,
  outputSchemaHash: FingerprintSchema,
  outputDigest: FingerprintSchema,
});

export const ChildTerminalDependencySchema = z.strictObject({
  state: z.literal("child-resolved"),
  nodeId: NodeIdSchema,
  parentRunId: RunIdSchema,
  edgeId: DelegationEdgeIdSchema,
  child: z.strictObject({
    runId: RunIdSchema, itemId: ItemIdSchema, workflowId: WorkflowIdSchema,
    attempt: PositiveIntSchema, descriptorVersion: PositiveIntSchema,
    contractFingerprint: FingerprintSchema, resultSchemaHash: FingerprintSchema,
    resultDigest: FingerprintSchema, dependencyDigest: FingerprintSchema,
  }),
  operationSources: z.array(z.strictObject({ path: ContractFieldPathSchema, identity: DeclaredActionIdentitySchema })).optional(),
  operationLineage: z.array(z.strictObject({ path: ContractFieldPathSchema, inputs: z.array(OperationInputLineageSchema).min(1) })).optional(),
});

export const DelegationTerminalMemberSchema = z.strictObject({
  dependencyId: DependencyIdSchema,
  runId: RunIdSchema, itemId: ItemIdSchema, workflowId: WorkflowIdSchema,
  attempt: PositiveIntSchema, descriptorVersion: PositiveIntSchema,
  contractFingerprint: FingerprintSchema, resultSchemaHash: FingerprintSchema,
  resultDigest: FingerprintSchema, dependencyDigest: FingerprintSchema,
  lifecycle: z.enum(["done", "failed", "cancelled"]),
});

export const DelegationTerminalDependencySchema = z.strictObject({
  state: z.literal("delegation-resolved"), nodeId: NodeIdSchema,
  parentRunId: RunIdSchema, edgeId: DelegationEdgeIdSchema, invocationCommandId: CommandIdSchema,
  manifest: DelegationManifestSchema,
  members: z.array(DelegationTerminalMemberSchema),
  operationSources: z.array(z.strictObject({ path: ContractFieldPathSchema, identity: DeclaredActionIdentitySchema })).optional(),
  operationLineage: z.array(z.strictObject({ path: ContractFieldPathSchema, inputs: z.array(OperationInputLineageSchema).min(1) })).optional(),
}).superRefine((receipt, context) => {
  const { manifest } = receipt;
  const expected = manifest.join === "none" ? [] : manifest.children;
  if (manifest.parentRunId !== receipt.parentRunId || manifest.edgeId !== receipt.edgeId
    || expected.length !== receipt.members.length
    || new Set(receipt.members.map(member => member.runId)).size !== receipt.members.length
    || receipt.members.some((member, index) => member.dependencyId !== expected[index]?.dependencyId
      || member.itemId !== expected[index]?.childItemId || member.runId === receipt.parentRunId
      || member.lifecycle === "done" && member.resultSchemaHash !== manifest.resultSchemaHash)
    || delegationJoinDisposition(manifest, receipt.members.map(member => member.lifecycle)) !== "satisfied") {
    context.addIssue({ code: "custom", message: "delegation terminal membership or join mismatch" });
  }
  const single = manifest.cardinality === "one" && manifest.join !== "none" && receipt.members.length === 1 && receipt.members[0]?.lifecycle === "done";
  if (!single && (receipt.operationSources !== undefined || receipt.operationLineage !== undefined)) {
    context.addIssue({ code: "custom", message: "group terminal evidence cannot manufacture single-result lineage" });
  }
});

export const TerminalDependencyRecordSchema = z.discriminatedUnion("state", [
  ResolvedTerminalDependencySchema,
  NotRunTerminalDependencySchema,
  AssertedTerminalDependencySchema,
  ChildTerminalDependencySchema,
  DelegationTerminalDependencySchema,
]);

export const DelegationTerminalEvidenceSchema = z.strictObject({
    state: z.literal("delegation-resolved"), nodeId: NodeIdSchema,
    parentRunId: RunIdSchema, edgeId: DelegationEdgeIdSchema, invocationCommandId: CommandIdSchema,
    manifest: DelegationManifestSchema,
    children: z.array(z.strictObject({ run: z.lazy(() => RunRecordSchema), result: z.lazy(() => RunResultRecordSchema),
      cancellation: z.strictObject({ cancelledBy: z.enum(["operator", "parent", "kernel"]), reason: z.string().min(1) }).optional() })),
  });

/** Exact executor evidence consumed by the factory-owned terminal derive. */
export const TerminalDependencyEvidenceSchema = z.discriminatedUnion("state", [
  DelegationTerminalEvidenceSchema,
  z.strictObject({
    state: z.literal("child-resolved"), nodeId: NodeIdSchema,
    parentRunId: RunIdSchema, edgeId: DelegationEdgeIdSchema,
    childRun: z.strictObject({ runId: RunIdSchema, itemId: ItemIdSchema, workflowId: WorkflowIdSchema, attempt: PositiveIntSchema,
      descriptorVersion: PositiveIntSchema, contractFingerprint: FingerprintSchema,
      lifecycle: z.literal("done") }),
    result: z.lazy(() => RunResultRecordSchema),
  }),
  z.strictObject({
    state: z.literal("resolved"),
    nodeId: NodeIdSchema,
    checkpoint: RunCheckpointRecordSchema,
  }),
  z.strictObject({
    state: z.literal("not-run"),
    nodeId: NodeIdSchema,
    reason: TerminalNotRunReasonSchema,
  }),
  z.strictObject({
    state: z.literal("asserted"),
    nodeId: NodeIdSchema,
    step: z.string().min(1),
    assertedAt: IsoInstantSchema,
    output: SchemaBoundCanonicalValueSchema,
  }),
]);

/** The terminal record of a PREVIEWED run: it stops at its first transaction node, so no declared result was derived and none is fabricated. */
export const RunDryRunPreviewResultSchema = z.strictObject({
  kind: z.literal("dry-run-preview"),
  /** The transaction node the run stopped at — its first (ref task-contract ). */
  stoppedAtNodeId: NodeIdSchema,
  externalCommit: z.literal("none"),
  preview: TransactionDryRunPreviewSchema,
});
export type RunDryRunPreviewResult = z.infer<typeof RunDryRunPreviewResultSchema>;

export const RunTerminalEvidenceResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("failed-evidence"),
    authorization: FailureTerminalAuthorizationRecordSchema,
    failureDigest: FingerprintSchema,
  }),
  z.strictObject({
    kind: z.literal("lifecycle-evidence"),
    outcome: z.enum(["cancelled", "discarded", "superseded"]),
    commandId: CommandIdSchema,
    auditId: CommandAuditIdSchema,
    requestFingerprint: FingerprintSchema,
    appliedVersion: PositiveIntSchema,
  }),
]);
export const RUN_TERMINAL_EVIDENCE_SCHEMA_HASH = deriveSchemaHash(RunTerminalEvidenceResultSchema, "output");
export type RunTerminalEvidenceResult = z.infer<typeof RunTerminalEvidenceResultSchema>;

export function deriveTerminalFailureDigest(failure: FailureRecord): Fingerprint {
  return FingerprintSchema.parse(sha256Hex(`hrauto:terminal-failure:v1\0${canonicalJsonStringify(FailureRecordSchema.parse(failure))}`));
}

export function terminalEvidenceResult(record: RunResultRecord): RunTerminalEvidenceResult | undefined {
  return record.resultSchemaHash === RUN_TERMINAL_EVIDENCE_SCHEMA_HASH
    ? RunTerminalEvidenceResultSchema.parse(record.result.value) : undefined;
}

export function createRunTerminalEvidenceResult(run: RunRecord, evidence: RunTerminalEvidenceResult): RunResultRecord {
  if (run.lifecycle.state !== "terminal" || run.lifecycle.outcome === "done" || run.lifecycle.outcome === "interrupted") {
    throw new Error("terminal-evidence-run-state-invalid");
  }
  const value = RunTerminalEvidenceResultSchema.parse(evidence);
  if (value.kind === "failed-evidence" ? run.lifecycle.outcome !== "failed"
    : run.lifecycle.outcome !== value.outcome || run.version < value.appliedVersion) throw new Error("terminal-evidence-outcome-mismatch");
  const dependencies: RunResultRecord["dependencies"] = [];
  return RunResultRecordSchema.parse({
    runId: run.envelope.runId, attempt: run.envelope.attempt, workflowId: run.envelope.workflow,
    descriptorVersion: run.envelope.descriptorVersion, contractFingerprint: run.envelope.contractFingerprint,
    configFingerprint: run.envelope.configFingerprint, configSnapshotId: run.envelope.configSnapshotId,
    resultSchemaHash: RUN_TERMINAL_EVIDENCE_SCHEMA_HASH,
    result: { schemaHash: RUN_TERMINAL_EVIDENCE_SCHEMA_HASH, value }, resultDigest: deriveRunResultDigest({ schemaHash: RUN_TERMINAL_EVIDENCE_SCHEMA_HASH, value }),
    dependencies, dependencyDigest: deriveTerminalDependencyDigest(dependencies), createdAt: run.lifecycle.endedAt,
  });
}


export function deriveRunResultDigest(result: unknown): Fingerprint {
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:run-result:v1\0${canonicalJsonStringify(valueFreeProtectedData(result))}`,
  ));
}

export function deriveTerminalDependencyDigest(dependencies: unknown): Fingerprint {
  const parsed = z.array(TerminalDependencyRecordSchema).parse(dependencies);
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:run-result-dependencies:v1\0${canonicalJsonStringify(parsed)}`,
  ));
}

export function deriveCheckpointOutputDigest(output: unknown): Fingerprint {
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:checkpoint-output:v1\0${canonicalJsonStringify(valueFreeProtectedData(output))}`,
  ));
}

export function deriveCheckpointProvenanceDigest(provenance: unknown): Fingerprint {
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:checkpoint-provenance:v1\0${canonicalJsonStringify(provenance)}`,
  ));
}

export const RunResultRecordSchema = z.strictObject({
  runId: RunIdSchema,
  attempt: PositiveIntSchema,
  workflowId: WorkflowIdSchema,
  descriptorVersion: PositiveIntSchema,
  contractFingerprint: FingerprintSchema,
  configFingerprint: FingerprintSchema,
  configSnapshotId: ConfigSnapshotIdSchema,
  resultSchemaHash: FingerprintSchema,
  result: SchemaBoundCanonicalValueSchema,
  resultDigest: FingerprintSchema,
  operationSources: z.array(z.strictObject({ path: ContractFieldPathSchema, identity: DeclaredActionIdentitySchema })).optional(),
  operationSourceDigest: FingerprintSchema.optional(),
  operationLineage: z.array(z.strictObject({ path: ContractFieldPathSchema, inputs: z.array(OperationInputLineageSchema).min(1) })).optional(),
  operationLineageDigest: FingerprintSchema.optional(),
  dependencies: z.array(TerminalDependencyRecordSchema),
  dependencyDigest: FingerprintSchema,
  createdAt: IsoInstantSchema,
}).superRefine((record, context) => {
  if (record.resultSchemaHash === RUN_TERMINAL_EVIDENCE_SCHEMA_HASH) {
    const evidence = RunTerminalEvidenceResultSchema.safeParse(record.result.value);
    if (!evidence.success || record.dependencies.length !== 0 || record.operationSources !== undefined
      || record.operationLineage !== undefined || record.result.protectedBindings !== undefined) {
      context.addIssue({ code: "custom", message: "terminal evidence is not a derived workflow output" });
    } else if (evidence.data.kind === "failed-evidence") {
      const owner = evidence.data.authorization;
      if (owner.runId !== record.runId || owner.workflowId !== record.workflowId || owner.attempt !== record.attempt
        || owner.descriptorVersion !== record.descriptorVersion || owner.contractFingerprint !== record.contractFingerprint
        || owner.authorizedAt !== record.createdAt) context.addIssue({ code: "custom", message: "terminal failure evidence identity mismatch" });
    }
  }

  if ((record.operationSources === undefined) !== (record.operationSourceDigest === undefined)
    || (record.operationSources !== undefined && record.operationSourceDigest !== sha256Hex(`hrauto:result-operation-sources:v1\0${canonicalJsonStringify(record.operationSources)}`))) {
    context.addIssue({ code: "custom", path: ["operationSourceDigest"], message: "result operation source digest mismatch" });
  }
  if ((record.operationLineage === undefined) !== (record.operationLineageDigest === undefined)
    || (record.operationLineage !== undefined && record.operationLineageDigest !== sha256Hex(`hrauto:result-operation-lineage:v1\0${canonicalJsonStringify(record.operationLineage)}`))) context.addIssue({ code: "custom", path: ["operationLineageDigest"], message: "result operation lineage digest mismatch" });
  const lineagePaths = new Set<string>();
  for (const lineage of record.operationLineage ?? []) {
    if (lineagePaths.has(lineage.path) || new Set(lineage.inputs.map((input) => input.inputId)).size !== lineage.inputs.length) context.addIssue({ code: "custom", message: "result operation lineage paths and inputs must be unique" });
    lineagePaths.add(lineage.path);
    let output: unknown = record.result.value;
    for (const segment of lineage.path.split(".")) output = output !== null && typeof output === "object" ? Reflect.get(output, segment) : undefined;
    if (output === undefined) context.addIssue({ code: "custom", message: "result operation lineage output field unavailable" });
    for (const input of lineage.inputs) {
      const dependency = record.dependencies.find((entry) => entry.nodeId === input.source.entryId);
      const single = dependency?.state === "child-resolved" ? dependency.child
        : dependency?.state === "delegation-resolved" ? singleDelegationMember(dependency) : undefined;
      if (dependency === undefined || (dependency.state !== "resolved" && single === undefined)
        || ((input.source.kind === "task-output") !== (dependency.state === "resolved"))
        || (input.result !== undefined && (single === undefined || input.result.runId !== single.runId || input.result.resultDigest !== single.resultDigest || input.result.dependencyDigest !== single.dependencyDigest || input.result.definitionFingerprint !== single.contractFingerprint || input.result.resultSchemaHash !== single.resultSchemaHash))
        || (input.identities !== undefined && (single === undefined || input.result === undefined
          || canonicalJsonStringify(input.identities) !== canonicalJsonStringify(((dependency.state === "child-resolved" || dependency.state === "delegation-resolved") ? dependency.operationLineage : undefined)?.find((lineage) => lineage.path === input.source.path)?.inputs.flatMap((retained) => retained.identity === undefined ? retained.identities ?? [] : [retained.identity]) ?? [])))
        || (input.identity !== undefined && !((dependency.state === "resolved" || dependency.state === "child-resolved" || dependency.state === "delegation-resolved") ? dependency.operationSources : undefined)?.some((source) => source.path === input.source.path && canonicalJsonStringify(source.identity) === canonicalJsonStringify(input.identity)))) context.addIssue({ code: "custom", message: "result lineage input is not retained by its exact dependency" });
    }
  }
  const sourcePaths = new Set<string>();
  for (const [index, source] of (record.operationSources ?? []).entries()) {
    const identity = source.identity;
    const dependency = record.dependencies.find((entry) => ((entry.state === "child-resolved" || entry.state === "delegation-resolved" && singleDelegationMember(entry) !== undefined)
      ? entry.operationSources?.some((retained) => (retained.identity !== undefined && canonicalJsonStringify(retained.identity) === canonicalJsonStringify(identity)))
      : entry.state === "resolved" && entry.nodeId === identity.nodeId
      && entry.checkpoint.runId === identity.runId && entry.checkpoint.attempt === identity.attempt
      && entry.checkpoint.claimGeneration === identity.claimGeneration && entry.contractFingerprint === identity.definitionFingerprint
      && entry.operationSources?.some((retained) => (retained.identity !== undefined && canonicalJsonStringify(retained.identity) === canonicalJsonStringify(identity)))));
    if (sourcePaths.has(source.path) || dependency === undefined || (identity.state !== undefined && identity.state !== "completed")) {
      context.addIssue({ code: "custom", path: ["operationSources", index], message: "result operation source does not belong to an exact resolved dependency or repeats a path" });
    }
    sourcePaths.add(source.path);
    let value: unknown = record.result.value;
    for (const segment of source.path.split(".")) value = value !== null && typeof value === "object" ? Reflect.get(value, segment) : undefined;
    if (value === undefined) context.addIssue({ code: "custom", path: ["operationSources", index, "path"], message: "result operation source field unavailable" });
  }
  if (record.result.schemaHash !== record.resultSchemaHash) {
    context.addIssue({
      code: "custom",
      path: ["result", "schemaHash"],
      message: "terminal result schema hash must equal resultSchemaHash",
    });
  }
  if (record.resultDigest !== deriveRunResultDigest(record.result)
    && record.resultDigest !== sha256Hex(`hrauto:run-result:v1\0${canonicalJsonStringify(record.result)}`)) {
    context.addIssue({
      code: "custom",
      path: ["resultDigest"],
      message: "terminal result digest must match the exact schema-bound canonical result",
    });
  }
  if (record.dependencyDigest !== deriveTerminalDependencyDigest(record.dependencies)) {
    context.addIssue({
      code: "custom",
      path: ["dependencyDigest"],
      message: "terminal dependency digest must match the ordered dependency identities",
    });
  }
  const nodeIds = record.dependencies.map(({ nodeId }) => nodeId);
  if (new Set(nodeIds).size !== nodeIds.length) {
    context.addIssue({
      code: "custom",
      path: ["dependencies"],
      message: "terminal dependencies must contain each node identity exactly once",
    });
  }
  for (const [index, dependency] of record.dependencies.entries()) {
    if ((dependency.state === "child-resolved" || dependency.state === "delegation-resolved") && dependency.parentRunId !== record.runId) {
      context.addIssue({ code: "custom", path: ["dependencies", index], message: "child terminal dependency belongs to a different parent run" });
    }
  }
  const resolved = record.dependencies.filter((dependency) => dependency.state === "resolved");
  const itemIds = new Set(resolved.map(({ checkpoint }) => checkpoint.itemId));
  if (itemIds.size > 1) {
    context.addIssue({
      code: "custom",
      path: ["dependencies"],
      message: "resolved terminal dependencies must belong to one logical item",
    });
  }
  for (const [index, dependency] of resolved.entries()) {
    if (dependency.checkpoint.workflowId !== record.workflowId) {
      context.addIssue({
        code: "custom",
        path: ["dependencies", index, "checkpoint", "workflowId"],
        message: "resolved terminal dependency workflow must equal the result workflow",
      });
    }
    if (dependency.checkpoint.attempt > record.attempt) {
      context.addIssue({
        code: "custom",
        path: ["dependencies", index, "checkpoint", "attempt"],
        message: "resolved terminal dependency cannot come from a future attempt",
      });
    }
  }
});

export type TerminalNotRunReason = z.infer<typeof TerminalNotRunReasonSchema>;
export type TerminalDependencyRecord = z.infer<typeof TerminalDependencyRecordSchema>;
export type TerminalDependencyEvidence = z.infer<typeof TerminalDependencyEvidenceSchema>;
export type RunResultRecord = z.infer<typeof RunResultRecordSchema>;

export function singleDelegationMember(dependency: z.infer<typeof DelegationTerminalDependencySchema>) {
  const member = dependency.members[0];
  return dependency.manifest.cardinality === "one" && dependency.manifest.join !== "none" && dependency.members.length === 1 && member?.lifecycle === "done" ? member : undefined;
}

export function singleDelegationResult(evidence: Extract<TerminalDependencyEvidence, { state: "delegation-resolved" | "child-resolved" }>) {
  if (evidence.state === "child-resolved") return RunResultRecordSchema.parse(evidence.result);
  return evidence.manifest.cardinality === "one" && evidence.manifest.join !== "none" && evidence.children.length === 1
    && evidence.children[0]?.run.lifecycle.state === "terminal" && evidence.children[0].run.lifecycle.outcome === "done" ? evidence.children[0].result : undefined;
}

export function delegationEvidenceOutput(evidence: Extract<TerminalDependencyEvidence, { state: "delegation-resolved" }>, schema: z.ZodType): unknown {
  const { manifest } = evidence;
  if (manifest.parentRunId !== evidence.parentRunId || manifest.edgeId !== evidence.edgeId) throw new Error("delegation-outcome-manifest-mismatch");
  if (manifest.join === "none") {
    if (evidence.children.length !== 0) throw new Error("delegation-dispatch-has-terminal-members");
    return DelegationManifestRefSchema.parse({ manifestId: manifest.manifestId, edgeId: manifest.edgeId, childCount: manifest.children.length });
  }
  if (manifest.children.length !== evidence.children.length) throw new Error("delegation-outcome-membership-mismatch");
  const outcomes = evidence.children.map(({ run, result, cancellation }, index) => {
    const expected = manifest.children[index], envelope = run.envelope;
    if (expected === undefined || envelope.parent?.runId !== evidence.parentRunId || envelope.parent.edgeId !== evidence.edgeId
      || envelope.itemId !== expected.childItemId || result.runId !== envelope.runId || result.workflowId !== envelope.workflow
      || result.attempt !== envelope.attempt || result.descriptorVersion !== envelope.descriptorVersion || result.contractFingerprint !== envelope.contractFingerprint
      || result.configSnapshotId !== envelope.configSnapshotId || result.configFingerprint !== envelope.configFingerprint || run.lifecycle.state !== "terminal") throw new Error("delegation-outcome-child-mismatch");
    const identity = { runId: envelope.runId, itemId: envelope.itemId }, terminal = terminalEvidenceResult(result);
    if (run.lifecycle.outcome === "done") {
      if (terminal !== undefined || result.resultSchemaHash !== manifest.resultSchemaHash || result.resultSchemaHash !== deriveSchemaHash(schema, "output")
        || run.completion?.kind !== "done" || run.completion.resultDigest !== result.resultDigest) throw new Error("delegation-outcome-result-mismatch");
      return childRunOutcomeSchema(schema).parse({ state: "done", ...identity, output: result.result.value });
    }
    if (run.lifecycle.outcome === "failed" && terminal?.kind === "failed-evidence" && terminal.authorization.failureId === run.lifecycle.failureId) return childRunOutcomeSchema(schema).parse({ state: "failed", ...identity, failureId: run.lifecycle.failureId });
    if (run.lifecycle.outcome === "cancelled" && terminal?.kind === "lifecycle-evidence" && terminal.outcome === "cancelled" && cancellation !== undefined) return childRunOutcomeSchema(schema).parse({ state: "cancelled", ...identity, ...cancellation });
    throw new Error("delegation-outcome-terminal-proof-unavailable");
  });
  if (delegationJoinDisposition(manifest, outcomes.map(outcome => outcome.state)) !== "satisfied") throw new Error("delegation-outcome-policy-unsatisfied");
  return manifest.cardinality === "one" ? outcomes[0] : outcomes;
}

export function delegationDependencyRecord(evidence: Extract<TerminalDependencyEvidence, { state: "delegation-resolved" }>): z.infer<typeof DelegationTerminalDependencySchema> {
  const single = singleDelegationResult(evidence);
  return DelegationTerminalDependencySchema.parse({ state: evidence.state, nodeId: evidence.nodeId, parentRunId: evidence.parentRunId,
    edgeId: evidence.edgeId, invocationCommandId: evidence.invocationCommandId, manifest: evidence.manifest,
    members: evidence.children.map(({ run, result }, index) => ({ dependencyId: evidence.manifest.children[index]?.dependencyId,
      runId: run.envelope.runId, itemId: run.envelope.itemId, workflowId: run.envelope.workflow, attempt: run.envelope.attempt,
      descriptorVersion: run.envelope.descriptorVersion, contractFingerprint: run.envelope.contractFingerprint,
      resultSchemaHash: result.resultSchemaHash, resultDigest: result.resultDigest, dependencyDigest: result.dependencyDigest,
      lifecycle: run.lifecycle.state === "terminal" ? run.lifecycle.outcome : undefined })),
    ...(single?.operationSources === undefined ? {} : { operationSources: single.operationSources }),
    ...(single?.operationLineage === undefined ? {} : { operationLineage: single.operationLineage }) });
}

export function terminalDelegationDependencyRecord(evidence: Extract<TerminalDependencyEvidence, { state: "delegation-resolved" }>): z.infer<typeof ChildTerminalDependencySchema> | z.infer<typeof DelegationTerminalDependencySchema> {
  const single = singleDelegationResult(evidence);
  const child = evidence.children[0]?.run;
  if (evidence.manifest.cardinality !== "one" || evidence.manifest.join !== "one" || single === undefined || child === undefined) return delegationDependencyRecord(evidence);
  return ChildTerminalDependencySchema.parse({ state: "child-resolved", nodeId: evidence.nodeId, parentRunId: evidence.parentRunId,
    edgeId: evidence.edgeId, child: { runId: child.envelope.runId, itemId: child.envelope.itemId, workflowId: child.envelope.workflow,
      attempt: child.envelope.attempt, descriptorVersion: child.envelope.descriptorVersion, contractFingerprint: child.envelope.contractFingerprint,
      resultSchemaHash: single.resultSchemaHash, resultDigest: single.resultDigest, dependencyDigest: single.dependencyDigest },
    ...(single.operationSources === undefined ? {} : { operationSources: single.operationSources }),
    ...(single.operationLineage === undefined ? {} : { operationLineage: single.operationLineage }) });
}
