import { defineTask } from "../../../../workflow-kit/task.js";
import {
  NewKronosReadSeparationTimecard,
  ReadSeparationTimecardOutputSchema,
} from "../../../../models/systems/new-kronos/read-separation-timecard.js";
import { directIdentifierDisplay } from "../../../../rules/redaction/redaction.js";
import { newKronosDriver } from "../driver-declaration.js";


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
          `the open New Kronos timecard displays employee ${directIdentifierDisplay(read.subject.observedEmployeeId)} `
          + `(name ${directIdentifierDisplay(read.subject.observedDisplayName)}) while the run expected EID ${directIdentifierDisplay(input.emplId)} — `
          + "refusing to attribute this timecard's punches to a different separation.",
          { subject: input.emplId },
        );
      }
      if (read.subject.expectedEid !== input.emplId) {
        return ctx.fail(
          "unexpected-page-state",
          `the New Kronos driver bound expected EID ${directIdentifierDisplay(read.subject.expectedEid)} while the task ran for `
          + `${directIdentifierDisplay(input.emplId)}`,
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
