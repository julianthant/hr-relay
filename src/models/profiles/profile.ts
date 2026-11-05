import { CanonicalCrashRecoveryRequestSchema } from "../run/worker.js";
import { FileIdentitySchema } from "../storage/file-identity.js";
import { WorkerPoolMemberSchema } from "../run/worker-slot.js";
import { z } from "zod";
import { IsoInstantSchema } from "../../rules/identity/ids.js";
import { ProfileDisplayNameSchema, ProfileIdentitySchema, profileInitials } from "./profile-identity.js";
import { DuoEnrollmentScopeSchema } from "../config/duo-credential-store.js";

const NameSchema = z.string().min(1).max(64).refine((value) => value === value.trim(), "profile name may not be whitespace-padded");

export class ProfileNameValidationError extends Error {
  constructor() {
    super("profile name refused");
    this.name = "ProfileNameValidationError";
  }
}

export const ProfileIdSchema = z.uuid();
export const ProfileOnboardingCompletionSchema = z.strictObject({
  generation: z.number().int().safe().positive(), finishId: z.uuid(), finishedAt: IsoInstantSchema,
  key: z.strictObject({ receiptDigest: z.string().regex(/^[0-9a-f]{64}$/u), confirmation: z.enum(["operator", "portal-accepted", "exact-credential-request"]) }),
  touch: z.strictObject({ receiptDigest: z.string().regex(/^[0-9a-f]{64}$/u), softwareInterceptionDisabled: z.literal(true), operatorConfirmedAt: IsoInstantSchema.optional() }),
});

export const ProfileRegistryRowSchema = z.strictObject({
  profileId: ProfileIdSchema,
  registration: z.strictObject({ operationId: z.uuid(), commandId: z.uuid(), writeId: z.uuid(), credentialRevision: z.number().int().positive(),
    onboardingCompletion: ProfileOnboardingCompletionSchema.optional() }),
  firstName: NameSchema,
  lastName: NameSchema,
  initials: ProfileIdentitySchema.shape.initials,
  timekeeperName: ProfileDisplayNameSchema,
  createdAt: IsoInstantSchema,
  lastSignedInAt: IsoInstantSchema,
  credentialState: z.enum(["saved", "wiped"]),
  duoState: z.enum(["not-set-up", "pending", "ready"]),
  lifecycle: z.enum(["ready", "cancelling"]),
  migratedFromLegacy: z.literal(true).optional(),
});
export type ProfileRegistryRow = z.infer<typeof ProfileRegistryRowSchema>;

export const ProfileRegistryDocumentSchema = z.strictObject({
  schemaVersion: z.literal(3),
  installationId: z.uuid(),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  profiles: z.array(ProfileRegistryRowSchema),
  sessionGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  activeProfileId: ProfileIdSchema.nullable(),
});
export type ProfileRegistryDocument = z.infer<typeof ProfileRegistryDocumentSchema>;

export function advanceProfileRegistryDocument(current: ProfileRegistryDocument,
  patch: Partial<Omit<ProfileRegistryDocument, "schemaVersion" | "installationId" | "revision">>): ProfileRegistryDocument {
  return ProfileRegistryDocumentSchema.parse({ ...current, ...patch, schemaVersion: current.schemaVersion, installationId: current.installationId, revision: current.revision + 1 });
}

export const ProfileAuthoritySnapshotSchema = z.strictObject({
  profileId: ProfileIdSchema,
  profileSessionEpoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  accountRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  accountAttemptGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  accountAvailability: z.literal("available"),
  savedSettingsRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  savedSettingsFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  activeSettingsRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  activeSettingsFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  activeConfigFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  protectedSettingsRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
export type ProfileAuthoritySnapshot = z.infer<typeof ProfileAuthoritySnapshotSchema>;

function assertNameInitial(name: string): void {
  const raw = [...name][0];
  const characters = [...name.normalize("NFC")];
  const letter = characters[0];
  if (raw === undefined || letter === undefined || !/^[A-Za-z]$/u.test(raw) || !/^[A-Za-z]$/u.test(letter)
    || (characters[1] !== undefined && /\p{M}/u.test(characters[1]))) {
    throw new ProfileNameValidationError();
  }
}

export function deriveProfileNames(firstName: string, lastName: string): {
  readonly firstName: string;
  readonly lastName: string;
  readonly initials: string;
  readonly timekeeperName: string;
} {
  const first = NameSchema.safeParse(firstName);
  const last = NameSchema.safeParse(lastName);
  if (!first.success || !last.success) throw new ProfileNameValidationError();
  assertNameInitial(first.data);
  assertNameInitial(last.data);
  const timekeeperName = `${first.data} ${last.data}`;
  if (!ProfileDisplayNameSchema.safeParse(timekeeperName).success) throw new ProfileNameValidationError();
  return { firstName: first.data, lastName: last.data, initials: profileInitials(timekeeperName), timekeeperName };
}

export const ProfileDatabaseBindingSchema = z.strictObject({ installationId: z.uuid(), profileId: ProfileIdSchema });
export type ProfileDatabaseBinding = z.infer<typeof ProfileDatabaseBindingSchema>;


export const CanonicalCredentialCreationSchema = z.strictObject({
  operationId: z.uuid(), keyId: z.uuid(), generation: z.number().int().safe().positive(),
  phase: z.enum(["planned", "ready"]), protectedRevision: z.number().int().safe().positive().optional(),
});

export const ProfileOnboardingDuoFailureSchema = z.strictObject({
  kind: z.enum(["unavailable", "refused", "unknown"]),
  causeTag: z.enum(["scope", "revoked", "busy", "browser-root", "browser-lifetime", "counter", "worker", "provider", "aborted", "timed-out", "request-refused"]),
});
export type ProfileOnboardingDuoFailure = z.infer<typeof ProfileOnboardingDuoFailureSchema>;

export const DuoDiagnosticExceptionTypeSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/u);
export const DuoDiagnosticCodeSchema = z.enum([
  "ONBOARDING_DUO_ALREADY_STARTED",
  "ONBOARDING_DUO_BROKER_BUSY",
  "ONBOARDING_DUO_BUSY",
  "ONBOARDING_DUO_ENROLL_REFUSED",
  "ONBOARDING_DUO_EVENT_UNRECORDED",
  "ONBOARDING_DUO_KEY_REQUIRED",
  "ONBOARDING_DUO_NATIVE_FAILED",
  "ONBOARDING_DUO_NATIVE_ORIGIN",
  "ONBOARDING_DUO_NATIVE_REQUIRED",
  "ONBOARDING_DUO_NATIVE_UNAVAILABLE",
  "ONBOARDING_DUO_NATIVE_UNRECORDED",
  "ONBOARDING_DUO_PORTAL_UNRECORDED",
  "ONBOARDING_DUO_REFUSED",
  "ONBOARDING_DUO_REQUEST",
  "ONBOARDING_DUO_REVOKED",
  "ONBOARDING_DUO_SCOPE",
  "ONBOARDING_DUO_SCOPE_ACCOUNT",
  "ONBOARDING_DUO_SCOPE_DOCUMENT",
  "ONBOARDING_DUO_SCOPE_REQUEST",
  "ONBOARDING_DUO_SCOPE_SENDER",
  "ONBOARDING_DUO_SCOPE_USERNAME",
  "ONBOARDING_DUO_SESSION_UNAVAILABLE",
  "ONBOARDING_DUO_WORKER_UNAVAILABLE",
  "ONBOARDING_DUO_UNKNOWN",
  "ONBOARDING_DUO_PROVIDER_FAILED",
  "ONBOARDING_DUO_SLOW_OPERATION",
]);
export const DuoDiagnosticOperationSchema = z.enum(["browser-setup", "attempt-setup", "browser-request", "broker-request"]);

export const ProfileOnboardingDuoEventSchema = z.strictObject({
  stage: z.enum(["intercepted", "forwarded", "backend-received", "replied", "refused", "timed-out", "aborted", "platform-native", "platform-virtual", "slow-operation"]),
  requestId: z.uuid().optional(),
  detail: z.enum(["sender", "request", "document", "account", "username", "backend", "native-scope", "native-origin", "native-unavailable", "native-security", "native-not-allowed", "native-other", "already-started", "broker-busy", "busy", "enroll-refused", "event-unrecorded", "key-required", "native-failed", "native-required", "refused", "revoked", "scope", "session-unavailable", "native-unrecorded", "portal-unrecorded", "browser-root", "browser-lifetime", "counter", "worker", "provider", "aborted", "timed-out", "request-refused", "worker-unavailable"]).optional(),
  code: DuoDiagnosticCodeSchema.optional(),
  exceptionType: DuoDiagnosticExceptionTypeSchema.optional(),
  operation: DuoDiagnosticOperationSchema.optional(),
  durationMs: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
});
export type ProfileOnboardingDuoEvent = z.infer<typeof ProfileOnboardingDuoEventSchema>;

export const SignUpDuoAttemptSchema = z.strictObject({
  attemptId: z.uuid(), generation: z.number().int().safe().positive(), method: z.enum(["key", "touch"]),
  expiresAt: IsoInstantSchema, state: z.enum(["pending", "complete", "unknown", "closed"]),
  scope: DuoEnrollmentScopeSchema.optional(),
  ceremony: z.strictObject({ credentialId: z.string().min(1), requestId: z.string().min(1),
    mechanism: z.enum(["fast-duo", "native-platform", "chromium-platform"]), softwareInterceptionDisabled: z.boolean() }).optional(),
  portal: z.strictObject({ credentialId: z.string().min(1), requestId: z.string().min(1),
    acceptance: z.enum(["portal-accepted", "exact-credential-request"]) }).optional(),
  operatorConfirmedAt: IsoInstantSchema.optional(),
  providerClosedAt: IsoInstantSchema.optional(),
  failure: ProfileOnboardingDuoFailureSchema.optional(),
});
export const SignUpOnboardingSchema = z.strictObject({
  accountId: z.uuid(),
  generation: z.number().int().safe().positive(),
  attempts: z.array(SignUpDuoAttemptSchema),
  finish: z.strictObject({ finishId: z.uuid(), finishedAt: IsoInstantSchema }).optional(),
  abort: z.strictObject({ operationId: z.uuid(), generation: z.number().int().safe().positive() }).optional(),
});
export type SignUpDuoAttempt = z.infer<typeof SignUpDuoAttemptSchema>;

export const SignUpOperationSchema = z.strictObject({
  schemaVersion: z.literal(2),
  kind: z.literal("sign-up"),
  operationId: z.uuid(),
  profileId: z.uuid(),
  commandId: z.uuid(),
  writeId: z.uuid(),
  emailKey: z.string().regex(/^[0-9a-f]{64}$/u),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  createdAt: IsoInstantSchema,
  commandFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  expectedRevision: z.number().int().safe().positive().optional(),
  credentials: CanonicalCredentialCreationSchema,
  onboarding: SignUpOnboardingSchema.optional(),
  phase: z.enum(["applying", "publishing"]),
});

const LogoutFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const LogoutSettlementSchema = z.strictObject({
  phase: z.enum(["prepared", "commit-intent", "done"]),
  stoppedAt: IsoInstantSchema,
  processId: z.number().int().positive(),
  before: LogoutFingerprintSchema,
  after: LogoutFingerprintSchema.optional(),
  requests: z.array(CanonicalCrashRecoveryRequestSchema).max(100_000),
  workers: z.array(z.strictObject({ member: WorkerPoolMemberSchema, processId: z.number().int().positive(), leaseGeneration: z.number().int().positive() })).max(64),
}).refine(value => value.phase === "prepared" ? value.after === undefined : value.after !== undefined, "logout settlement fingerprint prefix invalid");

export const LogoutOperationSchema = z.strictObject({
  schemaVersion: z.literal(2),
  kind: z.literal("logout"),
  operationId: z.uuid(),
  profileId: z.uuid(),
  sessionGeneration: z.number().int().safe().nonnegative(),
  source: z.strictObject({ database: FileIdentitySchema }),
  settlement: LogoutSettlementSchema.optional(),
  at: IsoInstantSchema,
  phase: z.enum(["admitted", "cancelling", "incomplete", "complete"]),
});

export type SignUpOperation = z.infer<typeof SignUpOperationSchema>;

export function assertFinishedProfileOnboarding(operation: SignUpOperation): void {
  const draft = operation.onboarding;
  if (draft === undefined || draft.finish === undefined || draft.abort !== undefined) throw new Error("profile-onboarding-incomplete");
  for (const method of ["key", "touch"] as const) {
    const attempt = draft.attempts.findLast(entry => entry.method === method && entry.generation === draft.generation);
    if (attempt?.state !== "complete" || attempt.scope?.accountId !== draft.accountId || attempt.providerClosedAt === undefined
      || attempt.ceremony === undefined || attempt.portal !== undefined && attempt.ceremony.credentialId !== attempt.portal.credentialId
      || attempt.operatorConfirmedAt === undefined && attempt.portal?.acceptance !== "portal-accepted" && !(method === "key" && attempt.portal?.acceptance === "exact-credential-request")
      || (method === "key" ? attempt.ceremony.mechanism !== "fast-duo"
        : (attempt.ceremony.mechanism !== "native-platform" && attempt.ceremony.mechanism !== "chromium-platform") || !attempt.ceremony.softwareInterceptionDisabled)) {
      throw new Error("profile-onboarding-incomplete");
    }
  }
}
export type LogoutOperation = z.infer<typeof LogoutOperationSchema>;
export type ProfileOperation = SignUpOperation | LogoutOperation;

const ProfileVerifierRowSchema = z.strictObject({
  profileId: ProfileIdSchema,
  emailKey: z.string().regex(/^[0-9a-f]{64}$/u),
  salt: z.string().regex(/^[0-9a-f]{32}$/u),
  passwordVerifier: z.string().regex(/^[0-9a-f]{64}$/u),
  consecutiveFailures: z.number().int().nonnegative(),
  lockedUntilMs: z.number().int().nonnegative().optional(),
});

export const ProfileVerifierDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  profiles: z.array(ProfileVerifierRowSchema),
});
