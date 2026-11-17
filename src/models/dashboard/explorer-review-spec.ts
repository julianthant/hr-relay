/**
 * The Explorer review spec: what a run of one workflow does, generated from its definition. Every part may carry `when`,
 * which shows it only under these run option values and decision outcomes: each key (an option or decision id) must hold
 * one of its values. A reader picks options, then walks the steps, taking each visible decision at its chosen or initial
 * outcome and ending at an outcome that stops.
 */
import { z } from "zod";
import { BrowserSystemIdSchema } from "../../rules/identity/ids.js";

const TextSchema = z.string().min(1);
const IdSchema = z.string().min(1);
export const ExplorerSpecWhenSchema = z.record(IdSchema, z.array(TextSchema).min(1));
const Gate = { when: ExplorerSpecWhenSchema.optional() };
export type ExplorerSpecGate = Readonly<{ when?: z.infer<typeof ExplorerSpecWhenSchema> }>;
/** A value that follows an option or decision: `values[by]`, else `otherwise`. */
export const ExplorerSpecValueSchema = z.union([TextSchema,
  z.strictObject({ by: IdSchema, values: z.record(TextSchema, TextSchema), otherwise: TextSchema })]);
export type ExplorerSpecValue = z.infer<typeof ExplorerSpecValueSchema>;
const SystemSchema = z.union([BrowserSystemIdSchema, z.literal("local")]);
const TextLineSchema = z.strictObject({ text: TextSchema, ...Gate });

export const ExplorerSpecOutcomeSchema = z.strictObject({ value: TextSchema, label: TextSchema, then: TextSchema, stops: z.boolean(), ...Gate });
const BlockSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("card"), id: IdSchema, title: TextSchema, mode: z.enum(["fill", "read"]), ...Gate,
    rows: z.array(z.strictObject({ id: IdSchema, label: TextSchema, value: ExplorerSpecValueSchema.optional(), source: IdSchema, ...Gate })) }),
  z.strictObject({ kind: z.literal("click"), target: TextSchema, ...Gate }),
  z.strictObject({ kind: z.literal("decision"), id: IdSchema, label: TextSchema, initial: TextSchema, ...Gate,
    outcomes: z.array(ExplorerSpecOutcomeSchema).min(1) }),
]);

export const ExplorerReviewSpecSchema = z.strictObject({
  unlistedFailure: z.literal("Anything not listed stops the run with a failure card."),
  options: z.array(z.strictObject({ id: IdSchema, label: TextSchema, ...Gate,
    choices: z.array(z.strictObject({ value: TextSchema, label: TextSchema })).min(2), initial: ExplorerSpecValueSchema })),
  /** One chip per system the chosen run signs in to before it starts, delegated runs included. */
  sessions: z.array(z.strictObject({ system: BrowserSystemIdSchema, ...Gate })),
  steps: z.array(z.strictObject({ id: IdSchema, title: TextSchema, system: SystemSchema.optional(), ...Gate,
    description: z.array(TextLineSchema), checks: z.array(TextLineSchema), blocks: z.array(BlockSchema) })).min(1),
  /** Where each row's value comes from, keyed by the row's `source`. */
  sources: z.record(IdSchema, z.strictObject({ origin: TextSchema, detail: TextSchema,
    reads: z.array(z.strictObject({ system: SystemSchema.optional(), step: IdSchema, page: TextSchema, field: TextSchema })) })),
}).superRefine((spec, context) => {
  const issue = (path: (string | number)[], message: string): void => { context.addIssue({ code: "custom", path, message }); };
  const known = new Map<string, readonly string[]>();
  const checkGate = (gate: ExplorerSpecGate, path: (string | number)[]): void => {
    for (const [key, values] of Object.entries(gate.when ?? {})) {
      const allowed = known.get(key);
      if (allowed === undefined) issue([...path, "when", key], `gate names ${key}, which is no earlier option or decision`);
      else for (const value of values) if (!allowed.includes(value)) issue([...path, "when", key], `gate names ${key}=${value}, which it never holds`);
    }
  };
  const values: [ExplorerSpecValue | undefined, (string | number)[]][] = [];
  /** A value may follow a decision taken later in its own step, so values are checked once every id is known. */
  const checkValue = (value: ExplorerSpecValue | undefined, path: (string | number)[]): void => { values.push([value, path]); };
  for (const [index, option] of spec.options.entries()) {
    const path = ["options", index];
    if (known.has(option.id)) issue(path, `option ${option.id} repeats`);
    checkGate(option, path);
    const choices = option.choices.map(choice => choice.value);
    if (new Set(choices).size !== choices.length) issue(path, `option ${option.id} repeats a choice`);
    checkValue(option.initial, [...path, "initial"]);
    for (const initial of typeof option.initial === "string" ? [option.initial] : [...Object.values(option.initial.values), option.initial.otherwise]) {
      if (!choices.includes(initial)) issue([...path, "initial"], `option ${option.id} starts at ${initial}, which is no choice`);
    }
    known.set(option.id, choices);
  }
  spec.sessions.forEach((session, index) => { checkGate(session, ["sessions", index]); });
  for (const [stepIndex, step] of spec.steps.entries()) {
    const path = ["steps", stepIndex];
    checkGate(step, path);
    [...step.description.map((line, index) => [line, "description", index] as const), ...step.checks.map((line, index) => [line, "checks", index] as const)]
      .forEach(([line, list, index]) => { checkGate(line, [...path, list, index]); });
    for (const [blockIndex, block] of step.blocks.entries()) {
      const blockPath = [...path, "blocks", blockIndex];
      checkGate(block, blockPath);
      if (block.kind === "card") for (const [rowIndex, row] of block.rows.entries()) {
        checkGate(row, [...blockPath, "rows", rowIndex]);
        checkValue(row.value, [...blockPath, "rows", rowIndex, "value"]);
        if (spec.sources[row.source] === undefined) issue([...blockPath, "rows", rowIndex, "source"], `row names unknown source ${row.source}`);
      }
      if (block.kind !== "decision") continue;
      if (known.has(block.id)) issue(blockPath, `decision ${block.id} repeats an option or decision id`);
      const outcomes = block.outcomes.map(outcome => outcome.value);
      if (new Set(outcomes).size !== outcomes.length) issue(blockPath, `decision ${block.id} repeats an outcome`);
      block.outcomes.forEach((outcome, index) => { checkGate(outcome, [...blockPath, "outcomes", index]); });
      if (!block.outcomes.some(outcome => outcome.value === block.initial && !outcome.stops && outcome.when === undefined)) {
        issue(blockPath, `decision ${block.id} starts at no ungated continuing outcome`);
      }
      known.set(block.id, outcomes);
    }
  }
  for (const [value, path] of values) {
    if (value === undefined || typeof value === "string") continue;
    const allowed = known.get(value.by);
    if (allowed === undefined) issue(path, `value follows ${value.by}, which is no option or decision`);
    else for (const key of Object.keys(value.values)) if (!allowed.includes(key)) issue(path, `value names ${value.by}=${key}, which it never holds`);
  }
});
export type ExplorerReviewSpec = z.infer<typeof ExplorerReviewSpecSchema>;
