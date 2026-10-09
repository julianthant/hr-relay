/** The run launcher's compact path.
 * Options is always visible. Step customization is chosen there, and only */

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
