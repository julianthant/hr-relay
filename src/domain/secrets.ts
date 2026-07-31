import { readFileSync, statSync } from "node:fs";
import { z } from "zod";
import type { Config } from "./config/schema.js";
import { deepFreeze } from "./immutability.js";

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

export const SecretSpecSchema = z.discriminatedUnion("source", [
  z.strictObject({
    name: EnvironmentSecretNameSchema,
    source: z.literal("environment"),
    env: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    requiredAtBoot: z.boolean(),
    classification: z.enum(["secret", "direct-identifier"]),
  }),
  z.strictObject({
    name: z.literal("ngrokCredential"),
    source: z.literal("local-ngrok-config"),
    requiredAtBoot: z.boolean(),
    classification: z.literal("secret"),
  }),
]);
export const SecretFamilySpecSchema = z.strictObject({
  name: SecretFamilyNameSchema,
  envPrefix: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  modelsEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  legacyModelEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  maximum: z.number().int().positive(),
  requiredAtBoot: z.boolean(),
  classification: z.literal("secret"),
});
export const SecretFileSpecSchema = z.strictObject({
  name: SecretFileNameSchema,
  configPath: z.literal("paths.duoCredential"),
  classification: z.literal("credential-file"),
  maximumBytes: z.number().int().positive(),
});

export const SECRET_SPECS = deepFreeze(SecretSpecSchema.array().parse([
  { name: "ucpathUserId", source: "environment", env: "UCPATH_USER_ID", requiredAtBoot: false, classification: "direct-identifier" },
  { name: "ucpathPassword", source: "environment", env: "UCPATH_PASSWORD", requiredAtBoot: false, classification: "secret" },
  { name: "timekeeperName", source: "environment", env: "TIMEKEEPER_NAME", requiredAtBoot: false, classification: "direct-identifier" },
  { name: "sharepointOnboardingRosterUrl", source: "environment", env: "ONBOARDING_ROSTER_URL", requiredAtBoot: false, classification: "secret" },
  { name: "ngrokCredential", source: "local-ngrok-config", requiredAtBoot: false, classification: "secret" },
]));
export const SECRET_FAMILY_SPECS = deepFreeze(SecretFamilySpecSchema.array().parse([
  { name: "geminiApiKeys", envPrefix: "GEMINI_API_KEY", modelsEnv: "OCR_GEMINI_MODELS", legacyModelEnv: "OCR_GEMINI_MODEL", maximum: 8, requiredAtBoot: false, classification: "secret" },
  { name: "groqApiKeys", envPrefix: "GROQ_API_KEY", modelsEnv: "OCR_GROQ_MODELS", legacyModelEnv: "OCR_GROQ_MODEL", maximum: 8, requiredAtBoot: false, classification: "secret" },
  { name: "mistralApiKeys", envPrefix: "MISTRAL_API_KEY", modelsEnv: "OCR_MISTRAL_MODELS", legacyModelEnv: "OCR_MISTRAL_MODEL", maximum: 8, requiredAtBoot: false, classification: "secret" },
  { name: "openRouterApiKeys", envPrefix: "OPEN_ROUTER_API_KEY", modelsEnv: "OCR_OPENROUTER_MODELS", legacyModelEnv: "OCR_OPENROUTER_MODEL", maximum: 8, requiredAtBoot: false, classification: "secret" },
  { name: "sambaNovaApiKeys", envPrefix: "SAMBANOVA_API_KEY", modelsEnv: "OCR_SAMBANOVA_MODELS", legacyModelEnv: "OCR_SAMBANOVA_MODEL", maximum: 8, requiredAtBoot: false, classification: "secret" },
]));
export const SECRET_FILE_SPECS = deepFreeze(SecretFileSpecSchema.array().parse([
  { name: "duoWebauthnCredential", configPath: "paths.duoCredential", classification: "credential-file", maximumBytes: 64_000 },
]));

export type SecretName = z.infer<typeof SecretNameSchema>;
export type EnvironmentSecretName = z.infer<typeof EnvironmentSecretNameSchema>;
export type SecretFamilyName = z.infer<typeof SecretFamilyNameSchema>;
export type SecretFileName = z.infer<typeof SecretFileNameSchema>;
type EnvironmentSecretSpec = Extract<z.infer<typeof SecretSpecSchema>, { source: "environment" }>;

export class SecretMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretMissingError";
  }
}

export class SecretFileError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SecretFileError";
  }
}

function environmentSecretSpecs(): readonly EnvironmentSecretSpec[] {
  return SECRET_SPECS.filter((spec): spec is EnvironmentSecretSpec => spec.source === "environment");
}

function secretSpec(name: EnvironmentSecretName) {
  const spec = environmentSecretSpecs().find((candidate) => candidate.name === name);
  if (spec === undefined) throw new SecretMissingError(`secret registry has no entry for ${name}`);
  return spec;
}

function familySpec(name: SecretFamilyName) {
  const spec = SECRET_FAMILY_SPECS.find((candidate) => candidate.name === name);
  if (spec === undefined) throw new SecretMissingError(`secret-family registry has no entry for ${name}`);
  return spec;
}

export function optionalSecret(name: EnvironmentSecretName, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const spec = secretSpec(name);
  const value = env[spec.env]?.trim();
  return value === "" ? undefined : value;
}

export function requireSecret(name: EnvironmentSecretName, env: NodeJS.ProcessEnv = process.env): string {
  const value = optionalSecret(name, env);
  if (value === undefined) {
    const spec = secretSpec(name);
    throw new SecretMissingError(`${name} is missing (${spec.env}); configure it in .env.example-compatible environment`);
  }
  return value;
}

export function optionalSecretFamily(name: SecretFamilyName, env: NodeJS.ProcessEnv = process.env): readonly string[] {
  const spec = familySpec(name);
  const values: string[] = [];
  for (let index = 1; index <= spec.maximum; index += 1) {
    const key = index === 1 ? spec.envPrefix : `${spec.envPrefix}${String(index)}`;
    const value = env[key]?.trim();
    if (value !== undefined && value !== "") values.push(value);
  }
  return values;
}

export function requireSecretFamily(name: SecretFamilyName, env: NodeJS.ProcessEnv = process.env): readonly [string, ...string[]] {
  const values = optionalSecretFamily(name, env);
  const first = values[0];
  if (first === undefined) {
    const spec = familySpec(name);
    throw new SecretMissingError(`${name} is missing (${spec.envPrefix}{,2..${String(spec.maximum)}})`);
  }
  return [first, ...values.slice(1)];
}

export function validateBootSecrets(env: NodeJS.ProcessEnv = process.env): void {
  const missing = environmentSecretSpecs().filter(({ requiredAtBoot }) => requiredAtBoot)
    .filter(({ name }) => optionalSecret(name, env) === undefined)
    .map(({ env: key }) => key);
  const missingFamilies = SECRET_FAMILY_SPECS.filter(({ requiredAtBoot }) => requiredAtBoot)
    .filter(({ name }) => optionalSecretFamily(name, env).length === 0)
    .map(({ envPrefix }) => envPrefix);
  const allMissing = [...missing, ...missingFamilies];
  if (allMissing.length > 0) throw new SecretMissingError(`missing boot secrets: ${allMissing.join(", ")}`);
}

export function validateDescriptorSecrets(
  names: readonly EnvironmentSecretName[],
  families: readonly SecretFamilyName[],
  env: NodeJS.ProcessEnv = process.env,
): void {
  const missing = names.filter((name) => optionalSecret(name, env) === undefined);
  const missingFamilies = families.filter((name) => optionalSecretFamily(name, env).length === 0);
  if (missing.length > 0 || missingFamilies.length > 0) {
    throw new SecretMissingError(`missing descriptor secrets: ${[...missing, ...missingFamilies].join(", ")}`);
  }
}

export function requireSecretFile(name: SecretFileName, config: Config): Buffer {
  const parsedName = SecretFileNameSchema.parse(name);
  const spec = SECRET_FILE_SPECS.find((candidate) => candidate.name === parsedName);
  if (spec === undefined) throw new SecretFileError(`${name} has no registered credential-file specification`);
  let metadata;
  try {
    metadata = statSync(config.paths.duoCredential);
  } catch (error) {
    throw new SecretFileError(`${name} is unavailable at the registered rebuild credential path`, { cause: error });
  }
  if (!metadata.isFile()) throw new SecretFileError(`${name} registered path is not a regular file`);
  if ((metadata.mode & 0o077) !== 0) throw new SecretFileError(`${name} file permissions must be 0600 or stricter`);
  if (metadata.size > spec.maximumBytes) {
    throw new SecretFileError(`${name} file exceeds its registered size limit`);
  }
  try {
    return readFileSync(config.paths.duoCredential);
  } catch (error) {
    throw new SecretFileError(`${name} could not be read`, { cause: error });
  }
}
