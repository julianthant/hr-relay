import { lstatSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { StoppedProtectedSettingsApplyInputSchema as ProtectedSettingsApplyInputSchema, StoppedProtectedSettingsNameSchema as ProtectedSettingsNameSchema, StoppedProtectedStoreRecordSchema as ProtectedStoreRecordSchema } from "../configuration/protected-settings-upgrade.js";
import { DuoCredentialFileSchema } from "../../../models/config/duo-credential.js";
import { ChatGptCredentialRecordSchema } from "../configuration/chatgpt-credential-repository.js";
import { readPrivateFile, noSymlinkAncestry, unpublishedDraftAbortMembership } from "../configuration/credential-safe-file.js";
import { file, hash, retainedStorageBackup, SourceRecordSchema, type FlatArchiveSource } from "./existing-data-backup-files.js";

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
export const FlatStartCleanIntentSchema = z.strictObject({
  schemaVersion: z.literal(2), kind: z.literal("flat-start-clean"), installationId: z.uuid(), operationId: z.uuid(),
  sourceDigest: DigestSchema, backup: z.strictObject({ backupPath: z.string(), backupDigest: DigestSchema }),
  credentialLayout: z.literal("flat-plaintext"), pepperDigest: DigestSchema,
  timing: z.strictObject({ launchTimeoutMs: z.number().int().positive(), closeProofMs: z.number().int().positive() }),
  phase: z.enum(["erasing", "publishing", "complete"]), cursor: z.number().int().safe().nonnegative(), pending: z.boolean(),
  result: z.strictObject({ registryDigest: DigestSchema }).optional(),
}).refine(intent => (intent.phase === "complete") === (intent.result !== undefined));
export type FlatStartCleanIntent = z.infer<typeof FlatStartCleanIntentSchema>;

const FlatProtectedSchema = z.strictObject({ schemaVersion: z.literal(2), record: ProtectedStoreRecordSchema,
  history: z.array(z.strictObject({ request: ProtectedSettingsApplyInputSchema,
    setValueIds: z.partialRecord(ProtectedSettingsNameSchema, z.uuid()) })) });

export function assertFlatStartCleanCredentials(source: FlatArchiveSource): void {
  const schemas = { "protected.json": FlatProtectedSchema, "duo-webauthn.json": DuoCredentialFileSchema,
    "chatgpt-account.json": ChatGptCredentialRecordSchema };
  for (const [name, schema] of Object.entries(schemas)) {
    const member = source.members.find(member => member.path === `profile/credentials/${name}`);
    if (member === undefined) continue;
    noSymlinkAncestry(join(source.sourceStateRoot, "credentials"), new Map());
    const observed = readPrivateFile(join(source.sourceStateRoot, "credentials", name), { label: "lock", maxBytes: 16 * 1024 * 1024 });
    if (member.kind !== "file" || observed === undefined || hash(observed.bytes) !== member.digest) throw new Error("flat-start-clean-credential-source-changed");
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(observed.bytes)); }
    catch { throw new Error("flat-start-clean-credential-layout-unsupported"); }
    if (!schema.safeParse(value).success) throw new Error("flat-start-clean-credential-layout-unsupported");
  }
}

export function flatStartCleanPlan(source: FlatArchiveSource) {
  const preserved = new Set(["profile", "profile/artifacts", "profile/locks", "profile/.runtime-owner.json", "profile/artifacts/.runtime-owner.json"]);
  const members = source.members.filter(member => member.path.startsWith("profile/") && member.kind !== "absent" && !preserved.has(member.path));
  return members.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "file" ? -1 : 1;
    const order = left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
    if (left.kind === "directory") return right.path.split("/").length - left.path.split("/").length || order;
    return order;
  });
}

export function readFlatStartCleanSource(workspace: string, installationId: string, intent: FlatStartCleanIntent): FlatArchiveSource {
  FlatStartCleanIntentSchema.parse(intent);
  const reference = retainedStorageBackup(workspace, installationId, intent.backup);
  if (intent.installationId !== installationId || reference === undefined) throw new Error("flat-start-clean-intent-changed");
  const bytes = file(join(dirname(reference.backupPath), "source.json")).bytes;
  const source = SourceRecordSchema.parse(JSON.parse(bytes.toString("utf8")));
  if (source.installationId !== installationId || source.operationId !== intent.operationId || hash(bytes) !== intent.sourceDigest) throw new Error("flat-start-clean-intent-changed");
  const plan = flatStartCleanPlan(source);
  if (intent.cursor > plan.length || intent.cursor === plan.length && intent.pending
    || intent.phase !== "erasing" && (intent.cursor !== plan.length || intent.pending)) throw new Error("flat-start-clean-cursor-invalid");
  return source;
}

export function assertFlatStartCleanFiles(source: FlatArchiveSource, intent: FlatStartCleanIntent): void {
  const plan = flatStartCleanPlan(source), removed = new Set(plan.slice(0, intent.cursor).map(member => member.path));
  const next = intent.pending ? plan[intent.cursor]?.path : undefined;
  const observed = unpublishedDraftAbortMembership(source.sourceStateRoot);
  const entries = new Map(observed.map(member => [member.path === "" ? "profile" : `profile/${member.path}`, member]));
  const paths = new Set(entries.keys());
  for (const member of source.members.filter(member => member.path === "profile" || member.path.startsWith("profile/"))) {
    const present = paths.has(member.path);
    if (removed.has(member.path) || member.kind === "absent") {
      if (present) throw new Error("flat-start-clean-source-changed");
      continue;
    }
    if (!present && member.path === next) continue;
    if (!present) throw new Error("flat-start-clean-source-changed");
    const path = join(source.sourceStateRoot, ...member.path.split("/").slice(1)), info = lstatSync(path);
    if ((info.mode & 0o7777) !== member.mode || info.isDirectory() !== (member.kind === "directory")) throw new Error("flat-start-clean-source-changed");
    if (member.kind === "file") {
      const current = file(path, member.disposition === "copy" ? "managed data" : "lock").bytes;
      if (current.byteLength !== member.size || hash(current) !== member.digest) throw new Error("flat-start-clean-source-changed");
    }
  }
  const known = new Set(source.members.filter(member => member.kind !== "absent").map(member => member.path));
  const publication = new Set(["profile/machine", ...["browser-roots.json", "profile-registry-version.json", "profiles.json", "profile-verifiers.json", "profile-pepper"].map(name => `profile/machine/${name}`)]);
  for (const path of paths) {
    if (intent.phase !== "erasing" && publication.has(path)) {
      const member = entries.get(path);
      if (member === undefined || member.directory !== (path === "profile/machine")
        || (member.mode & 0o7777) !== (member.directory ? 0o700 : 0o600)) throw new Error("flat-start-clean-publication-changed");
      continue;
    }
    if (!known.has(path)) throw new Error("flat-start-clean-membership-changed");
  }
  const control = join(dirname(dirname(source.sourceStateRoot)), ".tracker", "control");
  for (const name of readdirSync(control)) {
    if (["storage-backups", ".installation-mutation.lock", "flat-start-clean.json", `.flat-start-clean-${intent.operationId}.pepper`].includes(name)) continue;
    if (intent.phase !== "erasing" && name === "profile-registry.json") continue;
    for (const member of unpublishedDraftAbortMembership(join(control, name))) {
      const path = member.path === "" ? `control/${name}` : `control/${name}/${member.path}`;
      if (!known.has(path)) throw new Error("flat-start-clean-membership-changed");
    }
  }
  for (const member of source.members) {
    if (member.kind === "absent" || member.disposition !== "copy" || !(member.path === "control" || member.path.startsWith("control/"))) continue;
    const path = join(dirname(dirname(source.sourceStateRoot)), ".tracker", ...member.path.split("/")), info = lstatSync(path, { throwIfNoEntry: false });
    if (info === undefined || info.isDirectory() !== (member.kind === "directory") || (info.mode & 0o7777) !== member.mode) throw new Error("flat-start-clean-control-changed");
    if (member.kind === "file") {
      const current = file(path).bytes;
      if (current.byteLength !== member.size || hash(current) !== member.digest) throw new Error("flat-start-clean-control-changed");
    }
  }
}
