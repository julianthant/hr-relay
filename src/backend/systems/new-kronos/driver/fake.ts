import {
  NewKronosSearchReadSchema,
  NewKronosTimecardReadSchema,
} from "../../../../models/ui/new-kronos-timecard.js";
import type { NewKronosTimecardDriver } from "../../../../models/ui/new-kronos-timecard.js";

/**
 * A deterministic New Kronos driver for scenarios and unit tests.
 *
 * Both supplied reads are re-parsed through the schemas the live driver
 * returns, so a fixture that the real page could not produce fails here rather
 * than proving a task against a shape that does not exist. The §4b negatives
 * (`no-results`, `no-match`, `no-signal`, a wrong-subject timecard) are ordinary
 * inputs to this factory — refusing them is the TASK's job, and that is exactly
 * what the scenarios assert.
 */
export function createDeterministicNewKronosTimecardDriver(input: Readonly<{
  /**
   * Deliberately `unknown`: a fixture is authored as a plain literal and must
   * be PROVEN by the driver's own schema, not typed into agreement with it.
   */
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
