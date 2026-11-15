import { fileModified, fileChanged, fileStatus, descriptorStatus, privateFileNumber } from "../storage/file-identity.js";
import { assertMaintenanceCustodyAvailable } from "../storage/maintenance/custody-availability.js";
import { captureCanonicalDraftErasure,eraseCanonicalDraftCredentials,initializeCanonicalCredentials } from "../storage/configuration/canonical-credential-store.js";
import { privatePathRejects } from "../storage/private-path.js";

import { createHash,randomUUID } from "node:crypto";
import { closeSync,constants,existsSync,lstatSync,mkdirSync,openSync,readdirSync,readFileSync,realpathSync,rmSync } from "node:fs";
import { basename,dirname,join,relative,resolve } from "node:path";
import { createNativeBrowserProbe,NativeBrowserClosureUnprovedError } from "../runtime/browser/native-browser.js";

import { z } from "zod";
import { PROTECTED_SETTINGS_SCHEMA_HASH,ProtectedSettingsApplyInputSchema } from "../../models/config/protected-settings.js";
import { resolveConfigWithProvenance } from "../app/config/resolve.js";
import { ProfileOnboardingDuoProviderError } from "../runtime/browser/onboarding-duo-provider.js";
import { createTimeoutDeadlineScheduler } from "../runtime/scheduling/timeout-deadline-scheduler.js";
import { requireRuntimeAdmission } from "../storage/admission/admission-identity.js";
import { type RuntimeAdmission, type StartupRegistrationProof } from "../storage/admission/admission.js";
import { assertPrivateProfilePath,createBrowserRoots } from "../storage/browser-roots.js";
import { assertCredentialStoreOwner,createCredentialStore,CredentialStoreCommitUncertainError,initialDocument,type CredentialStoreHooks } from "../storage/configuration/credential-store.js";
import { hasUnprovedSourceClosure } from '../storage/source-closure.js';
import { AuthorityDatabase } from "../storage/sqlite/authority-database.js";
import { ProfileSessionRefusedError } from "./profile-errors.js";

import { operatorFailureSentence,type ErrorCatalogCode } from "../../models/failures/error-catalog.js";
import { assertFinishedProfileOnboarding,deriveProfileNames,DuoReenrolOperationSchema,LogoutOperationSchema,ProfileAuthoritySnapshotSchema,ProfileNameValidationError,ProfileOperationSchema,profileDetailsPatch,type DuoReenrolOperation,type LogoutOperation,type ProfileDetailsChange,type ProfileRegistryRow,type ProfileAuthoritySnapshot,type ProfileOperation,type SignUpOperation } from "../../models/profiles/profile.js";
import type { ProfileOnboardingMethod } from "../../models/profiles/public-profile.js";
import { DuoReenrolStateSchema,ProfileOnboardingStateSchema,profileAccount,type DuoReenrolState,type ProfileAccount,type ProfileOnboardingState } from "../../models/profiles/public-profile.js";
import type { DuoReenrolCommitIntent } from "../../models/config/duo-credential-store.js";
import { IsoInstantSchema } from "../../rules/identity/ids.js";
import { systemClock,type Clock } from "../../rules/time/clock.js";
import { noSymlinkAncestry,withOperationProof,type DirectoryIdentity } from "../storage/configuration/credential-safe-file.js";
import { createDuoCredentialStore,DuoCredentialError } from "../storage/configuration/duo-credential-store.js";
import { createProfileVerifiers } from "../storage/configuration/verifier-store.js";
import { type CredentialInventory } from "./credential-inventory.js";
import type { ProfileOnboardingDuoProvider } from "./onboarding-duo.js";
import { changeRelayLogin,RelayLoginOutcomeUnknownError,RelayLoginUnsettledError,restoreInterruptedLogin,type RelayLogin,type RelayLoginChange } from "./login-change.js";
import { createProfileOnboarding,type DuoDraft } from "./profile-onboarding.js";
import { appendDuoDiagnostic } from "../logs/duo-diagnostics.js";
import { createDebugEventWriter } from "../logs/debug-events.js";
import { createProfileRegistry,ProfileRegistryAuthorityError,withProfileLock } from "./registry.js";

import type { CredentialStore } from "../../models/config/credential-store.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import type { ChatGptAccountService } from "../accounts/chatgpt-account-service.js";
import type { SettingsRuntimeSnapshot } from "../runtime/settings/settings-runtime.js";

export interface ProfileActivity {
  hasUnquiescedWork(profileId: string): boolean;
  requestCancellation?(profileId: string): void;
}

/**
 * The profile runtime's fence for a Duo re-enrolment commit. Inside one authority write transaction it proves that the profile
 * holds no run, write, lease, artifact, worker child or command, then runs body there to set the commit hold. Body publishes
 * nothing: a machine operation published inside a profile transaction changes the registry that transaction's admission observed.
 */
export interface ProfileIdleFence {
  withIdleProfile<T>(profileId: string, body: () => T): T;
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
}


export interface ProfileLogoutResult extends ProfileRefusal {
  readonly inventory?: CredentialInventory;
}

type LoginChangeResult = { readonly state: "changed"; readonly durability?: "unconfirmed"; readonly failure?: unknown } | { readonly state: "unknown"; readonly failure: unknown } | ProfileRefusal;

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

function contained(profileRoot: string, candidate: string): string {
  const root = realpathSync(profileRoot);
  const path = resolve(root, candidate);
  const remainder = relative(root, path);
  if (remainder.startsWith("..") || remainder === "") throw new Error("profile path escapes its root");
  return path;
}


export function createProfileSession(input: {
  readonly machineRoot: string;
  readonly admission: RuntimeAdmission;
  readonly clock?: Clock;
  readonly onboardingDuo?: ProfileOnboardingDuoProvider;
  readonly account?: Pick<ChatGptAccountService, "readAuthority" | "revalidateAuthority">;
  readonly settings?: { read(): SettingsRuntimeSnapshot };
  readonly activity?: ProfileActivity;
  readonly credentialHooks?: CredentialStoreHooks;
  readonly credentialsFor?: (admission: RuntimeAdmission, purpose: "ordinary" | "settlement") => CredentialStore;
  readonly prepareLogout?: (profileId: string, admission: RuntimeAdmission) => Readonly<{ source: LogoutOperation["source"]; intentFailed(error: unknown): never }>;
  readonly prepareLogoutContinuation?: (operation: LogoutOperation) => void;
  readonly completedLogout?: (operationId: string) => Readonly<{ profileId: string; epoch: number }> | undefined;
  readonly closeStorage?: (profileId: string, admission: RuntimeAdmission) => void;
  readonly sessionChange?: (profileId: string) => { readonly state: "closed" } | ProfileRefusal | ProfileCancelling;
  readonly idleFence?: ProfileIdleFence;
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
  const unsettledLogins = new Map<string, RelayLogin>();
  const onboardingSessions = new Map<string, { readonly operationId: string; readonly epoch: number }>();
  function retainOnboardingBrowserFailure(error: unknown): never {
    if (!hasUnprovedSourceClosure(error) && !(error instanceof ProfileSessionRefusedError && error.code === "BROWSER_CLOSURE_UNPROVED")) throw error;
    throw new ProfileSessionRefusedError("BROWSER_CLOSURE_UNPROVED", { cause: error });
  }
  const completedOnboarding = new Map<string, { operationId: string; session: ActiveProfileSession }>();
  const storageAdmissions = new Map<string, { ordinary?: RuntimeAdmission; settlement?: RuntimeAdmission }>();
  const authoritySnapshots = new WeakSet<ProfileAuthoritySnapshot>();
  let logoutContinuationGeneration = 0;
  /** Profiles whose re-enrolment commit has started an effect it has not proved settled; every session of them reads as stale. */
  const commitHolds = new Set<string>();

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
      const info = fileStatus(path);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("profile operation is malformed");
      const parsed = ProfileOperationSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
      if (!parsed.success) throw new Error("profile operation is malformed");
      operations.push(parsed.data);
    }
    return operations;
  }

  function deleteOperation(operationId: string): void {
    admission.publishProfileOperation(operationId);
  }

  function storeFor(profileId: string, capability = admittedProfile(profileId), purpose: "ordinary" | "settlement" = "ordinary") {
    const profileRoot = registry.profileRoot(profileId);
    const store = input.credentialsFor?.(capability, purpose) ?? createCredentialStore({
      admission: capability,
      stateRoot: profileRoot,
      hooks: input.credentialHooks,
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
      capability = admission.admitProfile(profileId);
      if (capability.isProfileInitialization() && !existsSync(join(capability.stateRoot, "state.db"))) AuthorityDatabase.initializeProfile(capability);
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
      || commitHolds.has(session.profileId)
      || readOperations().some(operation => operation.kind === "logout" ? operation.phase !== "complete"
        : operation.profileId === session.profileId && (operation.kind === "sign-up" || operation.commit !== undefined))) {
      sessions.delete(token);
      return refusal("PROFILE_SESSION_STALE");
    }
    session.admission.assertLive();
    admittedProfile(session.profileId);
    return session;
  }

  function activate(profileId: string): ActiveProfileSession {
    admission.assertWritable();
    admission.lifetime.assertRuntimeAvailable();
    const selected = registry.read().activeProfileId;
    if (selected !== null && selected !== profileId) throw new Error("profile-session-not-current");
    const epoch = registry.advanceSession(profileId, "profile-activated");
    sessions.clear();
    unsettledLogins.clear();
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

  function settleSignUp(operation: SignUpOperation, proof?: StartupRegistrationProof): string {
    admission.assertWritable();
    assertFinishedProfileOnboarding(operation);
    if (operation.phase !== "publishing") { operation = { ...operation, phase: "publishing" }; writeOperation(operation); }
    const profile = admission.admitProfilePublication(operation.operationId);
    try { registry.publishSignUp(operation, profile, proof); }
    finally { profile.release(); }
    releaseOrdinary(operation.profileId);
    deleteOperation(operation.operationId);
    return operation.profileId;
  }

  function publishSignUp(operation: SignUpOperation): ActiveProfileSession { return activate(settleSignUp(operation)); }

  function signUpDraft(operation: SignUpOperation): DuoDraft {
    const draft = operation.onboarding;
    if (draft === undefined || operation.phase !== "applying" && !(operation.phase === "publishing" && draft.finish !== undefined)) throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE");
    return { operationId: operation.operationId, profileId: operation.profileId, accountId: draft.accountId, generation: draft.generation,
      attempts: draft.attempts, sealed: draft.finish !== undefined, aborted: draft.abort !== undefined, settle: "confirm" };
  }

  function reenrolDraft(operation: DuoReenrolOperation): DuoDraft {
    return { operationId: operation.operationId, profileId: operation.profileId, accountId: operation.draft.accountId, generation: operation.draft.generation,
      attempts: operation.draft.attempts, sealed: operation.commit !== undefined, aborted: operation.abort !== undefined, settle: "stage" };
  }

  function duoSetupState(draft: DuoDraft) {
    const method = (name: "key" | "touch") => {
      const attempt = draft.attempts.findLast(entry => entry.method === name && entry.generation === draft.generation);
      if (draft.aborted) return { state: "unavailable" as const, ceremonyObserved: false, portalAccepted: false, operatorConfirmed: false, exactCredentialRequestObserved: false };
      const idle = input.onboardingDuo === undefined ? "unavailable" as const : "idle" as const;
      const state = attempt?.state === "closed" ? idle : attempt?.state ?? idle;
      return { state: attempt !== undefined && state === "pending"
          && attempt.providerClosedAt === undefined && !onboarding.hasLiveAttempt(attempt.attemptId) ? "unknown" as const : state,
        ...(attempt === undefined ? {} : { attemptId: attempt.attemptId }),
        ceremonyObserved: attempt?.ceremony !== undefined, portalAccepted: attempt?.portal?.acceptance === "portal-accepted",
        operatorConfirmed: attempt?.operatorConfirmedAt !== undefined,
        ...(attempt?.ceremony?.mechanism === "native-platform" || attempt?.ceremony?.mechanism === "chromium-platform" ? { platformAuthenticator: attempt.ceremony.mechanism } : {}),
        exactCredentialRequestObserved: attempt?.portal?.acceptance === "exact-credential-request" };
    };
    const methods = { key: method("key"), touch: method("touch") };
    return { operationId: draft.operationId, profileId: draft.profileId,
      step: methods.key.state === "complete" && methods.touch.state === "complete" ? "ready" as const : "duo" as const, methods, browser: onboarding.browserState(draft.operationId) };
  }

  function onboardingState(operation: SignUpOperation): ProfileOnboardingState {
    return ProfileOnboardingStateSchema.parse({ state: "onboarding", ...duoSetupState(signUpDraft(operation)) });
  }

  function reenrolState(operation: DuoReenrolOperation): DuoReenrolState {
    return DuoReenrolStateSchema.parse({ state: "duo-reenrol", ...duoSetupState(reenrolDraft(operation)) });
  }

  /** A re-enrolment for a registered profile; the internal closure authority needs no session, only this binding. */
  function registeredReenrol(operationId: string): DuoReenrolOperation {
    const operation = readOperations().find((entry): entry is DuoReenrolOperation => entry.kind === "duo-reenrol" && entry.operationId === operationId);
    if (operation === undefined || !registry.read().profiles.some(row => row.profileId === operation.profileId)) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
    return operation;
  }

  function reenrolmentFor(profileId: string): DuoReenrolOperation | undefined {
    const open = readOperations().filter((entry): entry is DuoReenrolOperation => entry.kind === "duo-reenrol" && entry.profileId === profileId);
    if (open.length > 1) throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE");
    return open[0];
  }

  /** The public authority: the active session's own, Duo-ready profile and its open re-enrolment. */
  function requireReenrol(token: string, operationId: string, allowAbort = false): { session: { profileId: string; epoch: number; admission: RuntimeAdmission }; operation: DuoReenrolOperation } {
    const session = requireSession(token);
    if ("state" in session) throw new ProfileSessionRefusedError(session.code);
    const operation = registeredReenrol(operationId);
    if (operation.profileId !== session.profileId) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
    if (registry.read().profiles.find(row => row.profileId === session.profileId)?.duoState !== "ready") throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE");
    if (!allowAbort && operation.abort !== undefined) throw new ProfileSessionRefusedError("PROFILE_TRANSITION_BLOCKED");
    return { session, operation };
  }

  function requireOnboardingSession(token: string, operationId: string) {
    const session = onboardingSessions.get(token);
    if (session?.operationId !== operationId) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
    return session;
  }

  function requireOnboarding(token: string, operationId: string, allowAbort = false): SignUpOperation {
    const session = requireOnboardingSession(token, operationId);
    admission.assertWritable();
    if (session.epoch !== registry.read().sessionGeneration) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
    const operation = readOperations().find((entry): entry is SignUpOperation => entry.kind === "sign-up" && entry.operationId === operationId);
    if (operation?.onboarding === undefined || operation.phase !== "applying" && !(operation.phase === "publishing" && operation.onboarding.finish !== undefined)) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
    const published = registry.read().profiles.find(row => row.profileId === operation.profileId);
    if (published !== undefined) assertPublishedFinish(operation, published.registration);
    if (!allowAbort && operation.onboarding.abort !== undefined) throw new ProfileSessionRefusedError("PROFILE_TRANSITION_BLOCKED");
    return operation;
  }

  function issueOnboardingSession(operation: SignUpOperation): OnboardingProfileSession {
    for (const [token, pending] of onboardingSessions) if (pending.operationId === operation.operationId) onboardingSessions.delete(token);
    const token = randomUUID(); onboardingSessions.set(token, { operationId: operation.operationId, epoch: registry.read().sessionGeneration });
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
    if (selection.profiles.some(row => row.lifecycle === "cancelling") || readOperations().some(entry => entry.kind === "logout" && entry.phase !== "complete")) return refusal("PROFILE_LOGOUT_INCOMPLETE");
    if (selection.activeProfileId !== null) return refusal("PROFILE_SIGN_UP_OTHER_SIGNED_IN");
    const emailKey = verifiers.emailKeyFor(fields.email);
    if (readOperations().some(entry => entry.kind === "sign-up")) return refusal("PROFILE_TRANSITION_BLOCKED");
    const identified = verifiers.identify(fields.email);
    if (identified !== "unknown" && registry.read().profiles.some((row) => row.profileId === identified.profileId)) {
      return refusal("PROFILE_OTHER_EMAIL");
    }
    let operation = admission.beginProfileSignUp({
      emailKey, firstName: names.firstName, lastName: names.lastName, createdAt: IsoInstantSchema.parse(fields.createdAt), commandFingerprint: "a".repeat(64),
    });
    if (operation.onboarding === undefined || operation.phase !== "applying" && !(operation.phase === "publishing" && operation.onboarding.finish !== undefined)) return refusal("PROFILE_AUTHORITY_UNAVAILABLE");
    if (operation.onboarding.abort !== undefined) return refusal("PROFILE_TRANSITION_BLOCKED");
    if (operation.firstName !== names.firstName || operation.lastName !== names.lastName) return refusal("PROFILE_SIGN_IN_REFUSED");
    registry.ensureRoot(operation.profileId);
    const profile = admittedProfile(operation.profileId), initial = initialDocument();
    initializeCanonicalCredentials(admission, profile, operation, { revision: initial.record.revision, value: initial });
    if (operation.credentials.phase !== "ready") {
      operation = { ...operation, credentials: { ...operation.credentials, phase: "ready", protectedRevision: initial.record.revision } };
      writeOperation(operation);
    }
    const store = storeFor(operation.profileId, profile);
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
        && current.ucpathPassword?.value === fields.password;
      if (!same) return refusal("PROFILE_SIGN_IN_REFUSED");
    }
    return issueOnboardingSession(operation);
  }

  function admitSignedIn(row: ProfileRegistryRow, at: ReturnType<typeof IsoInstantSchema.parse>,
    credentialsMatch: (entries: ReturnType<ReturnType<typeof storeFor>["read"]>["entries"]) => boolean, proved?: RelayLogin): ActiveProfileSession | ProfileRefusal | ProfileCancelling {
    const finishing = readOperations().filter((entry): entry is SignUpOperation => entry.kind === "sign-up" && entry.profileId === row.profileId && entry.onboarding !== undefined);
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
    try {
      const active = activate(row.profileId);
      // A draft boot aborted while its profile was signed out is discarded before the first credential read, which its stage files would refuse.
      const leftover = reenrolmentFor(row.profileId);
      if (leftover?.abort !== undefined && leftover.commit === undefined) discardDuoReenrol(leftover);
      const store = storeFor(row.profileId);
      if (proved !== undefined) restoreInterruptedLogin(verifiers, store, row.profileId, proved, at);
      if (!credentialsMatch(store.read().entries)) {
        sessions.clear();
        registry.advanceSession(selection.activeProfileId, "profile-sign-in-refused");
        releaseOrdinary(row.profileId);
        return refusal("PROFILE_AUTHORITY_UNAVAILABLE");
      }
      verifiers.clearFailures(row.profileId);
      registry.update(row.profileId, { lastSignedInAt: at, lifecycle: "ready" });
      return active;
    } catch (error) {
      sessions.clear();
      try { registry.advanceSession(selection.activeProfileId, "profile-sign-in-refused"); if (!hasUnprovedSourceClosure(error)) releaseOrdinary(row.profileId); }
      catch (cleanup) { throw new AggregateError([error, cleanup], "profile sign-in and selection closure failed", { cause: cleanup }); }
      throw error;
    }
  }

  function continueLogout(operation: LogoutOperation): { readonly state: "signed-out" } | ProfileLogoutResult | ProfileCancelling {
    admission.assertWritable();
    const profileId = operation.profileId, selection = registry.read();
    const row = selection.profiles.find(row => row.profileId === profileId);
    const before = operation.settlement === undefined && selection.sessionGeneration === operation.sessionGeneration && selection.activeProfileId === profileId && row?.lifecycle === "ready";
    const revoked = selection.sessionGeneration === operation.sessionGeneration + 1 && selection.activeProfileId === null
      && (row?.lifecycle === "cancelling" || row?.lifecycle === "ready" && (operation.settlement === undefined || operation.settlement.phase === "done"));
    if (!before && !revoked) return refusal("PROFILE_TRANSITION_BLOCKED", operation.operationId);
    if (before) registry.advanceSession(null, "profile-logout-continuation");
    if (row?.lifecycle !== "cancelling" && operation.settlement?.phase !== "done") registry.update(profileId, { lifecycle: "cancelling" });
    input.prepareLogoutContinuation?.(operation);
    const closure = quiescence(profileId);
    if (closure !== "idle") {
      if (closure === "busy") input.activity?.requestCancellation?.(profileId);
      if (operation.settlement === undefined) writeOperation({ ...operation, phase: closure === "busy" ? "cancelling" : "incomplete" });
      return cancelling(operation.operationId);
    }
    if (input.prepareLogoutContinuation !== undefined) return cancelling(operation.operationId);
    return refusal("PROFILE_LOGOUT_BLOCKED", operation.operationId);
  }

  const onboarding = createProfileOnboarding({
    onEvent: (draft, event) => {
      const clock = input.clock ?? systemClock;
      appendDuoDiagnostic(machineRoot, clock.now(), event);
      AuthorityDatabase.withProfileOnboardingTimeline(admittedProfile(draft.profileId), clock, repository => {
        const build = z.object({ version: z.string().min(1) }).parse(JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"))).version;
        createDebugEventWriter({ repository, clock, build }).emit({ category: "duo",
          phase: event.stage === "refused" || event.stage === "aborted" ? "failed" : event.stage === "timed-out" ? "expired" : event.stage === "replied" ? "settled" : "started",
          ...(event.code === undefined ? {} : { code: event.code }), ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
          correlationId: event.requestId ?? draft.operationId, area: "profile-onboarding", reason: event.detail ? `${event.stage}-${event.detail}` : event.stage },
        { kind: "transport", connectionId: draft.operationId });
      });
    },
    failureDiagnostic: error => error instanceof ProfileOnboardingDuoProviderError ? { kind: error.kind, causeTag: error.reason } : { kind: "unknown", causeTag: "provider" }, clock: input.clock ?? systemClock,
    onFailure: (attempt, failure) => {
      const clock = input.clock ?? systemClock;
      AuthorityDatabase.withProfileOnboardingTimeline(admittedProfile(attempt.profileId), clock, repository => {
        const build = z.object({ version: z.string().min(1) }).parse(JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"))).version;
        createDebugEventWriter({ repository, clock, build }).emit({ category: "duo", phase: "failed", correlationId: attempt.attemptId,
          area: "profile-onboarding", reason: failure.causeTag,
          code: "PROFILE_ONBOARDING_DUO_FAILED", message: JSON.stringify({ method: attempt.method, ...failure }), pinned: true },
        { kind: "transport", connectionId: attempt.operationId });
      });
    },
    ...(input.onboardingDuo === undefined ? {} : { provider: input.onboardingDuo }),
    read: operationId => {
      const operation = readOperations().find((entry): entry is SignUpOperation | DuoReenrolOperation => entry.kind !== "logout" && entry.operationId === operationId);
      if (operation?.kind === "duo-reenrol") return reenrolDraft(registeredReenrol(operationId));
      if (operation === undefined || registry.read().profiles.some(row => row.profileId === operation.profileId)) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
      return signUpDraft(operation);
    },
    update: (operationId, change) => withProfileLock(machineRoot, () => {
      const operation = readOperations().find((entry): entry is SignUpOperation | DuoReenrolOperation => entry.kind !== "logout" && entry.operationId === operationId);
      if (operation?.kind === "duo-reenrol") {
        const current = registeredReenrol(operationId);
        if (current.commit !== undefined) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
        const outcome = change(reenrolDraft(current));
        writeOperation({ ...current, draft: { ...current.draft, attempts: [...outcome.attempts] } }); return outcome.result;
      }
      if (operation?.onboarding === undefined || operation.phase !== "applying"
        || registry.read().profiles.some(row => row.profileId === operation.profileId)) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
      const outcome = change(signUpDraft(operation)); writeOperation({ ...operation, onboarding: { ...operation.onboarding, attempts: [...outcome.attempts] } }); return outcome.result;
    }),
    publicState: draft => {
      const operation = readOperations().find((entry): entry is SignUpOperation | DuoReenrolOperation => entry.kind !== "logout" && entry.operationId === draft.operationId);
      if (operation?.kind === "duo-reenrol") return reenrolState(operation);
      if (operation === undefined) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
      return onboardingState(operation);
    },
    store: draft => createDuoCredentialStore(admittedProfile(draft.profileId), input.clock ?? systemClock),
  });

  /**
   * Change the signed-in profile's Relay login under the profile lock. A change left unsettled keeps its proved old login in
   * memory for this session, and the session's next change writes it back first; after a restart the old-login sign-in does.
   */
  function changeLogin(token: string, fields: { readonly currentPassword: string; readonly change: RelayLoginChange; readonly at: string }): LoginChangeResult {
    const at = IsoInstantSchema.parse(fields.at);
    admission.assertWritable();
    admission.lifetime.assertRuntimeAvailable();
    const initial = requireSession(token);
    if ("state" in initial) return initial;
    let settled: LoginChangeResult | undefined;
    // The lock release runs after the change settled: its failure is surfaced with that result, never in place of a landed login.
    try { return withProfileLock(machineRoot, () => (settled = changeLoginLocked(token, fields, at))); }
    catch (error) {
      if (hasUnprovedSourceClosure(error)) admission.retainSourceClosure(error);
      if (settled === undefined || settled.state === "refused") throw error;
      return { ...settled, failure: settled.failure === undefined ? error : new AggregateError([settled.failure, error], "profile login change and its lock release failed") };
    }
  }

  function changeLoginLocked(token: string, fields: { readonly currentPassword: string; readonly change: RelayLoginChange }, at: string): LoginChangeResult {
    const session = requireSession(token);
    if ("state" in session) return session;
    if (readOperations().some(operation => operation.kind === "sign-up")) return refusal("PROFILE_TRANSITION_BLOCKED");
    const store = storeFor(session.profileId, session.admission);
    const unsettled = unsettledLogins.get(token);
    if (unsettled !== undefined) { restoreInterruptedLogin(verifiers, store, session.profileId, unsettled, at); unsettledLogins.delete(token); }
    const priorEmail = store.read().entries.ucpathUserId?.value;
    try {
      const outcome = changeRelayLogin(verifiers, store, session.profileId, { ...fields, at });
      if (outcome.kind === "refused") return refusal(outcome.code);
      if (outcome.kind === "changed") return { state: "changed" };
      if (hasUnprovedSourceClosure(outcome.failure)) admission.retainSourceClosure(outcome.failure);
      return { state: "changed", durability: "unconfirmed", failure: outcome.failure };
    } catch (error) {
      const unclosed = hasUnprovedSourceClosure(error), settleable = error instanceof RelayLoginUnsettledError || error instanceof RelayLoginOutcomeUnknownError;
      if (unclosed) admission.retainSourceClosure(error);
      // The next change writes the proved old login back only if the swap did not land; a landed swap already proves the new one.
      if (settleable && priorEmail !== undefined) unsettledLogins.set(token, { email: priorEmail, password: fields.currentPassword });
      if (unclosed || !settleable || priorEmail === undefined) throw error;
      return error instanceof RelayLoginOutcomeUnknownError ? { state: "unknown", failure: error } : refusal("PROFILE_LOGIN_CHANGE_UNSETTLED");
    }
  }

  async function cancelOnboarding(token: string, operationId: string): Promise<{ readonly state: "signed-out" }> {
    requireOnboardingSession(token, operationId);
    withProfileLock(machineRoot, () => {
      const operation = requireOnboarding(token, operationId, true);
      if (operation.onboarding?.finish !== undefined) throw new ProfileSessionRefusedError("PROFILE_TRANSITION_BLOCKED");
      onboarding.beginTransition(operationId);
    });
    try { await onboarding.drain(operationId).catch(retainOnboardingBrowserFailure); }
    finally { onboarding.endTransition(operationId); }
    withProfileLock(machineRoot, () => {
      const operation = requireOnboarding(token, operationId, true), draft = operation.onboarding;
      if (draft === undefined || draft.finish !== undefined) throw new ProfileSessionRefusedError("PROFILE_TRANSITION_BLOCKED");
      if (draft.abort === undefined) writeOperation({ ...operation, onboarding: { ...draft,
        abort: { operationId: randomUUID(), generation: operation.credentials.generation + 1 } } });
    });
    return withProfileLock(machineRoot, () => {
      const operation = requireOnboarding(token, operationId, true);
      onboarding.assertAbortable(operationId);
      if (admission.abortUnpublishedProfile(operation)) {
        for (const [current, pending] of onboardingSessions) if (pending.operationId === operationId) onboardingSessions.delete(current);
        return { state: "signed-out" };
      }
      const profile = storageAdmissions.get(operation.profileId)?.ordinary ?? admission.admitProfileAbort(operation.operationId);
      storageAdmissions.set(operation.profileId, { ...storageAdmissions.get(operation.profileId), ordinary: profile });
      eraseCanonicalDraftCredentials(admission, profile, operation);
      const head = captureCanonicalDraftErasure(admission, profile, operation);
      releaseOrdinary(operation.profileId);
      admission.abortUnpublishedProfile(operation, head);
      for (const [current, pending] of onboardingSessions) if (pending.operationId === operationId) onboardingSessions.delete(current);
      return { state: "signed-out" };
    });
  }

  function duoStore(profileId: string) { return createDuoCredentialStore(admittedProfile(profileId), input.clock ?? systemClock); }

  /** Drains the draft's browser and attempts, then aborts it: its rows are discarded and the operation removed; the ready set is untouched. */
  async function abandonDuoReenrol(operationId: string, authorize: () => DuoReenrolOperation): Promise<void> {
    withProfileLock(machineRoot, () => {
      const operation = authorize();
      if (operation.commit !== undefined || commitHolds.has(operation.profileId)) throw new ProfileSessionRefusedError("PROFILE_DUO_REENROL_UNCERTAIN");
      onboarding.beginTransition(operationId);
    });
    try { await onboarding.drain(operationId).catch(retainOnboardingBrowserFailure); }
    finally { onboarding.endTransition(operationId); }
    withProfileLock(machineRoot, () => discardDuoReenrol(authorize()));
  }

  /** Marks a drained draft aborted, so it can never be started, shown or committed again. */
  function abortDuoReenrol(operation: DuoReenrolOperation): DuoReenrolOperation {
    if (operation.commit !== undefined || commitHolds.has(operation.profileId)) throw new ProfileSessionRefusedError("PROFILE_DUO_REENROL_UNCERTAIN");
    onboarding.assertAbortable(operation.operationId);
    if (operation.abort !== undefined) return operation;
    const aborted = { ...operation, abort: { abortedAt: IsoInstantSchema.parse((input.clock ?? systemClock).now().toISOString()) } };
    writeOperation(aborted);
    return aborted;
  }

  function discardDuoReenrol(operation: DuoReenrolOperation): void {
    const aborted = abortDuoReenrol(operation);
    duoStore(aborted.profileId).discardDraft(aborted.draft.accountId);
    deleteOperation(aborted.operationId);
  }

  /** The commit intent for exactly the credentials the draft's two proved attempts stored; anything else is a pre-effect refusal. */
  function prepareDuoReenrolCommit(operation: DuoReenrolOperation): DuoReenrolCommitIntent {
    const draft = reenrolDraft(operation);
    onboarding.verifyProved(draft);
    const proved = (["key", "touch"] as const).flatMap(method => {
      const receipt = draft.attempts.findLast(entry => entry.method === method && entry.generation === draft.generation);
      return receipt?.ceremony === undefined || receipt.ceremony.mechanism === "native-platform" ? [] : [receipt.ceremony.credentialId];
    });
    let intent: DuoReenrolCommitIntent;
    try { intent = duoStore(operation.profileId).prepareReenrolCommit(draft.accountId); }
    catch (error) {
      if (error instanceof DuoCredentialError && error.code === "DUO_CREDENTIAL_CONFLICT") throw new ProfileSessionRefusedError("PROFILE_DUO_REENROL_REFUSED", { cause: error });
      throw error;
    }
    if (canonicalJsonStringify([...intent.stagedIds].sort()) !== canonicalJsonStringify([...proved].sort())) throw new ProfileSessionRefusedError("PROFILE_DUO_REENROL_REFUSED");
    return intent;
  }

  /**
   * One validated reconciliation after a commit effect failed: the operation, the head and the record are each classified against
   * the intent. Only when every piece is applied or not applied does it finish the remaining steps and clear the hold.
   */
  function reconcileDuoReenrolCommit(profileId: string, operationId: string, intent: DuoReenrolCommitIntent, failure: unknown): never {
    let released = false;
    try {
      const recorded = readOperations().find(entry => entry.operationId === operationId);
      const store = duoStore(profileId), state = store.inspectReenrolCommit(intent);
      const published = recorded?.kind === "duo-reenrol" && recorded.commit !== undefined && canonicalJsonStringify(recorded.commit) === canonicalJsonStringify(intent);
      if (recorded?.kind === "duo-reenrol" && recorded.commit === undefined && state.head === "not-applied" && state.record === "not-applied") released = true;
      else if (published && state.record !== "unprovable" && state.head !== "unprovable") {
        store.commitReenrol(intent);
        deleteOperation(operationId);
        released = true;
      } else if (recorded === undefined && state.head === "applied" && state.record === "applied") released = true;
    } catch (cause) {
      if (hasUnprovedSourceClosure(cause)) admission.retainSourceClosure(cause);
      throw new ProfileSessionRefusedError("PROFILE_DUO_REENROL_UNCERTAIN", { cause: new AggregateError([failure, cause], "duo-reenrol-commit-reconciliation-unproved") });
    }
    if (released) commitHolds.delete(profileId);
    throw new ProfileSessionRefusedError("PROFILE_DUO_REENROL_UNCERTAIN", { cause: failure });
  }

  return withProvedOperations({
    close(): void {
      onboarding.assertClosed();
      logoutContinuationGeneration++;
      sessions.clear();
      unsettledLogins.clear();
      onboardingSessions.clear();
      completedOnboarding.clear();
      for (const profileId of storageAdmissions.keys()) {
        releaseOrdinary(profileId);
        releaseSettlement(profileId);
        storageAdmissions.delete(profileId);
      }
    },
    closeOnboarding(): Promise<void> { return onboarding.close(); },
    /** Opens, or returns the open, Duo re-enrolment for the active session's Duo-ready profile; its old enrolment keeps signing. */
    beginDuoReenrol(token: string): DuoReenrolState {
      admission.assertWritable();
      admission.lifetime.assertRuntimeAvailable();
      return withProfileLock(machineRoot, () => {
        const session = requireSession(token);
        if ("state" in session) throw new ProfileSessionRefusedError(session.code);
        if (registry.read().profiles.find(row => row.profileId === session.profileId)?.duoState !== "ready") throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE");
        const open = reenrolmentFor(session.profileId);
        // An aborted draft is returned too, so its cancel can finish the discard.
        if (open !== undefined) return reenrolState(open);
        const operation = DuoReenrolOperationSchema.parse({ schemaVersion: 1, kind: "duo-reenrol", operationId: randomUUID(), profileId: session.profileId,
          createdAt: IsoInstantSchema.parse((input.clock ?? systemClock).now().toISOString()), draft: { accountId: randomUUID(), generation: 1, attempts: [] } });
        writeOperation(operation);
        return reenrolState(operation);
      });
    },
    readDuoReenrol(token: string, operationId: string): DuoReenrolState {
      return withProfileLock(machineRoot, () => reenrolState(requireReenrol(token, operationId, true).operation));
    },
    async showDuoReenrolBrowser(token: string, operationId: string): Promise<DuoReenrolState> {
      requireReenrol(token, operationId);
      await onboarding.showBrowser(operationId).catch(retainOnboardingBrowserFailure);
      return reenrolState(requireReenrol(token, operationId).operation);
    },
    async reopenDuoReenrolBrowser(token: string, operationId: string, generation: number): Promise<DuoReenrolState> {
      requireReenrol(token, operationId);
      await onboarding.reopenBrowser(operationId, generation);
      return reenrolState(requireReenrol(token, operationId).operation);
    },
    async openDuoReenrolPortal(token: string, operationId: string): Promise<DuoReenrolState> {
      requireReenrol(token, operationId);
      await onboarding.openPortal(operationId).catch(retainOnboardingBrowserFailure);
      return reenrolState(requireReenrol(token, operationId).operation);
    },
    async startDuoReenrol(token: string, operationId: string, method: ProfileOnboardingMethod): Promise<DuoReenrolState> {
      withProfileLock(machineRoot, () => requireReenrol(token, operationId));
      await onboarding.start(operationId, method).catch(retainOnboardingBrowserFailure);
      return reenrolState(requireReenrol(token, operationId).operation);
    },
    confirmDuoReenrol(token: string, operationId: string, method: ProfileOnboardingMethod, attemptId: string): DuoReenrolState {
      withProfileLock(machineRoot, () => requireReenrol(token, operationId));
      onboarding.confirm(operationId, method, attemptId);
      return reenrolState(requireReenrol(token, operationId).operation);
    },
    async cancelDuoReenrolAttempt(token: string, operationId: string, method: ProfileOnboardingMethod, attemptId: string): Promise<DuoReenrolState> {
      withProfileLock(machineRoot, () => requireReenrol(token, operationId));
      await onboarding.cancelAttempt(operationId, method, attemptId).catch(retainOnboardingBrowserFailure);
      return reenrolState(requireReenrol(token, operationId).operation);
    },
    /** Abandons the re-enrolment: the profile, its session and its ready Duo set stay exactly as they were. */
    async cancelDuoReenrol(token: string, operationId: string): Promise<ActiveProfileSession> {
      const { session } = requireReenrol(token, operationId, true);
      await abandonDuoReenrol(operationId, () => requireReenrol(token, operationId, true).operation);
      return { state: "active", token, epoch: session.epoch, profileId: session.profileId };
    },
    /**
     * The internal closure authority: no session, bound to a registered profile and its own open re-enrolment, able only to drain
     * and abort. Logout and delete account refuse while a re-enrolment exists, so their callers close it first, before revoking.
     */
    async closeDuoReenrol(profileId: string): Promise<void> {
      const operation = withProfileLock(machineRoot, () => {
        if (!registry.read().profiles.some(row => row.profileId === profileId)) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
        return reenrolmentFor(profileId);
      });
      if (operation === undefined) return;
      const authorize = () => {
        const current = registeredReenrol(operation.operationId);
        if (current.profileId !== profileId) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
        return current;
      };
      await abandonDuoReenrol(operation.operationId, authorize);
    },
    /**
     * Replaces the ready Duo set with the draft's two staged credentials when the profile is idle. A refusal before any effect leaves
     * the draft committable; once an effect starts the profile stays closed until one reconciliation proves the outcome.
     */
    async commitDuoReenrol(token: string, operationId: string): Promise<ActiveProfileSession> {
      const initial = requireReenrol(token, operationId);
      onboarding.assertBrowserAvailable(operationId);
      if (reenrolState(initial.operation).step !== "ready") throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE");
      onboarding.beginTransition(operationId);
      try { await onboarding.drain(operationId).catch(retainOnboardingBrowserFailure); }
      finally { onboarding.endTransition(operationId); }
      return withProfileLock(machineRoot, () => {
        const { session, operation } = requireReenrol(token, operationId), profileId = session.profileId, fence = input.idleFence;
        if (fence === undefined) throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE");
        const intent = prepareDuoReenrolCommit(operation);
        // The hold is set in the transaction that proved the profile idle; from then on every session and context of it refuses, and
        // the swap below runs synchronously, so nothing enters between the proof and the swap.
        try { fence.withIdleProfile(profileId, () => { commitHolds.add(profileId); }); }
        catch (error) { commitHolds.delete(profileId); throw error; }
        try {
          writeOperation({ ...operation, commit: intent });
          duoStore(profileId).commitReenrol(intent);
          deleteOperation(operationId);
        } catch (error) { reconcileDuoReenrolCommit(profileId, operationId, intent, error); }
        commitHolds.delete(profileId);
        return { state: "active", token, epoch: session.epoch, profileId };
      });
    },
    /** Whether a re-enrolment commit holds this profile closed in this process. */
    duoReenrolCommitHeld(profileId: string): boolean { return commitHolds.has(profileId); },
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
      admission.lifetime.assertRuntimeAvailable();
      return withProfileLock(machineRoot, () => signUpLocked(fields, names));
    },
    assertOnboardingAbort(token: string, operationId: string): void {
      requireOnboardingSession(token, operationId);
      withProfileLock(machineRoot, () => requireOnboarding(token, operationId, true));
    },
    readOnboarding(token: string, operationId: string): ProfileOnboardingState {
      requireOnboardingSession(token, operationId);
      return withProfileLock(machineRoot, () => onboardingState(requireOnboarding(token, operationId, true)));
    },
    async showOnboardingBrowser(token: string, operationId: string): Promise<ProfileOnboardingState> {
      requireOnboarding(token, operationId);
      await onboarding.showBrowser(operationId).catch(retainOnboardingBrowserFailure);
      return onboardingState(requireOnboarding(token, operationId));
    },
    async reopenOnboardingBrowser(token: string, operationId: string, generation: number): Promise<ProfileOnboardingState> {
      requireOnboarding(token, operationId);
      await onboarding.reopenBrowser(operationId, generation);
      return onboardingState(requireOnboarding(token, operationId));
    },
    async openOnboardingPortal(token: string, operationId: string): Promise<ProfileOnboardingState> {
      requireOnboarding(token, operationId);
      await onboarding.openPortal(operationId).catch(retainOnboardingBrowserFailure);
      return onboardingState(requireOnboarding(token, operationId));
    },
    async startOnboardingDuo(token: string, operationId: string, method: ProfileOnboardingMethod): Promise<ProfileOnboardingState> {
      requireOnboardingSession(token, operationId);
      withProfileLock(machineRoot, () => requireOnboarding(token, operationId));
      await onboarding.start(operationId, method).catch(retainOnboardingBrowserFailure);
      return onboardingState(requireOnboarding(token, operationId));
    },
    confirmOnboardingDuo(token: string, operationId: string, method: ProfileOnboardingMethod, attemptId: string): ProfileOnboardingState {
      requireOnboardingSession(token, operationId);
      withProfileLock(machineRoot, () => requireOnboarding(token, operationId));
      onboarding.confirm(operationId, method, attemptId);
      return onboardingState(requireOnboarding(token, operationId));
    },
    async cancelOnboardingDuo(token: string, operationId: string, method: ProfileOnboardingMethod, attemptId: string): Promise<ProfileOnboardingState> {
      requireOnboardingSession(token, operationId);
      withProfileLock(machineRoot, () => requireOnboarding(token, operationId));
      await onboarding.cancelAttempt(operationId, method, attemptId).catch(retainOnboardingBrowserFailure);
      return onboardingState(requireOnboarding(token, operationId));
    },
    async completeOnboarding(token: string, operationId: string): Promise<ActiveProfileSession> {
      const completed = completedOnboarding.get(token);
      if (completed !== undefined) {
        if (completed.operationId !== operationId || "state" in requireSession(completed.session.token)) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
        return completed.session;
      }
      const initial = requireOnboarding(token, operationId);
      onboarding.assertBrowserAvailable(operationId);
      if (onboardingState(initial).step !== "ready") throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE");
      if (!registry.read().profiles.some(row => row.profileId === initial.profileId)) {
        onboarding.beginTransition(operationId);
        try { await onboarding.drain(operationId).catch(retainOnboardingBrowserFailure); }
        finally { onboarding.endTransition(operationId); }
      }
      return withProfileLock(machineRoot, () => {
        const pending = requireOnboarding(token, operationId);
        if (pending.onboarding === undefined) throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE");
        if (pending.onboarding.finish === undefined) {
          const candidate: SignUpOperation = { ...pending, phase: "publishing", onboarding: { ...pending.onboarding,
            finish: { finishId: randomUUID(), finishedAt: IsoInstantSchema.parse((input.clock ?? systemClock).now().toISOString()) } } };
          onboarding.verifyProved(signUpDraft(candidate));
          assertFinishedProfileOnboarding(candidate);
          writeOperation(candidate);
        }
        const operation = requireOnboarding(token, operationId), session = publishSignUp(operation);
        onboardingSessions.delete(token); completedOnboarding.set(token, { operationId, session });
        return session;
      });
    },
    cancelOnboarding,
    async recoverOnboarding(options: Readonly<{ deferActivation?: boolean; finishOnly?: boolean; registrationProofs?: readonly StartupRegistrationProof[] }> = {}): Promise<void> {
      const operations = readOperations().filter((entry): entry is SignUpOperation => entry.kind === "sign-up" && entry.onboarding !== undefined);
      const reenrolments = readOperations().filter((entry): entry is DuoReenrolOperation => entry.kind === "duo-reenrol");
      const selected = options.finishOnly === true ? operations.filter(operation => operation.onboarding?.finish !== undefined) : operations;
      // A recorded commit is reconciled under stopped custody. Every other draft's browser is proved closed, its attempts closed and the
      // draft aborted; its rows are discarded now for the profile this boot would resume, otherwise at that profile's next sign-in.
      const closed = options.finishOnly === true ? [] : reenrolments.filter(operation => operation.commit === undefined);
      if (selected.length === 0 && closed.length === 0) return;
      const selectedIds = new Set([...selected, ...closed].map(operation => operation.operationId));
      const browserRoot = join(machineRoot, "browsers", "onboarding");
      const browserRoots = createBrowserRoots(admission);
      const bound=[...operations, ...reenrolments].map(operation=>{
        const draft=operation.kind === "sign-up" ? operation.onboarding : operation.draft;
        if(draft===undefined)throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE");
        const rootInput = browserRoots.signupRoot({ profileId: operation.profileId, profileRoot: browserRoot, credentialFingerprint: null,
          owner: { kind: "signup", operationId: operation.operationId, accountId: draft.accountId, providerGeneration: draft.generation } }, true);
        return {operation,rootInput};
      });
      assertPrivateProfilePath(machineRoot,browserRoot);
      const rootInfo=lstatSync(browserRoot,{throwIfNoEntry:false});
      if(rootInfo!==undefined&&(!rootInfo.isDirectory()||rootInfo.isSymbolicLink()
        ||readdirSync(browserRoot).some(name=>!bound.some(entry=>entry.rootInput !== undefined && basename(entry.rootInput.profileDirectory)===name)))) {
        throw new NativeBrowserClosureUnprovedError([new Error("abandoned-onboarding-browser-membership-unavailable")]);
      }
      const clock=input.clock??systemClock;
      const config=resolveConfigWithProvenance({},{primaryDisplay:null},clock,{stateRoot:machineRoot,artifactRoot:admission.artifactRoot}).config;
      const present=bound.filter(entry => selectedIds.has(entry.operation.operationId)).flatMap(entry=>{
        if(entry.rootInput !== undefined && lstatSync(entry.rootInput.profileDirectory,{throwIfNoEntry:false})!==undefined)return [{ ...entry, rootInput: entry.rootInput }];
        // A re-enrolment that never registered a setup browser root launched none.
        if (entry.operation.kind === "duo-reenrol") {
          if (entry.rootInput !== undefined && entry.operation.abort === undefined) throw new NativeBrowserClosureUnprovedError([new Error("abandoned-duo-reenrol-browser-missing-without-owned-cleanup")]);
          return [];
        }
        if(entry.operation.onboarding?.finish===undefined&&entry.operation.onboarding?.abort===undefined) {
          throw new NativeBrowserClosureUnprovedError([new Error("abandoned-onboarding-browser-missing-without-owned-cleanup")]);
        }
        return [];
      });
      const assertBound=()=>{
        admission.assertLive();
        for(const entry of bound){
          const current=readOperations().find(operation=>operation.operationId===entry.operation.operationId);
          if(current===undefined||canonicalJsonStringify(current)!==canonicalJsonStringify(entry.operation))throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE");
        }
      };
      assertBound();
      for (const entry of present) {
        await browserRoots.withUnused(entry.rootInput.profileDirectory, createNativeBrowserProbe({ clock, scheduler: createTimeoutDeadlineScheduler(clock),
          closeProofMs: config.browser.closeProofMs, launchTimeoutMs: config.timeouts.sessionAcquireMs, signal: new AbortController().signal }),
        async ({ remove }) => { assertBound(); remove(); }, entry.rootInput);
        assertBound();
      }
      assertBound();
      for (const operation of selected) {
        if (operation.onboarding?.finish !== undefined) {
          if (operation.phase !== "publishing") throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE");
          const published = registry.read().profiles.find(row => row.profileId === operation.profileId);
          if (published !== undefined) assertPublishedFinish(operation, published.registration);
          else assertFinishedProfileOnboarding(operation);
          const profileId = settleSignUp(operation, options.registrationProofs?.find(proof => proof.operationId === operation.operationId));
          if (options.deferActivation !== true) activate(profileId);
        } else {
          if (operation.onboarding?.abort === undefined) onboarding.recoverClosed(operation.operationId);
          const draft = readOperations().find((entry): entry is SignUpOperation => entry.kind === "sign-up" && entry.operationId === operation.operationId);
          if (draft === undefined) throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE");
          if (draft.onboarding?.abort !== undefined && admission.abortUnpublishedProfile(draft)) continue;
          const session = issueOnboardingSession(draft);
          await cancelOnboarding(session.token, operation.operationId);
        }
      }
      for (const operation of closed) {
        if (operation.draft.attempts.some(attempt => attempt.providerClosedAt === undefined)) onboarding.recoverClosed(operation.operationId);
        withProfileLock(machineRoot, () => {
          const aborted = abortDuoReenrol(registeredReenrol(operation.operationId));
          if (registry.read().activeProfileId === aborted.profileId) discardDuoReenrol(aborted);
        });
      }
    },
    /**
     * Boot's roll-forward of recorded re-enrolment commits under stopped custody. Each is classified against its intent and finished
     * only when every piece is applied or not applied; the profiles it could not prove are returned for their admission to be held.
     */
    reconcileDuoReenrolCommits(): readonly Readonly<{ profileId: string; error: ProfileSessionRefusedError }>[] {
      admission.assertWritable();
      admission.assertExclusive();
      if (sessions.size !== 0) throw new ProfileSessionRefusedError("PROFILE_TRANSITION_BLOCKED");
      const unproved: { profileId: string; error: ProfileSessionRefusedError }[] = [];
      for (const operation of readOperations()) {
        if (operation.kind !== "duo-reenrol" || operation.commit === undefined) continue;
        const intent = operation.commit;
        try {
          withProfileLock(machineRoot, () => {
            const store = duoStore(registeredReenrol(operation.operationId).profileId), state = store.inspectReenrolCommit(intent);
            if (state.head === "unprovable" || state.record === "unprovable") throw new ProfileSessionRefusedError("PROFILE_DUO_REENROL_UNCERTAIN");
            store.commitReenrol(intent);
            deleteOperation(operation.operationId);
          });
        } catch (cause) {
          if (hasUnprovedSourceClosure(cause)) throw cause;
          unproved.push({ profileId: operation.profileId, error: cause instanceof ProfileSessionRefusedError && cause.code === "PROFILE_DUO_REENROL_UNCERTAIN" ? cause
            : new ProfileSessionRefusedError("PROFILE_DUO_REENROL_UNCERTAIN", { cause }) });
        }
      }
      return unproved;
    },
    signIn(fields: { readonly email: string; readonly password: string; readonly at: string }): ActiveProfileSession | ProfileRefusal | ProfileCancelling {
      const at = IsoInstantSchema.parse(fields.at);
      admission.assertWritable();
      admission.lifetime.assertRuntimeAvailable();
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
        return admitSignedIn(row, at, entries => entries.ucpathUserId?.value === fields.email && entries.ucpathPassword?.value === fields.password,
          { email: fields.email, password: fields.password });
      });
    },
    resumeSignedInProfile(fields: { readonly at: string }): ActiveProfileSession | ProfileRefusal | ProfileCancelling {
      const at = IsoInstantSchema.parse(fields.at);
      admission.assertWritable();
      admission.lifetime.assertRuntimeAvailable();
      return withProfileLock(machineRoot, () => {
        const selection = registry.read(), row = selection.profiles.find(entry => entry.profileId === selection.activeProfileId);
        if (row === undefined) return refusal("PROFILE_SIGN_IN_REFUSED");
        if (row.registration.onboardingCompletion === undefined) return refusal("PROFILE_TRANSITION_BLOCKED");
        const pending = openLogout(row.profileId);
        if (row.lifecycle === "cancelling" || pending !== undefined) return cancelling(pending?.operationId);
        return admitSignedIn(row, at, entries => {
          const email = entries.ucpathUserId?.value, password = entries.ucpathPassword?.value;
          if (email === undefined || password === undefined) return false;
          const identified = verifiers.identify(email);
          return identified !== "unknown" && identified.profileId === row.profileId && verifiers.passwordMatches(row.profileId, password);
        });
      });
    },
    changePassword(token: string, fields: { readonly currentPassword: string; readonly newPassword: string; readonly at: string }) {
      return changeLogin(token, { currentPassword: fields.currentPassword, change: { kind: "password", password: fields.newPassword }, at: fields.at });
    },
    changeUsername(token: string, fields: { readonly currentPassword: string; readonly newUsername: string; readonly at: string }) {
      return changeLogin(token, { currentPassword: fields.currentPassword, change: { kind: "username", email: fields.newUsername }, at: fields.at });
    },
    /** Change the signed-in person's Name, Initials or Timekeeper name; runs already started keep the timekeeper name they captured. */
    changeDetails(token: string, change: ProfileDetailsChange): { readonly state: "changed"; readonly account: ProfileAccount } | ProfileRefusal {
      admission.assertWritable();
      admission.lifetime.assertRuntimeAvailable();
      const checked = profileDetailsPatch(change);
      if ("refused" in checked) return refusal(checked.refused);
      return withProfileLock(machineRoot, () => {
        const session = requireSession(token);
        if ("state" in session) return session;
        return { state: "changed", account: profileAccount(registry.update(session.profileId, checked.patch)) };
      });
    },
    logOut(token: string, inputFields: { readonly at: string }): { readonly state: "signed-out" } | ProfileLogoutResult | ProfileCancelling {
      const at = IsoInstantSchema.parse(inputFields.at);
      admission.assertLive();
      admission.lifetime.assertRuntimeAvailable();
      const session = requireSession(token);
      if ("state" in session) return session;
      return withProfileLock(machineRoot, () => {
        const current = requireSession(token);
        if ("state" in current) return current;
        if (current.epoch === Number.MAX_SAFE_INTEGER) return refusal("PROFILE_TRANSITION_BLOCKED");
        if (reenrolmentFor(session.profileId) !== undefined) return refusal("PROFILE_DUO_REENROL_OPEN");
        storeFor(session.profileId, current.admission);
        if (input.prepareLogout === undefined) return refusal("PROFILE_LOGOUT_BLOCKED");
        const prepared = input.prepareLogout(session.profileId, current.admission);
        const existing = openLogout(session.profileId);
        const operation = existing ?? LogoutOperationSchema.parse({
          schemaVersion: 3,
          kind: "logout",
          operationId: randomUUID(),
          profileId: session.profileId,
          sessionGeneration: current.epoch,
          source: prepared.source,
          at,
          phase: "admitted",
        });
        if (existing === undefined) {
          try { writeOperation(operation); }
          catch (error) { prepared.intentFailed(error); }
        }
        registry.advanceSession(null, "profile-logout-requested");
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
      admission.lifetime.assertRuntimeAvailable();
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
        if (row === undefined || operations.length !== 1 || operation === undefined) return refusal("PROFILE_SESSION_STALE");
        const before = operation.settlement === undefined && selection.sessionGeneration === operation.sessionGeneration && selection.activeProfileId === row.profileId && row.lifecycle === "ready";
        const revoked = selection.sessionGeneration === operation.sessionGeneration + 1 && selection.activeProfileId === null
          && (row.lifecycle === "cancelling" || row.lifecycle === "ready" && (operation.settlement === undefined || operation.settlement.phase === "done"));
        if (!before && !revoked) return refusal("PROFILE_SESSION_STALE");
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
            if (current.sessionGeneration !== selection.sessionGeneration || current.activeProfileId !== selection.activeProfileId
              || currentRow === undefined || canonicalJsonStringify(currentRow) !== rowSnapshot
              || pending.length !== 1 || canonicalJsonStringify(pending[0]) !== operationSnapshot) return refusal("PROFILE_SESSION_STALE");
            return continueLogout(operation);
          });
        } });
      });
    },
    resumeLogout(operationId: string): { readonly state: "signed-out" } | ProfileLogoutResult | ProfileCancelling {
      admission.assertWritable();
      return withProfileLock(machineRoot, () => {
        const operation = readOperations().find((entry): entry is LogoutOperation => entry.kind === "logout" && entry.operationId === operationId);
        if (operation === undefined) {
          const completed = input.completedLogout?.(operationId), document = registry.read();
          if (completed === undefined || document.activeProfileId !== null || document.sessionGeneration !== completed.epoch
            || document.profiles.find(profile => profile.profileId === completed.profileId)?.lifecycle !== "ready") return refusal("PROFILE_SESSION_STALE");
          releaseOrdinary(completed.profileId); releaseSettlement(completed.profileId); storageAdmissions.delete(completed.profileId);
          return { state: "signed-out" };
        }
        if (operation.phase === "complete") return refusal("PROFILE_SESSION_STALE");
        return continueLogout(operation);
      });
    },
    deleteLoggedOutAccount(operationId: string): void {
      admission.assertWritable();
      try { assertMaintenanceCustodyAvailable("account-deletion"); }
      catch (cause) { throw new ProfileSessionRefusedError("PROFILE_ACCOUNT_DELETION_REFUSED", { cause }); }
      const completed = input.completedLogout?.(operationId), document = registry.read();
      if (completed === undefined || document.activeProfileId !== null || document.sessionGeneration !== completed.epoch
        || storageAdmissions.has(completed.profileId) || sessions.size !== 0) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
      if (reenrolmentFor(completed.profileId) !== undefined) throw new ProfileSessionRefusedError("PROFILE_DUO_REENROL_OPEN");
      try { admission.deleteProfileAccount(completed.profileId, completed.epoch); }
      catch (cause) { throw new ProfileSessionRefusedError("PROFILE_ACCOUNT_DELETION_REFUSED", { cause }); }
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
          const expected = fileStatus(path);
          if (!expected.isFile() || expected.isSymbolicLink() || privateFileNumber(expected.nlink) !== 1
            || privatePathRejects(path, expected, "owner")) throw new Error("profile file read refused");
          const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          try {
            const matches = (observed: typeof expected) => observed.isFile() && !observed.isSymbolicLink()
              && observed.dev === expected.dev && observed.ino === expected.ino && observed.size === expected.size
              && observed.mode === expected.mode && observed.uid === expected.uid && observed.nlink === expected.nlink
              && fileModified(observed) === fileModified(expected) && fileChanged(observed) === fileChanged(expected);
            if (!noSymlinkAncestry(dirname(path), ancestry) || !matches(descriptorStatus(descriptor))) throw new Error("profile file read refused");
            const bytes = readFileSync(descriptor);
            if (!matches(descriptorStatus(descriptor)) || !matches(fileStatus(path)) || bytes.byteLength !== privateFileNumber(expected.size)
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

function withProvedOperations<T extends object>(api: T): T {
  const proved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(api)) {
    proved[key] = typeof value === "function"
      ? (...args: unknown[]) => withOperationProof(() => (value as (...inner: unknown[]) => unknown).apply(api, args))
      : value;
  }
  return Object.freeze(proved) as T;
}
