/** A deterministic New Kronos driver for scripted runs: one employee, one timecard whose punches are the given days, and no page. */
import {
  NewKronosTimecardDriverSchema,
  NewKronosTimecardReadSchema,
  NewKronosSearchReadSchema,
  NEW_KRONOS_TIMECARD_DISPLAYED_EID,
  type NewKronosTimecardDriver,
} from "../../../../../src/models/ui/new-kronos-timecard.js";
import { EidSchema, IsoInstantSchema } from "../../../../../src/rules/identity/ids.js";

const GRID_COLUMNS = ["Schedule", "In", "Out", "Transfer", "Pay code", "Amount", "Shift", "Daily", "Period", "Absence"] as const;

/** `M/D/YYYY` or `MM/DD/YYYY` as the zero-padded spelling the timecard contracts take. */
function padded(bound: string): string {
  const [month = "", day = "", year = ""] = bound.split("/");
  return `${month.padStart(2, "0")}/${day.padStart(2, "0")}/${year}`;
}

const dayNumber = (bound: string): number => {
  const [month = "", day = "", year = ""] = bound.split("/");
  return Date.UTC(Number(year), Number(month) - 1, Number(day)) / 86_400_000;
};

export function createDeterministicNewKronosDriver(input: Readonly<{
  employeeId: string;
  displayName: string;
  /** Days (`MM/DD/YYYY`, chronological) the employee punched in the window. */
  punchDates: readonly string[];
  now: () => Date;
  /** Called first in every operation, where a script parks the step. */
  hold: () => Promise<void>;
}>): NewKronosTimecardDriver {
  const observedAt = () => IsoInstantSchema.parse(input.now().toISOString());
  const candidate = { displayName: input.displayName, employeeId: input.employeeId };
  return NewKronosTimecardDriverSchema.parse({
    system: "new-kronos",
    async searchEmployee({ employeeId }: Readonly<{ employeeId: string }>) {
      await input.hold();
      if (employeeId !== input.employeeId) throw new Error(`the New Kronos fake holds ${input.employeeId}, not ${employeeId}`);
      return NewKronosSearchReadSchema.parse({ state: "resolved", query: employeeId, totalCount: 1, candidates: [candidate], matched: candidate,
        selectedCount: 1, panelContext: "top-level", observedAt: observedAt() });
    },
    async readSeparationTimecard({ employeeId, rangeStart, rangeEnd }: Readonly<{ employeeId: string; rangeStart: string; rangeEnd: string }>) {
      await input.hold();
      if (employeeId !== input.employeeId) throw new Error(`the New Kronos fake holds ${input.employeeId}, not ${employeeId}`);
      const start = padded(rangeStart), end = padded(rangeEnd);
      const lastPunchDate = input.punchDates.at(-1) ?? null;
      return NewKronosTimecardReadSchema.parse({
        subject: { observationId: NEW_KRONOS_TIMECARD_DISPLAYED_EID, expectedEid: EidSchema.parse(employeeId), observedEmployeeId: employeeId,
          observedDisplayName: input.displayName, matches: true },
        range: { requestedStart: start, requestedEnd: end, observedLabel: `${rangeStart} - ${rangeEnd}`, observedStart: start, observedEnd: end, applied: true },
        grid: { columnHeaders: [...GRID_COLUMNS], scrollSteps: 0, daysCovered: dayNumber(end) - dayNumber(start) + 1, populatedRows: input.punchDates.length,
          lastPunchDate, punchDates: [...input.punchDates], sickDates: [], holidayDates: [], payCodeDays: [], unclassifiedPayCodes: [] },
        observedAt: observedAt(),
      });
    },
  });
}
