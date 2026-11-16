import { createHash } from "node:crypto";
import { ProfileDatabaseBindingSchema, type ProfileDatabaseBinding } from "../../../models/profiles/profile.js";
import { FingerprintSchema } from "../../../rules/identity/ids.js";
import { AUTHORITY_APPLICATION_ID } from "./migrations.js";

export type AuthorityBackupExpectedSource =
  | Readonly<{ kind: "profile"; binding: ProfileDatabaseBinding }>
  | Readonly<{ kind: "unbound-predecessor"; schemaVersion: 1 | 2 | 3 | 4 | 5 | 6; authorityContentFingerprint: string }>;

export function authoritySourceDatabaseIdentity(source: AuthorityBackupExpectedSource): string {
  if (source.kind === "unbound-predecessor") return FingerprintSchema.parse(source.authorityContentFingerprint);
  const binding = ProfileDatabaseBindingSchema.parse(source.binding);
  return createHash("sha256").update(JSON.stringify([AUTHORITY_APPLICATION_ID, binding.installationId, binding.profileId])).digest("hex");
}
