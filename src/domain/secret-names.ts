import { z } from "zod";

export const EnvironmentSecretNameSchema = z.enum([
  "ucpathUserId",
  "ucpathPassword",
  "timekeeperName",
  "sharepointOnboardingRosterUrl",
]);
export const SecretNameSchema = EnvironmentSecretNameSchema;
export const SecretFamilyNameSchema = z.enum([
  "geminiApiKeys",
  "groqApiKeys",
  "mistralApiKeys",
  "openRouterApiKeys",
  "sambaNovaApiKeys",
]);
export const SecretFileNameSchema = z.enum(["duoWebauthnCredential"]);
/**
 * The ONE test-target value that crosses the closed secret boundary (D300):
 * the canary's Kuali document number, selected in ignored local configuration.
 * The composed `separations` chain derives every person fact — employee name,
 * document EID, the UCPath subject — live from that number; no person value is
 * ever a registered test-target secret.
 */
export const TestTargetDocumentNumberSecretNameSchema = z.literal(
  "separationsKualiFinalizationCanaryDocumentNumber",
);
/** D318 — the person-lookup live-read canary: ONE UCPath EID selected in ignored local configuration. */
export const TestTargetEidSecretNameSchema = z.literal("personLookupCanaryEid");
export const TestTargetSecretNameSchema = z.union([
  TestTargetDocumentNumberSecretNameSchema,
  TestTargetEidSecretNameSchema,
]);

export type SecretName = z.infer<typeof SecretNameSchema>;
export type EnvironmentSecretName = z.infer<typeof EnvironmentSecretNameSchema>;
export type SecretFamilyName = z.infer<typeof SecretFamilyNameSchema>;
export type SecretFileName = z.infer<typeof SecretFileNameSchema>;
export type TestTargetDocumentNumberSecretName = z.infer<typeof TestTargetDocumentNumberSecretNameSchema>;
export type TestTargetEidSecretName = z.infer<typeof TestTargetEidSecretNameSchema>;
export type TestTargetSecretName = z.infer<typeof TestTargetSecretNameSchema>;
