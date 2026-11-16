/** A served run decision: the server declares every option, its order, its hint and how it is sent, so a surface never hard-codes a choice. */
import { z } from "zod";
import { IsoInstantSchema } from "../../rules/identity/ids.js";
import { ActionConfirmWireSchema } from "./actions.js";

export const RunDecisionTypeSchema = z.enum([
  "identity-mismatch", "pick-person", "pick-row", "review-before-write",
  "write-parked", "write-unknown", "failed-retryable", "failed-after-write",
  "member-failed", "correct-value", "workbook-row", "sign-in",
  "paused", "stalled", "refused", "cancelling",
]);
export type RunDecisionType = z.infer<typeof RunDecisionTypeSchema>;

const Text = z.string().min(1);
const Pattern = Text.superRefine((pattern, ctx) => {
  try { new RegExp(pattern, "u"); } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    ctx.addIssue({ code: "custom", message: "pattern must compile" });
  }
});

export const DecisionSendSchema = z.discriminatedUnion("via", [
  /* The section's own served action descriptor. */
  z.strictObject({ via: z.literal("action"), actionKey: Text }),
  /* The run's queue-row descriptor (cancel, resume, recover). */
  z.strictObject({ via: z.literal("row-action"), actionKey: Text }),
  /* `resolve-gate` on the parked gate node at the run version, with this declared arm. */
  z.strictObject({ via: z.literal("gate-arm"), gateNodeId: Text, expectedVersion: z.number().int().positive(), arm: Text }),
  /* The failure's served start plan, previewed before it starts. */
  z.strictObject({ via: z.literal("start-plan") }),
  z.strictObject({ via: z.literal("command"), family: Text, type: Text }),
]);
export type DecisionSend = z.infer<typeof DecisionSendSchema>;

export const CandidateTableWireSchema = z.strictObject({
  title: Text,
  columns: z.array(z.strictObject({ id: Text, label: Text })).min(1),
  rows: z.array(z.strictObject({
    id: Text,
    /* What the answered line prints for this row. */
    name: Text,
    sheetId: Text.optional(),
    rowId: Text.optional(),
    eid: z.string().regex(/^\d{8}$/u).optional(),
    chosenFrom: z.enum(["checked", "name-search", "manual"]).optional(),
    /* The worksheet row number a typed row number matches. */
    rowNumber: z.number().int().positive().optional(),
    cells: z.array(z.strictObject({ columnId: Text, value: z.string(), tone: z.literal("attention").optional() })).min(1),
  })).min(1),
  /* The fill row: a typed value names a served row; a `lookup` value instead starts a lookup for it, because the rows are shown masked. */
  typed: z.strictObject({ label: Text, placeholder: Text, pattern: Pattern, lookup: z.literal(true).optional() }).optional(),
}).superRefine((table, context) => {
  const columns = new Set(table.columns.map(({ id }) => id));
  if (columns.size !== table.columns.length) context.addIssue({ code: "custom", path: ["columns"], message: "candidate columns must be unique" });
  if (new Set(table.rows.map(({ id }) => id)).size !== table.rows.length) context.addIssue({ code: "custom", path: ["rows"], message: "candidate rows must be unique" });
  for (const [index, row] of table.rows.entries()) {
    if (row.cells.some(cell => !columns.has(cell.columnId))) context.addIssue({ code: "custom", path: ["rows", index], message: "a candidate cell must name a declared column" });
  }
});
export type CandidateTableWire = z.infer<typeof CandidateTableWireSchema>;

export const DecisionInputWireSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("text"), label: Text, placeholder: Text.optional(), pattern: Pattern.optional(), prefill: Text.optional() }),
  z.strictObject({ kind: z.literal("date"), label: Text }),
  z.strictObject({ kind: z.literal("candidate"), table: CandidateTableWireSchema }),
]);
export type DecisionInputWire = z.infer<typeof DecisionInputWireSchema>;

export const DecisionOptionWireSchema = z.strictObject({
  id: Text,
  label: Text,
  hint: Text,
  recommended: z.literal(true).optional(),
  send: DecisionSendSchema,
  /* Only the option that uses it; an option without one is submittable as is. */
  input: DecisionInputWireSchema.optional(),
  confirm: ActionConfirmWireSchema.optional(),
});
export type DecisionOptionWire = z.infer<typeof DecisionOptionWireSchema>;

export const DecisionAnswerWireSchema = z.strictObject({
  optionId: Text,
  label: Text,
  at: IsoInstantSchema,
  actor: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("person"), name: Text }),
    z.strictObject({ kind: z.literal("assistant"), onBehalfOf: z.strictObject({ name: Text }) }),
  ]),
});
export type DecisionAnswerWire = z.infer<typeof DecisionAnswerWireSchema>;

export const RunDecisionWireSchema = z.strictObject({
  type: RunDecisionTypeSchema,
  title: Text,
  /* The line after the title that names what is asked about this person or row. */
  context: Text.optional(),
  /* The dropdown's label; served whenever the decision offers more than one choice. */
  choiceLabel: Text.optional(),
  options: z.array(DecisionOptionWireSchema),
  answer: DecisionAnswerWireSchema.optional(),
}).superRefine((decision, context) => {
  const choices = decision.options.filter(option => !(option.send.via === "row-action" && option.id === "cancel-run"));
  if (choices.length > 1 && decision.choiceLabel === undefined) context.addIssue({ code: "custom", path: ["choiceLabel"], message: "a decision with several choices serves its choiceLabel" });
  const ids = decision.options.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["options"], message: "decision option ids must be unique" });
  const keys = decision.options.flatMap(({ send }) => send.via === "action" ? [send.actionKey] : []);
  if (new Set(keys).size !== keys.length) context.addIssue({ code: "custom", path: ["options"], message: "decision action keys must be unique" });
  if (decision.options.filter(option => option.recommended).length > 1) context.addIssue({ code: "custom", path: ["options"], message: "at most one option is recommended" });
  if (decision.answer !== undefined && !ids.includes(decision.answer.optionId)) {
    context.addIssue({ code: "custom", path: ["answer", "optionId"], message: "the answer must name a declared option" });
  }
  if (decision.type === "cancelling" && decision.options.length > 0) context.addIssue({ code: "custom", path: ["options"], message: "a cancelling decision is a line, with no options" });
});
export type RunDecisionWire = z.infer<typeof RunDecisionWireSchema>;
