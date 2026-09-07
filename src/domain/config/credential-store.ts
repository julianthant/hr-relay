import { z } from "zod";
import { ProtectedStoreRecordSchema, type ProtectedSettingsApplyInput, type ProtectedStoreRecord } from "./protected-settings.js";
import { SettingsApplyRefusalSchema } from "./settings.js";

/**
 * A protected write has settled in the credential authority. The record stays
 * inside the trusted credential/secret-reader boundary; public callers project
 * it to value-free presence metadata before serialization.
 */
export const CredentialStoreApplyOutcomeSchema = z.union([
  z.strictObject({ state: z.literal("applied"), record: ProtectedStoreRecordSchema }),
  SettingsApplyRefusalSchema,
]);
export type CredentialStoreApplyOutcome = z.infer<typeof CredentialStoreApplyOutcomeSchema>;

/** D336's independent, non-database authority for protected settings. */
export interface CredentialStore {
  read(): ProtectedStoreRecord;
  apply(input: ProtectedSettingsApplyInput): CredentialStoreApplyOutcome;
  /** Verify the exact most-recent application without performing a write. */
  verifyReplay(input: ProtectedSettingsApplyInput): CredentialStoreApplyOutcome;
}
