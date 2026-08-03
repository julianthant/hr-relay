/**
 * Server-authored action descriptors (doc 13 §3.2/§8.5): the ONLY source from
 * which a surface may render an interactive run control. A control the server
 * did not describe is unreachable, not hidden — surfaces render exactly the
 * descriptors they are handed and never re-derive availability from a status.
 *
 * Ported (shape) from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/demo-wire.ts (`ActionDescriptorWire`),
 * narrowed to the command vocabulary the rebuild's Phase-1 kernel actually
 * accepts (`src/domain/commands.ts`: run retry/cancel/bump/hide/unhide, gate
 * resolve-gate). The 1g BFF does not serve these yet — until it does, surfaces
 * receive an empty list and honestly draw no run-action controls (1i landing
 * note; serving lands with the doc 03 action-policy projection).
 */
import { z } from "zod";

export const ActionPlacementSchema = z.enum(["footer", "banner", "outcome", "menu", "data", "review"]);
export const ActionIntentSchema = z.enum(["primary", "neutral", "destructive", "violet", "success", "info", "warning"]);
export const ActionIconKeySchema = z.enum(["retry", "cancel", "bump", "delete", "review", "resolve", "rename", "external", "drill"]);
/** The Phase-1 command verbs a served action may name (kernel-accepted only). */
export const ActionCommandKeySchema = z.enum(["retry", "cancel", "bump", "hide", "unhide", "resolve-gate"]);

export const ActionConfirmWireSchema = z.strictObject({
  title: z.string().min(1),
  /** names the casualties in the operator's own terms */
  body: z.string().min(1),
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
  }),
  z.strictObject({
    ...ActionBaseFields,
    kind: z.literal("navigation"),
    navigate: z.strictObject({
      kind: z.enum(["self", "panel", "drill"]),
      runId: z.string().min(1).optional(),
    }),
  }),
]);

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
