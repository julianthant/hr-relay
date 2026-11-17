import { OPENABLE_AUTHORITY_SCHEMA_VERSIONS } from "../../models/config/authority-schema-versions.js";
import type { RestoreEligibilitySchema } from "../../models/storage/storage-status.js";
import type { z } from "zod";

export type RestoreEligibility = z.infer<typeof RestoreEligibilitySchema>;

export type RestoreEligibilityFacts = Readonly<{
  schemaVersion: number;
  authorityAvailable: boolean;
  /** Validates the candidate against the current person; asked only once every other fact allows the restore. */
  samePersonValid: () => boolean;
}>;

/** Automatic restore opens these schemas, so the doctor calls the same backups restorable. */
const isRestorable = (version: number) => OPENABLE_AUTHORITY_SCHEMA_VERSIONS.some(openable => openable === version);

export function restoreEligibilityOf(facts: RestoreEligibilityFacts): RestoreEligibility {
  if (!isRestorable(facts.schemaVersion)) return { state: "unsupported", reason: "The backup uses an unsupported authority schema. Preserve it and use its compatible release." };
  if (!facts.authorityAvailable) return { state: "unavailable", reason: "Current authority could not be inspected safely. Preserve it before recovery." };
  if (!facts.samePersonValid()) return { state: "unavailable", reason: "Backup does not prove the current person and installation." };
  return { state: "eligible" };
}
