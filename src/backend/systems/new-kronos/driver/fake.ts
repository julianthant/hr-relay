import {
  NewKronosSearchReadSchema,
  NewKronosTimecardReadSchema,
} from "../../../../models/ui/new-kronos-timecard.js";
import type { NewKronosTimecardDriver } from "../../../../models/ui/new-kronos-timecard.js";


export function createDeterministicNewKronosTimecardDriver(input: Readonly<{

  search: unknown;
  timecard?: unknown;
}>): NewKronosTimecardDriver {
  const search = NewKronosSearchReadSchema.parse(input.search);
  const timecard = input.timecard === undefined
    ? undefined
    : NewKronosTimecardReadSchema.parse(input.timecard);
  const driver: NewKronosTimecardDriver = {
    system: "new-kronos" as const,
    async searchEmployee() {
      return search;
    },
    async readSeparationTimecard() {
      if (timecard === undefined) {
        throw new Error(
          "[new-kronos] the deterministic driver was not given a timecard read; a scenario that reaches the "
          + "timecard node must supply one rather than have the driver invent an empty card",
        );
      }
      return timecard;
    },
  };
  return Object.freeze(driver);
}
