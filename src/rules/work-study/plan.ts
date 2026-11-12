import type { UcpathPayPathRead } from "../../models/ui/ucpath-paypath.js";
import type { WorkStudyPlan } from "../../models/workflows/work-study/plan-transaction.js";
import type { WorkStudyInputValue } from "../../models/workflows/work-study/input.js";

export const WORK_STUDY_POSITION_CHANGE_REASON = "JRL";
export const WORK_STUDY_POSITION_POOL = "F";

/** ISO date-only `YYYY-MM-DD` as PayPath's `MM/DD/YYYY`. */
export function workStudyUsDate(isoDate: string): string {
  throw new Error(`not implemented: workStudyUsDate(${isoDate})`);
}

export function workStudyComments(isoDate: string): string {
  throw new Error(`not implemented: workStudyComments(${isoDate})`);
}

/** Folds one run's input and its PayPath read into the planned transaction; throws `WorkStudyPlanRefusedError` when the read is for another Empl ID. */
export function planWorkStudyTransaction(input: WorkStudyInputValue, read: UcpathPayPathRead): WorkStudyPlan {
  throw new Error(`not implemented: planWorkStudyTransaction(${input.emplId}, ${read.emplId})`);
}

export class WorkStudyPlanRefusedError extends Error {
  constructor() { super("work-study-read-for-another-employee"); this.name = "WorkStudyPlanRefusedError"; }
}
