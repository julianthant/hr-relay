import { z } from "zod";
import { IsoInstantSchema } from "../../rules/identity/ids.js";
import { KualiTimekeeperNameSchema } from "../ui/kuali-document-identity.js";

const NameSchema = z.string().min(1).max(64).refine((value) => value === value.trim(), "profile name may not be whitespace-padded");

export class ProfileNameValidationError extends Error {
  constructor() {
    super("profile name refused");
    this.name = "ProfileNameValidationError";
  }
}

export const ProfileIdSchema = z.uuid();

export const ProfileRegistryRowSchema = z.strictObject({
  profileId: ProfileIdSchema,
  registration: z.strictObject({ operationId: z.uuid(), commandId: z.uuid(), writeId: z.uuid(), credentialRevision: z.number().int().positive() }),
  firstName: NameSchema,
  lastName: NameSchema,
  initials: z.string().regex(/^[A-Z]{2}$/u),
  timekeeperName: KualiTimekeeperNameSchema,
  createdAt: IsoInstantSchema,
  lastSignedInAt: IsoInstantSchema,
  credentialState: z.enum(["saved", "wiped"]),
  duoState: z.enum(["not-set-up", "pending", "ready"]),
  lifecycle: z.enum(["ready", "cancelling"]),
  migratedFromLegacy: z.literal(true).optional(),
});
export type ProfileRegistryRow = z.infer<typeof ProfileRegistryRowSchema>;

export const ProfileRegistryDocumentSchema = z.strictObject({
  schemaVersion: z.literal(2),
  profiles: z.array(ProfileRegistryRowSchema),
  sessionGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  activeProfileId: ProfileIdSchema.nullable(),
});
export type ProfileRegistryDocument = z.infer<typeof ProfileRegistryDocumentSchema>;

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

function initialLetter(name: string): string {
  const raw = [...name][0];
  const characters = [...name.normalize("NFC")];
  const letter = characters[0];
  if (raw === undefined || letter === undefined || !/^[A-Za-z]$/u.test(raw) || !/^[A-Za-z]$/u.test(letter)
    || (characters[1] !== undefined && /\p{M}/u.test(characters[1]))) {
    throw new ProfileNameValidationError();
  }
  return letter.toUpperCase();
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
  const initials = `${initialLetter(first.data)}${initialLetter(last.data)}`;
  if (!/^[A-Z]{2}$/u.test(initials) || !KualiTimekeeperNameSchema.safeParse(initials).success) {
    throw new ProfileNameValidationError();
  }
  return { firstName: first.data, lastName: last.data, initials, timekeeperName: initials };
}

export const FastDuoStorageSchema = z.literal("session");
export const FastDuoSetupActionSchema = z.enum(["ARM", "ENROLL", "CONFIRM", "export"]);

export const FastDuoSetupRequestSchema = z.strictObject({
  profileId: ProfileIdSchema,
  tabId: z.string().min(1),
  rpId: z.literal("duosecurity.com"),
  action: FastDuoSetupActionSchema,
  storage: FastDuoStorageSchema,
});

export const RelayDuoProvisionSchema = z.strictObject({
  profileId: ProfileIdSchema,
  storage: FastDuoStorageSchema,
});

export function refusePersistentDuoStorage(storage: string): void {
  if (storage !== "session") throw new Error("fast-duo-persistent-copy-refused");
}

export function nextDuoSignCount(stored: number, nowSec: number): number {
  if (!Number.isSafeInteger(stored) || stored < 0 || !Number.isSafeInteger(nowSec) || nowSec < 0) {
    throw new Error("duo counter is not a safe nonnegative integer");
  }
  return Math.max(stored + 1, nowSec);
}


export const ProfileDatabaseBindingSchema = z.strictObject({ installationId: z.uuid(), profileId: ProfileIdSchema });
export type ProfileDatabaseBinding = z.infer<typeof ProfileDatabaseBindingSchema>;


export const SignUpOperationSchema = z.strictObject({
  schemaVersion: z.literal(1),
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
  expectedRevision: z.number().int().positive().optional(),
  phase: z.enum(["applying", "publishing"]),
});

export const LogoutOperationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("logout"),
  operationId: z.uuid(),
  profileId: z.uuid(),
  at: IsoInstantSchema,
  phase: z.enum(["admitted", "cancelling", "erasing", "incomplete", "complete"]),
  commandId: z.uuid().optional(),
  writeId: z.uuid().optional(),
  expectedRevision: z.number().int().positive().optional(),
});

export type SignUpOperation = z.infer<typeof SignUpOperationSchema>;
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
