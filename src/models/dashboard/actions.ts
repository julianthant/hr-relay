/** Server-authored action descriptors: the ONLY source a surface may render a run control from — a control the server did not describe is unreachable, not hidden. */
import { z } from "zod";
import { WriteIntentIdSchema, WriteAttemptIdSchema, FingerprintSchema } from "../../rules/identity/ids.js";
import { ParkedWriteCheckTargetSchema } from "../../rules/commands/commands.js";

export const ActionPlacementSchema = z.enum(["footer", "banner", "outcome", "menu", "data", "review"]);
export const ActionIntentSchema = z.enum(["primary", "neutral", "destructive", "violet", "success", "info", "warning"]);
export const ActionIconKeySchema = z.enum(["retry", "cancel", "bump", "archive", "delete", "review", "resolve", "rename", "external", "drill"]);
/** The command verbs a served action may name; the two write resolutions are INTENT-scoped rather than run-scoped, and every verb on this list has a durable reason it is here. */
export const ActionCommandKeySchema = z.enum([
  "retry", "restart", "recover-run", "cancel", "bump", "rename", "archive", "delete", "resolve-gate",
  "recheck-write", "resolve-write-absent", "check-parked-write",
]);

/** Parked-write actions bind the exact intent generation and original attempt. */
export const ActionWriteTargetSchema = z.strictObject({
  writeIntentId: WriteIntentIdSchema,
  intentGeneration: z.number().int().positive(),
  writeAttemptId: WriteAttemptIdSchema,
  bindingProofDigest: FingerprintSchema,
  occurrenceKeyDigest: FingerprintSchema,
});

export const ActionConfirmWireSchema = z.strictObject({
  title: z.string().min(1),
  /** names the casualties in the operator's own terms */
  body: z.string().min(1).optional(),
  confirmLabel: z.string().min(1),
  tone: z.enum(["destructive", "neutral"]),
});

const ActionBaseFields = {
  /** stable within a row */
  key: z.string().min(1),
  label: z.string().min(1),
  /** long-form copy — rendered under the label where a placement allows it */
  detail: z.string().min(1).optional(),
  intent: ActionIntentSchema,
  icon: ActionIconKeySchema.optional(),
  placement: z.array(ActionPlacementSchema).min(1),
} as const;

export const ActionDescriptorWireSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...ActionBaseFields,
    kind: z.literal("command"),
    command: ActionCommandKeySchema,
    /** CAS — the row version the surface the operator is holding was projected at */
    expectedVersion: z.number().int().positive(),
    confirm: ActionConfirmWireSchema.optional(),
    /** the typed resolution this gate option records (`resolve-gate` only) */
    resolution: z.enum(["approved", "rejected"]).optional(),
    /** The parked intent and original write occurrence. */
    writeTarget: ActionWriteTargetSchema.optional(),
    /** The idle worker and held run authority for `check-parked-write`. */
    checkTarget: ParkedWriteCheckTargetSchema.optional(),
  }),
  z.strictObject({
    ...ActionBaseFields,
    kind: z.literal("navigation"),
    navigate: z.union([
      z.strictObject({ kind: z.enum(["self", "panel", "drill"]), runId: z.string().min(1).optional() }),
      z.strictObject({ kind: z.literal("rerun"), expectedVersion: z.number().int().positive() }),
    ]),
  }),
]).superRefine((action, context) => {
  if (action.kind !== "command") return;
  const scoped = action.command === "recheck-write" || action.command === "resolve-write-absent" || action.command === "check-parked-write";
  if ((action.command === "check-parked-write") !== (action.checkTarget !== undefined)) {
    context.addIssue({ code: "custom", path: ["checkTarget"], message: "only held checks require their exact worker and parked-write target" });
  }
  // Every parked-write action requires an occurrence target.
  if (scoped && action.writeTarget === undefined) {
    context.addIssue({
      code: "custom",
      path: ["writeTarget"],
      message: `${action.command} is intent-scoped and cannot be served without a write target`,
    });
  }
  if (!scoped && action.writeTarget !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["writeTarget"],
      message: `${action.command} takes no parked-write target`,
    });
  }
});

export type ActionPlacement = z.infer<typeof ActionPlacementSchema>;
export type ActionIntent = z.infer<typeof ActionIntentSchema>;
export type ActionIconKey = z.infer<typeof ActionIconKeySchema>;
export type ActionDescriptorWire = z.infer<typeof ActionDescriptorWireSchema>;

/** The one placement filter every surface uses; never re-filter by status. */
export function actionsAt(
  actions: readonly ActionDescriptorWire[],
  placement: ActionPlacement,
): ActionDescriptorWire[] {
  return actions.filter((action) => action.placement.includes(placement));
}
