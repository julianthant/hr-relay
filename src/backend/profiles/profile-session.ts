import { AuthorityDatabase } from "../storage/sqlite/authority-database.js";
import { randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import {
  createCredentialStore,
  credentialMigrationSource,
  inspectCredentialCopy,
  assertCredentialStoreOwner,
  readForErasure,
  CredentialErasureAuthorityError,
  CredentialStoreCommitUncertainError,
  RESTORE_ADMISSION_REQUEST,
  type CredentialInitializationCopyInspection, type CredentialStoreOptions, type CredentialStoreHooks,
} from "../storage/configuration/credential-store.js";
import { type RuntimeAdmission } from "../storage/admission/admission.js";
import { requireRuntimeAdmission } from "../storage/admission/admission-identity.js";
import {
  PROTECTED_SETTINGS_SCHEMA_HASH,
  ProtectedSettingsApplyInputSchema,
  CompleteProtectedSettingsPatchSchema,
  type CompleteProtectedSettingsPatch,
} from "../../models/config/protected-settings.js";
import { CredentialEraseInputSchema } from "../../models/config/credential-store.js";
import { operatorFailureSentence, type ErrorCatalogCode } from "../../models/failures/error-catalog.js";
import { deriveProfileNames, ProfileNameValidationError, ProfileAuthoritySnapshotSchema, type ProfileAuthoritySnapshot } from "../../models/profiles/profile.js";
import { IsoInstantSchema } from "../../rules/identity/ids.js";
import {
  noSymlinkAncestry,
  type DirectoryIdentity,
} from "../storage/configuration/credential-safe-file.js";
import { assessCredentialInventory, type CredentialInventory } from "./credential-inventory.js";
import { createProfileRegistry, withProfileLock, ProfileRegistryAuthorityError } from "./registry.js";
import { SignUpOperationSchema, LogoutOperationSchema, type SignUpOperation, type LogoutOperation, type ProfileOperation } from "../../models/profiles/profile.js";
import { createProfileVerifiers } from "./verifier-store.js";

import type { ChatGptAccountService } from "../accounts/chatgpt-account-service.js";
import type { CredentialStore } from "../../models/config/credential-store.js";
import type { SettingsRuntimeSnapshot } from "../runtime/settings/settings-runtime.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";

export interface ProfileActivity {
  hasUnquiescedWork(profileId: string): boolean;
  requestCancellation?(profileId: string): void;
}

export interface ActiveProfileSession {
  readonly state: "active";
  readonly token: string;
  readonly epoch: number;
  readonly profileId: string;
}

export interface ProfileRefusal {
  readonly state: "refused";
  readonly code: ErrorCatalogCode;
  readonly message: string;
  readonly operationId?: string;
  readonly request?: string;
}

export class ProfileSessionRefusedError extends Error {
  constructor(readonly code: ErrorCatalogCode) { super(operatorFailureSentence(code)); this.name = "ProfileSessionRefusedError"; }
}

export interface ProfileLogoutResult extends ProfileRefusal {
  readonly inventory?: CredentialInventory;
}

export interface ProfileCancelling {
  readonly state: "cancelling";
  readonly code: ErrorCatalogCode;
  readonly message: string;
  readonly operationId?: string;
}


function refusal(code: ErrorCatalogCode, operationId?: string): ProfileRefusal {
  return { state: "refused", code, message: operatorFailureSentence(code), ...(operationId === undefined ? {} : { operationId }) };
}

function cancelling(operationId?: string): ProfileCancelling {
  return {
    state: "cancelling",
    code: "PROFILE_LOGOUT_BLOCKED",
    message: operatorFailureSentence("PROFILE_LOGOUT_BLOCKED"),
    ...(operationId === undefined ? {} : { operationId }),
  };
}

function restoreAdmission(operationId?: string): ProfileLogoutResult {
  return { ...refusal("PROFILE_RESTORE_ADMISSION_REQUIRED", operationId), request: RESTORE_ADMISSION_REQUEST };
}

function contained(profileRoot: string, candidate: string): string {
  const root = realpathSync(profileRoot);
  const path = resolve(root, candidate);
  const remainder = relative(root, path);
  if (remainder.startsWith("..") || remainder === "") throw new Error("profile path escapes its root");
  return path;
}

function journalOutsideProfile(profileRoot: string, journalPath: string): boolean {
  const root = realpathSync(profileRoot);
  const parent = dirname(journalPath);
  if (!existsSync(parent)) {
    const remainder = relative(root, resolve(journalPath));
    return remainder.startsWith("..") || isAbsolute(remainder);
  }
  const info = lstatSync(parent);
  if (info.isSymbolicLink()) return false;
  const resolved = join(realpathSync(parent), journalPath.slice(parent.length + 1));
  const remainder = relative(root, resolved);
  return remainder.startsWith("..") || isAbsolute(remainder);
}

export function createProfileSession(input: {
  readonly machineRoot: string;
  readonly admission: RuntimeAdmission;
  readonly account?: Pick<ChatGptAccountService, "readAuthority" | "revalidateAuthority">;
  readonly settings?: { read(): SettingsRuntimeSnapshot };
  readonly activity?: ProfileActivity;
  readonly backupPaths?: (profileId: string) => readonly string[];
  readonly loginDataPaths?: (profileId: string) => readonly string[];
  readonly credentialHooks?: CredentialStoreHooks;
  readonly repairInventory?: (admission: RuntimeAdmission, ...args: Parameters<NonNullable<CredentialStoreOptions["repairInventory"]>>) => ReturnType<NonNullable<CredentialStoreOptions["repairInventory"]>>;
  readonly initializationInventory?: (admission: RuntimeAdmission, operation: SignUpOperation, writer: Readonly<{ acquisitionId: string; pid: number }>, copies: CredentialInitializationCopyInspection) => Readonly<{ revalidate(operation: SignUpOperation): () => void; revalidateBeforeKeyIntent(): void }>;
  readonly credentialsFor?: (admission: RuntimeAdmission, purpose: "ordinary" | "settlement") => CredentialStore;
  readonly prepareLogout?: (profileId: string, admission: RuntimeAdmission) => void;
  readonly preparePendingLogout?: (operation: LogoutOperation, admission: RuntimeAdmission, credentials: CredentialStore) => void;
  readonly closeStorage?: (profileId: string, admission: RuntimeAdmission) => void;
  readonly sessionChange?: (profileId: string) => { readonly state: "closed" } | ProfileRefusal | ProfileCancelling;
  readonly credentialInventory?: (input: Readonly<{ profileId: string; admission: RuntimeAdmission; credentials: CredentialStore;
    operationId: string; operation: LogoutOperation; capturedSecrets: readonly string[]; capturedSecretsComplete: boolean }>) => CredentialInventory;
}) {
  const admission = requireRuntimeAdmission(input.admission);
  admission.assertWritable();
  admission.assertStateRoot(input.machineRoot);
  if (admission.stateRoot !== resolve(input.machineRoot)) throw new Error("profile machine root differs from admission");
  mkdirSync(input.machineRoot, { recursive: true, mode: 0o700 });
  const machineRoot = realpathSync(input.machineRoot);
  const registry = createProfileRegistry(admission);
  const verifiers = createProfileVerifiers(machineRoot);
  const sessions = new Map<string, { readonly profileId: string; readonly epoch: number; readonly admission: RuntimeAdmission }>();
  const storageAdmissions = new Map<string, { ordinary?: RuntimeAdmission; settlement?: RuntimeAdmission }>();
  const authoritySnapshots = new WeakSet<ProfileAuthoritySnapshot>();
  let logoutContinuationGeneration = 0;

  function writeOperation(operation: ProfileOperation): void {
    admission.publishProfileOperation(operation);
  }

  function readOperations(): ProfileOperation[] {
    registry.read();
    const directory = join(machineRoot, "machine", "operations");
    if (!existsSync(directory)) return [];
    const operations: ProfileOperation[] = [];
    for (const name of readdirSync(directory)) {
      if (!name.endsWith(".json")) continue;
      const path = join(directory, name);
      const info = lstatSync(path);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("profile operation is malformed");
      const parsed = z.union([SignUpOperationSchema, LogoutOperationSchema]).safeParse(JSON.parse(readFileSync(path, "utf8")));
      if (!parsed.success) throw new Error("profile operation is malformed");
      operations.push(parsed.data);
    }
    return operations;
  }

  function deleteOperation(operationId: string): void {
    admission.publishProfileOperation(operationId);
  }

  function journalPath(profileId: string): string {
    return join(machineRoot, "machine", "erasures", `${profileId}.json`);
  }

  function storeFor(profileId: string, capability = admittedProfile(profileId), purpose: "ordinary" | "settlement" = "ordinary") {
    const profileRoot = registry.profileRoot(profileId);
    const store = input.credentialsFor?.(capability, purpose) ?? createCredentialStore({
      admission: capability,
      erasureJournalAdmission: admission,
      stateRoot: profileRoot,
      erasureJournalPath: journalPath(profileId),
      hooks: input.credentialHooks,
      repairInventory: (request, writer, copies) => {
        const inventory = input.repairInventory?.(capability, request, writer, copies);
        if (inventory === undefined) throw new Error("credential-repair-inventory-required");
        return inventory;
      },
      initializationInventory: (operation, writer, copies) => {
        const inventory = input.initializationInventory?.(capability, operation, writer, copies);
        if (inventory === undefined) throw new Error("credential-initialization-inventory-required");
        return inventory;
      },
    });
    assertCredentialStoreOwner(store, capability);
    return store;
  }

  function releaseOrdinary(profileId: string): void {
    const entry = storageAdmissions.get(profileId), capability = entry?.ordinary;
    if (entry === undefined || capability === undefined) return;
    input.closeStorage?.(profileId, capability);
    capability.release();
    delete entry.ordinary;
    if (entry.settlement === undefined) storageAdmissions.delete(profileId);
  }

  function releaseSettlement(profileId: string): void {
    const entry = storageAdmissions.get(profileId), capability = entry?.settlement;
    if (entry === undefined || capability === undefined) return;
    input.closeStorage?.(profileId, capability);
    capability.release();
    delete entry.settlement;
    if (entry.ordinary === undefined) storageAdmissions.delete(profileId);
  }

  function admittedProfile(profileId: string): RuntimeAdmission {
    admission.assertLive();
    admission.assertStateRoot(machineRoot);
    let capability = storageAdmissions.get(profileId)?.ordinary;
    if (capability === undefined) {
      const claim = registry.storageClaim(profileId);
      capability = admission.admitProfile(claim);
      if (claim.phase === "setup" && !existsSync(join(capability.stateRoot, "state.db"))) AuthorityDatabase.initializeProfile(capability);
      storageAdmissions.set(profileId, { ...storageAdmissions.get(profileId), ordinary: capability });
    }
    if (capability.stateRoot !== registry.profileRoot(profileId)) throw new Error("profile root differs from admission");
    capability.assertStateRoot(capability.stateRoot);
    return capability;
  }

  function requireSession(token: string): { profileId: string; epoch: number; admission: RuntimeAdmission } | ProfileRefusal {
    admission.assertLive();
    const session = sessions.get(token);
    if (session === undefined) return refusal("PROFILE_SESSION_STALE");
    let current;
    try { current = registry.read(); }
    catch (error) {
      if (error instanceof ProfileRegistryAuthorityError) return refusal(error.code);
      throw error;
    }
    const row = current.profiles.find(entry => entry.profileId === session.profileId);
    if (current.activeProfileId !== session.profileId || current.sessionGeneration !== session.epoch
      || row?.lifecycle !== "ready" || row.credentialState !== "saved"
      || readOperations().some(operation => operation.kind === "logout" ? operation.phase !== "complete" : operation.credentialInitialization !== undefined)) {
      sessions.delete(token);
      return refusal("PROFILE_SESSION_STALE");
    }
    session.admission.assertLive();
    admittedProfile(session.profileId);
    return session;
  }

  function activate(profileId: string): ActiveProfileSession {
    admission.assertWritable();
    const profileAdmission = admittedProfile(profileId);
    profileAdmission.assertWritable();
    const epoch = registry.advanceSession(profileId);
    sessions.clear();
    releaseOrdinary(profileId);
    const currentAdmission = admittedProfile(profileId);
    currentAdmission.assertWritable();
    const token = randomUUID();
    sessions.set(token, { profileId, epoch, admission: currentAdmission });
    return { state: "active", token, epoch, profileId };
  }

  function settingsAuthority(snapshot: SettingsRuntimeSnapshot) {
    const active = snapshot.runtimeStatus.state === "current" ? snapshot.runtimeStatus.identity : snapshot.runtimeStatus.active;
    return {
      savedSettingsRevision: snapshot.record.revision, savedSettingsFingerprint: snapshot.record.settingsFingerprint,
      activeSettingsRevision: active.settingsRevision, activeSettingsFingerprint: active.settingsFingerprint, activeConfigFingerprint: active.configFingerprint,
    };
  }

  async function readCurrentAuthority(token: string): Promise<{ readonly state: "available"; readonly snapshot: ProfileAuthoritySnapshot } | ProfileRefusal> {
    const session = requireSession(token);
    if ("state" in session) return session;
    if (input.account === undefined || input.settings === undefined) return refusal("PROFILE_AUTHORITY_UNAVAILABLE");
    const store = storeFor(session.profileId);
    const settings = settingsAuthority(input.settings.read());
    const protectedRevision = store.read().revision;
    const account = await input.account.readAuthority(admittedProfile(session.profileId));
    if (account.availability !== "available" || account.revision === null) return refusal("PROFILE_AUTHORITY_UNAVAILABLE");
    const current = requireSession(token);
    if ("state" in current) return current;
    if (canonicalJsonStringify(settings) !== canonicalJsonStringify(settingsAuthority(input.settings.read()))
      || protectedRevision !== storeFor(session.profileId).read().revision
      || !input.account.revalidateAuthority(account, admittedProfile(session.profileId))) return refusal("PROFILE_AUTHORITY_CHANGED");
    const final = requireSession(token);
    if ("state" in final) return final;
    if (canonicalJsonStringify(settings) !== canonicalJsonStringify(settingsAuthority(input.settings.read()))
      || protectedRevision !== storeFor(session.profileId).read().revision) return refusal("PROFILE_AUTHORITY_CHANGED");
    const snapshot = ProfileAuthoritySnapshotSchema.parse({
      profileId: session.profileId, profileSessionEpoch: session.epoch,
      accountRevision: account.revision, accountAttemptGeneration: account.attemptGeneration, accountAvailability: account.availability,
      ...settings,
      protectedSettingsRevision: protectedRevision,
    });
    authoritySnapshots.add(snapshot);
    return { state: "available", snapshot: Object.freeze(snapshot) };
  }

  function openLogout(profileId: string): LogoutOperation | undefined {
    return readOperations().find((operation): operation is LogoutOperation => operation.kind === "logout" && operation.profileId === profileId && operation.phase !== "complete");
  }

  function quiescence(profileId: string): "idle" | "busy" | "uncertain" {
    if (input.activity === undefined) return "uncertain";
    try {
      const result = input.activity.hasUnquiescedWork(profileId);
      if (result === true) return "busy";
      if (result === false) return "idle";
      return "uncertain";
    } catch {
      // A failed activity answer is incomplete closure.
      return "uncertain";
    }
  }

  function discardUnpublished(profileId: string): void {
    const root = registry.profileRoot(profileId);
    if (!existsSync(join(root, "credentials", "protected.json"))) rmSync(root, { recursive: true, force: true });
  }

  function publishSignUp(operation: SignUpOperation, fields: { readonly email: string; readonly password: string }): ActiveProfileSession {
    admission.assertWritable();
    operation = { ...operation, phase: "publishing" };
    writeOperation(operation);
    admittedProfile(operation.profileId).assertWritable();
    if (verifiers.identify(fields.email) === "unknown") verifiers.save(operation.profileId, fields.email, fields.password);
    if (!registry.read().profiles.some((row) => row.profileId === operation.profileId)) {
      const names = deriveProfileNames(operation.firstName, operation.lastName);
      registry.publishSignUp(operation, ProtectedSettingsApplyInputSchema.parse({
        commandId: operation.commandId, commandFingerprint: operation.commandFingerprint,
        expectedRevision: operation.expectedRevision, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
        writeId: operation.writeId, updatedAt: operation.createdAt,
        entries: { ucpathUserId: { set: fields.email }, ucpathPassword: { set: fields.password }, timekeeperName: { set: names.timekeeperName } },
      }));
    }
    releaseOrdinary(operation.profileId);
    deleteOperation(operation.operationId);
    return activate(operation.profileId);
  }

  function signUpLocked(fields: {
    readonly firstName: string;
    readonly lastName: string;
    readonly email: string;
    readonly password: string;
    readonly createdAt: string;
  }, names: ReturnType<typeof deriveProfileNames>): ActiveProfileSession | ProfileRefusal {
    admission.assertWritable();
    const selection = registry.read();
    if (selection.activeProfileId !== null || readOperations().some(entry => entry.kind === "logout" && entry.phase !== "complete")) return refusal("PROFILE_TRANSITION_BLOCKED");
    const emailKey = verifiers.emailKeyFor(fields.email);
    const identified = verifiers.identify(fields.email);
    if (identified !== "unknown" && registry.read().profiles.some((row) => row.profileId === identified.profileId)) {
      return refusal("PROFILE_OTHER_EMAIL");
    }
    let operation = readOperations().find((entry): entry is SignUpOperation => entry.kind === "sign-up" && entry.emailKey === emailKey);
    if (operation === undefined) {
      operation = admission.beginProfileSignUp({
        emailKey, firstName: names.firstName, lastName: names.lastName, createdAt: IsoInstantSchema.parse(fields.createdAt), commandFingerprint: "a".repeat(64),
      });
    }
    if (operation.firstName !== names.firstName || operation.lastName !== names.lastName) return refusal("PROFILE_SIGN_IN_REFUSED");
    registry.ensureRoot(operation.profileId);
    const store = storeFor(operation.profileId);
    if (operation.phase === "applying") store.migrateHistory({ operation });
    operation = readOperations().find((entry): entry is SignUpOperation => entry.kind === "sign-up" && entry.operationId === operation?.operationId) ?? operation;
    let revision = operation.expectedRevision;
    if (revision === undefined) {
      revision = store.read().revision;
      operation = { ...operation, expectedRevision: revision };
      writeOperation(operation);
    }
    if (!store.ownsCommandId(operation.commandId)) {
      try {
        const applied = store.apply(ProtectedSettingsApplyInputSchema.parse({
          commandId: operation.commandId,
          commandFingerprint: operation.commandFingerprint,
          expectedRevision: revision,
          protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
          writeId: operation.writeId,
          updatedAt: operation.createdAt,
          entries: {
            ucpathUserId: { set: fields.email },
            ucpathPassword: { set: fields.password },
            timekeeperName: { set: names.timekeeperName },
          },
        }));
        if (applied.state !== "applied" && !store.ownsCommandId(operation.commandId)) {
          deleteOperation(operation.operationId);
          discardUnpublished(operation.profileId);
          return refusal("PROFILE_SIGN_IN_REFUSED");
        }
      } catch (error) {
        if (!(error instanceof CredentialStoreCommitUncertainError)) throw error;
        if (!store.ownsCommandId(operation.commandId)) return refusal("PROFILE_SIGN_IN_REFUSED");
      }
    }
    if (store.ownsCommandId(operation.commandId)) {
      const current = store.read().entries;
      const same = current.ucpathUserId?.value === fields.email
        && current.ucpathPassword?.value === fields.password
        && current.timekeeperName?.value === names.timekeeperName;
      if (!same) return refusal("PROFILE_SIGN_IN_REFUSED");
    }
    return publishSignUp(operation, fields);
  }

  function logoutStorage(operation: LogoutOperation) {
    const entry = storageAdmissions.get(operation.profileId) ?? {};
    releaseSettlement(operation.profileId);
    const settlement = admission.admitProfile(registry.settlementClaim(operation.operationId));
    entry.settlement = settlement;
    storageAdmissions.set(operation.profileId, entry);
    return { settlement, store: storeFor(operation.profileId, settlement, "settlement") };
  }

  function continueLogout(operation: LogoutOperation): { readonly state: "wiped"; readonly inventory: CredentialInventory } | ProfileLogoutResult | ProfileCancelling {
    admission.assertWritable();
    const profileId = operation.profileId;
    const selection = registry.read();
    if (selection.activeProfileId !== null && selection.activeProfileId !== profileId) return refusal("PROFILE_TRANSITION_BLOCKED", operation.operationId);
    if (selection.activeProfileId === profileId) registry.advanceSession(null);
    if (selection.profiles.find(row => row.profileId === profileId)?.lifecycle !== "cancelling") registry.update(profileId, { lifecycle: "cancelling" });
    let stopped: ReturnType<typeof logoutStorage> | undefined;
    if (storageAdmissions.get(profileId)?.ordinary === undefined && input.preparePendingLogout !== undefined) {
      stopped = logoutStorage(operation);
      input.preparePendingLogout(operation, stopped.settlement, stopped.store);
    }
    const closure = quiescence(profileId);
    if (closure === "busy") {
      input.activity?.requestCancellation?.(profileId);
      const next = { ...operation, phase: "cancelling" as const };
      writeOperation(next);
      return cancelling(operation.operationId);
    }
    if (closure !== "idle") {
      writeOperation({ ...operation, phase: "incomplete" });
      return cancelling(operation.operationId);
    }
    const profileRoot = registry.profileRoot(profileId);
    if (!journalOutsideProfile(profileRoot, journalPath(profileId))) {
      writeOperation({ ...operation, phase: "incomplete" });
      return restoreAdmission(operation.operationId);
    }
    const { settlement, store } = stopped ?? logoutStorage(operation);
    const before = readForErasure(store, operation.operationId);
    const capturedSecrets = [before.entries.ucpathUserId?.value, before.entries.ucpathPassword?.value]
      .filter((value): value is string => value !== undefined);
    let command = operation;
    if (command.commandId === undefined || command.writeId === undefined || command.expectedRevision === undefined) {
      command = {
        ...command,
        phase: "erasing",
        commandId: command.commandId ?? randomUUID(),
        writeId: command.writeId ?? randomUUID(),
        expectedRevision: command.expectedRevision ?? before.revision,
      };
      writeOperation(command);
    } else if (command.phase !== "erasing") {
      command = { ...command, phase: "erasing" };
      writeOperation(command);
    }
    const commandId = command.commandId;
    const writeId = command.writeId;
    const expectedRevision = command.expectedRevision;
    if (commandId === undefined || writeId === undefined || expectedRevision === undefined) return cancelling(command.operationId);
    {
      try {
        const erased = store.erase(CredentialEraseInputSchema.parse({
          commandId,
          commandFingerprint: "b".repeat(64),
          expectedRevision,
          protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
          writeId,
          updatedAt: command.at,
        }));
        if (erased.state !== "applied" && !store.ownsCommandId(commandId)) {
          writeOperation({ ...command, phase: "incomplete" });
          return refusal("PROFILE_LOGOUT_BLOCKED", command.operationId);
        }
      } catch (error) {
        if (error instanceof CredentialErasureAuthorityError) {
          writeOperation({ ...command, phase: "incomplete" });
          return restoreAdmission(command.operationId);
        }
        if (error instanceof CredentialStoreCommitUncertainError) {
          if (!store.ownsCommandId(commandId)) {
            writeOperation({ ...command, phase: "incomplete" });
            return cancelling(command.operationId);
          }
        } else {
          throw error;
        }
      }
    }
    const record = readForErasure(store, operation.operationId);
    const inventory = input.credentialInventory?.({ profileId, admission: settlement, credentials: store, operationId: operation.operationId, operation: command,
      capturedSecrets, capturedSecretsComplete: before.entries.ucpathUserId !== undefined && before.entries.ucpathPassword !== undefined }) ?? assessCredentialInventory({
      profileRoot,
      inspectEncrypted: path => inspectCredentialCopy(store, path, capturedSecrets),
      entriesAbsent: record.entries.ucpathUserId === undefined && record.entries.ucpathPassword === undefined,
      backupPaths: input.backupPaths?.(profileId),
      loginDataPaths: input.loginDataPaths?.(profileId),
      capturedSecrets,
      capturedSecretsComplete: before.entries.ucpathUserId !== undefined && before.entries.ucpathPassword !== undefined,
    });
    if (!inventory.logoutComplete) {
      writeOperation({ ...command, phase: "incomplete" });
      return { ...refusal("PROFILE_LOGOUT_INVENTORY_BLOCKED", command.operationId), inventory };
    }
    releaseOrdinary(profileId);
    releaseSettlement(profileId);
    storageAdmissions.delete(profileId);
    registry.update(profileId, { credentialState: "wiped", lifecycle: "ready" });
    deleteOperation(command.operationId);
    return { state: "wiped", inventory };
  }

  return Object.freeze({
    close(): void {
      logoutContinuationGeneration++;
      sessions.clear();
      for (const profileId of storageAdmissions.keys()) {
        releaseOrdinary(profileId);
        releaseSettlement(profileId);
        storageAdmissions.delete(profileId);
      }
    },
    signUp(fields: {
      readonly firstName: string;
      readonly lastName: string;
      readonly email: string;
      readonly password: string;
      readonly createdAt: string;
    }): ActiveProfileSession | ProfileRefusal {
      let names: ReturnType<typeof deriveProfileNames>;
      try {
        names = deriveProfileNames(fields.firstName, fields.lastName);
      } catch (error) {
        if (error instanceof ProfileNameValidationError) return refusal("PROFILE_NAME_REFUSED");
        throw error;
      }
      if (fields.password.length === 0) return refusal("PROFILE_SIGN_IN_REFUSED");
      admission.assertWritable();
      return withProfileLock(machineRoot, () => signUpLocked(fields, names));
    },
    signIn(fields: { readonly email: string; readonly password: string; readonly at: string;
      readonly credentialMigration?: { readonly kind: "prove-v2" } | { readonly kind: "replace-v3"; readonly entries: CompleteProtectedSettingsPatch } }): ActiveProfileSession | ProfileRefusal | ProfileCancelling {
      const at = IsoInstantSchema.parse(fields.at);
      admission.assertWritable();
      return withProfileLock(machineRoot, () => {
        const identified = verifiers.identify(fields.email);
        if (identified === "unknown") return refusal("PROFILE_SIGN_IN_REFUSED");
        const row = registry.read().profiles.find((entry) => entry.profileId === identified.profileId);
        if (row === undefined) return refusal("PROFILE_SIGN_IN_REFUSED");
        const pending = openLogout(row.profileId);
        if (row.lifecycle === "cancelling" || pending !== undefined) return cancelling(pending?.operationId);
        const nowMs = Date.parse(at);
        if (verifiers.locked(row.profileId, nowMs)) return refusal("PROFILE_SIGN_IN_REFUSED");
        if (!verifiers.passwordMatches(row.profileId, fields.password)) {
          verifiers.recordFailure(row.profileId, nowMs);
          return refusal("PROFILE_SIGN_IN_REFUSED");
        }
        const selection = registry.read();
        if (selection.activeProfileId !== null && selection.activeProfileId !== row.profileId) return refusal("PROFILE_TRANSITION_BLOCKED");
        const closure = input.sessionChange?.(row.profileId);
        if (closure !== undefined && closure.state !== "closed") return closure;
        admission.assertWritable();
        if (registry.read().profiles.some((entry) => entry.profileId !== row.profileId && entry.lifecycle === "cancelling")) {
          return refusal("PROFILE_TRANSITION_BLOCKED");
        }
        if (readOperations().some((entry) => entry.kind === "logout" && entry.profileId !== row.profileId && entry.phase !== "complete")) {
          return refusal("PROFILE_TRANSITION_BLOCKED");
        }
        const names = deriveProfileNames(row.firstName, row.lastName);
        let operation = readOperations().find((entry): entry is SignUpOperation => entry.kind === "sign-up" && entry.profileId === row.profileId && entry.phase === "applying");
        if (operation === undefined) {
          operation = SignUpOperationSchema.parse({ schemaVersion: 1, kind: "sign-up", operationId: randomUUID(), profileId: row.profileId,
            commandId: randomUUID(), writeId: randomUUID(), emailKey: verifiers.emailKeyFor(fields.email), firstName: names.firstName,
            lastName: names.lastName, createdAt: at, commandFingerprint: "c".repeat(64), phase: "applying" });
          writeOperation(operation);
        }
        releaseOrdinary(row.profileId);
        let store = storeFor(row.profileId);
        const source = credentialMigrationSource(store);
        const migration = fields.credentialMigration;
        if (source.state === "legacy" || operation.credentialInitialization?.mode === "replace-v3" || operation.credentialInitialization?.mode === "proven-v2") {
          const mode = source.state === "legacy" ? source.schemaVersion === 2 ? "proven-v2" : "replace-v3" : operation.credentialInitialization?.mode;
          if (mode === "replace-v3") {
            if (migration?.kind !== "replace-v3") return refusal("PROFILE_CREDENTIAL_CONVERSION_REQUIRED", operation.operationId);
            const parsed = CompleteProtectedSettingsPatchSchema.safeParse(migration.entries);
            if (!parsed.success || !("set" in parsed.data.ucpathUserId) || parsed.data.ucpathUserId.set !== fields.email
              || !("set" in parsed.data.ucpathPassword) || parsed.data.ucpathPassword.set !== fields.password) return refusal("PROFILE_CREDENTIAL_CONVERSION_REQUIRED", operation.operationId);
          } else if (migration?.kind !== "prove-v2") return refusal("PROFILE_CREDENTIAL_CONVERSION_REQUIRED", operation.operationId);
          if (operation.credentialInitialization === undefined) {
            if (source.state !== "legacy") return refusal("PROFILE_CREDENTIAL_CONVERSION_REQUIRED", operation.operationId);
            const binding = { schemaVersion: source.schemaVersion, revision: source.revision, device: source.device, inode: source.inode, digest: source.digest };
            operation = SignUpOperationSchema.parse({ ...operation, expectedRevision: source.revision,
              credentialInitialization: { mode, keyId: randomUUID(), phase: "admitted", source: binding } });
            writeOperation(operation);
          }
          sessions.clear();
          store.migrateHistory({ operation, ...(migration?.kind === "replace-v3" ? { replacement: migration.entries } : {}) });
          operation = readOperations().find((entry): entry is SignUpOperation => entry.kind === "sign-up" && entry.operationId === operation?.operationId) ?? operation;
          if (mode === "replace-v3") {
            const entries = store.read().entries;
            if (entries.ucpathUserId?.value !== fields.email || entries.ucpathPassword?.value !== fields.password) return refusal("PROFILE_SIGN_IN_REFUSED");
            verifiers.clearFailures(row.profileId);
            registry.update(row.profileId, { lastSignedInAt: at, credentialState: "saved", lifecycle: "ready" });
            releaseOrdinary(row.profileId); deleteOperation(operation.operationId);
            return activate(row.profileId);
          }
        } else if (source.state === "absent") return refusal("PROFILE_CREDENTIAL_CONVERSION_REQUIRED", operation.operationId);
        let replacementRevision: number | undefined;
        const holdsSupplied = (): boolean => {
          const current = store.read().entries;
          return current.ucpathUserId?.value === fields.email
            && current.ucpathPassword?.value === fields.password
            && current.timekeeperName?.value === names.timekeeperName;
        };

        if (operation !== undefined && store.ownsCommandId(operation.commandId) && !holdsSupplied()) {
          replacementRevision = store.read().revision;
          releaseOrdinary(row.profileId);
          deleteOperation(operation.operationId);
          operation = undefined;
        }
        if (operation === undefined) {
          operation = SignUpOperationSchema.parse({
            schemaVersion: 1,
            kind: "sign-up",
            operationId: randomUUID(),
            profileId: row.profileId,
            commandId: randomUUID(),
            writeId: randomUUID(),
            emailKey: verifiers.emailKeyFor(fields.email),
            firstName: names.firstName,
            lastName: names.lastName,
            createdAt: at,
            commandFingerprint: "c".repeat(64),
            expectedRevision: replacementRevision ?? store.read().revision,
            phase: "applying",
          });
          writeOperation(operation);
          store = storeFor(row.profileId);
        }
        if (operation.expectedRevision === undefined) {
          operation = { ...operation, expectedRevision: store.read().revision };
          writeOperation(operation);
        }
        const commandId = operation.commandId;
        const expectedRevision = operation.expectedRevision;
        if (expectedRevision === undefined) return refusal("PROFILE_SIGN_IN_REFUSED");
        if (!store.ownsCommandId(commandId)) {
          try {
            const applied = store.apply(ProtectedSettingsApplyInputSchema.parse({
              commandId,
              commandFingerprint: operation.commandFingerprint,
              expectedRevision,
              protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
              writeId: operation.writeId,
              updatedAt: operation.createdAt,
              entries: {
                ucpathUserId: { set: fields.email },
                ucpathPassword: { set: fields.password },
                timekeeperName: { set: names.timekeeperName },
              },
            }));
            if (applied.state !== "applied" && !store.ownsCommandId(commandId)) {
              deleteOperation(operation.operationId);
              return refusal("PROFILE_SIGN_IN_REFUSED");
            }
          } catch (error) {
            if (!(error instanceof CredentialStoreCommitUncertainError)) throw error;
            if (!store.ownsCommandId(commandId)) return refusal("PROFILE_SIGN_IN_REFUSED");
          }
        }
        if (!holdsSupplied()) return refusal("PROFILE_SIGN_IN_REFUSED");
        verifiers.clearFailures(row.profileId);
        registry.update(row.profileId, { lastSignedInAt: at, credentialState: "saved", lifecycle: "ready" });
        releaseOrdinary(row.profileId);
        deleteOperation(operation.operationId);
        return activate(row.profileId);
      });
    },
    changePassword(): ProfileRefusal {
      return refusal("PROFILE_VERIFIER_UNAVAILABLE");
    },
    logOut(token: string, inputFields: { readonly at: string }): { readonly state: "wiped"; readonly inventory: CredentialInventory } | ProfileLogoutResult | ProfileCancelling {
      const at = IsoInstantSchema.parse(inputFields.at);
      admission.assertLive();
      const issued = sessions.get(token);
      if (issued !== undefined && !journalOutsideProfile(join(machineRoot, "profiles", issued.profileId), journalPath(issued.profileId))) {
        return restoreAdmission();
      }
      const session = requireSession(token);
      if ("state" in session) return session;
      return withProfileLock(machineRoot, () => {
        const current = requireSession(token);
        if ("state" in current) return current;
        storeFor(session.profileId, current.admission);
        input.prepareLogout?.(session.profileId, current.admission);
        const existing = openLogout(session.profileId);
        const operation = existing ?? LogoutOperationSchema.parse({
          schemaVersion: 1,
          kind: "logout",
          operationId: randomUUID(),
          profileId: session.profileId,
          at,
          phase: "admitted",
        });
        if (existing === undefined) writeOperation(operation);
        registry.advanceSession(null);
        for (const [held, value] of sessions) {
          if (value.profileId === session.profileId) sessions.delete(held);
        }
        registry.update(session.profileId, { lifecycle: "cancelling" });
        return continueLogout(operation);
      });
    },
    authorizeLogoutContinuation(fields: { readonly email: string; readonly password: string; readonly at: string }) {
      const at = IsoInstantSchema.parse(fields.at);
      admission.assertWritable();
      return withProfileLock(machineRoot, () => {
        const identified = verifiers.identify(fields.email);
        if (identified === "unknown") return refusal("PROFILE_SIGN_IN_REFUSED");
        const nowMs = Date.parse(at);
        if (verifiers.locked(identified.profileId, nowMs)) return refusal("PROFILE_SIGN_IN_REFUSED");
        if (!verifiers.passwordMatches(identified.profileId, fields.password)) {
          verifiers.recordFailure(identified.profileId, nowMs);
          return refusal("PROFILE_SIGN_IN_REFUSED");
        }
        const selection = registry.read();
        const row = selection.profiles.find(entry => entry.profileId === identified.profileId);
        const operations = readOperations().filter((entry): entry is LogoutOperation => entry.kind === "logout"
          && entry.profileId === identified.profileId && entry.phase !== "complete");
        const operation = operations[0];
        if (row?.lifecycle !== "cancelling" || selection.activeProfileId !== null || operations.length !== 1 || operation === undefined) {
          return refusal("PROFILE_SESSION_STALE");
        }
        verifiers.clearFailures(row.profileId);
        const operationSnapshot = canonicalJsonStringify(operation), rowSnapshot = canonicalJsonStringify(row);
        const generation = ++logoutContinuationGeneration;
        return Object.freeze({ state: "authorized" as const, resume() {
          if (generation !== logoutContinuationGeneration) return refusal("PROFILE_SESSION_STALE");
          logoutContinuationGeneration++;
          admission.assertWritable();
          return withProfileLock(machineRoot, () => {
            const current = registry.read();
            const pending = readOperations().filter((entry): entry is LogoutOperation => entry.kind === "logout"
              && entry.profileId === row.profileId && entry.phase !== "complete");
            const currentRow = current.profiles.find(entry => entry.profileId === row.profileId);
            if (current.sessionGeneration !== selection.sessionGeneration || current.activeProfileId !== null
              || currentRow === undefined || canonicalJsonStringify(currentRow) !== rowSnapshot
              || pending.length !== 1 || canonicalJsonStringify(pending[0]) !== operationSnapshot) return refusal("PROFILE_SESSION_STALE");
            return continueLogout(operation);
          });
        } });
      });
    },
    resumeLogout(operationId: string): { readonly state: "wiped"; readonly inventory: CredentialInventory } | ProfileLogoutResult | ProfileCancelling {
      admission.assertWritable();
      return withProfileLock(machineRoot, () => {
        const operation = readOperations().find((entry): entry is LogoutOperation => entry.kind === "logout" && entry.operationId === operationId);
        if (operation === undefined) return refusal("PROFILE_SESSION_STALE");
        if (operation.phase === "complete") return refusal("PROFILE_SESSION_STALE");
        return continueLogout(operation);
      });
    },
    logoutOperations(): readonly { readonly operationId: string; readonly profileId: string; readonly phase: string }[] {
      return readOperations().filter((operation): operation is LogoutOperation => operation.kind === "logout").map((operation) => ({
        operationId: operation.operationId,
        profileId: operation.profileId,
        phase: operation.phase,
      }));
    },
    prepareCurrentStorage(token: string): { readonly state: "available" } | ProfileRefusal {
      const current = requireSession(token);
      if ("state" in current) return current;
      storeFor(current.profileId, current.admission);
      return { state: "available" };
    },
    readCurrentAuthority,
    async revalidateAuthority(token: string, captured: ProfileAuthoritySnapshot): Promise<{ readonly state: "available"; readonly snapshot: ProfileAuthoritySnapshot } | ProfileRefusal> {
      if (!authoritySnapshots.has(captured)) return refusal("PROFILE_AUTHORITY_CHANGED");
      const current = await readCurrentAuthority(token);
      if (current.state !== "available") return current;
      if (canonicalJsonStringify(current.snapshot) !== canonicalJsonStringify(captured)) return refusal("PROFILE_AUTHORITY_CHANGED");
      return current;
    },
    readFile(token: string, relativePath: string): Uint8Array | ProfileRefusal {
      const initial = requireSession(token);
      if ("state" in initial) return initial;
      return withProfileLock(machineRoot, () => {
        const session = requireSession(token);
        if ("state" in session) return session;
        try {
          const path = contained(session.admission.stateRoot, relativePath);
          session.admission.assertStateRoot(path);
          const ancestry = new Map<string, DirectoryIdentity>();
          if (!noSymlinkAncestry(dirname(path), ancestry)) throw new Error("profile file read refused");
          const expected = lstatSync(path);
          if (!expected.isFile() || expected.isSymbolicLink() || expected.nlink !== 1
            || (process.getuid !== undefined && expected.uid !== process.getuid())) throw new Error("profile file read refused");
          const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          try {
            const matches = (observed: typeof expected) => observed.isFile() && !observed.isSymbolicLink()
              && observed.dev === expected.dev && observed.ino === expected.ino && observed.size === expected.size
              && observed.mode === expected.mode && observed.uid === expected.uid && observed.nlink === expected.nlink
              && observed.mtimeMs === expected.mtimeMs && observed.ctimeMs === expected.ctimeMs;
            if (!noSymlinkAncestry(dirname(path), ancestry) || !matches(fstatSync(descriptor))) throw new Error("profile file read refused");
            const bytes = readFileSync(descriptor);
            if (!matches(fstatSync(descriptor)) || !matches(lstatSync(path)) || bytes.byteLength !== expected.size
              || !noSymlinkAncestry(dirname(path), ancestry)) throw new Error("profile file read refused");
            session.admission.assertStateRoot(path);
            const current = requireSession(token);
            if ("state" in current) return current;
            return bytes;
          } finally { closeSync(descriptor); }
        } catch { throw new Error("profile file read refused"); }
      });
    },
  });
}
