import { defineTask } from "../../../base/task.js";
import {
  NewKronosReadSeparationTimecard,
  ReadSeparationTimecardOutputSchema,
} from "../../../domain/contracts/new-kronos/read-separation-timecard.js";
import { newKronosDriver } from "../declaration.js";

/**
 * Ported semantic operation: legacy 1bffbd65,
 * `src/systems/new-kronos/navigate.ts` (`clickGoToTimecard` :445-533,
 * `verifyTimecardEmployee` :554-576, `setDateRange` :1266-1345,
 * `getSeparationTimecardData` :852-894).
 *
 * The driver throws for every mechanical failure — a Go To that never enabled,
 * a menu option that never rendered, a window that did not apply, a virtualized
 * grid that was not fully read — and this task maps those refusals onto the
 * contract's distinct error codes so a failed run's durable
 * `FailureRecord.code` says WHICH thing went wrong. The one thing it never does
 * is turn any of them into an empty timecard: `separations.md` §4b and legacy's
 * own S36/S37 are that mistake, and it is what put a real termination on a
 * timesheet nobody opened.
 */
export const readSeparationTimecardTask = defineTask(
  newKronosDriver,
  NewKronosReadSeparationTimecard,
  {
    sessions: [{ system: "new-kronos", access: "read", session: "reuse-worker" }],
    async run({ input, ctx }) {
      const read = await ctx.driver.readSeparationTimecard({
        employeeId: input.emplId,
        rangeStart: input.rangeStart,
        rangeEnd: input.rangeEnd,
      });

      // S37: the timecard displaying a different person is the wrong-person
      // control, and it fails with BOTH identities named.
      if (!read.subject.matches || read.subject.observedEmployeeId !== input.emplId) {
        return ctx.fail(
          "subject-mismatch",
          `the open New Kronos timecard displays employee ${read.subject.observedEmployeeId} `
          + `(${read.subject.observedDisplayName}) while the run expected EID ${input.emplId} — `
          + "refusing to attribute this timecard's punches to a different separation.",
          { subject: input.emplId },
        );
      }
      if (read.subject.expectedEid !== input.emplId) {
        return ctx.fail(
          "unexpected-page-state",
          `the New Kronos driver bound expected EID ${read.subject.expectedEid} while the task ran for `
          + `${input.emplId}`,
          { subject: input.emplId },
        );
      }
      // S40: the grid is only meaningful on the window it is proved to show.
      if (read.range.requestedStart !== read.range.observedStart
        || read.range.requestedEnd !== read.range.observedEnd) {
        return ctx.fail(
          "timecard-range-not-applied",
          `the New Kronos timecard displays ${read.range.observedStart} - ${read.range.observedEnd} `
          + `(label ${JSON.stringify(read.range.observedLabel)}) while the run requested `
          + `${read.range.requestedStart} - ${read.range.requestedEnd}`,
          { subject: input.emplId },
        );
      }

      const output = ReadSeparationTimecardOutputSchema.parse({
        subject: read.subject,
        range: read.range,
        grid: read.grid,
      });
      ctx.recordData([
        { direction: "read", field: "subject", value: output.subject },
        { direction: "read", field: "range", value: output.range },
        { direction: "read", field: "grid", value: output.grid },
      ]);
      return output;
    },
  },
);
