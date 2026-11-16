import { z } from "zod";

export const EnvironmentSecretNameSchema = z.enum([
  "ucpathUserId",
  "ucpathPassword",
  "sharepointOnboardingRosterUrl",
]);
export const SecretNameSchema = EnvironmentSecretNameSchema;
export type SecretName = z.infer<typeof SecretNameSchema>;
export type EnvironmentSecretName = z.infer<typeof EnvironmentSecretNameSchema>;
