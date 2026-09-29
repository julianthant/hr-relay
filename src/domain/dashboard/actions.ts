/**
 * Server-authored action descriptors (ref frontend-backend-integration §3.2/§8.5): the ONLY source from
 * which a surface may render an interactive run control. A control the server
 * did not describe is unreachable, not hidden — surfaces render exactly the
 * descriptors they are handed and never re-derive availability from a status.
 *
 * Ported (shape) from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/demo-wire.ts (`ActionDescriptorWire`),
 * narrowed to the command vocabulary the rebuild's Phase-1 kernel actually
 * accepts (`src/domain/commands.ts`: run retry/cancel/bump/rename, gate
 * resolve-gate). The 1g BFF does not serve these yet — until it does, surfaces
 * receive an empty list and honestly draw no run-action controls (1i landing
 * note; serving lands with the ref dashboard-surfaces action-policy projection).
 */
import { z } from "zod";
import { WriteIntentIdSchema } from "../ids.js";

export const ActionPlacementSchema = z.enum(["footer", "banner", "outcome", "menu", "data", "review"]);
export const ActionIntentSchema = z.enum(["primary", "neutral", "destructive", "violet", "success", "info", "warning"]);
export const ActionIconKeySchema = z.enum(["retry", "cancel", "bump", "archive", "delete", "review", "resolve", "rename", "external", "drill"]);
/**
 * The command verbs a served action may name (kernel-accepted only).
 *
 * The two `resolve-write-*` verbs are ref write-safety §4.1's typed operator resolutions.
 * They are NOT interchangeable with `retry`: the kernel rejects generic retry
 * for a `parked-write` run by name, because a fenced write that may already
 * exist in a real HR system has no "try again" — only "I looked, and it is
 * there" or "I looked, and it is not". Serving them is what makes that pair
 * reachable at all.
 *
 * `rename` joined the vocabulary with D233. It was recorded as kernel-internal
 * on the reasoning that *"the display-name edit is an inline field on the row,
 * not a descriptor-driven control"* — and no build ever grew that field, so the
 * one kernel command an operator would reach for daily was reachable only from
 * a CLI that does not exist. It is a descriptor-driven control like every other
 * run verb, and the demo (`RebuildDemo.tsx:240`) serves it exactly that way: a
 * `menu` descriptor the surface INTERCEPTS to collect its one value, the same
 * shape `resolve-gate` already uses for the ceremony dialog's answer.
 *
 * `hide` and `unhide` LEFT the vocabulary with D234, on the operator's ruling
 * that *"there are runs and archived runs; there should be no hidden runs."*
 * `unhide` had never been serveable at all — a hidden run was filtered out of
 * the queue projection, so no row existed to hang it off — and `hide` was a
 * one-way door dressed as a reversible tombstone.
 *
 * `delete` JOINED with D308, on the operator's second ruling: *"some runs were
 * just error runs … I should be able to delete normal runs like this and
 * archived runs."* It is what `hide` only pretended to be. A hidden run was
 * still there — filtered out of one projection and rendered by nothing, which
 * is why `unhide` could never be served. A DELETED run is gone: the terminal
 * run and every row it owns leave authority behind one insert-only tombstone,
 * so there is no hidden state to reveal and nothing left to render. Archiving
 * is still the model that takes a run off the queue and KEEPS it; delete is
 * the one that ends it, and its blast radius is why every served descriptor
 * carries a confirm.
 */
export const ActionCommandKeySchema = z.enum([
  "retry", "restart", "cancel", "bump", "rename", "archive", "delete", "resolve-gate",
  "resolve-write-present", "resolve-write-absent",
]);

/**
 * Ref write-safety §4.1: both write resolutions are INTENT-scoped as well as run-scoped
 * — the run version alone cannot express "resolve the write this browser was
 * looking at", because recovery can advance a generation without touching the
 * run row. A stale generation is refused by the kernel, which is why the
 * descriptor carries the one it was projected from rather than letting the
 * surface read it back off a second fetch.
 */
export const ActionWriteTargetSchema = z.strictObject({
  writeIntentId: WriteIntentIdSchema,
  intentGeneration: z.number().int().positive(),
});

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
    /** the parked intent this write resolution settles (`resolve-write-*` only) */
    writeTarget: ActionWriteTargetSchema.optional(),
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
  const scoped = action.command === "resolve-write-present" || action.command === "resolve-write-absent";
  // A write resolution WITHOUT its intent target is a control that cannot be
  // sent, and an intent target on any other verb names a scope that command
  // does not accept — both are unreachable controls, which is the one thing a
  // server-authored descriptor exists to make impossible.
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
      message: `${action.command} takes no write target; only the ref write-safety §4.1 resolutions are intent-scoped`,
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
