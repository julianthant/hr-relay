import { z } from "zod";

export const EnvironmentSecretNameSchema = z.enum([
  "ucpathUserId",
  "ucpathPassword",
  "timekeeperName",
  "sharepointOnboardingRosterUrl",
]);
export const SecretNameSchema = z.union([
  EnvironmentSecretNameSchema,
  z.literal("ngrokCredential"),
]);
export const SecretFamilyNameSchema = z.enum([
  "geminiApiKeys",
  "groqApiKeys",
  "mistralApiKeys",
  "openRouterApiKeys",
  "sambaNovaApiKeys",
]);
export const SecretFileNameSchema = z.enum(["duoWebauthnCredential"]);

export type SecretName = z.infer<typeof SecretNameSchema>;
export type EnvironmentSecretName = z.infer<typeof EnvironmentSecretNameSchema>;
export type SecretFamilyName = z.infer<typeof SecretFamilyNameSchema>;
export type SecretFileName = z.infer<typeof SecretFileNameSchema>;
