import { createReadonlyAuthoritySnapshot } from "./readonly-authority-snapshot.js";
import { lstatSync, type BigIntStats } from "node:fs";
import { spawnSync } from "node:child_process";
import { workerBootstrapEnvironment } from "../../../models/config/secrets.js";
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
  { readonly schemaVersion: 1 | 2 | 3 | 4 | 5 | 6; readonly state: "unbound" } | { readonly schemaVersion: 7 | 8; readonly state: "bound"; readonly binding: ProfileDatabaseBinding } {
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
  { readonly schemaVersion: 1 | 2 | 3 | 4 | 5 | 6; readonly state: "unbound" } | { readonly schemaVersion: 7 | 8; readonly state: "bound"; readonly binding: ProfileDatabaseBinding } {
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
    const boundVersion = z.union([z.literal(7), z.literal(8)]).safeParse(version.user_version);
    const binding = boundVersion.success ? ProfileDatabaseBindingSchema.parse(database.prepare("SELECT installation_id AS installationId,profile_id AS profileId FROM database_states WHERE id=1").get()) : undefined;
    const after = lstatSync(path);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs || after.nlink !== 1) throw new Error("profile-database-identity-changed");
    if (binding === undefined) {
      if (typeof version.user_version !== "number" || !isSupportedStoppedAuthoritySchemaVersion(version.user_version) || version.user_version >= 7) throw new Error("profile-database-schema-mismatch");
      return { schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]).parse(version.user_version), state: "unbound" };
    }
    return { schemaVersion: z.union([z.literal(7), z.literal(8)]).parse(version.user_version), state: "bound", binding };
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

// Source SQLite descriptors belong to the observer process, never a live writer process.
const liveBindingScript = `
const { DatabaseSync } = require("node:sqlite");
const { constants, openSync, closeSync, lstatSync, fstatSync, readSync } = require("node:fs");
const { dirname } = require("node:path");
const [path, expected, schema, application] = process.argv.slice(1);
const identity = stats => [stats.dev, stats.ino, stats.mode, stats.uid, stats.nlink].join(":");
const inspect = file => {
  const stats = lstatSync(file, { bigint: true, throwIfNoEntry: false });
  if (stats === undefined) return undefined;
  if (!stats.isFile() || stats.nlink !== 1n || (stats.mode & 0o022n) !== 0n
    || typeof process.getuid === "function" && stats.uid !== BigInt(process.getuid())) throw new Error("profile-database-identity-invalid");
  return stats;
};
const checkWalHeader = (file, stats) => {
  if (stats.size === 0n) return;
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (identity(fstatSync(descriptor, { bigint: true })) !== identity(stats)) throw new Error("profile-database-identity-changed");
    const header = Buffer.alloc(32);
    if (readSync(descriptor, header, 0, header.length, 0) !== header.length) throw new Error("profile-database-companion-malformed");
    const magic = header.readUInt32BE(0), version = header.readUInt32BE(4), pageSize = header.readUInt32BE(8);
    if ((magic !== 0x377f0682 && magic !== 0x377f0683) || version !== 3007000
      || pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0) throw new Error("profile-database-companion-malformed");
    let first = 0, second = 0;
    const word = offset => magic === 0x377f0682 ? header.readUInt32LE(offset) : header.readUInt32BE(offset);
    for (let offset = 0; offset < 24; offset += 8) {
      first = (first + word(offset) + second) >>> 0;
      second = (second + word(offset + 4) + first) >>> 0;
    }
    if (header.readUInt32BE(24) !== first || header.readUInt32BE(28) !== second) throw new Error("profile-database-companion-malformed");
    const current = inspect(file);
    if (current === undefined || identity(current) !== identity(stats)) throw new Error("profile-database-identity-changed");
  } finally { closeSync(descriptor); }
};
const check = descriptor => {
  let ancestor = dirname(path);
  for (;;) {
    if (!lstatSync(ancestor).isDirectory()) throw new Error("profile-database-identity-invalid");
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const main = inspect(path);
  if (main === undefined) throw new Error("profile-database-binding-required");
  if (identity(main) !== expected || descriptor !== undefined && identity(fstatSync(descriptor, { bigint: true })) !== expected)
    throw new Error("profile-database-identity-changed");
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const companion = inspect(path + suffix);
    if (suffix === "-wal" && companion !== undefined) checkWalHeader(path + suffix, companion);
    if (suffix === "-journal" && companion !== undefined && companion.size > 0n) throw new Error("authority-readonly-source-journal-unsettled");
  }
};
let descriptor, database, result;
try {
  try {
    check();
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    check(descriptor);
    database = new DatabaseSync(path, { readOnly: true, allowExtension: false, defensive: true, timeout: 250 });
    database.exec("PRAGMA query_only=ON; BEGIN");
    const version = database.prepare("PRAGMA user_version").get().user_version;
    const app = database.prepare("PRAGMA application_id").get().application_id;
    if (version !== Number(schema) || app !== Number(application)) throw new Error("profile-database-schema-mismatch");
    const binding = database.prepare("SELECT installation_id AS installationId,profile_id AS profileId FROM database_states WHERE id=1").get();
    database.exec("COMMIT");
    check(descriptor);
    result = { state: "bound", binding };
  } finally {
    try { database?.close(); }
    finally { if (descriptor !== undefined) closeSync(descriptor); }
  }
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stdout.write(JSON.stringify({ state: "refused", message: error.message }));
  process.exitCode = 1;
}
`;

export function assertLiveProfileDatabaseBinding(path: string, expected: ProfileDatabaseBinding): void {
  requireDatabaseSourcePath(path);
  const before = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  if (before === undefined) throw new Error("profile-database-binding-required");
  if (!before.isFile() || before.nlink !== 1n || (before.mode & 0o022n) !== 0n
    || process.getuid !== undefined && before.uid !== BigInt(process.getuid())) throw new Error("profile-database-identity-invalid");
  const identity = (stats: BigIntStats) => [stats.dev, stats.ino, stats.mode, stats.uid, stats.nlink].join(":");
  const witness = identity(before);
  const observed = spawnSync(process.execPath, ["--input-type=commonjs", "-e", liveBindingScript, path, witness,
    String(CURRENT_AUTHORITY_SCHEMA_VERSION), String(AUTHORITY_APPLICATION_ID)],
  { encoding: "utf8", maxBuffer: 64 * 1024, env: workerBootstrapEnvironment() });
  if (observed.error !== undefined || observed.signal !== null) throw new Error("profile-database-observation-failed", {
    cause: observed.error ?? { status: observed.status, signal: observed.signal },
  });
  if (observed.status !== 0) {
    const refusal = z.strictObject({ state: z.literal("refused"), message: z.string() }).parse(JSON.parse(observed.stdout));
    throw new Error(refusal.message);
  }
  const result = z.strictObject({ state: z.literal("bound"), binding: ProfileDatabaseBindingSchema }).parse(JSON.parse(observed.stdout));
  requireDatabaseSourcePath(path);
  const after = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  if (after === undefined || identity(after) !== witness) throw new Error("profile-database-identity-changed");
  if (result.binding.installationId !== expected.installationId || result.binding.profileId !== expected.profileId) throw new Error("profile-database-binding-mismatch");
}
