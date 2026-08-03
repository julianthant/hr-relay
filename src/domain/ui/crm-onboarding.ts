import { z } from "zod";
import {
  CrmReadOnboardingDates,
  ReadOnboardingDatesOutputSchema,
} from "../contracts/crm/read-onboarding-dates.js";
import {
  CrmReadOnboardingRecord,
  ReadOnboardingRecordOutputSchema,
} from "../contracts/crm/read-onboarding-record.js";
import {
  EidSchema,
  ElementIdSchema,
  ObservationIdSchema,
  PageStateIdSchema,
  ScreenIdSchema,
} from "../ids.js";

export const CRM_ONBOARDING_SEARCH_SCREEN = ScreenIdSchema.parse(
  "crm.onboarding.search",
);
export const CRM_ONBOARDING_RECORD_SCREEN = ScreenIdSchema.parse(
  "crm.onboarding.record",
);
export const CRM_ONBOARDING_HISTORY_SCREEN = ScreenIdSchema.parse(
  "crm.onboarding.history",
);

export const CRM_ONBOARDING_SEARCH_RESULT_ROWS = ElementIdSchema.parse(
  "crm.onboarding.search-result-rows",
);
export const CRM_ONBOARDING_SEARCH_RESULT_ROW_CELLS = ElementIdSchema.parse(
  "crm.onboarding.search-result-row-cells",
);
export const CRM_ONBOARDING_SEARCH_RESULT_NAME_LINK = ElementIdSchema.parse(
  "crm.onboarding.search-result-name-link",
);
export const CRM_ONBOARDING_RECORD_FIELD_VALUE = ElementIdSchema.parse(
  "crm.onboarding.record-field-value",
);
export const CRM_ONBOARDING_HISTORY_ROWS = ElementIdSchema.parse(
  "crm.onboarding.history-rows",
);

export const CRM_ONBOARDING_SEARCH_READY = PageStateIdSchema.parse(
  "crm.onboarding.search-ready",
);
export const CRM_ONBOARDING_SEARCH_EMPTY = PageStateIdSchema.parse(
  "crm.onboarding.search-empty",
);
export const CRM_ONBOARDING_RECORD_READY = PageStateIdSchema.parse(
  "crm.onboarding.record-ready",
);
export const CRM_ONBOARDING_HISTORY_READY = PageStateIdSchema.parse(
  "crm.onboarding.history-ready",
);

export const CRM_ONBOARDING_DISPLAYED_EID = ObservationIdSchema.parse(
  "crm.onboarding.displayed-eid",
);

/**
 * A CRM extraction is load-bearing only when the driver proves which displayed
 * person it observed immediately before reading the record. Keeping expected
 * and observed EIDs beside the output prevents a stale open record from being
 * flattened into an apparently valid task result.
 */
export const CrmSubjectBindingSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("displayed-record"),
    observationId: z.literal(CRM_ONBOARDING_DISPLAYED_EID),
    expectedEid: EidSchema,
    observedEid: EidSchema,
  }),
  z.strictObject({
    state: z.literal("absent-query"),
    expectedEid: EidSchema,
    queriedEid: EidSchema,
  }),
]);
export type CrmSubjectBinding = z.infer<typeof CrmSubjectBindingSchema>;

export const CrmOnboardingRecordReadSchema = z.strictObject({
  binding: CrmSubjectBindingSchema,
  output: ReadOnboardingRecordOutputSchema,
});
export type CrmOnboardingRecordRead = z.infer<typeof CrmOnboardingRecordReadSchema>;

export const CrmOnboardingDatesReadSchema = z.strictObject({
  binding: CrmSubjectBindingSchema,
  output: ReadOnboardingDatesOutputSchema,
});
export type CrmOnboardingDatesRead = z.infer<typeof CrmOnboardingDatesReadSchema>;

const ReadOnboardingRecordOperationSchema = z.custom<(
  input: z.output<typeof CrmReadOnboardingRecord.input>,
) => Promise<CrmOnboardingRecordRead>>((value) => typeof value === "function");

const ReadOnboardingDatesOperationSchema = z.custom<(
  input: z.output<typeof CrmReadOnboardingDates.input>,
) => Promise<CrmOnboardingDatesRead>>((value) => typeof value === "function");

/**
 * CRM's task-facing semantic surface. Raw browser primitives remain in the store's driver folder;
 * the contract-bound methods here are the only operations Person Lookup tasks can invoke.
 */
export const CrmOnboardingDriverSchema = z.strictObject({
  system: z.literal("crm"),
  readOnboardingRecord: ReadOnboardingRecordOperationSchema,
  readOnboardingDates: ReadOnboardingDatesOperationSchema,
});
export type CrmOnboardingDriver = z.infer<typeof CrmOnboardingDriverSchema>;
