import {
  ReadOnboardingDatesOutputSchema,
  type ReadOnboardingDatesOutput,
} from "../../../domain/contracts/crm/read-onboarding-dates.js";
import {
  ReadOnboardingRecordOutputSchema,
  type ReadOnboardingRecordOutput,
} from "../../../domain/contracts/crm/read-onboarding-record.js";
import { EidSchema } from "../../../domain/ids.js";
import {
  CRM_ONBOARDING_DISPLAYED_EID,
  CrmSubjectBindingSchema,
} from "../../../domain/ui/crm-onboarding.js";
import type { CrmOnboardingDriver } from "../../../domain/ui/crm-onboarding.js";

export function createDeterministicCrmOnboardingDriver(input: Readonly<{
  record: ReadOnboardingRecordOutput;
  dates: ReadOnboardingDatesOutput;
  recordObservedEid?: string;
  datesObservedEid?: string;
  datesBindingState?: "displayed-record" | "absent-query";
}>): CrmOnboardingDriver {
  const record = ReadOnboardingRecordOutputSchema.parse(input.record);
  const dates = ReadOnboardingDatesOutputSchema.parse(input.dates);
  const recordObservedEid = input.recordObservedEid === undefined
    ? undefined
    : EidSchema.parse(input.recordObservedEid);
  const datesObservedEid = input.datesObservedEid === undefined
    ? undefined
    : EidSchema.parse(input.datesObservedEid);
  const driver: CrmOnboardingDriver = {
    system: "crm" as const,
    async readOnboardingRecord(request) {
      return {
        binding: CrmSubjectBindingSchema.parse(record.state === "found"
          ? {
              state: "displayed-record",
              observationId: CRM_ONBOARDING_DISPLAYED_EID,
              expectedEid: request.eid,
              observedEid: recordObservedEid ?? request.eid,
            }
          : {
              state: "absent-query",
              expectedEid: request.eid,
              queriedEid: request.eid,
            }),
        output: record,
      };
    },
    async readOnboardingDates(request) {
      return {
        binding: CrmSubjectBindingSchema.parse(input.datesBindingState === "absent-query"
          ? {
              state: "absent-query",
              expectedEid: request.eid,
              queriedEid: request.eid,
            }
          : {
              state: "displayed-record",
              observationId: CRM_ONBOARDING_DISPLAYED_EID,
              expectedEid: request.eid,
              observedEid: datesObservedEid ?? request.eid,
            }),
        output: dates,
      };
    },
  };
  return Object.freeze(driver);
}
