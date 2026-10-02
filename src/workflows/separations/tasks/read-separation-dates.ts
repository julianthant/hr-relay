import { defineTask } from "../../../workflow-kit/task.js";
import {
  ReadSeparationDatesOutputSchema,
  SeparationsReadSeparationDates,
} from "../../../models/workflows/separations/read-separation-dates.js";
import { reconcileSeparationDates } from "../../../rules/separations/separation-dates.js";

/**
 * The write's payload, executed. `no-punch-in-window` is the durable code §4b's
 * answer produces when the card opened and established no worked day — the one
 * arm where legacy proceeds on the Kuali date and writes a "per Kronos
 * timesheet" comment citing a card that showed nothing.
 */
export const readSeparationDatesTask = defineTask(SeparationsReadSeparationDates, {
  sessions: [],
  async run({ input, ctx }) {
    const resolution = reconcileSeparationDates({
      plan: input.plan,
      timekeeperName: input.timekeeperName,
      lastPunchDate: input.lastPunchDate,
      sickDates: input.sickDates,
      holidayDates: input.holidayDates,
      unclassifiedPayCodes: input.unclassifiedPayCodes,
      observedWindow: input.observedWindow,
    });
    if (resolution.state === "refused") {
      return ctx.fail(resolution.code, resolution.reason);
    }
    const output = ReadSeparationDatesOutputSchema.parse(resolution.dates);
    ctx.recordData([
      { direction: "read", field: "lastDayWorked", value: output.lastDayWorked },
      { direction: "read", field: "separationDate", value: output.separationDate },
      { direction: "read", field: "terminationEffectiveDate", value: output.terminationEffectiveDate },
      { direction: "read", field: "kualiLastDayWorked", value: output.kualiLastDayWorked },
      { direction: "read", field: "kualiSeparationDate", value: output.kualiSeparationDate },
      { direction: "read", field: "lastDayWorkedChanged", value: output.lastDayWorkedChanged },
      { direction: "read", field: "separationDateChanged", value: output.separationDateChanged },
      { direction: "read", field: "latestSickDate", value: output.latestSickDate },
      { direction: "read", field: "firstHolidayDate", value: output.firstHolidayDate },
      { direction: "read", field: "latestHolidayDate", value: output.latestHolidayDate },
      { direction: "read", field: "separationDeterminingLeave", value: output.separationDeterminingLeave },
      { direction: "read", field: "unclassifiedPayCodes", value: output.unclassifiedPayCodes },
      { direction: "read", field: "terminationComments", value: output.terminationComments },
      { direction: "read", field: "dateChangeComments", value: output.dateChangeComments },
      { direction: "read", field: "source", value: output.source },
    ]);
    return output;
  },
});
