import { z } from "zod";
import { ErrorCatalogCodeSchema } from "../failures/error-catalog.js";
import { ErrorCodeSchema } from "../../rules/identity/ids.js";
import { ProfileIdSchema, ProfileRegistryRowSchema } from "./profile.js";

export const ProfileLoginRequestSchema = z.strictObject({ email: z.string().min(1).max(254), password: z.string().min(1).max(1024) });
export const ProfileSignUpRequestSchema = ProfileLoginRequestSchema.extend({ firstName: z.string().min(1).max(64), lastName: z.string().min(1).max(64) });
export type ProfileLoginRequest = z.infer<typeof ProfileLoginRequestSchema>;
export type ProfileSignUpRequest = z.infer<typeof ProfileSignUpRequestSchema>;

export const ProfileOnboardingMethodSchema = z.enum(["key", "touch"]);
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
export const ProfileOnboardingStateSchema = z.strictObject({
  state: z.literal("onboarding"), operationId: z.uuid(), profileId: ProfileIdSchema,
  step: z.enum(["duo", "ready"]),
  methods: z.strictObject({ key: ProfileOnboardingMethodStateSchema, touch: ProfileOnboardingMethodStateSchema }),
}).superRefine((value, context) => {
  const complete = value.methods.key.state === "complete" && value.methods.touch.state === "complete";
  if ((value.step === "ready") !== complete) context.addIssue({ code: "custom", message: "profile-onboarding-readiness-invalid" });
  for (const [name, method] of Object.entries(value.methods)) {
    const confirmed = method.operatorConfirmed || name === "key" && method.exactCredentialRequestObserved;
    if (method.state === "complete" && (!method.ceremonyObserved || name === "touch" && !method.portalAccepted || !confirmed)) {
      context.addIssue({ code: "custom", message: "profile-onboarding-method-incomplete" });
    }
  }
});
export type ProfileOnboardingState = z.infer<typeof ProfileOnboardingStateSchema>;
export const CompleteProfileOnboardingRequestSchema = z.strictObject({ operationId: z.uuid() });
export type CompleteProfileOnboardingRequest = z.infer<typeof CompleteProfileOnboardingRequestSchema>;
export const CancelProfileOnboardingRequestSchema = CompleteProfileOnboardingRequestSchema;
export type CancelProfileOnboardingRequest = z.infer<typeof CancelProfileOnboardingRequestSchema>;
export const StartProfileOnboardingDuoRequestSchema = CompleteProfileOnboardingRequestSchema.extend({ method: ProfileOnboardingMethodSchema });
export type StartProfileOnboardingDuoRequest = z.infer<typeof StartProfileOnboardingDuoRequestSchema>;
export const ConfirmProfileOnboardingDuoRequestSchema = StartProfileOnboardingDuoRequestSchema.extend({ attemptId: z.uuid(), operatorConfirmed: z.literal(true) });
export type ConfirmProfileOnboardingDuoRequest = z.infer<typeof ConfirmProfileOnboardingDuoRequestSchema>;
export const CancelProfileOnboardingDuoRequestSchema = StartProfileOnboardingDuoRequestSchema.extend({ attemptId: z.uuid() });
export type CancelProfileOnboardingDuoRequest = z.infer<typeof CancelProfileOnboardingDuoRequestSchema>;

export const PublicProfileStateSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("signed-out") }),
  z.strictObject({ state: z.literal("error"), code: ErrorCodeSchema }),
  z.strictObject({ state: z.literal("active"), profileId: ProfileIdSchema, duoState: ProfileRegistryRowSchema.shape.duoState, epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
  z.strictObject({ state: z.literal("cancelling"), operationId: z.uuid() }),
  ProfileOnboardingStateSchema,
  z.strictObject({ state: z.literal("refused"), code: ErrorCatalogCodeSchema }),
]);
export type PublicProfileState = z.infer<typeof PublicProfileStateSchema>;
