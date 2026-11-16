import type { FieldSource } from "../../../models/workflow/explorer-preview.js";

/**
 * The Explorer contract: a review spec generated from a workflow definition.
 * `When` gates a part on run options and decision points: every key (an option id or a decision id) must hold one of the listed values.
 */
export type When = Readonly<Record<string, readonly string[]>>;
type Gate = Readonly<{ when?: When }>;

export type SpecOption = Readonly<{ id: string; label: string; choices: readonly Readonly<{ value: string; label: string }>[] }>;
export type SpecOutcome = Gate & Readonly<{ value: string; label: string; then: string; stops?: boolean }>;
/** A value that follows a decision point: `values[decision]`, else `otherwise`. */
export type SpecValue = string | Readonly<{ by: string; values: Readonly<Record<string, string>>; otherwise: string }>;
export type SpecRow = Gate & Readonly<{ label: string; value: SpecValue; source?: string }>;
export type SpecText = Gate & Readonly<{ text: string }>;

export type SpecBlock = Gate & (
  | Readonly<{ kind: "card"; title: string; mode: "fill" | "read"; rows: readonly SpecRow[] }>
  | Readonly<{ kind: "pick"; title: string; columns: readonly string[]; rows: readonly Readonly<{ cells: readonly string[]; warning?: boolean }>[]; other: Readonly<{ label: string; placeholder: string }>; question: Readonly<{ title: string; context: string }> }>
  | Readonly<{ kind: "click"; target: string }>
  | Readonly<{ kind: "decision"; id: string; label: string; initial: string; outcomes: readonly SpecOutcome[] }>
);

export type SpecStep = Gate & Readonly<{
  id: string; title: string; system?: string;
  description: readonly SpecText[]; checks: readonly SpecText[];
  /** Browser sessions the run signs in to (step 1). */
  sessions?: readonly (Gate & Readonly<{ system: string }>)[];
  blocks: readonly SpecBlock[];
}>;

/** Where a fill value comes from; `reads[].step` is a step id. */
export type SpecSource = Readonly<{ origin?: string; detail?: string; reads?: readonly Readonly<{ system: string; page: string; field: string; step: string }>[] }>;

export type ExplorerSpec = Readonly<{
  workflow: Readonly<{ id: string; title: string }>;
  options: readonly SpecOption[];
  steps: readonly SpecStep[];
  sources: Readonly<Record<string, SpecSource>>;
}>;

export type SpecValues = Readonly<Record<string, string>>;

export const matches = (gate: Gate, values: SpecValues): boolean => Object.entries(gate.when ?? {}).every(([key, allowed]) => allowed.includes(values[key]));
export const firstMatch = <T extends Gate>(items: readonly T[], values: SpecValues): T | undefined => items.find(item => matches(item, values));
export const specValue = (value: SpecValue, values: SpecValues): string => typeof value === "string" ? value : value.values[values[value.by]] ?? value.otherwise;
export const defaultOptions = (spec: ExplorerSpec): SpecValues => Object.fromEntries(spec.options.map(option => [option.id, option.choices[0].value]));

export type ResolvedSpec = Readonly<{ values: SpecValues; steps: readonly SpecStep[]; stop?: SpecOutcome }>;

/**
 * Applies the chosen options and decision outcomes: the visible steps, the decision values (falling back to each decision's
 * initial outcome when the chosen one no longer applies), and the outcome that ends the run, which hides every later step.
 */
export function resolveExplorer(spec: ExplorerSpec, options: SpecValues, decisions: SpecValues): ResolvedSpec {
  const values: Record<string, string> = { ...options };
  const steps: SpecStep[] = [];
  let stop: SpecOutcome | undefined;
  for (const step of spec.steps) {
    if (!matches(step, values)) continue;
    steps.push(step);
    for (const block of step.blocks) {
      if (block.kind !== "decision" || !matches(block, values)) continue;
      const outcomes = block.outcomes.filter(outcome => matches(outcome, values));
      const chosen = outcomes.find(outcome => outcome.value === decisions[block.id]) ?? outcomes.find(outcome => outcome.value === block.initial) ?? outcomes[0];
      values[block.id] = chosen.value;
      if (chosen.stops) { stop = chosen; break; }
    }
    if (stop) break;
  }
  return { values, steps, stop };
}

export const specFieldSource = (source: SpecSource, numberOf: (stepId: string) => number | undefined): FieldSource => ({
  origin: source.origin, detail: source.detail,
  reads: source.reads?.flatMap(read => { const step = numberOf(read.step); return step === undefined ? [] : [{ ...read, step }]; }),
});
