/** Historical Explorer review/outbox storage shapes only, retained for migration and stored-record validation; no command, query or service consumes them. */
import { z } from "zod";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { ContractFieldPathSchema } from "../task/task-contract.js";
import {
  ActorIdSchema,
  CommandIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  NodeIdSchema,
  SourceSurfaceIdSchema,
  WorkflowIdSchema,
} from "../../rules/identity/ids.js";
import {
  EnqueuePolicySchema,
  IconNameSchema,
  TimelineCategoryKeySchema,
  WorkflowCategorySchema,
} from "../workflow/presentation.js";
import { sha256Hex } from "../../rules/validation/sha256.js";

export const ExplorerPresentationLabelSchema = z.string().max(120).superRefine((value, context) => {
  if (value.length === 0 || value.trim() !== value) {
    context.addIssue({ code: "custom", message: "Explorer presentation labels must be non-empty and already trimmed" });
  }
  if (value.normalize("NFC") !== value) {
    context.addIssue({ code: "custom", message: "Explorer presentation labels must be NFC-normalized" });
  }
  if (/\p{Cc}/u.test(value)) {
    context.addIssue({ code: "custom", message: "Explorer presentation labels cannot contain control characters" });
  }
});

/** Storage and backfill-gap are system-scoped, so they cannot enter a workflow draft. */
export const ExplorerWorkflowNotificationTriggerSchema = z.enum([
  "failed",
  "gate-waiting",
  "write-parked",
  "repeating",
  "verified-done",
]);

const ExplorerEditDataFieldSchema = z.strictObject({
  nodeId: NodeIdSchema,
  fieldPath: ContractFieldPathSchema,
  label: ExplorerPresentationLabelSchema,
});

export const ExplorerEditChangeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("workflow-label"), value: ExplorerPresentationLabelSchema }),
  z.strictObject({ kind: z.literal("workflow-icon"), value: IconNameSchema }),
  z.strictObject({ kind: z.literal("workflow-category"), value: WorkflowCategorySchema }),
  z.strictObject({
    kind: z.literal("timeline-category-label"),
    categoryKey: TimelineCategoryKeySchema,
    value: ExplorerPresentationLabelSchema,
  }),
  z.strictObject({
    kind: z.literal("timeline-category-order"),
    categoryKeys: z.array(TimelineCategoryKeySchema).min(1).superRefine((keys, context) => {
      if (new Set(keys).size !== keys.length) {
        context.addIssue({ code: "custom", message: "timeline category order cannot repeat a category key" });
      }
    }),
  }),
  z.strictObject({
    kind: z.literal("notification-preference"),
    trigger: ExplorerWorkflowNotificationTriggerSchema,
    enabled: z.boolean(),
  }),
  z.strictObject({ kind: z.literal("enqueue-policy"), value: EnqueuePolicySchema }),
  z.strictObject({
    kind: z.literal("edit-data-fields"),
    fields: z.array(ExplorerEditDataFieldSchema).superRefine((fields, context) => {
      const identities = fields.map(({ nodeId, fieldPath }) => `${String(nodeId)}\0${String(fieldPath)}`);
      if (new Set(identities).size !== identities.length) {
        context.addIssue({ code: "custom", message: "Edit Data fields cannot repeat a descriptor field" });
      }
    }),
  }),
]);
export type ExplorerEditChange = z.infer<typeof ExplorerEditChangeSchema>;

function changeTarget(change: ExplorerEditChange): string {
  switch (change.kind) {
    case "timeline-category-label": return `${change.kind}\0${change.categoryKey}`;
    case "notification-preference": return `${change.kind}\0${change.trigger}`;
    default: return change.kind;
  }
}

export const ExplorerEditDraftSchema = z.strictObject({
  draftVersion: z.literal(1),
  workflowId: WorkflowIdSchema,
  baseDescriptorVersion: z.number().int().positive(),
  baseContractFingerprint: FingerprintSchema,
  /** Zero is the explicit never-overridden baseline. */
  baseOverrideRevision: z.number().int().nonnegative(),
  changes: z.array(ExplorerEditChangeSchema).min(1).max(100),
}).superRefine((draft, context) => {
  const targets = draft.changes.map(changeTarget);
  if (new Set(targets).size !== targets.length) {
    context.addIssue({ code: "custom", path: ["changes"], message: "each Explorer change target must be unique" });
  }
});
export type ExplorerEditDraft = z.infer<typeof ExplorerEditDraftSchema>;

export const ExplorerEditReviewTokenIdSchema = z.string().uuid().brand<"ExplorerEditReviewTokenId">();

/** One domain-separated identity for the exact draft bytes the operator reviewed. */
export function deriveExplorerEditFingerprint(input: unknown): z.infer<typeof FingerprintSchema> {
  const draft = ExplorerEditDraftSchema.parse(input);
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:explorer-edit:v1\0${canonicalJsonStringify(draft)}`,
  ));
}

export const ExplorerEditReviewReceiptSchema = z.strictObject({
  reviewTokenId: ExplorerEditReviewTokenIdSchema,
  draftFingerprint: FingerprintSchema,
  issuedAt: IsoInstantSchema,
  expiresAt: IsoInstantSchema,
}).superRefine((receipt, context) => {
  if (receipt.expiresAt <= receipt.issuedAt) {
    context.addIssue({ code: "custom", path: ["expiresAt"], message: "Explorer review token must expire after issue" });
  }
});
export type ExplorerEditReviewReceipt = z.infer<typeof ExplorerEditReviewReceiptSchema>;

export const ExplorerEditReviewTokenRecordSchema = z.strictObject({
  recordVersion: z.literal(1),
  ...ExplorerEditReviewReceiptSchema.shape,
  requestedBy: ActorIdSchema,
  source: SourceSurfaceIdSchema,
  draft: ExplorerEditDraftSchema,
  state: z.enum(["issued", "consumed"]),
  consumedBy: CommandIdSchema.optional(),
  consumedAt: IsoInstantSchema.optional(),
}).superRefine((record, context) => {
  if (record.draftFingerprint !== deriveExplorerEditFingerprint(record.draft)) {
    context.addIssue({ code: "custom", path: ["draftFingerprint"], message: "Explorer review token draft fingerprint mismatch" });
  }
  const expectsConsumptionEvidence = record.state === "consumed";
  if ((record.consumedBy !== undefined) !== expectsConsumptionEvidence
    || (record.consumedAt !== undefined) !== expectsConsumptionEvidence) {
    context.addIssue({
      code: "custom",
      path: ["state"],
      message: "issued Explorer review token requires neither consumedBy nor consumedAt; consumed requires both",
    });
  }
});
export type ExplorerEditReviewTokenRecord = z.infer<typeof ExplorerEditReviewTokenRecordSchema>;

const ExplorerAppliedOverrideContentSchema = z.strictObject({
  recordVersion: z.literal(1),
  workflowId: WorkflowIdSchema,
  revision: z.number().int().positive(),
  baseDescriptorVersion: z.number().int().positive(),
  baseContractFingerprint: FingerprintSchema,
  compiledFingerprint: FingerprintSchema,
  changes: z.array(ExplorerEditChangeSchema).min(1).max(100),
  commandId: CommandIdSchema,
  appliedAt: IsoInstantSchema,
});

/** Reconstruct the reviewed draft identity carried by one applied record. */
export function deriveExplorerAppliedCompiledFingerprint(
  content: z.infer<typeof ExplorerAppliedOverrideContentSchema>,
): z.infer<typeof FingerprintSchema> {
  return deriveExplorerEditFingerprint({
    draftVersion: 1,
    workflowId: content.workflowId,
    baseDescriptorVersion: content.baseDescriptorVersion,
    baseContractFingerprint: content.baseContractFingerprint,
    baseOverrideRevision: content.revision - 1,
    changes: content.changes,
  });
}

/** Identity of every persisted byte, including command provenance and apply time. */
export function deriveExplorerAppliedRecordFingerprint(input: unknown): z.infer<typeof FingerprintSchema> {
  const content = ExplorerAppliedOverrideContentSchema.parse(input);
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:explorer-applied-record:v1\0${canonicalJsonStringify(content)}`,
  ));
}

export const ExplorerAppliedOverrideSchema = z.strictObject({
  ...ExplorerAppliedOverrideContentSchema.shape,
  recordFingerprint: FingerprintSchema,
}).superRefine((override, context) => {
  if (override.compiledFingerprint !== deriveExplorerAppliedCompiledFingerprint(override)) {
    context.addIssue({
      code: "custom",
      path: ["compiledFingerprint"],
      message: "Explorer applied override compiled fingerprint mismatch",
    });
  }
  const { recordFingerprint, ...recordContent } = override;
  if (recordFingerprint !== deriveExplorerAppliedRecordFingerprint(recordContent)) {
    context.addIssue({
      code: "custom",
      path: ["recordFingerprint"],
      message: "Explorer applied override record fingerprint mismatch",
    });
  }
});
export type ExplorerAppliedOverride = z.infer<typeof ExplorerAppliedOverrideSchema>;

export const ExplorerEditProjectionOutboxRecordSchema = z.strictObject({
  recordVersion: z.literal(1),
  commandId: CommandIdSchema,
  reviewTokenId: ExplorerEditReviewTokenIdSchema,
  override: ExplorerAppliedOverrideSchema,
  state: z.enum(["pending", "projected"]),
  createdAt: IsoInstantSchema,
  projectedAt: IsoInstantSchema.optional(),
}).superRefine((record, context) => {
  if (record.commandId !== record.override.commandId) {
    context.addIssue({ code: "custom", path: ["commandId"], message: "Explorer outbox command must match override provenance" });
  }
  if ((record.state === "projected") !== (record.projectedAt !== undefined)) {
    context.addIssue({ code: "custom", path: ["projectedAt"], message: "projected Explorer outbox requires an instant" });
  }
});
export type ExplorerEditProjectionOutboxRecord = z.infer<typeof ExplorerEditProjectionOutboxRecordSchema>;
