import { z } from "zod";
import { ProtectedValueSchemas } from "../config/protected-settings.js";
import { ErrorCatalogCodeSchema } from "../failures/error-catalog.js";
import { ErrorCodeSchema } from "../../rules/identity/ids.js";
import { ProfileIdSchema, ProfileRegistryRowSchema, type ProfileRegistryRow } from "./profile.js";
import { PreflightReportWireSchema } from "../preflight/preflight-contract.js";
import { DuoKeyChangeSchema, DuoKeyIdSchema, DuoKeyNameSchema } from "../config/duo-credential-store.js";

export const ProfileLoginRequestSchema = z.strictObject({ email: z.string().min(1).max(254), password: z.string().min(1).max(1024) });
export const ProfileSignUpRequestSchema = ProfileLoginRequestSchema.extend({
  firstName: z.string().min(1).max(64), lastName: z.string().min(1).max(64),
  ucpathUsername: ProtectedValueSchemas.ucpathUserId,
  ucpathPassword: ProtectedValueSchemas.ucpathPassword,
});
export type ProfileLoginRequest = z.infer<typeof ProfileLoginRequestSchema>;
export type ProfileSignUpRequest = z.infer<typeof ProfileSignUpRequestSchema>;
/**
 * Relay login changes for the signed-in profile; the current password proves the caller. A replacement must be enterable in the
 * sign-in form: at most its inputs' 160 characters, and no line break, which its single-line password input removes.
 */
export const RELAY_SIGN_IN_FIELD_MAX = 160;
export const ProfilePasswordChangeRequestSchema = z.strictObject({ currentPassword: ProfileLoginRequestSchema.shape.password,
  newPassword: z.string().min(1).max(RELAY_SIGN_IN_FIELD_MAX).regex(/^[^\r\n]*$/u) });
export const ProfileUsernameChangeRequestSchema = z.strictObject({ currentPassword: ProfileLoginRequestSchema.shape.password,
  newUsername: z.string().min(1).max(RELAY_SIGN_IN_FIELD_MAX) });
export const ProfileLoginChangeResultSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("changed"), durability: z.literal("unconfirmed").optional(), diagnostics: z.literal("unrecorded").optional() }),
  z.strictObject({ state: z.literal("unknown"), code: z.literal("PROFILE_LOGIN_CHANGE_UNKNOWN"), diagnostics: z.literal("unrecorded").optional() }),
  z.strictObject({ state: z.literal("refused"), code: ErrorCatalogCodeSchema }),
]);
/** The signed-in person's account values; the timekeeper name and timekeeper initials are stored and changed independently. */
export const ProfileAccountSchema = z.strictObject({ username: ProfileRegistryRowSchema.shape.relayEmail, name: z.string(), initials: ProfileRegistryRowSchema.shape.initials,
  timekeeper: ProfileRegistryRowSchema.shape.timekeeperName, timekeeperInitials: ProfileRegistryRowSchema.shape.timekeeperInitials,
  lastSignedInAt: ProfileRegistryRowSchema.shape.lastSignedInAt });
export type ProfileAccount = z.infer<typeof ProfileAccountSchema>;
export function profileAccount(row: ProfileRegistryRow, identify: (email: string) => "unknown" | { readonly profileId: string }): ProfileAccount {
  const owner = row.relayEmail === undefined ? "unknown" : identify(row.relayEmail);
  return ProfileAccountSchema.parse({ ...(owner !== "unknown" && owner.profileId === row.profileId && { username: row.relayEmail }), name: `${row.firstName} ${row.lastName}`, initials: row.initials, timekeeper: row.timekeeperName,
    timekeeperInitials: row.timekeeperInitials, lastSignedInAt: row.lastSignedInAt });
}
/** A details change names at least one value; each value is checked by `profileDetailsPatch`, whose refusal states the reason. */
export const ProfileDetailsChangeRequestSchema = z.strictObject({
  name: z.strictObject({ firstName: z.string().max(64), lastName: z.string().max(64) }).optional(),
  initials: z.string().max(64).optional(),
  timekeeperName: z.string().max(256).optional(),
  timekeeperInitials: z.string().max(64).optional(),
}).refine(value => value.name !== undefined || value.initials !== undefined || value.timekeeperName !== undefined || value.timekeeperInitials !== undefined,
  "profile-details-change-empty");
export const ProfileDetailsChangeResultSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("changed"), account: ProfileAccountSchema }),
  z.strictObject({ state: z.literal("refused"), code: ErrorCatalogCodeSchema }),
]);
const DuoKeySummarySchema = z.strictObject({ id: DuoKeyIdSchema, name: DuoKeyNameSchema.optional(),
  shortId: z.string().min(1).max(8).regex(/^[A-Za-z0-9_-]+$/u), addedAt: z.iso.datetime(), lastUsedAt: z.iso.datetime().optional() });
export const DuoKeysSnapshotSchema = z.strictObject({ revision: z.number().int().safe().nonnegative(), keys: z.array(DuoKeySummarySchema).max(1000) });
export type DuoKeysSnapshot = z.infer<typeof DuoKeysSnapshotSchema>;
export const ProfileDuoKeysScopeSchema = z.strictObject({ profileId: ProfileIdSchema, epoch: z.number().int().safe().positive() });
export const ProfileDuoKeysReadSchema = ProfileDuoKeysScopeSchema.extend({ snapshot: DuoKeysSnapshotSchema });
export const ProfileDuoKeyChangeRequestSchema = ProfileDuoKeysScopeSchema.extend({ change: DuoKeyChangeSchema });
export const DuoKeyChangeResultSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("changed"), snapshot: DuoKeysSnapshotSchema }),
  z.strictObject({ state: z.literal("name-in-use") }),
  z.strictObject({ state: z.literal("refused"), code: ErrorCatalogCodeSchema }),
]);
export type DuoKeyChangeResult = z.infer<typeof DuoKeyChangeResultSchema>;
export const ProfileDuoKeyChangeResponseSchema = ProfileDuoKeysScopeSchema.extend({ commandId: z.uuid(), result: DuoKeyChangeResultSchema });
/** A Relay username the dashboard sign-in form accepts: one UCSD work email with no surrounding spaces. */
export function isRelayUsername(value: string): boolean { return /^[^\s@]+@ucsd\.edu$/iu.test(value); }
export const DeleteProfileAccountRequestSchema = z.strictObject({ confirmed: z.literal(true),
  expectedProfileId: ProfileIdSchema, expectedEpoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) });
export type DeleteProfileAccountRequest = z.infer<typeof DeleteProfileAccountRequestSchema>;
export const ProfileOnboardingMethodSchema = z.enum(["key"]);
export type ProfileOnboardingMethod = z.infer<typeof ProfileOnboardingMethodSchema>;
export const ProfileOnboardingMethodStateSchema = z.strictObject({
  state: z.enum(["unavailable", "idle", "pending", "complete", "unknown"]),
  attemptId: z.uuid().optional(),
  ceremonyObserved: z.boolean(),
  portalAccepted: z.boolean(),
  operatorConfirmed: z.boolean(),
  exactCredentialRequestObserved: z.boolean(),
});
export type ProfileOnboardingMethodState = z.infer<typeof ProfileOnboardingMethodStateSchema>;
export const PROFILE_ONBOARDING_STATE = "onboarding";
export const PROFILE_ONBOARDING_ROUTE_KEY = "onboarding";
export const ProfileOnboardingBrowserFailureCodeSchema = z.enum(["DUO_SETUP_OPEN_FAILED", "DUO_SETUP_STOP_FAILED", "DUO_SETUP_FILES_BUSY"]);
export const ProfileOnboardingBrowserSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.enum(["checking", "opening", "open", "closed", "reopening"]), generation: z.number().int().nonnegative() }),
  z.strictObject({ state: z.literal("failed"), generation: z.number().int().nonnegative(), code: ProfileOnboardingBrowserFailureCodeSchema }),
]);
export type ProfileOnboardingBrowser = z.infer<typeof ProfileOnboardingBrowserSchema>;

const DuoSetupFields = {
  operationId: z.uuid(), profileId: ProfileIdSchema,
  step: z.enum(["duo", "ready"]),
  methods: z.strictObject({ key: ProfileOnboardingMethodStateSchema }),
  browser: ProfileOnboardingBrowserSchema,
};
function refineDuoSetup(value: Readonly<{ step: "duo" | "ready"; methods: Readonly<Record<ProfileOnboardingMethod, ProfileOnboardingMethodState>> }>, context: z.RefinementCtx): void {
  const complete = value.methods.key.state === "complete";
  if ((value.step === "ready") !== complete) context.addIssue({ code: "custom", message: "profile-onboarding-readiness-invalid" });
  for (const method of Object.values(value.methods)) {
    const confirmed = method.operatorConfirmed || method.portalAccepted || method.exactCredentialRequestObserved;
    if (method.state === "complete" && (!method.ceremonyObserved || !confirmed)) {
      context.addIssue({ code: "custom", message: "profile-onboarding-method-incomplete" });
    }
  }
}
export const ProfileOnboardingStateSchema = z.strictObject({ state: z.literal(PROFILE_ONBOARDING_STATE), ...DuoSetupFields }).superRefine(refineDuoSetup);
export type ProfileOnboardingState = z.infer<typeof ProfileOnboardingStateSchema>;
/** Setting Duo up again is a resource of the active session, so the profile's own state stays active while it is open. */
export const DuoReenrolStateSchema = z.strictObject({ state: z.literal("duo-reenrol"), ...DuoSetupFields }).superRefine(refineDuoSetup);
export type DuoReenrolState = z.infer<typeof DuoReenrolStateSchema>;
export const CompleteProfileOnboardingRequestSchema = z.strictObject({ operationId: z.uuid() });
export type CompleteProfileOnboardingRequest = z.infer<typeof CompleteProfileOnboardingRequestSchema>;
export const CancelProfileOnboardingRequestSchema = CompleteProfileOnboardingRequestSchema;
export const ReopenProfileOnboardingBrowserRequestSchema = CompleteProfileOnboardingRequestSchema.extend({ generation: z.number().int().nonnegative() });
export type ReopenProfileOnboardingBrowserRequest = z.infer<typeof ReopenProfileOnboardingBrowserRequestSchema>;
export type CancelProfileOnboardingRequest = z.infer<typeof CancelProfileOnboardingRequestSchema>;
export const StartProfileOnboardingDuoRequestSchema = CompleteProfileOnboardingRequestSchema.extend({ method: ProfileOnboardingMethodSchema });
export type StartProfileOnboardingDuoRequest = z.infer<typeof StartProfileOnboardingDuoRequestSchema>;
export const ConfirmProfileOnboardingDuoRequestSchema = StartProfileOnboardingDuoRequestSchema.extend({ attemptId: z.uuid(), operatorConfirmed: z.literal(true) });
export type ConfirmProfileOnboardingDuoRequest = z.infer<typeof ConfirmProfileOnboardingDuoRequestSchema>;
export const CancelProfileOnboardingDuoRequestSchema = StartProfileOnboardingDuoRequestSchema.extend({ attemptId: z.uuid() });
export type CancelProfileOnboardingDuoRequest = z.infer<typeof CancelProfileOnboardingDuoRequestSchema>;

export const ProfileFirstRunCheckSchema = z.discriminatedUnion("state", [
  z.strictObject({ scope: z.literal("local-startup"), profileId: ProfileIdSchema,
    epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), state: z.enum(["passed", "failed"]), report: PreflightReportWireSchema }),
  z.strictObject({ scope: z.literal("local-startup"), profileId: ProfileIdSchema,
    epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), state: z.literal("unavailable"), code: z.literal("PROFILE_FIRST_RUN_CHECK_UNAVAILABLE") }),
]).superRefine((value, context) => {
  if (value.state === "unavailable") return;
  if (value.report.requestedCapabilities.length !== 1 || value.report.requestedCapabilities[0] !== "dashboard.serve") {
    context.addIssue({ code: "custom", path: ["report", "requestedCapabilities"], message: "profile-first-run-check-scope-invalid" });
  }
  if ((value.state === "failed") !== value.report.results.some(result => result.status === "fail")) {
    context.addIssue({ code: "custom", path: ["state"], message: "profile-first-run-check-outcome-invalid" });
  }
});
export type ProfileFirstRunCheck = z.infer<typeof ProfileFirstRunCheckSchema>;

export const PublicProfileStateSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("signed-out"), signUpRequired: z.boolean().optional(),
    resumable: z.literal(true).optional(), logoutIncomplete: z.literal(true).optional() }),
  z.strictObject({ state: z.literal("error"), code: ErrorCodeSchema, firstRunCheck: ProfileFirstRunCheckSchema.optional() }),
  z.strictObject({ state: z.literal("active"), profileId: ProfileIdSchema, duoState: ProfileRegistryRowSchema.shape.duoState, epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), firstRunCheck: ProfileFirstRunCheckSchema.optional(),
    account: ProfileAccountSchema.optional() }),
  z.strictObject({ state: z.literal("cancelling"), operationId: z.uuid() }),
  ProfileOnboardingStateSchema,
  z.strictObject({ state: z.literal("refused"), code: ErrorCatalogCodeSchema, firstRunCheck: ProfileFirstRunCheckSchema.optional() }),
]).superRefine((value, context) => {
  if (value.state !== "active" || value.firstRunCheck === undefined) return;
  if (value.firstRunCheck.state === "unavailable" || value.firstRunCheck.profileId !== value.profileId || value.firstRunCheck.epoch !== value.epoch) {
    context.addIssue({ code: "custom", path: ["firstRunCheck"], message: "profile-first-run-check-active-identity-invalid" });
  }
});
export type PublicProfileState = z.infer<typeof PublicProfileStateSchema>;
