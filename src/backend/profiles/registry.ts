import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  CREDENTIAL_DIRECTORY_MODE,
  noSymlinkAncestry,
  createPrivateLock,
  readPrivateFile,
  removeExactPath,
  ensureChildDirectory,
  fsyncPath,
  replacePrivateFile,
  statDirectory,
  writePrivateStage,
  type DirectoryIdentity,
} from "../storage/configuration/credential-safe-file.js";
import {
  ProfileRegistryDocumentSchema,
  ProfileRegistryRowSchema,
  deriveProfileNames,
  type ProfileRegistryDocument,
  type ProfileRegistryRow,
} from "../../models/profiles/profile.js";
import { systemClock } from "../../rules/time/clock.js";
import { observeProcessIdentity } from "../storage/sqlite/runtime-process-locks.js";
import { encodePrivate } from "../../rules/validation/private-equal.js";

export interface CreateProfileInput {
  readonly firstName: string;
  readonly lastName: string;
  readonly createdAt: string;
  readonly profileId?: string;
  readonly migratedFromLegacy?: true;
}

function registryPath(machineRoot: string): { readonly directory: string; readonly path: string } {
  const directory = join(machineRoot, "machine");
  return { directory, path: join(directory, "profiles.json") };
}

const RegistryVersionSchema = z.strictObject({ schemaVersion: z.literal(2) });

export class ProfileRegistryAuthorityError extends Error {
  readonly code = "PROFILE_AUTHORITY_UNAVAILABLE";
  constructor() { super("profile registry authority is unavailable"); this.name = "ProfileRegistryAuthorityError"; }
}

function readRegistry(path: string): ProfileRegistryDocument {
  try {
    noSymlinkAncestry(dirname(path), new Map());
    const version = readPrivateFile(join(dirname(path), "profile-registry-version.json"), { label: "lock", maxBytes: 128 });
    if (version === undefined) throw new ProfileRegistryAuthorityError();
    RegistryVersionSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(version.bytes)));
    const file = readPrivateFile(path, { label: "lock", maxBytes: 1_048_576 });
    if (file === undefined) throw new Error("profile registry is missing");
    const parsed = ProfileRegistryDocumentSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)));
    return parsed;
  } catch {
    throw new ProfileRegistryAuthorityError();
  }
}

function ensureProfileRoot(root: string, profileId: string): string {
  const profilesDirectory = join(root, "profiles");
  ensureChildDirectory(root, profilesDirectory, "profiles", CREDENTIAL_DIRECTORY_MODE, CREDENTIAL_DIRECTORY_MODE);
  const profileRoot = join(profilesDirectory, profileId);
  ensureChildDirectory(profilesDirectory, profileRoot, "profile root", CREDENTIAL_DIRECTORY_MODE, CREDENTIAL_DIRECTORY_MODE);
  statDirectory(profileRoot, "profile root", CREDENTIAL_DIRECTORY_MODE);
  return profileRoot;
}

function writeRegistry(machineRoot: string, document: ProfileRegistryDocument): void {
  const { directory, path } = registryPath(machineRoot);
  ensureChildDirectory(machineRoot, directory, "profile registry", CREDENTIAL_DIRECTORY_MODE, CREDENTIAL_DIRECTORY_MODE);
  const stage = join(directory, `.profiles.${randomUUID()}.tmp`);
  writePrivateStage(stage, encodePrivate(ProfileRegistryDocumentSchema.parse(document)));
  replacePrivateFile(stage, path);
  fsyncPath(directory);
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

export function createProfileRegistry(machineRoot: string) {
  const root = z.string().min(1).parse(machineRoot);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  withProfileLock(root, () => {
    const { path, directory } = registryPath(root);
    try {
      const file = readPrivateFile(path, { label: "lock", maxBytes: 1_048_576 });
      const versionPath = join(directory, "profile-registry-version.json");
      const version = readPrivateFile(versionPath, { label: "lock", maxBytes: 128 });
      if (version !== undefined) {
        RegistryVersionSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(version.bytes)));
        readRegistry(path);
        return;
      }
      let current: ProfileRegistryDocument;
      if (file === undefined) {
        if ((existsSync(join(root, "profiles")) && readdirSync(join(root, "profiles")).length > 0)
          || existsSync(join(root, "machine", "profile-verifiers.json"))
          || existsSync(join(root, "machine", "operations"))) throw new ProfileRegistryAuthorityError();
        current = { schemaVersion: 2, profiles: [], activeProfileId: null, sessionGeneration: 0 };
      } else {
        const prior = z.strictObject({ schemaVersion: z.literal(1), profiles: z.array(ProfileRegistryRowSchema) })
          .parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)));
        current = { schemaVersion: 2, profiles: prior.profiles, activeProfileId: null, sessionGeneration: 0 };
      }
      writePrivateStage(versionPath, encodePrivate({ schemaVersion: 2 }));
      fsyncPath(directory);
      writeRegistry(root, current);
    } catch { throw new ProfileRegistryAuthorityError(); }
  }, ".profile-registry.lock");
  return Object.freeze({
    read(): ProfileRegistryDocument {
      return readRegistry(registryPath(root).path);
    },
    create(input: CreateProfileInput): ProfileRegistryRow {
      return withProfileLock(root, () => {
        const names = deriveProfileNames(input.firstName, input.lastName);
        const profileId = z.uuid().parse(input.profileId ?? randomUUID());
        const current = readRegistry(registryPath(root).path);
        if (current.profiles.some((row) => row.profileId === profileId)) {
          throw new Error("profile registry already contains that profile");
        }
        const row = ProfileRegistryRowSchema.parse({
          profileId,
          ...names,
          createdAt: input.createdAt,
          lastSignedInAt: input.createdAt,
          credentialState: "saved",
          duoState: "not-set-up",
          lifecycle: "ready",
          ...(input.migratedFromLegacy === true ? { migratedFromLegacy: true } : {}),
        });
        writeRegistry(root, { ...current, profiles: [...current.profiles, row] });
        ensureProfileRoot(root, profileId);
        return row;
      }, ".profile-registry.lock");
    },
    ensureRoot(profileId: string): string {
      return ensureProfileRoot(root, z.uuid().parse(profileId));
    },
    update(profileId: string, patch: Partial<Pick<ProfileRegistryRow, "credentialState" | "duoState" | "lastSignedInAt" | "lifecycle">>): ProfileRegistryRow {
      return withProfileLock(root, () => {
        const id = z.uuid().parse(profileId);
        const current = readRegistry(registryPath(root).path);
        const index = current.profiles.findIndex((row) => row.profileId === id);
        const existing = current.profiles[index];
        if (existing === undefined) throw new Error("profile registry does not contain that profile");
        const row = ProfileRegistryRowSchema.parse({ ...existing, ...patch });
        const profiles = current.profiles.slice();
        profiles[index] = row;
        writeRegistry(root, { ...current, profiles });
        return row;
      }, ".profile-registry.lock");
    },
    advanceSession(profileId: string | null): number {
      return withProfileLock(root, () => {
        const current = readRegistry(registryPath(root).path);
        if (profileId !== null && !current.profiles.some(row => row.profileId === profileId)) throw new Error("profile selection is unavailable");
        const next = ProfileRegistryDocumentSchema.parse({ ...current, activeProfileId: profileId, sessionGeneration: current.sessionGeneration + 1 });
        writeRegistry(root, next);
        return next.sessionGeneration;
      }, ".profile-registry.lock");
    },
    profileRoot(profileId: string): string {
      return join(root, "profiles", z.uuid().parse(profileId));
    },
  });
}
