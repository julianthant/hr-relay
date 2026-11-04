import { z } from "zod";
import { RefreshedRunSettlementSchema } from "../../../rules/workflow/dependencies.js";
import { CommandIdSchema, DelegationEdgeIdSchema, DelegationManifestIdSchema, DependencyIdSchema, FingerprintSchema, GateIdSchema, IsoInstantSchema, ItemIdSchema, NodeIdSchema, PositiveIntSchema, RunIdSchema, StableRecordIdSchema, WorkflowIdSchema, WorkerIdSchema } from "../../../rules/identity/ids.js";
import { DelegationTerminalDependencySchema } from "../../../models/run/result.js";
import { DelegationPolicySchema } from "../../../models/workflow/delegation-policy.js";

export const DelegationScopeEvidenceSchema = z.array(z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("delegation"), nodeId: NodeIdSchema, receipt: DelegationTerminalDependencySchema }),
    z.strictObject({ kind: z.literal("gate"), nodeId: NodeIdSchema }),
    z.strictObject({ kind: z.literal("checkpoint"), nodeId: NodeIdSchema, runId: RunIdSchema,
      attempt: PositiveIntSchema, claimGeneration: PositiveIntSchema }),
  ]));

export const DelegationInvocationRequestSchema = z.strictObject({
  commandId: CommandIdSchema,
  runId: RunIdSchema,
  attempt: PositiveIntSchema,
  nodeId: NodeIdSchema,
  edgeId: DelegationEdgeIdSchema,
  manifestId: DelegationManifestIdSchema,
  definitionFingerprint: FingerprintSchema,
  parentInputDigest: FingerprintSchema,
  approvalDigest: FingerprintSchema,
  scopeEvidence: DelegationScopeEvidenceSchema,
  target: z.strictObject({ workflowId: WorkflowIdSchema, descriptorVersion: PositiveIntSchema,
    contractFingerprint: FingerprintSchema, inputSchemaHash: FingerprintSchema, canonicalInputSchemaHash: FingerprintSchema,
    resultSchemaHash: FingerprintSchema }),
  configSnapshotId: z.uuid(),
  configFingerprint: FingerprintSchema,
  dryRun: z.boolean(),
  cardinality: z.enum(["one", "many"]),
  join: z.enum(["one", "all", "all-settled", "none"]),
  policy: DelegationPolicySchema,
  planFingerprint: FingerprintSchema,
  children: z.array(z.strictObject({ childItemId: ItemIdSchema, canonicalInputFingerprint: FingerprintSchema, sourceRecordIds: z.array(StableRecordIdSchema).min(1).optional() })),
});

export const DelegationAdmissionRequestSchema = z.strictObject({
  commandId: CommandIdSchema,
  runId: RunIdSchema,
  expectedVersion: PositiveIntSchema,
  claim: z.strictObject({ workerId: WorkerIdSchema, claimGeneration: PositiveIntSchema }),
  invocationCommandId: CommandIdSchema,
  scopeEvidence: DelegationScopeEvidenceSchema,
  observedScopeDigest: FingerprintSchema,
});

export const DelegationSettlementRequestSchema = z.strictObject({
  commandId: CommandIdSchema,
  dependencyId: DependencyIdSchema,
  expectedVersion: PositiveIntSchema,
  runId: RunIdSchema,
  childAttempt: PositiveIntSchema,
  resultDigest: FingerprintSchema,
  state: z.enum(["satisfied", "failed", "cancelled"]),
  now: IsoInstantSchema,
  settlement: RefreshedRunSettlementSchema.optional(),
});

export const ContinuationRetryOwnerSchema = z.strictObject({ runId: RunIdSchema, version: PositiveIntSchema, attempt: PositiveIntSchema });

export const DelegationRetryRequestSchema = z.strictObject({
  continuationOwner: ContinuationRetryOwnerSchema.optional(),
  commandId: CommandIdSchema, sourceCommandId: CommandIdSchema, invocationCommandId: CommandIdSchema,
  manifestId: DelegationManifestIdSchema, dependencyId: DependencyIdSchema, expectedVersion: PositiveIntSchema,
  parentVersion: PositiveIntSchema, originalRunId: RunIdSchema, originalAttempt: PositiveIntSchema,
  previousRunId: RunIdSchema, previousAttempt: PositiveIntSchema, resultDigest: FingerprintSchema,
  replacementRunId: RunIdSchema, replacementAttempt: PositiveIntSchema,
  planFingerprint: FingerprintSchema, policy: DelegationPolicySchema,
});

const DelegationRefreshBase = {
  commandId: CommandIdSchema, runId: RunIdSchema, expectedVersion: PositiveIntSchema,
  definitionFingerprint: FingerprintSchema, claimGeneration: PositiveIntSchema,
};
export const DelegationRefreshRequestSchema = z.discriminatedUnion("phase", [
  z.strictObject({ ...DelegationRefreshBase, phase: z.literal("admit"), retryCommandId: CommandIdSchema, nodeId: NodeIdSchema,
    previous: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("terminal"), appliedVersion: PositiveIntSchema }),
      z.strictObject({ kind: z.literal("gate"), gateId: GateIdSchema, parkCommandId: CommandIdSchema }),
    ]) }),
  z.strictObject({ ...DelegationRefreshBase, phase: z.literal("extend"), rootCommandId: CommandIdSchema,
    retryCommandId: CommandIdSchema, nodeId: NodeIdSchema }),
  z.strictObject({ ...DelegationRefreshBase, phase: z.literal("settle"), rootCommandId: CommandIdSchema,
    retryCommandIds: z.array(CommandIdSchema).min(1),
    children: z.array(z.strictObject({ retryCommandId: CommandIdSchema, runId: RunIdSchema,
      attempt: PositiveIntSchema, resultDigest: FingerprintSchema, appliedVersion: PositiveIntSchema })),
  }),
]);
