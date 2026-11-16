import { z } from "zod";
import { HireEmployeeSchema } from "../people/hire-employee.js";
import { I9RecordIdsSchema } from "../systems/i9/read-section2-signer.js";
import { ObservationIdSchema, PageStateIdSchema } from "../../rules/identity/ids.js";
import { containsDryRunSample } from "../workflow/dry-run.js";
import { probeVerdictSchema } from "../../rules/write-safety/write-safety-primitives.js";
import type { MutationCapability } from "./driver.js";

export const I9_PROFILE_SUBJECT = ObservationIdSchema.parse("i9.profile.displayed-name");
export const I9_SEARCH_RESULTS = ObservationIdSchema.parse("i9.search.results");
export const I9_SEARCH_READ = PageStateIdSchema.parse("i9.search.read");
export const I9_PROFILE_STAGED = PageStateIdSchema.parse("i9.profile.staged");
export const I9_REMOTE_STAGED = PageStateIdSchema.parse("i9.remote.staged");
export const I9ProfileTargetSchema = HireEmployeeSchema.pick({ firstName: true, lastName: true, middleName: true,
  ssn: true, dob: true, email: true, departmentNumber: true }).extend({ expectedName: z.string().min(1) })
  .refine(value => value.expectedName === `${value.firstName} ${value.lastName}`, "I-9 target name must match its legal name");
export type I9ProfileTarget = z.infer<typeof I9ProfileTargetSchema>;
export const I9RemoteTargetSchema = I9ProfileTargetSchema.safeExtend({ profileId: I9RecordIdsSchema.shape.profileId,
  startDate: HireEmployeeSchema.shape.effectiveDate });
export type I9RemoteTarget = z.infer<typeof I9RemoteTargetSchema>;

export const I9ProfileProofSchema = z.strictObject({ kind: z.literal("i9-profile"),
  profileId: I9RecordIdsSchema.shape.profileId, firstName: z.string().min(1), lastName: z.string().min(1),
  dob: HireEmployeeSchema.shape.dob, email: z.email(), departmentNumber: HireEmployeeSchema.shape.departmentNumber,
  source: z.literal("saved-profile-read") }).refine(value => !containsDryRunSample(value), "Preview samples cannot prove a saved profile");
export const I9RemoteProofSchema = z.strictObject({ kind: z.literal("i9-remote-record"),
  ...I9RecordIdsSchema.shape, startDate: HireEmployeeSchema.shape.effectiveDate, email: z.email(),
  source: z.literal("i9-record-read") }).refine(value => !containsDryRunSample(value), "Preview samples cannot prove a saved I-9 record");
export type I9ProfileProof = z.infer<typeof I9ProfileProofSchema>;
export type I9RemoteProof = z.infer<typeof I9RemoteProofSchema>;
export const I9ProfileVerdictSchema = probeVerdictSchema(I9ProfileProofSchema);
export const I9RemoteVerdictSchema = probeVerdictSchema(I9RemoteProofSchema);
export const I9CreationStagingSchema = z.strictObject({ stagedPageState: PageStateIdSchema, observedName: z.string().min(1) });
export type I9CreationStaging = z.infer<typeof I9CreationStagingSchema>;

export function i9ProfileKey(input: I9ProfileTarget): string {
  return ["i9:profile", input.email.toLowerCase(), input.firstName.toLowerCase(), input.lastName.toLowerCase(), input.dob].join("|");
}
export function i9RemoteKey(input: I9RemoteTarget): string {
  return ["i9:remote", input.profileId, input.startDate].join("|");
}

export interface I9CreationDriver {
  read(id: typeof I9_PROFILE_SUBJECT): Promise<string>;
  probeProfile(input: I9ProfileTarget): Promise<z.infer<typeof I9ProfileVerdictSchema>>;
  prepareProfile(input: I9ProfileTarget, capture: () => Promise<void>): Promise<I9CreationStaging>;
  saveProfile(capability: MutationCapability): Promise<I9ProfileProof>;
  probeRemote(input: I9RemoteTarget): Promise<z.infer<typeof I9RemoteVerdictSchema>>;
  prepareRemote(input: I9RemoteTarget, capture: () => Promise<void>): Promise<I9CreationStaging>;
  createRemote(capability: MutationCapability): Promise<I9RemoteProof>;
}

export const I9_PROFILE_EXAMPLE = I9ProfileTargetSchema.parse({
  firstName: "Fixture", lastName: "Hire", middleName: "", expectedName: "Fixture Hire",
  ssn: null, dob: "2000-01-14", email: "hire@example.test", departmentNumber: "000412",
});
export const I9_PROFILE_PROOF_EXAMPLE = I9ProfileProofSchema.parse({ kind: "i9-profile", profileId: "900001",
  firstName: "Fixture", lastName: "Hire", dob: "2000-01-14", email: "hire@example.test",
  departmentNumber: "000412", source: "saved-profile-read" });
export const I9_REMOTE_PROOF_EXAMPLE = I9RemoteProofSchema.parse({ kind: "i9-remote-record", profileId: "900001", i9Id: "900002",
  startDate: "09/11/2026", email: "hire@example.test", source: "i9-record-read" });
