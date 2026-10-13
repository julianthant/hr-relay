import type { CrmDiscoveredRecord } from "../../../../models/systems/crm/search-onboarding-records.js";
import {
  ReadOnboardingDatesOutputSchema,
  type ReadOnboardingDatesOutput,
} from "../../../../models/systems/crm/read-onboarding-dates.js";
import {
  ReadOnboardingRecordOutputSchema,
  type ReadOnboardingRecordOutput,
} from "../../../../models/systems/crm/read-onboarding-record.js";
import { EidSchema } from "../../../../rules/identity/ids.js";
import {
  CRM_ONBOARDING_DISPLAYED_EID,
  CrmSubjectBindingSchema,
} from "../../../../models/ui/crm-onboarding.js";
import type { CrmOnboardingDriver } from "../../../../models/ui/crm-onboarding.js";

export function createDeterministicCrmOnboardingDriver(input: Readonly<{
  record: ReadOnboardingRecordOutput;
  discovery?: readonly CrmDiscoveredRecord[];
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
    async searchOnboardingRecords() {
      if (input.discovery !== undefined) return [...input.discovery];
      throw new Error("CRM fixture requires explicit discovery records");
    },
    async verifyOnboardingRecord(request) { return request; },
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
      if (request.name === undefined) return { binding: { state: "not-read", expectedEid: request.eid }, output: { emplId: request.eid, state: "no-confident-record", employmentDate: null, oathDate: null, reason: "No confident CRM record" } };
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
