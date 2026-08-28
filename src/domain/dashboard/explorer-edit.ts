/**
 * The Workflow Explorer's closed safe-edit protocol (ref operator-trust §5.3–§5.4).
 *
 * This boundary carries presentation data and values from existing closed
 * descriptor vocabularies only. It has no arm for executable code, graph
 * authoring, selectors, secrets, checkpoint values, or an open property bag.
 */
import { z } from "zod";
import { canonicalJsonStringify } from "../canonical-json.js";
import { ContractFieldPathSchema } from "../contracts/base.js";
import {
  CommandIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  NodeIdSchema,
  WorkflowIdSchema,
} from "../ids.js";
import {
  EnqueuePolicySchema,
  IconNameSchema,
  TimelineCategoryKeySchema,
  WorkflowCategorySchema,
} from "../workflow/presentation.js";
import { sha256Hex } from "../sha256.js";

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

/** One domain-separated identity for the exact draft bytes the operator reviewed. */
export function deriveExplorerEditFingerprint(input: unknown): z.infer<typeof FingerprintSchema> {
  const draft = ExplorerEditDraftSchema.parse(input);
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:explorer-edit:v1\0${canonicalJsonStringify(draft)}`,
  ));
}

export const ExplorerEditApplyRequestSchema = z.strictObject({
  commandVersion: z.literal(1),
  commandId: CommandIdSchema,
  /** The domain-separated fingerprint of the exact draft the operator reviewed. */
  reviewedFingerprint: FingerprintSchema,
  draft: ExplorerEditDraftSchema,
});
export type ExplorerEditApplyRequest = z.infer<typeof ExplorerEditApplyRequestSchema>;

export const ExplorerCompiledEditSchema = z.strictObject({
  commandId: CommandIdSchema,
  draft: ExplorerEditDraftSchema,
  compiledFingerprint: FingerprintSchema,
});
export type ExplorerCompiledEdit = z.infer<typeof ExplorerCompiledEditSchema>;

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
});
export type ExplorerAppliedOverride = z.infer<typeof ExplorerAppliedOverrideSchema>;

export const ExplorerEditAuthorityFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  overrides: z.array(ExplorerAppliedOverrideSchema),
}).superRefine((file, context) => {
  const ids = file.overrides.map(({ workflowId }) => String(workflowId));
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["overrides"], message: "Explorer authority repeats a workflow" });
  }
});
export type ExplorerEditAuthorityFile = z.infer<typeof ExplorerEditAuthorityFileSchema>;

export const ExplorerEditApplyResultSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("applied"), override: ExplorerAppliedOverrideSchema }),
  z.strictObject({
    state: z.literal("conflict"),
    workflowId: WorkflowIdSchema,
    currentOverrideRevision: z.number().int().nonnegative(),
    currentDescriptorVersion: z.number().int().positive(),
    currentContractFingerprint: FingerprintSchema,
    message: z.string().min(1),
  }),
  z.strictObject({
    state: z.literal("rejected"),
    workflowId: WorkflowIdSchema,
    code: z.enum(["schema-mismatch", "policy-refused"]),
    message: z.string().min(1),
  }),
]);
export type ExplorerEditApplyResult = z.infer<typeof ExplorerEditApplyResultSchema>;

export const ExplorerEditReadbackSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("none"), revision: z.literal(0) }),
  z.strictObject({ state: z.literal("applied"), override: ExplorerAppliedOverrideSchema }),
]);
export type ExplorerEditReadback = z.infer<typeof ExplorerEditReadbackSchema>;
