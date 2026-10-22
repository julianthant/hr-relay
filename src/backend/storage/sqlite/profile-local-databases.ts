import { createReadonlyAuthoritySnapshot } from "./readonly-authority-snapshot.js";
import { lstatSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { ProfileDatabaseBindingSchema, type ProfileDatabaseBinding } from "../../../models/profiles/profile.js";
import { requireDatabaseSourcePath } from "./recovery-admission.js";
import { AUTHORITY_APPLICATION_ID, CURRENT_AUTHORITY_SCHEMA_VERSION, isSupportedStoppedAuthoritySchemaVersion } from "./migrations.js";
export function countUcsdLoginRows(path: string): number | "unreadable" | "absent" {
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (info === undefined) return "absent";
  if (!info.isFile()) return "unreadable";
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(path, { readOnly: true });
    const rows = z.array(z.object({
      origin_url: z.string().optional(),
      username_value: z.string().optional(),
    })).parse(database.prepare("SELECT origin_url, username_value FROM logins").all());
    return rows.filter((row) => isUcsdIdentity(row.origin_url) || isUcsdIdentity(row.username_value)).length;
  } catch {
    return "unreadable";
  } finally {
    database?.close();
  }
}

function isUcsdIdentity(value: string | undefined): boolean {
  if (value === undefined) return false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "ucsd.edu" || host.endsWith(".ucsd.edu");
  } catch {
    const text = value.toLowerCase();
    return text.endsWith("@ucsd.edu") || text.endsWith(".ucsd.edu");
  }
}


export function readProfileDatabaseBinding(path: string):
  { readonly schemaVersion: 1 | 2 | 3 | 4 | 5 | 6; readonly state: "unbound" } | { readonly schemaVersion: 7; readonly state: "bound"; readonly binding: ProfileDatabaseBinding } {
  requireDatabaseSourcePath(path);
  const before = lstatSync(path, { throwIfNoEntry: false });
  if (before === undefined) throw new Error("profile-database-binding-required");
  if (!before.isFile() || before.nlink !== 1 || (process.getuid !== undefined && before.uid !== process.getuid())
    || (before.mode & 0o022) !== 0) throw new Error("profile-database-identity-invalid");
  const snapshot = createReadonlyAuthoritySnapshot(path);
  try {
    const binding = readProfileDatabaseBindingCopy(snapshot.path);
    snapshot.assertUnchanged();
    const after = lstatSync(path);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs || after.nlink !== 1) throw new Error("profile-database-identity-changed");
    return binding;
  } finally { try { snapshot.assertUnchanged(); } finally { snapshot.dispose(); } }
}

function readProfileDatabaseBindingCopy(path: string):
  { readonly schemaVersion: 1 | 2 | 3 | 4 | 5 | 6; readonly state: "unbound" } | { readonly schemaVersion: 7; readonly state: "bound"; readonly binding: ProfileDatabaseBinding } {
  requireDatabaseSourcePath(path);
  const before = lstatSync(path, { throwIfNoEntry: false });
  if (before === undefined) throw new Error("profile-database-binding-required");
  if (!before.isFile() || before.nlink !== 1 || (process.getuid !== undefined && before.uid !== process.getuid())
    || (before.mode & 0o022) !== 0) throw new Error("profile-database-identity-invalid");
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const version = database.prepare("PRAGMA user_version").get();
    const application = database.prepare("PRAGMA application_id").get();
    if ((version?.user_version !== CURRENT_AUTHORITY_SCHEMA_VERSION && (typeof version?.user_version !== "number" || !isSupportedStoppedAuthoritySchemaVersion(version.user_version)))
      || application?.application_id !== AUTHORITY_APPLICATION_ID) throw new Error("profile-database-schema-mismatch");
    const binding = version.user_version === 7 ? ProfileDatabaseBindingSchema.parse(database.prepare("SELECT installation_id AS installationId,profile_id AS profileId FROM database_states WHERE id=1").get()) : undefined;
    const after = lstatSync(path);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs || after.nlink !== 1) throw new Error("profile-database-identity-changed");
    if (binding === undefined) {
      if (typeof version.user_version !== "number" || !isSupportedStoppedAuthoritySchemaVersion(version.user_version)) throw new Error("profile-database-schema-mismatch");
      return { schemaVersion: version.user_version, state: "unbound" };
    }
    return { schemaVersion: 7, state: "bound", binding };
  } finally { database.close(); }
}

export function assertCanonicalProfileBinding(path: string, expected: ProfileDatabaseBinding): void {
  const actual = readProfileDatabaseBinding(path);
  if (actual.state !== "bound") throw new Error("profile-database-binding-required");
  if (actual.binding.installationId !== expected.installationId || actual.binding.profileId !== expected.profileId) throw new Error("profile-database-binding-mismatch");
}

export function assertProfileRestoreDatabaseBinding(path: string, expected: ProfileDatabaseBinding): void {
  assertCanonicalProfileBinding(path, expected);
}
