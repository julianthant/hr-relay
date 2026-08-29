import { createHash } from "node:crypto";
import { readFileSync, statSync, type Stats } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { canonicalJsonStringify } from "./canonical-json.js";
import type { Config } from "./config/schema.js";
import { EidSchema, FingerprintSchema, type Eid, type Fingerprint } from "./ids.js";
import { deepFreeze } from "./immutability.js";
import {
  createActivityPersonPseudonymDomain,
  type ActivityPersonPseudonymDomain,
} from "./trust/activity-person-pseudonym.js";
import {
  EnvironmentSecretNameSchema,
  SecretFamilyNameSchema,
  SecretFileNameSchema,
  SecretNameSchema,
} from "./secret-names.js";
import type {
  SecretFamilyName,
  SecretFileName,
  SecretName,
} from "./secret-names.js";
export {
  EnvironmentSecretNameSchema,
  SecretFamilyNameSchema,
  SecretFileNameSchema,
  SecretNameSchema,
} from "./secret-names.js";
export type {
  EnvironmentSecretName,
  SecretFamilyName,
  SecretFileName,
  SecretName,
} from "./secret-names.js";
const SecretSourceSchema = z.enum(["environment", "local-ngrok-config"]);

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
    maximumBytes: z.number().int().positive(),
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

export const TestTargetEidSecretReferenceSchema = z.strictObject({
  name: z.literal("separationsKualiFinalizationCanaryEid"),
  env: z.literal("HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID"),
});
export const TestTargetEidSecretNameSchema = TestTargetEidSecretReferenceSchema.shape.name;
export type TestTargetEidSecretName = z.infer<typeof TestTargetEidSecretNameSchema>;

export const ActivityPersonPseudonymSecretReferenceSchema = z.strictObject({
  key: z.strictObject({
    name: z.literal("activityPersonPseudonymHmacKey"),
    env: z.literal("HRAUTO_ACTIVITY_PERSON_PSEUDONYM_HMAC_KEY"),
  }),
  generation: z.strictObject({
    env: z.literal("HRAUTO_ACTIVITY_PERSON_PSEUDONYM_KEY_GENERATION"),
  }),
});

export const ACTIVITY_PERSON_PSEUDONYM_SECRET_REFERENCE = deepFreeze(
  ActivityPersonPseudonymSecretReferenceSchema.parse({
    key: {
      name: "activityPersonPseudonymHmacKey",
      env: "HRAUTO_ACTIVITY_PERSON_PSEUDONYM_HMAC_KEY",
    },
    generation: {
      env: "HRAUTO_ACTIVITY_PERSON_PSEUDONYM_KEY_GENERATION",
    },
  }),
);

export const TestTargetEidSecretSpecSchema = TestTargetEidSecretReferenceSchema.extend({
  classification: z.literal("direct-identifier"),
});

export const SECRET_SPECS = deepFreeze(SecretSpecSchema.array().parse([
  { name: "ucpathUserId", source: "environment", env: "UCPATH_USER_ID", requiredAtBoot: false, classification: "direct-identifier" },
  { name: "ucpathPassword", source: "environment", env: "UCPATH_PASSWORD", requiredAtBoot: false, classification: "secret" },
  { name: "timekeeperName", source: "environment", env: "TIMEKEEPER_NAME", requiredAtBoot: false, classification: "direct-identifier" },
  { name: "sharepointOnboardingRosterUrl", source: "environment", env: "ONBOARDING_ROSTER_URL", requiredAtBoot: false, classification: "secret" },
  { name: "ngrokCredential", source: "local-ngrok-config", requiredAtBoot: false, classification: "secret", maximumBytes: 64_000 },
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
export const TEST_TARGET_EID_SECRET_SPECS = deepFreeze(TestTargetEidSecretSpecSchema.array().parse([
  {
    name: "separationsKualiFinalizationCanaryEid",
    env: "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID",
    classification: "direct-identifier",
  },
]));

type SecretSpec = z.infer<typeof SecretSpecSchema>;
type SecretFileMetadata = Pick<Stats, "isFile" | "mode" | "size">;

export const SecretAvailabilitySchema = z.discriminatedUnion("state", [
  z.strictObject({ name: SecretNameSchema, source: SecretSourceSchema, state: z.literal("present") }),
  z.strictObject({
    name: SecretNameSchema,
    source: SecretSourceSchema,
    state: z.literal("missing"),
    diagnostic: z.string().min(1),
  }),
  z.strictObject({
    name: SecretNameSchema,
    source: SecretSourceSchema,
    state: z.literal("unknown"),
    diagnostic: z.string().min(1),
  }),
]);
export type SecretAvailability = z.infer<typeof SecretAvailabilitySchema>;

interface SecretSourceAccess {
  readonly homeDirectory: () => string;
  readonly stat: (path: string) => SecretFileMetadata;
  readonly readText: (path: string) => string;
  readonly readBytes: (path: string) => Buffer;
}

const DEFAULT_SECRET_SOURCE_ACCESS: SecretSourceAccess = {
  homeDirectory: homedir,
  stat: statSync,
  readText: (path) => readFileSync(path, "utf8"),
  readBytes: (path) => readFileSync(path),
};

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

export class SecretSourceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SecretSourceError";
  }
}

function registeredTestTargetEidSecretSpec(name: TestTargetEidSecretName) {
  const spec = TEST_TARGET_EID_SECRET_SPECS.find((candidate) => candidate.name === name);
  if (spec === undefined) throw new SecretMissingError(`test-target EID registry has no entry for ${name}`);
  return spec;
}

/**
 * Resolve one registered live-subject EID. The environment key is closed by
 * `TestTargetEidSecretNameSchema`; callers can never supply an arbitrary key.
 */
export function optionalTestTargetEidSecret(
  name: TestTargetEidSecretName,
  env: NodeJS.ProcessEnv = process.env,
): Eid | undefined {
  const spec = registeredTestTargetEidSecretSpec(name);
  const encodedEid = env[spec.env]?.trim();
  if (encodedEid === undefined || encodedEid === "") return undefined;
  const parsed = EidSchema.safeParse(encodedEid);
  if (!parsed.success) {
    throw new SecretSourceError(`test-target EID ${name} is invalid in registered environment source ${spec.env}`);
  }
  return parsed.data;
}

function registeredSecretSpec(name: SecretName): SecretSpec {
  const spec = SECRET_SPECS.find((candidate) => candidate.name === name);
  if (spec === undefined) throw new SecretMissingError(`secret registry has no entry for ${name}`);
  return spec;
}

function familySpec(name: SecretFamilyName) {
  const spec = SECRET_FAMILY_SPECS.find((candidate) => candidate.name === name);
  if (spec === undefined) throw new SecretMissingError(`secret-family registry has no entry for ${name}`);
  return spec;
}

function assertReadableSecretFile(
  name: string,
  source: string,
  path: string,
  maximumBytes: number,
  access: SecretSourceAccess,
): void {
  let metadata: SecretFileMetadata;
  try {
    metadata = access.stat(path);
  } catch (error) {
    throw new SecretSourceError(`${name} source ${source} is unavailable at its registered path`, { cause: error });
  }
  if (!metadata.isFile()) throw new SecretSourceError(`${name} source ${source} is not a regular file`);
  if ((metadata.mode & 0o077) !== 0) throw new SecretSourceError(`${name} source ${source} permissions must be 0600 or stricter`);
  if (metadata.size > maximumBytes) throw new SecretSourceError(`${name} source ${source} exceeds its registered size limit`);
}

function localNgrokCredential(access: SecretSourceAccess): string | undefined {
  const spec = registeredSecretSpec("ngrokCredential");
  if (spec.source !== "local-ngrok-config") throw new SecretSourceError("ngrokCredential has the wrong registered source kind");
  const path = join(access.homeDirectory(), "Library", "Application Support", "ngrok", "ngrok.yml");
  assertReadableSecretFile(spec.name, spec.source, path, spec.maximumBytes, access);
  let content: string;
  try {
    content = access.readText(path);
  } catch (error) {
    throw new SecretSourceError("ngrokCredential source local-ngrok-config could not be read", { cause: error });
  }
  const tokenLines = content.split(/\r?\n/).filter((line) => /^\s*authtoken\s*:/.test(line));
  if (tokenLines.length > 1) throw new SecretSourceError("ngrokCredential source local-ngrok-config declares authtoken more than once");
  const tokenLine = tokenLines[0];
  if (tokenLine === undefined) return undefined;
  const separator = tokenLine.indexOf(":");
  const encoded = tokenLine.slice(separator + 1).trim();
  if (encoded === "") return undefined;
  if (encoded.startsWith("\"") || encoded.startsWith("'")) {
    const quote = encoded.startsWith("\"") ? "\"" : "'";
    if (!encoded.endsWith(quote) || encoded.length < 3) {
      throw new SecretSourceError("ngrokCredential source local-ngrok-config has a malformed quoted authtoken");
    }
    return encoded.slice(1, -1).trim() || undefined;
  }
  const token = encoded.replace(/\s+#.*$/, "").trim();
  return token === "" ? undefined : token;
}

function resolveSecretValue(
  name: SecretName,
  env: NodeJS.ProcessEnv,
  access: SecretSourceAccess,
): string | undefined {
  const spec = registeredSecretSpec(name);
  if (spec.source === "local-ngrok-config") return localNgrokCredential(access);
  const value = env[spec.env]?.trim();
  return value === "" ? undefined : value;
}

export function inspectSecret(
  name: SecretName,
  env: NodeJS.ProcessEnv = process.env,
  access: SecretSourceAccess = DEFAULT_SECRET_SOURCE_ACCESS,
): SecretAvailability {
  const spec = registeredSecretSpec(name);
  try {
    const value = resolveSecretValue(name, env, access);
    if (value === undefined) {
      return SecretAvailabilitySchema.parse({
        name,
        source: spec.source,
        state: "missing",
        diagnostic: `${name} is missing from ${spec.source}`,
      });
    }
    return SecretAvailabilitySchema.parse({ name, source: spec.source, state: "present" });
  } catch (error) {
    if (!(error instanceof SecretSourceError)) throw error;
    return SecretAvailabilitySchema.parse({
      name,
      source: spec.source,
      state: "unknown",
      diagnostic: `${name} could not be resolved from ${spec.source}: ${error.message}`,
    });
  }
}

export function optionalSecret(
  name: SecretName,
  env: NodeJS.ProcessEnv = process.env,
  access: SecretSourceAccess = DEFAULT_SECRET_SOURCE_ACCESS,
): string | undefined {
  return resolveSecretValue(name, env, access);
}

/**
 * The ONE sanctioned production source of the environment object that
 * `resolveConfig`/`resolveConfigWithProvenance` take as a parameter (ref clock-config-secrets).
 * The resolver itself never touches `process.env` — it reads only its
 * statically-declared `CONFIG_ENV_BINDINGS` keys off the value it is handed —
 * and no module outside this file may reach the environment, so composition
 * roots obtain it here rather than growing their own read.
 */
export function configResolutionEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return env;
}

export function requireSecret(
  name: SecretName,
  env: NodeJS.ProcessEnv = process.env,
  access: SecretSourceAccess = DEFAULT_SECRET_SOURCE_ACCESS,
): string {
  const value = optionalSecret(name, env, access);
  if (value === undefined) {
    const spec = registeredSecretSpec(name);
    const source = spec.source === "environment" ? `${spec.source} ${spec.env}` : spec.source;
    throw new SecretMissingError(`${name} is missing from registered source ${source}`);
  }
  return value;
}

/**
 * D288's exact secret composition. The public generation must be configured
 * beside the key; neither value has a default, and the returned domain exposes
 * no key-reading operation.
 */
export function requireActivityPersonPseudonymDomain(
  env: NodeJS.ProcessEnv = process.env,
): ActivityPersonPseudonymDomain {
  const reference = ACTIVITY_PERSON_PSEUDONYM_SECRET_REFERENCE;
  const keyGeneration = env[reference.generation.env]?.trim();
  if (keyGeneration === undefined || keyGeneration === "") {
    throw new SecretMissingError(
      `activity person pseudonym generation is missing from registered environment source ${reference.generation.env}`,
    );
  }
  const keyHex = env[reference.key.env]?.trim();
  if (keyHex === undefined || keyHex === "") {
    throw new SecretMissingError(
      `activity person pseudonym HMAC key is missing from registered environment source ${reference.key.env}`,
    );
  }
  return createActivityPersonPseudonymDomain({ keyGeneration, keyHex });
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

/**
 * The model chain a provider family is configured to use, in priority order.
 *
 * Model ids are NOT secrets, but their env variables were registered on the
 * family specs at D96 and this module is the only one permitted to read the
 * environment — so the reader lives here. `modelsEnv` is the comma-separated
 * chain; the single-model `legacyModelEnv` spelling is honored when the chain
 * is absent, because the operator's `.env` predates the plural form. An empty
 * result is a fact the composition root judges (a feature that needs the
 * family fails loud there), never a default minted here.
 */
export function providerModelChain(name: SecretFamilyName, env: NodeJS.ProcessEnv = process.env): readonly string[] {
  const spec = familySpec(name);
  const chain = env[spec.modelsEnv]?.trim();
  if (chain !== undefined && chain !== "") {
    const models = chain.split(",").map((model) => model.trim()).filter((model) => model !== "");
    if (models.length > 0) return models;
  }
  const legacy = env[spec.legacyModelEnv]?.trim();
  if (legacy !== undefined && legacy !== "") return [legacy];
  return [];
}

function unresolvedDiagnostics(availabilities: readonly SecretAvailability[]): readonly string[] {
  return availabilities
    .filter((availability) => availability.state !== "present")
    .map((availability) => `${availability.name} [${availability.state}: ${availability.diagnostic}]`);
}

export function validateBootSecrets(
  env: NodeJS.ProcessEnv = process.env,
  access: SecretSourceAccess = DEFAULT_SECRET_SOURCE_ACCESS,
): void {
  const unresolved = unresolvedDiagnostics(SECRET_SPECS.filter(({ requiredAtBoot }) => requiredAtBoot)
    .map(({ name }) => inspectSecret(name, env, access)));
  const missingFamilies = SECRET_FAMILY_SPECS.filter(({ requiredAtBoot }) => requiredAtBoot)
    .filter(({ name }) => optionalSecretFamily(name, env).length === 0)
    .map(({ envPrefix }) => envPrefix);
  const allUnresolved = [...unresolved, ...missingFamilies.map((family) => `${family} [missing: environment family has no value]`)];
  if (allUnresolved.length > 0) throw new SecretMissingError(`unresolved boot secrets: ${allUnresolved.join(", ")}`);
}

export function validateDescriptorSecrets(
  names: readonly SecretName[],
  families: readonly SecretFamilyName[],
  env: NodeJS.ProcessEnv = process.env,
  access: SecretSourceAccess = DEFAULT_SECRET_SOURCE_ACCESS,
): void {
  const unresolved = unresolvedDiagnostics(names.map((name) => inspectSecret(name, env, access)));
  const missingFamilies = families.filter((name) => optionalSecretFamily(name, env).length === 0);
  if (unresolved.length > 0 || missingFamilies.length > 0) {
    const diagnostics = [...unresolved, ...missingFamilies.map((family) => `${family} [missing: environment family has no value]`)];
    throw new SecretMissingError(`unresolved descriptor secrets: ${diagnostics.join(", ")}`);
  }
}

export function requireSecretFile(
  name: SecretFileName,
  config: Config,
  access: SecretSourceAccess = DEFAULT_SECRET_SOURCE_ACCESS,
): Buffer {
  const parsedName = SecretFileNameSchema.parse(name);
  const spec = SECRET_FILE_SPECS.find((candidate) => candidate.name === parsedName);
  if (spec === undefined) throw new SecretFileError(`${name} has no registered credential-file specification`);
  try {
    assertReadableSecretFile(name, spec.classification, config.paths.duoCredential, spec.maximumBytes, access);
  } catch (error) {
    throw new SecretFileError(`${name} is unavailable at the registered rebuild credential path`, { cause: error });
  }
  try {
    return access.readBytes(config.paths.duoCredential);
  } catch (error) {
    throw new SecretFileError(`${name} could not be read`, { cause: error });
  }
}

/**
 * The PUBLIC half of a WebAuthn credential, which is all an identity needs.
 * `credentialId` travels to the relying party in cleartext on every assertion
 * and `rpId` is the relying party's own name; the private key is never read
 * into the identity and never leaves this function. The file is Duo
 * Autopilot's own format (`duo-autopilot/src/background.js` `isValidCredential`:
 * one object, an array, or `{credentials: [...]}`), not one of this repo's
 * boundaries, so the two fields are read by type guard rather than by a zod
 * record that would have to be open to admit the secret fields beside them.
 */
function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function webauthnCredentialEntries(parsed: unknown): readonly unknown[] | undefined {
  if (isUnknownArray(parsed)) return parsed;
  if (parsed === null || typeof parsed !== "object") return undefined;
  if ("credentials" in parsed) {
    const credentials: unknown = parsed.credentials;
    return isUnknownArray(credentials) ? credentials : undefined;
  }
  return [parsed];
}

function webauthnCredentialIdentity(entry: unknown): Readonly<{ rpId: string; credentialId: string }> | undefined {
  if (entry === null || typeof entry !== "object") return undefined;
  if (!("rpId" in entry) || !("credentialId" in entry)) return undefined;
  const { rpId, credentialId } = entry;
  if (typeof rpId !== "string" || rpId.length === 0) return undefined;
  if (typeof credentialId !== "string" || credentialId.length === 0) return undefined;
  return { rpId, credentialId };
}

/**
 * D267 (ref execution-and-sessions §10.1): the IDENTITY of a credential file —
 * a SHA-256 over the sorted `(rpId, credentialId)` pairs it holds — resolved
 * through this module because it is the only permitted credential-file reader.
 * It is what the Duo ceremony lease is keyed on: per CREDENTIAL, never per
 * worker, system or profile. The digest carries no secret byte, and a file
 * whose identity cannot be resolved THROWS; it never yields a substitute key,
 * because a per-worker key is the unserialized behaviour wearing a lease's name.
 */
export function resolveSecretFileIdentity(
  name: SecretFileName,
  config: Config,
  access: SecretSourceAccess = DEFAULT_SECRET_SOURCE_ACCESS,
): Fingerprint {
  const bytes = requireSecretFile(name, config, access);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new SecretFileError(`${name} is not JSON, so its credential identity cannot be resolved`, { cause: error });
  }
  const entries = webauthnCredentialEntries(parsed);
  if (entries === undefined) throw new SecretFileError(`${name} has no recognizable credential shape, so its identity cannot be resolved`);
  const identities = entries.map((entry, index) => {
    const identity = webauthnCredentialIdentity(entry);
    if (identity === undefined) {
      throw new SecretFileError(`${name} credential #${String(index)} carries no rpId + credentialId, so its identity cannot be resolved`);
    }
    return identity;
  });
  if (identities.length === 0) throw new SecretFileError(`${name} holds no credential, so its identity cannot be resolved`);
  identities.sort((a, b) => `${a.rpId}\u0000${a.credentialId}`.localeCompare(`${b.rpId}\u0000${b.credentialId}`));
  return FingerprintSchema.parse(createHash("sha256")
    .update("hrauto:duo-credential-identity:v1\0")
    .update(canonicalJsonStringify(identities))
    .digest("hex"));
}
