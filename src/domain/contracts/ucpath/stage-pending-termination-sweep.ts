/**
 * `ucpath/stage-pending-termination-sweep` — the PREPARE arm of the sweep.
 *
 * It ticks the Select checkbox on every in-progress `Terminat*` row this person
 * has in the *Transactions in Progress* grid, reads back which rows it ticked,
 * and stops. No Delete is clicked: ticking a checkbox is page state and nothing
 * more, which is what puts the whole selection on the reversible side of the
 * fence.
 *
 * Two things it refuses rather than resolves:
 *
 *  - **A settled row is never selected.** Only `Pending` and `Pushed Back` are
 *    in progress; `Approved`, `Denied`, `Error` and `Manually Processed` are
 *    settled, and deleting a settled row would destroy the record of something
 *    that already happened.
 *  - **A row whose displayed name is not this person's** fails the subject
 *    binding. The sweep is a DELETE keyed only by a person, so reading the
 *    wrong person's grid is the one mistake with no downstream control at all.
 */
import { z } from "zod";
import { EidSchema, ObservationIdSchema, taskId } from "../../ids.js";
import {
  UCPATH_SMART_HR_DISPLAYED_PERSON_NAME,
  UCPATH_SMART_HR_TERMINATION_STAGED,
  UcpathPendingSweepStagingSchema,
  UcpathPendingSweepTargetSchema,
} from "../../ui/ucpath-smart-hr-termination.js";
import { ContractFieldPathSchema, defineTaskContract } from "../base.js";

export const UcpathStagePendingTerminationSweep = defineTaskContract({
  id: taskId("ucpath/stage-pending-termination-sweep"),
  title: "Select Pending UCPath Terminations",
  effect: "prepare",
  input: UcpathPendingSweepTargetSchema,
  output: UcpathPendingSweepStagingSchema,
  errorCodes: [
    "ucpath-unavailable",
    "unexpected-page-state",
    "subject-mismatch",
    "selection-not-persisted",
  ],
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("expectedName"), identity: "name" },
    observe: ObservationIdSchema.parse(UCPATH_SMART_HR_DISPLAYED_PERSON_NAME),
    match: "normalized-exact-name",
    requiredAt: "after-prepare-before-fence",
  },
  scenarios: ["separations-ucpath-termination/pending-sweep-nothing-to-do"],
  checkpoint: "in-memory-only",
  example: {
    stagedPageState: UCPATH_SMART_HR_TERMINATION_STAGED,
    emplId: EidSchema.parse("10800000"),
    observedName: "Deterministic Person",
    selected: ["T002209631"],
    observedAt: "2026-08-13T10:18:00.000Z",
  },
});

export type UcpathPendingSweepPrepareOutput = z.output<typeof UcpathPendingSweepStagingSchema>;
