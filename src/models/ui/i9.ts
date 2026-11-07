import { z } from "zod";
import { I9LookupInputSchema, I9RecordIdsSchema, type I9LookupInput, type I9SignerOutput } from "../systems/i9/read-section2-signer.js";
import type { I9CreationDriver } from "./i9-creation.js";

export const I9SearchCriteriaSchema = I9LookupInputSchema.partial().extend({
  profileId: I9RecordIdsSchema.shape.profileId.optional(),
  employeeId: z.string().trim().min(1).optional(),
}).refine(input => input.lastName !== undefined || input.ssn !== undefined || input.profileId !== undefined || input.employeeId !== undefined,
  "I-9 search requires a last name, SSN, profile ID or I-9 employee ID");
export type I9SearchCriteria = z.output<typeof I9SearchCriteriaSchema>;

export const I9SearchRowSchema = z.strictObject({
  lastName: z.string().min(1), firstName: z.string().min(1),
  employer: z.string(), worksite: z.string(),
  profileId: I9RecordIdsSchema.shape.profileId,
  i9Id: z.union([I9RecordIdsSchema.shape.i9Id, z.literal("")]),
  nextAction: z.string(), startDate: z.string(), createdOn: z.string(),
});
export type I9SearchRow = z.output<typeof I9SearchRowSchema>;
export const I9SearchOutputSchema = z.strictObject({ rows: z.array(I9SearchRowSchema), restricted: z.boolean() });
export type I9SearchOutput = z.output<typeof I9SearchOutputSchema>;

export interface I9Driver extends I9CreationDriver {
  readonly system: "i9";
  searchEmployees(input: I9SearchCriteria): Promise<I9SearchOutput>;
  readRecordSummary(record: z.output<typeof I9RecordIdsSchema>): Promise<I9SignerOutput>;
  readSection2Signer(input: I9LookupInput): Promise<I9SignerOutput>;
}
