import { z } from "zod";
import { ProtectedStoreRecordSchema, type ProtectedSettingsApplyInput, type ProtectedStoreRecord } from "./protected-settings.js";
import { SettingsApplyRefusalSchema } from "./settings.js";

/** A protected write has settled in the credential authority; public callers see value-free presence metadata only. */
export const CredentialStoreApplyOutcomeSchema = z.union([
  z.strictObject({ state: z.literal("applied"), record: ProtectedStoreRecordSchema }),
  SettingsApplyRefusalSchema,
]);
export type CredentialStoreApplyOutcome = z.infer<typeof CredentialStoreApplyOutcomeSchema>;

/** The independent, non-database authority for protected settings. */
export interface CredentialStore {
  read(): ProtectedStoreRecord;
  /** Authorized command-path lookup; recovers a stale writer before returning value-free retry time. */
  acceptedAt(commandId: string): string | undefined;
  /** Value-free, read-only ownership retained across failed audits and SQLite restore. */
  ownsCommandId(this: void, commandId: string): boolean;
  apply(input: ProtectedSettingsApplyInput): CredentialStoreApplyOutcome;
  /** Verify the exact most-recent application without performing a write. */
  verifyReplay(input: ProtectedSettingsApplyInput): CredentialStoreApplyOutcome;
}
