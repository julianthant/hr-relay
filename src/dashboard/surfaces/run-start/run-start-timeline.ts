/** The launcher's path: a run walks Input then Start, then Steps when it customizes them; a rerun walks Steps then Start. The checks are a section of Start. */

import type { RunStartStage } from "./run-dialog-model.js";

export type { RunStartStage };

export interface RunStartStageSpec {
  readonly label: RunStartStage;
  readonly number: number;
}

export function runStartStages(rerun: boolean, customize = false): readonly RunStartStageSpec[] {
  const labels: readonly RunStartStage[] = rerun ? ["Steps", "Start"] : customize ? ["Input", "Start", "Steps"] : ["Input", "Start"];
  return Object.freeze(labels.map((label, index) => Object.freeze({ label, number: index + 1 })));
}

/** A stage the path does not have falls back to its first page. */
export function reconcileRunStartStage(stages: readonly RunStartStageSpec[], current: RunStartStage): RunStartStage {
  return stages.find((stage) => stage.label === current)?.label ?? stages[0]?.label ?? "Start";
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
