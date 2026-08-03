import {
  ReadOnboardingDatesOutputSchema,
  type ReadOnboardingDatesOutput,
} from "../../../domain/contracts/crm/read-onboarding-dates.js";
import {
  ReadOnboardingRecordOutputSchema,
  type ReadOnboardingRecordOutput,
} from "../../../domain/contracts/crm/read-onboarding-record.js";
import type { CrmOnboardingDriver } from "../../../domain/ui/crm-onboarding.js";

export function createDeterministicCrmOnboardingDriver(input: Readonly<{
  record: ReadOnboardingRecordOutput;
  dates: ReadOnboardingDatesOutput;
}>): CrmOnboardingDriver {
  const record = ReadOnboardingRecordOutputSchema.parse(input.record);
  const dates = ReadOnboardingDatesOutputSchema.parse(input.dates);
  return Object.freeze({
    system: "crm" as const,
    async readOnboardingRecord() {
      return record;
    },
    async readOnboardingDates() {
      return dates;
    },
  });
}
