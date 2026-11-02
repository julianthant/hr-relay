import type { RuntimeAdmission } from "../storage/admission/admission.js";
import { join } from "node:path";
import { z } from "zod";
import {
  CREDENTIAL_DIRECTORY_MODE,
  noSymlinkAncestry,
  readPrivateFile,
  withPrivateFileLock,
  ensureChildDirectory,
  statDirectory,
} from "../storage/configuration/credential-safe-file.js";
import {
  advanceProfileRegistryDocument,
  ProfileRegistryRowSchema,
  type ProfileRegistryDocument,
  type ProfileRegistryRow,
} from "../../models/profiles/profile.js";
import { SignUpOperationSchema, type SignUpOperation } from "../../models/profiles/profile.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";



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

export function withProfileLock<T>(machineRoot: string, body: () => T, name: ".profile-ops.lock" | ".profile-registry.lock" = ".profile-ops.lock"): T {
  const directory = join(machineRoot, "machine");
  noSymlinkAncestry(machineRoot, new Map());
  ensureChildDirectory(machineRoot, directory, "profile registry", CREDENTIAL_DIRECTORY_MODE, CREDENTIAL_DIRECTORY_MODE);
  return withPrivateFileLock(directory, name, body);
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
    read(): ProfileRegistryDocument {
      return read();
    },
    publishSignUp(operation: SignUpOperation, profile: RuntimeAdmission): ProfileRegistryRow {
      return withProfileLock(root, () => {
        read();
        const file = readPrivateFile(join(root, "machine", "operations", `${operation.operationId}.json`), { label: "lock", maxBytes: 1_048_576 });
        if (file === undefined) throw new ProfileRegistryAuthorityError();
        const pending = SignUpOperationSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)));
        if (canonicalJsonStringify(pending) !== canonicalJsonStringify(operation)) throw new Error("profile-signup-intent-mismatch");
        admission.publishProfileRegistration(profile, pending);
        const row = read().profiles.find(entry => entry.profileId === pending.profileId);
        if (row === undefined) throw new ProfileRegistryAuthorityError();
        return row;
      }, ".profile-registry.lock");
    },
    ensureRoot(profileId: string): string {
      return ensureProfileRoot(root, z.uuid().parse(profileId));
    },
    update(profileId: string, patch: Partial<Pick<ProfileRegistryRow, "lastSignedInAt" | "lifecycle">>): ProfileRegistryRow {
      return withProfileLock(root, () => {
        const id = z.uuid().parse(profileId);
        const current = read();
        const index = current.profiles.findIndex((row) => row.profileId === id);
        const existing = current.profiles[index];
        if (existing === undefined) throw new Error("profile registry does not contain that profile");
        const row = ProfileRegistryRowSchema.parse({ ...existing, ...patch });
        const profiles = current.profiles.slice();
        profiles[index] = row;
        write(advanceProfileRegistryDocument(current, { profiles }));
        return row;
      }, ".profile-registry.lock");
    },
    advanceSession(profileId: string | null): number {
      return withProfileLock(root, () => {
        const current = read();
        if (profileId !== null && !current.profiles.some(row => row.profileId === profileId)) throw new Error("profile selection is unavailable");
        const next = advanceProfileRegistryDocument(current, { activeProfileId: profileId, sessionGeneration: current.sessionGeneration + 1 });
        write(next);
        return next.sessionGeneration;
      }, ".profile-registry.lock");
    },
    profileRoot(profileId: string): string {
      return join(root, "profiles", z.uuid().parse(profileId));
    },
  });
}
