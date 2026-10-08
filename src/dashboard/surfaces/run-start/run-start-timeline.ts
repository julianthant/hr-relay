/**
 * The run launcher's compact path.
 *
 * Options is always visible. Step customization is chosen there, and only
 * then does the Steps stage appear.
 *
 * THE SPREADSHEET METHOD HAS ONE STAGE, AND THAT IS THE HONEST COUNT (D296).
 * Its whole contribution to the dialog is the choice of method: the file, the
 * column mapping, the per-row review, the queue policy and the enqueue all
 * belong to the intake workspace this arm hands off to. The demo walks its
 * spreadsheet method through every stage and suppresses each stage's controls
 * (`DemoRunStart.tsx:973,1001` — `!isHandoff`), which it can afford because it
 * serves a sheet list to pick from and a `Confirm` that names the chosen sheet;
 * nothing here serves either. Numbering two more stages an operator would walk
 * through empty is `DESIGN.md`'s own empty scaffolding, and a rail that says
 * `1 → 2 → 3` over one reachable stage is a claim about this dialog that is
 * false.
 */

import type { StartMethod } from "./run-start-model.js";

export type RunStartStage = "Input" | "Options" | "Steps" | "Values" | "Warning" | "Confirm";

export interface RunStartStageSpec {
  readonly label: RunStartStage;
  readonly number: number;
}

export function runStartStages(
  customizeSteps: boolean,
  method: StartMethod = "typed",
  rerun = false,
): readonly RunStartStageSpec[] {
  const labels: RunStartStage[] = rerun ? ["Steps", "Values", "Options", "Confirm"] : method === "spreadsheet"
    ? ["Input"]
    : customizeSteps
      ? ["Input", "Options", "Steps", "Confirm"]
      : ["Input", "Options", "Confirm"];
  return Object.freeze(labels.map((label, index) => Object.freeze({ label, number: index + 1 })));
}

export function reconcileRunStartStage(
  stages: readonly RunStartStageSpec[],
  current: RunStartStage,
): RunStartStage {
  if (stages.some((stage) => stage.label === current) || (current === "Warning" && stages.some((stage) => stage.label === "Values"))) return current;
  return current === "Steps" ? "Options" : "Input";
}

export function adjacentRunStartStage(
  stages: readonly RunStartStageSpec[],
  current: RunStartStage,
  direction: "previous" | "next",
): RunStartStage | null {
  const index = stages.findIndex((stage) => stage.label === current);
  if (index < 0) return null;
  const target = direction === "next" ? index + 1 : index - 1;
  return stages[target]?.label ?? null;
}
