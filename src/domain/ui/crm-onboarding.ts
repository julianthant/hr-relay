import type { z } from "zod";
import type {
  ReadOnboardingDatesOutput,
} from "../contracts/crm/read-onboarding-dates.js";
import type {
  CrmReadOnboardingRecord,
  ReadOnboardingRecordOutput,
} from "../contracts/crm/read-onboarding-record.js";
import type { CrmReadOnboardingDates } from "../contracts/crm/read-onboarding-dates.js";

/**
 * CRM's task-facing semantic surface. Raw browser primitives remain in the store's driver folder;
 * the contract-bound methods here are the only operations Person Lookup tasks can invoke.
 */
export interface CrmOnboardingDriver {
  readonly system: "crm";
  readOnboardingRecord(
    input: z.output<typeof CrmReadOnboardingRecord.input>,
  ): Promise<ReadOnboardingRecordOutput>;
  readOnboardingDates(
    input: z.output<typeof CrmReadOnboardingDates.input>,
  ): Promise<ReadOnboardingDatesOutput>;
}
