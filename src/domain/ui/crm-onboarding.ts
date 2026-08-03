import { z } from "zod";
import type {
  ReadOnboardingDatesOutput,
} from "../contracts/crm/read-onboarding-dates.js";
import type {
  CrmReadOnboardingRecord,
  ReadOnboardingRecordOutput,
} from "../contracts/crm/read-onboarding-record.js";
import type { CrmReadOnboardingDates } from "../contracts/crm/read-onboarding-dates.js";
import { EidSchema, ObservationIdSchema } from "../ids.js";

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

export interface CrmSubjectBoundRead<Output> {
  readonly binding: CrmSubjectBinding;
  readonly output: Output;
}

/**
 * CRM's task-facing semantic surface. Raw browser primitives remain in the store's driver folder;
 * the contract-bound methods here are the only operations Person Lookup tasks can invoke.
 */
export interface CrmOnboardingDriver {
  readonly system: "crm";
  readOnboardingRecord(
    input: z.output<typeof CrmReadOnboardingRecord.input>,
  ): Promise<CrmSubjectBoundRead<ReadOnboardingRecordOutput>>;
  readOnboardingDates(
    input: z.output<typeof CrmReadOnboardingDates.input>,
  ): Promise<CrmSubjectBoundRead<ReadOnboardingDatesOutput>>;
}
