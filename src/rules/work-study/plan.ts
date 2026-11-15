import type { UcpathPayPathRead, UcpathPayPathWorkStudyTarget } from "../../models/ui/ucpath-paypath.js";
import type { WorkStudyPlan } from "../../models/workflows/work-study/read-transaction-plan.js";
import type { WorkStudyInputValue } from "../../models/workflows/work-study/input.js";

export const WORK_STUDY_POSITION_CHANGE_REASON = "JRL";
export const WORK_STUDY_POSITION_POOL = "F";

/** ISO date-only `YYYY-MM-DD` as PayPath's `MM/DD/YYYY`. */
export function workStudyUsDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${month}/${day}/${year}`;
}

export function workStudyComments(isoDate: string): string {
  return `Updated pool id to ${WORK_STUDY_POSITION_POOL} per work study award ${workStudyUsDate(isoDate)}`;
}

/** Folds one run's input and its PayPath read into the planned transaction; throws `WorkStudyPlanRefusedError` when the read is for another Empl ID. */
export function planWorkStudyTransaction(input: WorkStudyInputValue, read: UcpathPayPathRead): WorkStudyPlan {
  if (read.emplId !== input.emplId) throw new WorkStudyPlanRefusedError();
  return {
    emplId: input.emplId, name: read.displayedName, effectiveDate: workStudyUsDate(input.effectiveDate),
    positionChangeReason: WORK_STUDY_POSITION_CHANGE_REASON, positionPool: WORK_STUDY_POSITION_POOL,
    comments: workStudyComments(input.effectiveDate), current: read.position,
  };
}

/** The transaction the Save files: exactly the planned values, for the person PayPath named when the plan was read. */
export function workStudyTarget(plan: WorkStudyPlan): UcpathPayPathWorkStudyTarget {
  return {
    emplId: plan.emplId, expectedName: plan.name, effectiveDate: plan.effectiveDate,
    positionChangeReason: plan.positionChangeReason, positionPool: plan.positionPool, comments: plan.comments,
  };
}

export class WorkStudyPlanRefusedError extends Error {
  constructor() { super("work-study-read-for-another-employee"); this.name = "WorkStudyPlanRefusedError"; }
}
