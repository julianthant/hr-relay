import { z } from "zod";
import { CommandIdSchema, DelegationEdgeIdSchema, DelegationManifestIdSchema, DependencyIdSchema, FingerprintSchema, IsoInstantSchema, ItemIdSchema, NodeIdSchema, PositiveIntSchema, RunIdSchema, WorkflowIdSchema, WorkerIdSchema } from "../../../rules/identity/ids.js";
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
  children: z.array(z.strictObject({ childItemId: ItemIdSchema, canonicalInputFingerprint: FingerprintSchema })),
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
});

export const DelegationRetryRequestSchema = z.strictObject({
  commandId: CommandIdSchema, sourceCommandId: CommandIdSchema, invocationCommandId: CommandIdSchema,
  manifestId: DelegationManifestIdSchema, dependencyId: DependencyIdSchema, expectedVersion: PositiveIntSchema,
  parentVersion: PositiveIntSchema, originalRunId: RunIdSchema, originalAttempt: PositiveIntSchema,
  previousRunId: RunIdSchema, previousAttempt: PositiveIntSchema, resultDigest: FingerprintSchema,
  replacementRunId: RunIdSchema, replacementAttempt: PositiveIntSchema,
  planFingerprint: FingerprintSchema, policy: DelegationPolicySchema,
});
