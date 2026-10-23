import { z } from "zod";
import { ErrorCatalogCodeSchema } from "../failures/error-catalog.js";
import { ErrorCodeSchema } from "../../rules/identity/ids.js";
import { ProfileIdSchema, ProfileRegistryRowSchema } from "./profile.js";

export const ProfileLoginRequestSchema = z.strictObject({ email: z.string().min(1).max(254), password: z.string().min(1).max(1024) });
export const ProfileSignUpRequestSchema = ProfileLoginRequestSchema.extend({ firstName: z.string().min(1).max(64), lastName: z.string().min(1).max(64) });
export type ProfileLoginRequest = z.infer<typeof ProfileLoginRequestSchema>;
export type ProfileSignUpRequest = z.infer<typeof ProfileSignUpRequestSchema>;

export const PublicProfileStateSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("signed-out") }),
  z.strictObject({ state: z.literal("error"), code: ErrorCodeSchema }),
  z.strictObject({ state: z.literal("active"), profileId: ProfileIdSchema, duoState: ProfileRegistryRowSchema.shape.duoState, epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
  z.strictObject({ state: z.literal("cancelling"), operationId: z.uuid() }),
  z.strictObject({ state: z.literal("refused"), code: ErrorCatalogCodeSchema }),
]);
export type PublicProfileState = z.infer<typeof PublicProfileStateSchema>;
