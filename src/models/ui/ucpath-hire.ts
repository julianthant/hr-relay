import { z } from "zod";
import { sha256Hex } from "../../rules/validation/sha256.js";
import { isHireNameForm } from "../../rules/ucpath/hire-name.js";
import { HireEmployeeSchema } from "../people/hire-employee.js";
import { I9RecordIdsSchema } from "../systems/i9/read-section2-signer.js";
import { UcpathApprovalStatusSchema, UcpathTransactionReceiptSchema } from "./ucpath-ss-smart-hr.js";
import { EidSchema, FingerprintSchema, IsoInstantSchema, ObservationIdSchema, PageStateIdSchema } from "../../rules/identity/ids.js";
import { containsDryRunSample } from "../workflow/dry-run.js";
import { probeVerdictSchema } from "../../rules/write-safety/write-safety-primitives.js";
import type { MutationCapability } from "./driver.js";

export const UCPATH_HIRE_SUBJECT = ObservationIdSchema.parse("ucpath.hire.displayed-name");
export const UCPATH_HIRE_STAGED = PageStateIdSchema.parse("ucpath.hire.staged");
export const UcpathHireIdentitySchema = z.strictObject({ employee: HireEmployeeSchema, expectedName: z.string().min(1) });
export type UcpathHireIdentity = z.infer<typeof UcpathHireIdentitySchema>;
export const UcpathHireQuerySchema = UcpathHireIdentitySchema.extend({
  mode: z.enum(["new-hire", "rehire"]), emplId: EidSchema.nullable(),
}).refine(value => isHireNameForm(value.employee, value.expectedName))
  .refine(value => value.mode === "rehire" ? value.emplId !== null : value.emplId === null);
export const UcpathHireTargetSchema = UcpathHireQuerySchema.safeExtend({
  profileId: I9RecordIdsSchema.shape.profileId.nullable(), comments: z.string().min(1),
}).refine(value => value.mode === "new-hire" ? value.profileId !== null : value.profileId === null);
export type UcpathHireQuery = z.infer<typeof UcpathHireQuerySchema>;
export type UcpathHireTarget = z.infer<typeof UcpathHireTargetSchema>;

export const UcpathHireFindingSchema = z.strictObject({
  transactionId: UcpathTransactionReceiptSchema, approvalStatus: UcpathApprovalStatusSchema,
  profileId: I9RecordIdsSchema.shape.profileId.nullable(),
  action: z.enum(["HIR", "REH"]), displayedName: z.string().min(1), emplId: EidSchema.nullable(),
  effectiveDate: HireEmployeeSchema.shape.effectiveDate, positionNumber: HireEmployeeSchema.shape.positionNumber,
  email: z.email(), dob: HireEmployeeSchema.shape.dob, detailVerified: z.literal(true),
});
export type UcpathHireFinding = z.infer<typeof UcpathHireFindingSchema>;
export const UcpathHireScanSchema = z.strictObject({
  state: z.enum(["complete", "incomplete"]), rows: z.array(UcpathHireFindingSchema).max(300),
  queryDigest: FingerprintSchema, observedAt: IsoInstantSchema, source: z.literal("ss-smart-hr-list-and-detail"),
}).refine(scan => new Set(scan.rows.map(row => row.transactionId)).size === scan.rows.length)
  .refine(scan => scan.state !== "complete" || scan.rows.length < 300);
export type UcpathHireScan = z.infer<typeof UcpathHireScanSchema>;
export const UcpathHireProofSchema = UcpathHireFindingSchema.extend({ kind: z.literal("ucpath-hire"),
  approvalStatus: z.enum(["Pending", "Approved", "Manually Processed"]), source: z.literal("ss-smart-hr-detail-read"),
}).refine(value => !containsDryRunSample(value), "Preview samples cannot prove a filed hire");
export type UcpathHireProof = z.infer<typeof UcpathHireProofSchema>;
export const UcpathHireVerdictSchema = probeVerdictSchema(UcpathHireProofSchema);
export const UcpathHireStagingSchema = z.strictObject({
  stagedPageState: z.literal(UCPATH_HIRE_STAGED), observedName: z.string().min(1), transactionIdDisplay: z.literal("NEW"),
  template: z.enum(["UC_FULL_HIRE", "UC_CONC_HIRE"]), reason: z.enum(["Hire - No Prior UC Affiliation", "Concurrent Hire - Non Dual Emp"]),
});
export type UcpathHireStaging = z.infer<typeof UcpathHireStagingSchema>;
export interface UcpathHireDriver {
  readHireSubject(): Promise<string>;
  scanHireTransactions(input: UcpathHireIdentity): Promise<UcpathHireScan>;
  stageHire(input: UcpathHireTarget, capture: () => Promise<void>): Promise<UcpathHireStaging>;
  submitHire(capability: MutationCapability): Promise<UcpathHireProof>;
}
export function ucpathHireKey(input: UcpathHireQuery): string {
  return ["ucpath:hire", input.employee.email.toLowerCase(), input.employee.effectiveDate,
    input.employee.positionNumber].join("|");
}
export const UCPATH_HIRE_PROOF_EXAMPLE = UcpathHireProofSchema.parse({
  kind: "ucpath-hire", transactionId: "T009000001", approvalStatus: "Pending", profileId: "900001", action: "HIR", displayedName: "Fixture Hire", emplId: null,
  effectiveDate: "09/11/2026", positionNumber: "12345678", email: "hire@example.test", dob: "2000-01-14", detailVerified: true,
  source: "ss-smart-hr-detail-read",
});

export function ucpathHireSearchDigest(employee: { readonly firstName: string; readonly lastName: string }) {
  return FingerprintSchema.parse(sha256Hex(`ucpath:hire:name:${JSON.stringify([employee.firstName, employee.lastName])}`));
}
