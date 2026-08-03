import type { Page } from "playwright";
import type { z } from "zod";
import type { CrmReadOnboardingDates } from "../../../domain/contracts/crm/read-onboarding-dates.js";
import type { ReadOnboardingDatesOutput } from "../../../domain/contracts/crm/read-onboarding-dates.js";
import type { CrmReadOnboardingRecord } from "../../../domain/contracts/crm/read-onboarding-record.js";
import type { ReadOnboardingRecordOutput } from "../../../domain/contracts/crm/read-onboarding-record.js";
import type { CrmOnboardingDriver } from "../../../domain/ui/crm-onboarding.js";

export interface CrmOnboardingOperations {
  readonly readOnboardingRecord: (
    page: Page,
    input: z.output<typeof CrmReadOnboardingRecord.input>,
  ) => Promise<ReadOnboardingRecordOutput>;
  readonly readOnboardingDates: (
    page: Page,
    input: z.output<typeof CrmReadOnboardingDates.input>,
  ) => Promise<ReadOnboardingDatesOutput>;
}

/**
 * Owns the raw CRM Page boundary. The supplied operations are the provenance-recorded selector
 * interpreter; neither task implementation can bypass this driver to reach Playwright.
 */
export function createCrmOnboardingDriver(
  page: Page,
  operations: CrmOnboardingOperations,
): CrmOnboardingDriver {
  return Object.freeze({
    system: "crm" as const,
    async readOnboardingRecord(
      input: z.output<typeof CrmReadOnboardingRecord.input>,
    ) {
      return operations.readOnboardingRecord(page, input);
    },
    async readOnboardingDates(
      input: z.output<typeof CrmReadOnboardingDates.input>,
    ) {
      return operations.readOnboardingDates(page, input);
    },
  });
}
