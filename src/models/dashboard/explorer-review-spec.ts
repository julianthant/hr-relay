/**
 * The Explorer review spec: what a run of one workflow does, generated from its definition. Every part may carry `when`,
 * a list of alternatives that shows it when any alternative holds: each key (an option or decision id) holds one of its
 * values. A reader picks options, then walks the steps, taking each visible decision at its chosen or initial outcome and
 * ending at an outcome that stops. A step's cards, lines and rows may follow the step's own decisions.
 */
import { z } from "zod";
import { BrowserSystemIdSchema } from "../../rules/identity/ids.js";

const TextSchema = z.string().min(1);
const IdSchema = z.string().min(1);
export const ExplorerSpecConditionSchema = z.record(IdSchema, z.array(TextSchema).min(1));
export const ExplorerSpecWhenSchema = z.array(ExplorerSpecConditionSchema).min(1);
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
  z.strictObject({ kind: z.literal("starts"), workflowId: IdSchema, title: TextSchema, each: TextSchema, ...Gate }),
  z.strictObject({ kind: z.literal("decision"), id: IdSchema, label: TextSchema, initial: ExplorerSpecValueSchema, ...Gate,
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
  type Path = (string | number)[];
  const issue = (path: Path, message: string): void => { context.addIssue({ code: "custom", path, message }); };
  const known = new Map<string, readonly string[]>();
  const checkGate = (gate: ExplorerSpecGate, path: Path, scope: ReadonlyMap<string, readonly string[]> = known): void => {
    for (const [index, alternative] of (gate.when ?? []).entries()) for (const [key, values] of Object.entries(alternative)) {
      const allowed = scope.get(key);
      if (allowed === undefined) issue([...path, "when", index, key], `gate names ${key}, which is no earlier option or decision`);
      else for (const value of values) if (!allowed.includes(value)) issue([...path, "when", index, key], `gate names ${key}=${value}, which it never holds`);
    }
  };
  const values: [ExplorerSpecValue | undefined, Path][] = [];
  /** A value may follow a decision taken later in its own step, so values are checked once every id is known. */
  const checkValue = (value: ExplorerSpecValue | undefined, path: Path): void => { values.push([value, path]); };
  const candidates = (value: ExplorerSpecValue): readonly string[] => typeof value === "string" ? [value] : [...Object.values(value.values), value.otherwise];
  for (const [index, option] of spec.options.entries()) {
    const path = ["options", index];
    if (known.has(option.id)) issue(path, `option ${option.id} repeats`);
    checkGate(option, path);
    const choices = option.choices.map(choice => choice.value);
    if (new Set(choices).size !== choices.length) issue(path, `option ${option.id} repeats a choice`);
    checkValue(option.initial, [...path, "initial"]);
    for (const initial of candidates(option.initial)) if (!choices.includes(initial)) issue([...path, "initial"], `option ${option.id} starts at ${initial}, which is no choice`);
    known.set(option.id, choices);
  }
  spec.sessions.forEach((session, index) => { checkGate(session, ["sessions", index]); });
  for (const [stepIndex, step] of spec.steps.entries()) {
    const path = ["steps", stepIndex];
    checkGate(step, path);
    const own = new Map(known);
    for (const block of step.blocks) if (block.kind === "decision") own.set(block.id, block.outcomes.map(outcome => outcome.value));
    [...step.description.map((line, index) => [line, "description", index] as const), ...step.checks.map((line, index) => [line, "checks", index] as const)]
      .forEach(([line, list, index]) => { checkGate(line, [...path, list, index], own); });
    for (const [blockIndex, block] of step.blocks.entries()) {
      const blockPath = [...path, "blocks", blockIndex];
      if (block.kind !== "decision") checkGate(block, blockPath, own);
      if (block.kind === "card") for (const [rowIndex, row] of block.rows.entries()) {
        checkGate(row, [...blockPath, "rows", rowIndex], own);
        checkValue(row.value, [...blockPath, "rows", rowIndex, "value"]);
        if (spec.sources[row.source] === undefined) issue([...blockPath, "rows", rowIndex, "source"], `row names unknown source ${row.source}`);
      }
      if (block.kind !== "decision") continue;
      checkGate(block, blockPath);
      if (known.has(block.id)) issue(blockPath, `decision ${block.id} repeats an option or decision id`);
      const outcomes = block.outcomes.map(outcome => outcome.value);
      if (new Set(outcomes).size !== outcomes.length) issue(blockPath, `decision ${block.id} repeats an outcome`);
      block.outcomes.forEach((outcome, index) => { checkGate(outcome, [...blockPath, "outcomes", index]); });
      checkValue(block.initial, [...blockPath, "initial"]);
      for (const initial of candidates(block.initial)) {
        if (!block.outcomes.some(outcome => outcome.value === initial && !outcome.stops)) issue([...blockPath, "initial"], `decision ${block.id} starts at ${initial}, which is no continuing outcome`);
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
