import { createHash } from "node:crypto";
import { readFileSync, statSync, type Stats } from "node:fs";
import { z } from "zod";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { MIGRATED_SETTINGS_ENVIRONMENT_KEYS, RETIRED_TEST_TARGET_ENVIRONMENT_KEYS } from "./catalog.js";
import { ProtectedStoreRecordSchema, type ProtectedStoreRecord } from "./protected-settings.js";
import type { Config } from "./schema.js";
import { establishHostPrimaryDisplay, hostPrimaryDisplayEnvironment, type HostDisplayProbe } from "./host-display.js";
import { FingerprintSchema, type Fingerprint } from "../../rules/identity/ids.js";
import { deepFreeze } from "../../rules/validation/immutability.js";
import { EnvironmentSecretNameSchema, SecretFileNameSchema, SecretNameSchema } from "./secret-names.js";
import type { SecretFileName, SecretName } from "./secret-names.js";
export {
  EnvironmentSecretNameSchema,
  SecretFileNameSchema,
  SecretNameSchema,
} from "./secret-names.js";
export type {
  EnvironmentSecretName,
  SecretFileName,
  SecretName,
} from "./secret-names.js";
const SecretSourceSchema = z.literal("protected-store");
const REGISTERED_SECRET_FILE_MAXIMUM_BYTES = 64_000;

export const SecretSpecSchema = z.strictObject({
  name: EnvironmentSecretNameSchema,
  source: z.literal("protected-store"),
  requiredAtBoot: z.boolean(),
  classification: z.enum(["secret", "direct-identifier"]),
});
export const SecretFileSpecSchema = z.strictObject({
  name: SecretFileNameSchema,
  configPath: z.literal("paths.duoCredential"),
  classification: z.literal("credential-file"),
  maximumBytes: z.number().int().positive(),
});

export const ActivityPersonPseudonymSecretReferenceSchema = z.strictObject({
  name: z.literal("activityPersonPseudonym"),
});

export const ACTIVITY_PERSON_PSEUDONYM_SECRET_REFERENCE = deepFreeze(
  ActivityPersonPseudonymSecretReferenceSchema.parse({
    name: "activityPersonPseudonym",
  }),
);

export const SECRET_SPECS = deepFreeze(SecretSpecSchema.array().parse([
  { name: "ucpathUserId", source: "protected-store", requiredAtBoot: false, classification: "direct-identifier" },
  { name: "ucpathPassword", source: "protected-store", requiredAtBoot: false, classification: "secret" },
  { name: "timekeeperName", source: "protected-store", requiredAtBoot: false, classification: "direct-identifier" },
  { name: "sharepointOnboardingRosterUrl", source: "protected-store", requiredAtBoot: false, classification: "secret" },
]));
export const SECRET_FILE_SPECS = deepFreeze(SecretFileSpecSchema.array().parse([
  { name: "duoWebauthnCredential", configPath: "paths.duoCredential", classification: "credential-file", maximumBytes: REGISTERED_SECRET_FILE_MAXIMUM_BYTES },
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

interface SecretFileAccess {
  readonly stat: (path: string) => SecretFileMetadata;
  readonly readBytes: (path: string) => Buffer;
}

const DEFAULT_SECRET_FILE_ACCESS: SecretFileAccess = {
  stat: statSync,
  readBytes: (path) => readFileSync(path),
};

/** Every accessor invocation calls this source; no protected value is cached or published. */
export const ProtectedSecretSourceSchema = z.strictObject({
  read: z.function({ input: [], output: z.unknown() }),
});
export type ProtectedSecretSource = z.infer<typeof ProtectedSecretSourceSchema>;

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

function assertRegisteredSecretFileMetadata(
  metadata: SecretFileMetadata,
  publicSourceLabel: string,
  maximumBytes: number,
): void {
  if (!metadata.isFile()) throw new SecretSourceError(`${publicSourceLabel} is not a regular file`);
  if ((metadata.mode & 0o077) !== 0) {
    throw new SecretSourceError(`${publicSourceLabel} permissions must be 0600 or stricter`);
  }
  if (metadata.size > maximumBytes) {
    throw new SecretSourceError(`${publicSourceLabel} exceeds its registered size limit`);
  }
}

const MIGRATED_ENVIRONMENT_KEY_SET: ReadonlySet<string> = new Set(
  MIGRATED_SETTINGS_ENVIRONMENT_KEYS,
);

function migratedEnvironmentRefusal(key: string): SecretSourceError {
  if (RETIRED_TEST_TARGET_ENVIRONMENT_KEY_SET.has(key)) {
    return new SecretSourceError(retiredTestTargetEnvironmentRefusal(key));
  }
  return new SecretSourceError(
    `migrated environment key ${key} is refused; set it in Settings, then remove it`,
  );
}

/** Refuse migrated names by key membership only; no value is ever inspected. */
export function assertNoMigratedEnvironmentKeys(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const migrated = Object.keys(env).find((key) => MIGRATED_ENVIRONMENT_KEY_SET.has(key));
  if (migrated !== undefined) throw migratedEnvironmentRefusal(migrated);
}

/** Test-target environment names refuse before secret access; values belong in the ignored private config. */
const RETIRED_TEST_TARGET_ENVIRONMENT_KEY_SET: ReadonlySet<string> = new Set(RETIRED_TEST_TARGET_ENVIRONMENT_KEYS);
export function retiredTestTargetEnvironmentRefusal(key: string): string {
  return `retired test-target environment key ${key} is refused; test-target inputs live in config/test-data.local.json, so remove it`;
}

function registeredSecretSpec(name: SecretName): SecretSpec {
  const spec = SECRET_SPECS.find((candidate) => candidate.name === name);
  if (spec === undefined) throw new SecretMissingError(`secret registry has no entry for ${name}`);
  return spec;
}

function assertReadableSecretFile(
  name: string,
  source: string,
  path: string,
  maximumBytes: number,
  access: SecretFileAccess,
): void {
  let metadata: SecretFileMetadata;
  try {
    metadata = access.stat(path);
  } catch (error) {
    throw new SecretSourceError(`${name} source ${source} is unavailable at its registered path`, { cause: error });
  }
  assertRegisteredSecretFileMetadata(metadata, `${name} source ${source}`, maximumBytes);
}

function readProtectedStore(
  name: string,
  source: ProtectedSecretSource,
): ProtectedStoreRecord {
  try {
    return ProtectedStoreRecordSchema.parse(ProtectedSecretSourceSchema.parse(source).read());
  } catch (error) {
    throw new SecretSourceError(`${name} could not be read from protected-store`, { cause: error });
  }
}

/** Value-free revision for invalidating observations after a protected-settings edit. */
export function protectedSecretRevision(source: ProtectedSecretSource): number {
  return readProtectedStore("protected-settings", source).revision;
}

function resolveSecretValue(name: SecretName, source: ProtectedSecretSource): string | undefined {
  registeredSecretSpec(name);
  return readProtectedStore(name, source).entries[name]?.value;
}

export function inspectSecret(
  name: SecretName,
  source: ProtectedSecretSource,
): SecretAvailability {
  const spec = registeredSecretSpec(name);
  try {
    const value = resolveSecretValue(name, source);
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
  source: ProtectedSecretSource,
): string | undefined {
  return resolveSecretValue(name, source);
}

/** The production resolution environment: the ONE sanctioned environment, after the host's primary display has been established in it. */
export function hostAwareResolutionEnvironment(
  probe: HostDisplayProbe,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  establishHostPrimaryDisplay(probe, env);
  return env;
}

export function requireSecret(
  name: SecretName,
  source: ProtectedSecretSource,
): string {
  const value = optionalSecret(name, source);
  if (value === undefined) {
    const spec = registeredSecretSpec(name);
    throw new SecretMissingError(`${name} is missing from registered source ${spec.source}`);
  }
  return value;
}

function unresolvedDiagnostics(availabilities: readonly SecretAvailability[]): readonly string[] {
  return availabilities
    .filter((availability) => availability.state !== "present")
    .map((availability) => `${availability.name} [${availability.state}: ${availability.diagnostic}]`);
}

export function validateBootSecrets(
  source: ProtectedSecretSource,
 ): void {
  const unresolved = unresolvedDiagnostics(SECRET_SPECS.filter(({ requiredAtBoot }) => requiredAtBoot)
    .map(({ name }) => inspectSecret(name, source)));
  if (unresolved.length > 0) throw new SecretMissingError(`unresolved boot secrets: ${unresolved.join(", ")}`);
}

export function requireSecretFile(
  name: SecretFileName,
  config: Config,
  access: SecretFileAccess = DEFAULT_SECRET_FILE_ACCESS,
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

/** The credential file is Fast Duo's credential format (one object, an array, or `{credentials: [...]}`), so its identity fields are read by type guard rather than an open record. */
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

/** The IDENTITY of a credential file — a SHA-256 over the sorted `(rpId, credentialId)` pairs it holds — resolved here because this module is the only permitted credential-file reader. */
export function resolveSecretFileIdentity(
  name: SecretFileName,
  config: Config,
  access: SecretFileAccess = DEFAULT_SECRET_FILE_ACCESS,
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

/** Closed worker bootstrap: OS lookup/home/temp/locale mechanics plus the display channel; NODE_OPTIONS and arbitrary parent bindings are not process mechanics. */
export const WORKER_PROCESS_MECHANIC_KEYS = Object.freeze(["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "TZ"] as const);

export function workerBootstrapEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  assertNoMigratedEnvironmentKeys(env);
  const result: NodeJS.ProcessEnv = { ...hostPrimaryDisplayEnvironment(env) };
  for (const key of WORKER_PROCESS_MECHANIC_KEYS) {
    const value = env[key];
    if (value !== undefined) result[key] = value;
  }
  return Object.freeze(result);
}
