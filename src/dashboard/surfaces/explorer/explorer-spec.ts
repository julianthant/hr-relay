import type { ExplorerReviewSpec, ExplorerSpecGate, ExplorerSpecValue } from "../../../models/dashboard/explorer-review-spec.js";
import { SYSTEM_NAME } from "../shared/status/system-chip-model.js";

export type SpecStep = ExplorerReviewSpec["steps"][number];
export type SpecBlock = SpecStep["blocks"][number];
export type SpecOption = ExplorerReviewSpec["options"][number];
export type SpecDecision = Extract<SpecBlock, { kind: "decision" }>;
export type SpecOutcome = SpecDecision["outcomes"][number];
export type SpecCard = Extract<SpecBlock, { kind: "card" }>;
export type SpecRow = SpecCard["rows"][number];
export type SpecValues = Readonly<Record<string, string>>;

/** What the source drawer shows for one fill value. */
export interface FieldSource {
  readonly origin: string;
  readonly detail: string;
  readonly reads: readonly { readonly system: string; readonly page: string; readonly field: string; readonly step: number }[];
}

export class ExplorerSpecError extends Error { override name = "ExplorerSpecError"; }

/** A gate holds when any of its alternatives has every key at one of its values. */
export const applies = (gate: ExplorerSpecGate, values: SpecValues): boolean => gate.when === undefined
  || gate.when.some(alternative => Object.entries(alternative).every(([key, allowed]) => { const held = values[key]; return held !== undefined && allowed.includes(held); }));

export const valueOf = (value: ExplorerSpecValue, values: SpecValues): string =>
  typeof value === "string" ? value : value.values[values[value.by] ?? ""] ?? value.otherwise;

export const visible = <Item extends ExplorerSpecGate>(items: readonly Item[], values: SpecValues): Item[] => items.filter(item => applies(item, values));

export type ResolvedExplorer = Readonly<{
  /** Every visible option and the decisions walked so far, by id. */
  values: SpecValues;
  options: readonly SpecOption[];
  sessions: readonly string[];
  steps: readonly SpecStep[];
  /** The outcome that ends the run; every later step is hidden. */
  stop?: SpecOutcome;
}>;

/**
 * Applies the chosen options and decision outcomes. An option or decision whose chosen value no longer applies falls back to
 * its initial value. The walk ends at the first outcome that stops the run.
 */
export function resolveExplorer(spec: ExplorerReviewSpec, chosen: SpecValues, decisions: SpecValues): ResolvedExplorer {
  const values: Record<string, string> = {};
  const options: SpecOption[] = [];
  for (const option of spec.options) {
    if (!applies(option, values)) continue;
    options.push(option);
    const picked = chosen[option.id];
    values[option.id] = picked !== undefined && option.choices.some(choice => choice.value === picked) ? picked : valueOf(option.initial, values);
  }
  const steps: SpecStep[] = [];
  let stop: SpecOutcome | undefined;
  for (const step of spec.steps) {
    if (!applies(step, values)) continue;
    steps.push(step);
    for (const block of step.blocks) {
      if (block.kind !== "decision" || !applies(block, values)) continue;
      const outcomes = visible(block.outcomes, values);
      const initial = valueOf(block.initial, values);
      const outcome = outcomes.find(candidate => candidate.value === decisions[block.id]) ?? outcomes.find(candidate => candidate.value === initial);
      if (outcome === undefined) throw new ExplorerSpecError(`explorer-decision-outcome-missing: ${step.id}/${block.id} has no outcome at ${initial}`);
      values[block.id] = outcome.value;
      if (outcome.stops) { stop = outcome; break; }
    }
    if (stop) break;
  }
  return { values, options, sessions: spec.sessions.filter(session => applies(session, values)).map(session => session.system), steps, stop };
}

export const systemName = (system: string): string => system === "local" ? "Local" : SYSTEM_NAME[system as keyof typeof SYSTEM_NAME] ?? system;

export function rowValue(row: SpecRow, values: SpecValues): string {
  if (row.value === undefined) throw new ExplorerSpecError(`explorer-row-value-missing: ${row.id}`);
  return valueOf(row.value, values);
}

/** The source drawer's content; a read from a step that is not shown is left out. `numberOf` is the shown step's number. */
export function fieldSource(spec: ExplorerReviewSpec, row: SpecRow, numberOf: (stepId: string) => number | undefined): FieldSource {
  const source = spec.sources[row.source];
  if (source === undefined) throw new ExplorerSpecError(`explorer-source-missing: ${row.id} names ${row.source}`);
  return {
    origin: source.origin, detail: source.detail,
    reads: source.reads.flatMap(read => { const step = numberOf(read.step); return step === undefined ? [] : [{ system: systemName(read.system ?? "local"), page: read.page, field: read.field, step }]; }),
  };
}
