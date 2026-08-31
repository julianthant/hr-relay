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
export const TestTargetEidSecretNameSchema = z.literal("separationsKualiFinalizationCanaryEid");
export const TestTargetEmployeeNameSecretNameSchema = z.literal(
  "separationsKualiFinalizationCanaryEmployeeName",
);
export const TestTargetTimekeeperNameSecretNameSchema = z.literal(
  "separationsKualiFinalizationCanaryTimekeeperName",
);
export const TestTargetSecretNameSchema = z.union([
  TestTargetEidSecretNameSchema,
  TestTargetEmployeeNameSecretNameSchema,
  TestTargetTimekeeperNameSecretNameSchema,
]);

export type SecretName = z.infer<typeof SecretNameSchema>;
export type EnvironmentSecretName = z.infer<typeof EnvironmentSecretNameSchema>;
export type SecretFamilyName = z.infer<typeof SecretFamilyNameSchema>;
export type SecretFileName = z.infer<typeof SecretFileNameSchema>;
export type TestTargetEidSecretName = z.infer<typeof TestTargetEidSecretNameSchema>;
export type TestTargetEmployeeNameSecretName = z.infer<typeof TestTargetEmployeeNameSecretNameSchema>;
export type TestTargetTimekeeperNameSecretName = z.infer<typeof TestTargetTimekeeperNameSecretNameSchema>;
export type TestTargetSecretName = z.infer<typeof TestTargetSecretNameSchema>;
