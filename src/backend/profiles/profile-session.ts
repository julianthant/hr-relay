import { ProfileOnboardingDuoProviderError } from "./onboarding-duo-provider.js";
import { ProfileSessionRefusedError } from "./profile-errors.js";
import { AuthoritySourceClosureUnprovedError } from '../storage/source-closure.js';
import { AuthorityDatabase } from "../storage/sqlite/authority-database.js";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import {
  createCredentialStore,
  credentialMigrationSource,
  captureReadyUpgradeCredentialSource,
  inspectCredentialCopy,
  assertCredentialStoreOwner,
  readForErasure,
  CredentialErasureAuthorityError,
  CredentialStoreCommitUncertainError,
  authenticateUnpublishedDraftAbort, prepareUnpublishedDraftAbort,
  RESTORE_ADMISSION_REQUEST,
  type CredentialInitializationCopyInspection, type CredentialStoreOptions, type CredentialStoreHooks,
} from "../storage/configuration/credential-store.js";
import { type RuntimeAdmission, type RegisteredProfileStorageClaim } from "../storage/admission/admission.js";
import { requireRuntimeAdmission } from "../storage/admission/admission-identity.js";
import {
  PROTECTED_SETTINGS_SCHEMA_HASH,
  ProtectedSettingsApplyInputSchema,
  CompleteProtectedSettingsPatchSchema,
  type CompleteProtectedSettingsPatch,
} from "../../models/config/protected-settings.js";
import { CredentialEraseInputSchema } from "../../models/config/credential-store.js";
import { operatorFailureSentence, type ErrorCatalogCode } from "../../models/failures/error-catalog.js";
import { assertFinishedProfileOnboarding, deriveProfileNames, ProfileNameValidationError, ProfileAuthoritySnapshotSchema, type ProfileAuthoritySnapshot } from "../../models/profiles/profile.js";
import { IsoInstantSchema } from "../../rules/identity/ids.js";
import {
  noSymlinkAncestry,
  type DirectoryIdentity,
} from "../storage/configuration/credential-safe-file.js";
import { assessCredentialInventory, type CredentialInventory } from "./credential-inventory.js";
import { createProfileRegistry, withProfileLock, ProfileRegistryAuthorityError } from "./registry.js";
import { SignUpOperationSchema, LogoutOperationSchema, type SignUpOperation, type LogoutOperation, type ProfileOperation } from "../../models/profiles/profile.js";
import { createProfileVerifiers } from "./verifier-store.js";
import { ProfileOnboardingStateSchema, type ProfileOnboardingState } from "../../models/profiles/public-profile.js";
import type { ProfileOnboardingMethod } from "../../models/profiles/public-profile.js";
import type { ProfileOnboardingDuoProvider } from "./onboarding-duo.js";
import { createProfileOnboarding } from "./profile-onboarding.js";
import { createDraftDuoCredentialStore } from "../storage/configuration/duo-credential-store.js";
import { systemClock, type Clock } from "../../rules/time/clock.js";

import type { ChatGptAccountService } from "../accounts/chatgpt-account-service.js";
import type { CredentialStore } from "../../models/config/credential-store.js";
import type { SettingsRuntimeSnapshot } from "../runtime/settings/settings-runtime.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";

export class ProfileUpgradeUnavailableError extends Error {
  readonly code = "PROFILE_UPGRADE_UNAVAILABLE";
  constructor(cause: unknown) { super(operatorFailureSentence("PROFILE_UPGRADE_UNAVAILABLE"), { cause }); this.name = "ProfileUpgradeUnavailableError"; }
}

export interface AuthenticatedProfileUpgrade { readonly profileId: string; }
const authenticatedUpgrades = new WeakMap<AuthenticatedProfileUpgrade, (machine: RuntimeAdmission) => RegisteredProfileStorageClaim>();
export function consumeAuthenticatedProfileUpgrade(authorization: AuthenticatedProfileUpgrade, machine: RuntimeAdmission): RegisteredProfileStorageClaim {
  const consume = authenticatedUpgrades.get(authorization);
  if (consume === undefined) throw new ProfileSessionRefusedError("PROFILE_UPGRADE_UNAVAILABLE");
  authenticatedUpgrades.delete(authorization);
  return consume(requireRuntimeAdmission(machine));
}
function issueAuthenticatedProfileUpgrade(profileId: string,
  capture: NonNullable<ReturnType<RuntimeAdmission["captureProfileUpgradeHandoff"]>>,
  credentials: ReturnType<typeof captureReadyUpgradeCredentialSource>): AuthenticatedProfileUpgrade {
  const authorization = Object.freeze({ profileId });
  authenticatedUpgrades.set(authorization, machine => {
    const claim = capture.consume(machine);
    credentials.revalidate(machine, claim);
    return claim;
  });
  return authorization;
}
export interface ProfileUpgradeRequired extends ProfileRefusal { readonly upgrade: AuthenticatedProfileUpgrade; }

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

export interface OnboardingProfileSession extends ProfileOnboardingState {
  readonly token: string;
}

export interface ProfileRefusal {
  readonly state: "refused";
  readonly code: ErrorCatalogCode;
  readonly message: string;
  readonly operationId?: string;
  readonly request?: string;
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
  readonly clock?: Clock;
  readonly onboardingDuo?: ProfileOnboardingDuoProvider;
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
  const onboardingSessions = new Map<string, string>();
  const completedOnboarding = new Map<string, { operationId: string; session: ActiveProfileSession }>();
  const storageAdmissions = new Map<string, { ordinary?: RuntimeAdmission; settlement?: RuntimeAdmission }>();
  const authoritySnapshots = new WeakSet<ProfileAuthoritySnapshot>();
  let logoutContinuationGeneration = 0;
  let upgradeRequested = false;

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
      || row?.lifecycle !== "ready" || row.credentialState !== "saved" || row.registration.onboardingCompletion === undefined
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

  function assertPublishedFinish(operation: SignUpOperation, registration: ReturnType<typeof registry.read>["profiles"][number]["registration"]): void {
    assertFinishedProfileOnboarding(operation);
    const draft = operation.onboarding, completion = registration.onboardingCompletion;
    if (operation.phase !== "publishing" || draft?.finish === undefined || completion === undefined
      || registration.operationId !== operation.operationId || registration.commandId !== operation.commandId || registration.writeId !== operation.writeId
      || completion.generation !== draft.generation || completion.finishId !== draft.finish.finishId || completion.finishedAt !== draft.finish.finishedAt) throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE");
    for (const method of ["key", "touch"] as const) {
      const receipt = draft.attempts.findLast(entry => entry.method === method && entry.generation === draft.generation);
      if (createHash("sha256").update(canonicalJsonStringify(receipt)).digest("hex") !== completion[method].receiptDigest) throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE");
    }
  }

  function publishSignUp(operation: SignUpOperation, fields: { readonly email: string; readonly password: string }): ActiveProfileSession {
    admission.assertWritable();
    operation = { ...operation, phase: "publishing" };
    writeOperation(operation);
    admittedProfile(operation.profileId).assertWritable();
    if (!registry.read().profiles.some((row) => row.profileId === operation.profileId)) {
      const names = deriveProfileNames(operation.firstName, operation.lastName);
      const verifier = verifiers.prepare(operation.profileId, fields.email, fields.password);
      registry.publishSignUp(operation, ProtectedSettingsApplyInputSchema.parse({
        commandId: operation.commandId, commandFingerprint: operation.commandFingerprint,
        expectedRevision: operation.expectedRevision, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
        writeId: operation.writeId, updatedAt: operation.createdAt,
        entries: { ucpathUserId: { set: fields.email }, ucpathPassword: { set: fields.password }, timekeeperName: { set: names.timekeeperName } },
      }), verifier);
    }
    releaseOrdinary(operation.profileId);
    deleteOperation(operation.operationId);
    return activate(operation.profileId);
  }

  function onboardingState(operation: SignUpOperation): ProfileOnboardingState {
    const draft = operation.onboarding;
    if (draft === undefined || operation.phase !== "applying" && !(operation.phase === "publishing" && draft.finish !== undefined)) throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE");
    const method = (name: "key" | "touch") => {
      const attempt = draft.attempts.findLast(entry => entry.method === name && entry.generation === draft.generation);
      if (draft.abort !== undefined) return { state: "unavailable" as const, ceremonyObserved: false, portalAccepted: false, operatorConfirmed: false, exactCredentialRequestObserved: false };
      const idle = input.onboardingDuo === undefined ? "unavailable" as const : "idle" as const;
      const state = attempt?.state === "closed" ? idle : attempt?.state ?? idle;
      return { state: attempt !== undefined && state === "pending"
          && attempt.providerClosedAt === undefined && !onboarding.hasLiveAttempt(attempt.attemptId) ? "unknown" as const : state,
        ...(attempt === undefined ? {} : { attemptId: attempt.attemptId }),
        ceremonyObserved: attempt?.ceremony !== undefined, portalAccepted: attempt?.portal?.acceptance === "portal-accepted",
        operatorConfirmed: attempt?.operatorConfirmedAt !== undefined,
        exactCredentialRequestObserved: attempt?.portal?.acceptance === "exact-credential-request" };
    };
    const methods = { key: method("key"), touch: method("touch") };
    return ProfileOnboardingStateSchema.parse({ state: "onboarding", operationId: operation.operationId, profileId: operation.profileId,
      step: methods.key.state === "complete" && methods.touch.state === "complete" ? "ready" : "duo", methods });
  }

  function requireOnboarding(token: string, operationId: string, allowAbort = false): SignUpOperation {
    admission.assertWritable();
    if (onboardingSessions.get(token) !== operationId) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
    const operation = readOperations().find((entry): entry is SignUpOperation => entry.kind === "sign-up" && entry.operationId === operationId);
    if (operation?.onboarding === undefined || operation.phase !== "applying" && !(operation.phase === "publishing" && operation.onboarding.finish !== undefined)) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
    const published = registry.read().profiles.find(row => row.profileId === operation.profileId);
    if (published !== undefined) assertPublishedFinish(operation, published.registration);
    if (!allowAbort && operation.onboarding.abort !== undefined) throw new ProfileSessionRefusedError("PROFILE_TRANSITION_BLOCKED");
    return operation;
  }

  function issueOnboardingSession(operation: SignUpOperation): OnboardingProfileSession {
    for (const [token, operationId] of onboardingSessions) if (operationId === operation.operationId) onboardingSessions.delete(token);
    const token = randomUUID(); onboardingSessions.set(token, operation.operationId);
    return { ...onboardingState(operation), token };
  }

  function signUpLocked(fields: {
    readonly firstName: string;
    readonly lastName: string;
    readonly email: string;
    readonly password: string;
    readonly createdAt: string;
  }, names: ReturnType<typeof deriveProfileNames>): OnboardingProfileSession | ProfileRefusal {
    admission.assertWritable();
    const selection = registry.read();
    if (selection.activeProfileId !== null || readOperations().some(entry => entry.kind === "logout" && entry.phase !== "complete")) return refusal("PROFILE_TRANSITION_BLOCKED");
    const emailKey = verifiers.emailKeyFor(fields.email);
    if (readOperations().some(entry => entry.kind === "sign-up" && entry.emailKey !== emailKey)) return refusal("PROFILE_TRANSITION_BLOCKED");
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
    if (operation.onboarding === undefined || operation.phase !== "applying" && !(operation.phase === "publishing" && operation.onboarding.finish !== undefined)) return refusal("PROFILE_AUTHORITY_UNAVAILABLE");
    if (operation.onboarding.abort !== undefined) {
      if (operation.firstName !== names.firstName || operation.lastName !== names.lastName
        || !authenticateUnpublishedDraftAbort(storeFor(operation.profileId), operation, { email: fields.email, password: fields.password, timekeeperName: names.timekeeperName })) return refusal("PROFILE_SIGN_IN_REFUSED");
      return issueOnboardingSession(operation);
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
    return issueOnboardingSession(operation);
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

  const onboarding = createProfileOnboarding({
    failureKind: error => error instanceof ProfileOnboardingDuoProviderError ? error.kind : "unknown", clock: input.clock ?? systemClock,
    ...(input.onboardingDuo === undefined ? {} : { provider: input.onboardingDuo }),
    read: operationId => {
      const operation = readOperations().find((entry): entry is SignUpOperation => entry.kind === "sign-up" && entry.operationId === operationId);
      if (operation === undefined || registry.read().profiles.some(row => row.profileId === operation.profileId)) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
      return operation;
    },
    update: (operationId, change) => withProfileLock(machineRoot, () => {
      const operation = readOperations().find((entry): entry is SignUpOperation => entry.kind === "sign-up" && entry.operationId === operationId);
      if (operation?.onboarding === undefined || operation.phase !== "applying"
        || registry.read().profiles.some(row => row.profileId === operation.profileId)) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
      const outcome = change(operation); writeOperation(outcome.operation); return outcome.result;
    }),
    email: operation => {
      const email = storeFor(operation.profileId).read().entries.ucpathUserId?.value;
      if (email === undefined) throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE");
      return email;
    },
    store: operation => {
      if (operation.onboarding === undefined) throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE");
      return createDraftDuoCredentialStore(admittedProfile(operation.profileId), admission, operation.operationId, operation.onboarding.generation, input.clock ?? systemClock);
    },
  });

  return Object.freeze({
    close(): void {
      onboarding.assertClosed();
      logoutContinuationGeneration++;
      sessions.clear();
      onboardingSessions.clear();
      completedOnboarding.clear();
      for (const profileId of storageAdmissions.keys()) {
        releaseOrdinary(profileId);
        releaseSettlement(profileId);
        storageAdmissions.delete(profileId);
      }
    },
    closeOnboarding(): Promise<void> { return onboarding.close(); },
    signUp(fields: {
      readonly firstName: string;
      readonly lastName: string;
      readonly email: string;
      readonly password: string;
      readonly createdAt: string;
    }): OnboardingProfileSession | ProfileRefusal {
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
    assertOnboardingAbort(token: string, operationId: string): void {
      withProfileLock(machineRoot, () => requireOnboarding(token, operationId, true));
    },
    readOnboarding(token: string, operationId: string): ProfileOnboardingState {
      return withProfileLock(machineRoot, () => onboardingState(requireOnboarding(token, operationId, true)));
    },
    async startOnboardingDuo(token: string, operationId: string, method: ProfileOnboardingMethod): Promise<ProfileOnboardingState> {
      withProfileLock(machineRoot, () => requireOnboarding(token, operationId));
      await onboarding.start(operationId, method);
      return onboardingState(requireOnboarding(token, operationId));
    },
    confirmOnboardingDuo(token: string, operationId: string, method: ProfileOnboardingMethod, attemptId: string): ProfileOnboardingState {
      withProfileLock(machineRoot, () => requireOnboarding(token, operationId));
      onboarding.confirm(operationId, method, attemptId);
      return onboardingState(requireOnboarding(token, operationId));
    },
    async cancelOnboardingDuo(token: string, operationId: string, method: ProfileOnboardingMethod, attemptId: string): Promise<ProfileOnboardingState> {
      withProfileLock(machineRoot, () => requireOnboarding(token, operationId));
      await onboarding.cancelAttempt(operationId, method, attemptId);
      return onboardingState(requireOnboarding(token, operationId));
    },
    async completeOnboarding(token: string, operationId: string): Promise<ActiveProfileSession> {
      const completed = completedOnboarding.get(token);
      if (completed !== undefined) {
        if (completed.operationId !== operationId || "state" in requireSession(completed.session.token)) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
        return completed.session;
      }
      const initial = requireOnboarding(token, operationId);
      if (onboardingState(initial).step !== "ready") throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE");
      if (!registry.read().profiles.some(row => row.profileId === initial.profileId)) await onboarding.drain(operationId);
      return withProfileLock(machineRoot, () => {
        const pending = requireOnboarding(token, operationId);
        if (pending.onboarding === undefined) throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE");
        if (pending.onboarding.finish === undefined) writeOperation({ ...pending, onboarding: { ...pending.onboarding,
          finish: { finishId: randomUUID(), finishedAt: (input.clock ?? systemClock).now().toISOString() } } });
        const published = registry.read().profiles.find(row => row.profileId === pending.profileId);
        const operation = published === undefined ? onboarding.verifyFinish(operationId) : pending;
        if (published !== undefined) assertPublishedFinish(operation, published.registration);
        const fields = storeFor(operation.profileId).read().entries;
        const email = fields.ucpathUserId?.value, password = fields.ucpathPassword?.value;
        if (email === undefined || password === undefined) throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE");
        const session = publishSignUp(operation, { email, password });
        onboardingSessions.delete(token); completedOnboarding.set(token, { operationId, session });
        return session;
      });
    },
    async cancelOnboarding(token: string, operationId: string): Promise<{ readonly state: "signed-out" }> {
      requireOnboarding(token, operationId, true);
      await onboarding.drain(operationId);
      return withProfileLock(machineRoot, () => {
        let operation = requireOnboarding(token, operationId, true);
        onboarding.assertAbortable(operationId);
        const draft = operation.onboarding;
        if (draft === undefined) throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE");
        if (draft.abort === undefined) {
          const commandId = randomUUID(), writeId = randomUUID(), generation = draft.generation + 1;
          const commandFingerprint = createHash("sha256").update(canonicalJsonStringify({ kind: "abort-profile-onboarding", operationId, generation, commandId, writeId })).digest("hex");
          operation = { ...operation, onboarding: { ...draft, generation, abort: CredentialEraseInputSchema.parse({ commandId, writeId, commandFingerprint,
            expectedRevision: storeFor(operation.profileId).read().revision, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
            updatedAt: (input.clock ?? systemClock).now().toISOString() }) } };
          writeOperation(operation);
        }
        const witness = prepareUnpublishedDraftAbort(storeFor(operation.profileId), operation);
        releaseOrdinary(operation.profileId);
        admission.abortUnpublishedProfile(witness);
        for (const [current, pending] of onboardingSessions) if (pending === operationId) onboardingSessions.delete(current);
        return { state: "signed-out" };
      });
    },
    signIn(fields: { readonly email: string; readonly password: string; readonly at: string;
      readonly credentialMigration?: { readonly kind: "prove-v2" } | { readonly kind: "replace-v3"; readonly entries: CompleteProtectedSettingsPatch } }): ActiveProfileSession | ProfileRefusal | ProfileCancelling | ProfileUpgradeRequired {
      const at = IsoInstantSchema.parse(fields.at);
      admission.assertWritable();
      return withProfileLock(machineRoot, () => {
        const identified = verifiers.identify(fields.email);
        if (identified === "unknown") return refusal("PROFILE_SIGN_IN_REFUSED");
        const row = registry.read().profiles.find((entry) => entry.profileId === identified.profileId);
        if (row === undefined) return refusal("PROFILE_SIGN_IN_REFUSED");
        if (row.registration.onboardingCompletion === undefined) return refusal("PROFILE_TRANSITION_BLOCKED");
        const pending = openLogout(row.profileId);
        if (row.lifecycle === "cancelling" || pending !== undefined) return cancelling(pending?.operationId);
        const nowMs = Date.parse(at);
        if (verifiers.locked(row.profileId, nowMs)) return refusal("PROFILE_SIGN_IN_REFUSED");
        if (!verifiers.passwordMatches(row.profileId, fields.password)) {
          verifiers.recordFailure(row.profileId, nowMs);
          return refusal("PROFILE_SIGN_IN_REFUSED");
        }
        const finishing = readOperations().filter((entry): entry is SignUpOperation => entry.kind === "sign-up" && entry.profileId === row.profileId);
        if (finishing.length > 1) return refusal("PROFILE_AUTHORITY_UNAVAILABLE");
        for (const operation of finishing) {
          assertPublishedFinish(operation, row.registration);
          releaseOrdinary(row.profileId); deleteOperation(operation.operationId);
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
        if (upgradeRequested) return refusal("PROFILE_TRANSITION_BLOCKED");
        if (row.lifecycle === "ready" && row.credentialState === "saved") {
          const claim = registry.storageClaim(row.profileId);
          const capture = admission.captureProfileUpgradeHandoff(claim);
          if (capture !== undefined) {
            let credentials: ReturnType<typeof captureReadyUpgradeCredentialSource>;
            try { credentials = captureReadyUpgradeCredentialSource(admission, claim); }
            catch (error) {
              if (error instanceof AuthoritySourceClosureUnprovedError) throw error;
              throw new ProfileUpgradeUnavailableError(error);
            }
            upgradeRequested = true;
            return { ...refusal("PROFILE_UPGRADE_STARTING"), upgrade: issueAuthenticatedProfileUpgrade(row.profileId, capture, credentials) };
          }
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
