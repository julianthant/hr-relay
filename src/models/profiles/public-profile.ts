import { z } from "zod";
import { ErrorCatalogCodeSchema } from "../failures/error-catalog.js";
import { ErrorCodeSchema } from "../../rules/identity/ids.js";
import { ProfileIdSchema, ProfileRegistryRowSchema, type ProfileRegistryRow } from "./profile.js";
import { PreflightReportWireSchema } from "../preflight/preflight-contract.js";

export const ProfileLoginRequestSchema = z.strictObject({ email: z.string().min(1).max(254), password: z.string().min(1).max(1024) });
export const ProfileSignUpRequestSchema = ProfileLoginRequestSchema.extend({ firstName: z.string().min(1).max(64), lastName: z.string().min(1).max(64) });
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
/** The signed-in person's account values; Timekeeper initials are not a value of their own but `profileInitials(timekeeper)`. */
export const ProfileAccountSchema = z.strictObject({ name: z.string(), initials: ProfileRegistryRowSchema.shape.initials,
  timekeeper: ProfileRegistryRowSchema.shape.timekeeperName, lastSignedInAt: ProfileRegistryRowSchema.shape.lastSignedInAt });
export type ProfileAccount = z.infer<typeof ProfileAccountSchema>;
export function profileAccount(row: ProfileRegistryRow): ProfileAccount {
  return ProfileAccountSchema.parse({ name: `${row.firstName} ${row.lastName}`, initials: row.initials, timekeeper: row.timekeeperName, lastSignedInAt: row.lastSignedInAt });
}
/** A details change names at least one value; each value is checked by `profileDetailsPatch`, whose refusal states the reason. */
export const ProfileDetailsChangeRequestSchema = z.strictObject({
  name: z.strictObject({ firstName: z.string().max(64), lastName: z.string().max(64) }).optional(),
  initials: z.string().max(64).optional(),
  timekeeperName: z.string().max(256).optional(),
}).refine(value => value.name !== undefined || value.initials !== undefined || value.timekeeperName !== undefined, "profile-details-change-empty");
export const ProfileDetailsChangeResultSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("changed"), account: ProfileAccountSchema }),
  z.strictObject({ state: z.literal("refused"), code: ErrorCatalogCodeSchema }),
]);
/** A Relay username the dashboard sign-in form accepts: one UCSD work email with no surrounding spaces. */
export function isRelayUsername(value: string): boolean { return /^[^\s@]+@ucsd\.edu$/iu.test(value); }
export const DeleteProfileAccountRequestSchema = z.strictObject({ confirmed: z.literal(true),
  expectedProfileId: ProfileIdSchema, expectedEpoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) });
export type DeleteProfileAccountRequest = z.infer<typeof DeleteProfileAccountRequestSchema>;
export const ProfileOnboardingMethodSchema = z.enum(["key", "touch"]);
export type ProfileOnboardingMethod = z.infer<typeof ProfileOnboardingMethodSchema>;
export const ProfileOnboardingMethodStateSchema = z.strictObject({
  state: z.enum(["unavailable", "idle", "pending", "complete", "unknown"]),
  attemptId: z.uuid().optional(),
  ceremonyObserved: z.boolean(),
  portalAccepted: z.boolean(),
  operatorConfirmed: z.boolean(),
  exactCredentialRequestObserved: z.boolean(),
  platformAuthenticator: z.enum(["native-platform", "chromium-platform"]).optional(),
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

export const ProfileOnboardingStateSchema = z.strictObject({
  state: z.literal(PROFILE_ONBOARDING_STATE), operationId: z.uuid(), profileId: ProfileIdSchema,
  step: z.enum(["duo", "ready"]),
  methods: z.strictObject({ key: ProfileOnboardingMethodStateSchema, touch: ProfileOnboardingMethodStateSchema }),
  browser: ProfileOnboardingBrowserSchema,
}).superRefine((value, context) => {
  const complete = value.methods.key.state === "complete" && value.methods.touch.state === "complete";
  if ((value.step === "ready") !== complete) context.addIssue({ code: "custom", message: "profile-onboarding-readiness-invalid" });
  for (const [name, method] of Object.entries(value.methods)) {
    const confirmed = method.operatorConfirmed || method.portalAccepted || name === "key" && method.exactCredentialRequestObserved;
    if (method.state === "complete" && (!method.ceremonyObserved || !confirmed)) {
      context.addIssue({ code: "custom", message: "profile-onboarding-method-incomplete" });
    }
  }
});
export type ProfileOnboardingState = z.infer<typeof ProfileOnboardingStateSchema>;
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
