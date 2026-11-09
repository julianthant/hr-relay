import { z } from "zod";
import { ContractFieldPathSchema } from "../task/task-contract.js";
import { BrowserSessionIdSchema, DelegationEdgeIdSchema, FingerprintSchema, NodeIdSchema, PositiveIntSchema, IsoInstantSchema, RunIdSchema, TaskIdSchema, slugSchema } from "../../rules/identity/ids.js";

/** Recorded operation identities: stored events, checkpoints and results still carry these fields as plain data. */
export const OperationIdSchema = slugSchema("operation id must be kebab-case").brand<"OperationId">();
export const OperationActionIdSchema = slugSchema("operation action id must be kebab-case").brand<"OperationActionId">();
export const OperationOccurrenceSegmentSchema = slugSchema("operation occurrence path segments must be kebab-case").brand<"OperationOccurrenceSegment">();
export const OperationSessionIdSchema = slugSchema("logical session id must be kebab-case").brand<"OperationSessionId">();
export const OperationValueIdSchema = slugSchema("operation value id must be kebab-case").brand<"OperationValueId">();
export const OperationTransformIdSchema = slugSchema("operation transform id must be kebab-case").brand<"OperationTransformId">();
export const ConfigurationReferenceKeySchema = z.string().regex(
  /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/,
  "configuration reference key must be a dot-delimited path",
).brand<"ConfigurationReferenceKey">();

const FieldPathSchema = z.string().regex(
  /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/,
  "operation field path must be a dot-delimited object path",
);
const AvailabilitySchema = z.enum(["owned", "offered"]);

export const SnapshotWorkflowValueReferenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("run-input"), path: FieldPathSchema, availability: AvailabilitySchema.optional() }),
  z.strictObject({ kind: z.literal("configuration"), key: ConfigurationReferenceKeySchema, schemaHash: FingerprintSchema }),
  z.strictObject({ kind: z.literal("constant"), valueDigest: FingerprintSchema }),
  z.strictObject({ kind: z.literal("task-output"), entryId: NodeIdSchema, path: FieldPathSchema, availability: AvailabilitySchema.optional() }),
  z.strictObject({ kind: z.literal("transformation"), transformId: OperationTransformIdSchema, path: FieldPathSchema, availability: AvailabilitySchema.optional() }),
  z.strictObject({ kind: z.literal("child-output"), entryId: NodeIdSchema, path: FieldPathSchema, availability: AvailabilitySchema.optional() }),
]);

export const DeclaredActionIdentitySchema = z.strictObject({
  runId: RunIdSchema,
  definitionFingerprint: FingerprintSchema,
  nodeId: NodeIdSchema,
  taskId: TaskIdSchema,
  childInvocation: z.strictObject({ parentRunId: RunIdSchema, edgeId: DelegationEdgeIdSchema }).optional(),
  attempt: PositiveIntSchema,
  claimGeneration: PositiveIntSchema,
  taskAttempt: PositiveIntSchema,
  invocationId: OperationIdSchema,
  occurrencePath: z.array(OperationOccurrenceSegmentSchema).min(1),
  logicalActionId: OperationActionIdSchema,
  occurrence: PositiveIntSchema,
  logicalSessionId: OperationSessionIdSchema,
  physicalSessionId: BrowserSessionIdSchema.optional(),
  state: z.enum(["started", "completed", "failed", "not-run", "confirmed"]).optional(),
  confirmation: z.strictObject({ verificationActionId: OperationActionIdSchema, verificationOccurrence: PositiveIntSchema, verifiedAt: IsoInstantSchema }).optional(),
  reason: z.enum(["condition-false", "dry-run", "cancelled", "callback-failed"]).optional(),
}).superRefine((identity, context) => {
  if ((identity.state === "confirmed") !== (identity.confirmation !== undefined)) context.addIssue({ code: "custom", path: ["confirmation"], message: "confirmed action requires exact verification evidence" });
});
export type DeclaredActionIdentity = z.infer<typeof DeclaredActionIdentitySchema>;

export const OperationChildResultIdentitySchema = z.strictObject({
  runId: RunIdSchema, definitionFingerprint: FingerprintSchema, resultSchemaHash: FingerprintSchema,
  resultDigest: FingerprintSchema, dependencyDigest: FingerprintSchema,
});
export type OperationChildResultIdentity = z.infer<typeof OperationChildResultIdentitySchema>;

export const OperationChildResultReferenceSchema = z.strictObject({
  source: z.strictObject({ kind: z.literal("child-output"), entryId: NodeIdSchema, path: ContractFieldPathSchema }),
  result: OperationChildResultIdentitySchema,
});

export const OperationInputLineageSchema = z.strictObject({
  inputId: z.string().regex(/^[a-z][a-z0-9-]*$/u),
  source: z.strictObject({ kind: z.enum(["task-output", "child-output"]), entryId: NodeIdSchema, path: ContractFieldPathSchema }),
  state: z.enum(["retained", "unavailable"]),
  identity: DeclaredActionIdentitySchema.optional(),
  identities: z.array(DeclaredActionIdentitySchema).min(1).optional(),
  result: OperationChildResultIdentitySchema.optional(),
  reason: z.literal("exact-input-occurrence-not-retained").optional(),
}).superRefine((input, context) => {
  if (input.state === "retained" ? (input.identity === undefined && input.identities === undefined) || input.reason !== undefined : input.identity !== undefined || input.identities !== undefined || input.reason === undefined) {
    context.addIssue({ code: "custom", message: "input lineage requires one exact identity or named unavailable evidence" });
  }
});
export type OperationInputLineage = z.infer<typeof OperationInputLineageSchema>;
