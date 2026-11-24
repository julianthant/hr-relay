/** The run launcher's two-step path: Input, then Start. Step customization and the checks are sections of Start. */

import type { RunStartStage } from "./run-dialog-model.js";

export type { RunStartStage };

export interface RunStartStageSpec {
  readonly label: RunStartStage;
  readonly number: number;
}

export function runStartStages(): readonly RunStartStageSpec[] {
  return Object.freeze((["Input", "Start"] as const).map((label, index) => Object.freeze({ label, number: index + 1 })));
}

/** A stage the path does not have falls back to Input; Warning exists only in a rerun. */
export function reconcileRunStartStage(
  stages: readonly RunStartStageSpec[],
  current: RunStartStage,
  rerun: boolean,
): RunStartStage {
  if (stages.some((stage) => stage.label === current) || (current === "Warning" && rerun)) return current;
  return "Input";
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
