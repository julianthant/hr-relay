import type { RuntimeAdmission } from "../storage/admission/admission.js";
import { join } from "node:path";
import { z } from "zod";
import {
  CREDENTIAL_DIRECTORY_MODE,
  noSymlinkAncestry,
  createPrivateLock,
  readPrivateFile,
  removeExactPath,
  ensureChildDirectory,
  fsyncPath,
  statDirectory,
  type DirectoryIdentity,
} from "../storage/configuration/credential-safe-file.js";
import {
  ProfileRegistryDocumentSchema,
  ProfileRegistryRowSchema,
  type ProfileRegistryDocument,
  type ProfileRegistryRow,
} from "../../models/profiles/profile.js";
import { SignUpOperationSchema, type SignUpOperation } from "../../models/profiles/profile.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { systemClock } from "../../rules/time/clock.js";
import { observeProcessIdentity } from "../storage/sqlite/runtime-process-locks.js";
import { createCredentialStore, captureCommittedCredentialReplay } from "../storage/configuration/credential-store.js";
import { ProtectedSettingsApplyInputSchema, PROTECTED_SETTINGS_SCHEMA_HASH } from "../../models/config/protected-settings.js";
import { encodePrivate } from "../../rules/validation/private-equal.js";



export class ProfileRegistryAuthorityError extends Error {
  readonly code = "PROFILE_AUTHORITY_UNAVAILABLE";
  constructor(cause?: unknown) { super("profile registry authority is unavailable", { cause }); this.name = "ProfileRegistryAuthorityError"; }
}

function ensureProfileRoot(root: string, profileId: string): string {
  const profilesDirectory = join(root, "profiles");
  ensureChildDirectory(root, profilesDirectory, "profiles", CREDENTIAL_DIRECTORY_MODE, CREDENTIAL_DIRECTORY_MODE);
  const profileRoot = join(profilesDirectory, profileId);
  ensureChildDirectory(profilesDirectory, profileRoot, "profile root", CREDENTIAL_DIRECTORY_MODE, CREDENTIAL_DIRECTORY_MODE);
  statDirectory(profileRoot, "profile root", CREDENTIAL_DIRECTORY_MODE);
  return profileRoot;
}

const ProfileOpLockSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("profile-ops"),
  pid: z.number().int().positive(),
  platform: z.string().min(1),
  startToken: z.string().min(1),
});

function profileLockBytes(): Uint8Array {
  const observation = observeProcessIdentity(process.pid);
  if (observation.state !== "alive") throw new Error("profile operation lock owner is unavailable");
  return encodePrivate(ProfileOpLockSchema.parse({
    schemaVersion: 1,
    kind: "profile-ops",
    pid: process.pid,
    platform: observation.identity.platform,
    startToken: observation.identity.startToken,
  }));
}

function heldByLiveOwner(bytes: Buffer): boolean {
  const parsed = ProfileOpLockSchema.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  if (!parsed.success) throw new Error("profile operation lock is malformed");
  const observation = observeProcessIdentity(parsed.data.pid);
  return observation.state === "alive"
    && observation.identity.platform === parsed.data.platform
    && observation.identity.startToken === parsed.data.startToken;
}

export function withProfileLock<T>(machineRoot: string, body: () => T, name: ".profile-ops.lock" | ".profile-registry.lock" = ".profile-ops.lock"): T {
  const directory = join(machineRoot, "machine");
  noSymlinkAncestry(machineRoot, new Map());
  ensureChildDirectory(machineRoot, directory, "profile registry", CREDENTIAL_DIRECTORY_MODE, CREDENTIAL_DIRECTORY_MODE);
  const path = join(directory, name);
  const bytes = profileLockBytes();
  const deadline = systemClock.monotonicMs() + 10_000;
  let identity: DirectoryIdentity | undefined;
  for (;;) {
    const created = createPrivateLock(path, directory, bytes, () => {
      const file = readPrivateFile(path, { label: "lock", maxBytes: 4_096 });
      return file !== undefined && Buffer.from(file.bytes).equals(Buffer.from(bytes));
    });
    if (created) {
      const own = readPrivateFile(path, { label: "lock", maxBytes: 4_096 });
      if (own === undefined || !own.bytes.equals(Buffer.from(bytes))) throw new Error("profile operation lock changed before acquisition");
      identity = own.identity;
      break;
    }
    const held = readPrivateFile(path, { label: "lock", maxBytes: 4_096 });
    if (held !== undefined && heldByLiveOwner(held.bytes)) {
      if (systemClock.monotonicMs() > deadline) throw new Error("profile operation lock is unavailable");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      continue;
    }
    if (held !== undefined) {
      removeExactPath(path, held.identity, false, "profile operation lock changed before recovery");
      fsyncPath(directory);
    }
  }
  let outcome: { readonly kind: "value"; readonly value: T } | { readonly kind: "error"; readonly error: unknown };
  try { outcome = { kind: "value", value: body() }; }
  catch (error) { outcome = { kind: "error", error }; }
  try {
    const file = readPrivateFile(path, { label: "lock", maxBytes: 4_096 });
    if (file === undefined || identity === undefined || !file.bytes.equals(Buffer.from(bytes))) throw new Error("profile operation lock changed before release");
    removeExactPath(path, identity, false, "profile operation lock changed before release");
    fsyncPath(directory);
  } catch (error) {
    if (outcome.kind === "error") throw new AggregateError([outcome.error, error], "profile operation and lock release failed", { cause: error });
    throw error;
  }
  if (outcome.kind === "error") throw outcome.error;
  return outcome.value;
}

export function createProfileRegistry(admission: RuntimeAdmission) {
  const root = admission.stateRoot;
  const read = () => {
    try { return admission.readProfileRegistry(); }
    catch (error) { throw new ProfileRegistryAuthorityError(error); }
  };
  read();
  const write = (document: ProfileRegistryDocument) => admission.publishProfileRegistry(read(), document);
  return Object.freeze({
    settlementClaim(operationId: string) { return admission.issueProfileSettlementClaim(operationId); },
    storageClaim(profileId: string) {
      return admission.issueRegisteredProfileClaim(profileId);
    },
    read(): ProfileRegistryDocument {
      return read();
    },
    publishSignUp(operation: SignUpOperation, request: unknown): ProfileRegistryRow {
      return withProfileLock(root, () => {
        read();
        const file = readPrivateFile(join(root, "machine", "operations", `${operation.operationId}.json`), { label: "lock", maxBytes: 1_048_576 });
        if (file === undefined) throw new ProfileRegistryAuthorityError();
        const pending = SignUpOperationSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)));
        if (canonicalJsonStringify(pending) !== canonicalJsonStringify(operation)) throw new Error("profile-signup-intent-mismatch");
        const parsed = ProtectedSettingsApplyInputSchema.parse(request);
        if (parsed.commandId !== pending.commandId || parsed.writeId !== pending.writeId || parsed.commandFingerprint !== pending.commandFingerprint
          || parsed.expectedRevision !== pending.expectedRevision || parsed.protectedSchemaHash !== PROTECTED_SETTINGS_SCHEMA_HASH
          || parsed.updatedAt !== pending.createdAt) throw new Error("profile-signup-receipt-mismatch");
        const capability = admission.admitProfile(this.storageClaim(pending.profileId));
        try {
          const store = createCredentialStore({ admission: capability, stateRoot: capability.stateRoot, erasureJournalAdmission: admission,
            erasureJournalPath: join(root, "machine", "erasures", `${pending.profileId}.json`) });
          const witness = captureCommittedCredentialReplay(store, parsed);
          admission.publishProfileRegistration(pending, witness);
        } finally { capability.release(); }
        const row = read().profiles.find(entry => entry.profileId === pending.profileId);
        if (row === undefined) throw new ProfileRegistryAuthorityError();
        return row;
      }, ".profile-registry.lock");
    },
    ensureRoot(profileId: string): string {
      return ensureProfileRoot(root, z.uuid().parse(profileId));
    },
    update(profileId: string, patch: Partial<Pick<ProfileRegistryRow, "credentialState" | "duoState" | "lastSignedInAt" | "lifecycle">>): ProfileRegistryRow {
      return withProfileLock(root, () => {
        const id = z.uuid().parse(profileId);
        const current = read();
        const index = current.profiles.findIndex((row) => row.profileId === id);
        const existing = current.profiles[index];
        if (existing === undefined) throw new Error("profile registry does not contain that profile");
        const row = ProfileRegistryRowSchema.parse({ ...existing, ...patch });
        const profiles = current.profiles.slice();
        profiles[index] = row;
        write({ ...current, profiles });
        return row;
      }, ".profile-registry.lock");
    },
    advanceSession(profileId: string | null): number {
      return withProfileLock(root, () => {
        const current = read();
        if (profileId !== null && !current.profiles.some(row => row.profileId === profileId)) throw new Error("profile selection is unavailable");
        const next = ProfileRegistryDocumentSchema.parse({ ...current, activeProfileId: profileId, sessionGeneration: current.sessionGeneration + 1 });
        write(next);
        return next.sessionGeneration;
      }, ".profile-registry.lock");
    },
    profileRoot(profileId: string): string {
      return join(root, "profiles", z.uuid().parse(profileId));
    },
  });
}
