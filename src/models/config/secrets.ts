import { z } from "zod";
import { ProfileIdentitySchema } from "../profiles/profile-identity.js";
import { MIGRATED_SETTINGS_ENVIRONMENT_KEYS, RETIRED_PROTECTED_SETTINGS_ENVIRONMENT_KEYS, RETIRED_TEST_TARGET_ENVIRONMENT_KEYS } from "./catalog.js";
import { ProtectedStoreRecordSchema, type ProtectedStoreRecord } from "./protected-settings.js";
import { establishHostPrimaryDisplay, hostPrimaryDisplayEnvironment, type HostDisplayProbe } from "./host-display.js";
import { deepFreeze } from "../../rules/validation/immutability.js";
import { EnvironmentSecretNameSchema, SecretNameSchema } from "./secret-names.js";
import type { SecretName } from "./secret-names.js";
export {
  EnvironmentSecretNameSchema,
  SecretNameSchema,
} from "./secret-names.js";
export type {
  EnvironmentSecretName,
  SecretName,
} from "./secret-names.js";
const SecretSourceSchema = z.literal("protected-store");

export const SecretSpecSchema = z.strictObject({
  name: EnvironmentSecretNameSchema,
  source: z.literal("protected-store"),
  requiredAtBoot: z.boolean(),
  classification: z.enum(["secret", "direct-identifier"]),
});
export const SECRET_SPECS = deepFreeze(SecretSpecSchema.array().parse([
  { name: "ucpathUserId", source: "protected-store", requiredAtBoot: false, classification: "direct-identifier" },
  { name: "ucpathPassword", source: "protected-store", requiredAtBoot: false, classification: "secret" },
  { name: "sharepointOnboardingRosterUrl", source: "protected-store", requiredAtBoot: false, classification: "secret" },
]));
type SecretSpec = z.infer<typeof SecretSpecSchema>;

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

/** Every accessor invocation calls this source; no protected value is cached or published. */
export const ProtectedSecretSourceSchema = z.strictObject({
  read: z.function({ input: [], output: z.unknown() }),
});
export type ProtectedSecretSource = z.infer<typeof ProtectedSecretSourceSchema>;

export const RuntimeInputSnapshotSchema = ProtectedStoreRecordSchema.safeExtend({ profileIdentity: ProfileIdentitySchema.optional() });

export function readProtectedCredentials(source: ProtectedSecretSource): ProtectedStoreRecord {
  const { profileIdentity: _profileIdentity, ...credentials } = RuntimeInputSnapshotSchema.parse(source.read());
  return ProtectedStoreRecordSchema.parse(credentials);
}

export function readProfileIdentity(source: ProtectedSecretSource) {
  let snapshot: z.infer<typeof RuntimeInputSnapshotSchema>;
  try { snapshot = RuntimeInputSnapshotSchema.parse(source.read()); }
  catch (cause) { throw new SecretSourceError("admitted profile identity is unreadable", { cause }); }
  if (snapshot.profileIdentity === undefined) throw new SecretSourceError("admitted profile identity is unavailable");
  return snapshot.profileIdentity;
}

export class SecretMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretMissingError";
  }
}

export class SecretSourceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SecretSourceError";
  }
}

const MIGRATED_ENVIRONMENT_KEY_SET: ReadonlySet<string> = new Set(
  MIGRATED_SETTINGS_ENVIRONMENT_KEYS,
);

function migratedEnvironmentRefusal(key: string): SecretSourceError {
  if (RETIRED_TEST_TARGET_ENVIRONMENT_KEY_SET.has(key)) {
    return new SecretSourceError(retiredTestTargetEnvironmentRefusal(key));
  }
  if (RETIRED_PROTECTED_SETTINGS_ENVIRONMENT_KEYS.some(retired => retired === key)) {
    return new SecretSourceError(`retired protected setting ${key} is refused; remove it from the environment`);
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

function readProtectedStore(
  name: string,
  source: ProtectedSecretSource,
): ProtectedStoreRecord {
  try {
    return readProtectedCredentials(source);
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

/** Closed worker bootstrap: OS lookup/home/temp/locale mechanics plus the display channel; NODE_OPTIONS and arbitrary parent bindings are not process mechanics. */
export const WORKER_PROCESS_MECHANIC_KEYS = Object.freeze(["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "TZ"] as const);

export function windowsSystemRoot(): string | undefined {
  return process.env.SystemRoot;
}

export function windowsProgramFilesRoots(): readonly (string | undefined)[] {
  return [process.env["ProgramFiles(x86)"], process.env.ProgramFiles];
}

export const DEVELOPMENT_DEBUG_MIRROR_ENV = "RELAY_DEV_DEBUG_MIRROR";

export function developmentDebugMirrorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[DEVELOPMENT_DEBUG_MIRROR_ENV] === "1";
}

export function workerBootstrapEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  assertNoMigratedEnvironmentKeys(env);
  const result: NodeJS.ProcessEnv = { ...hostPrimaryDisplayEnvironment(env) };
  for (const key of WORKER_PROCESS_MECHANIC_KEYS) {
    const value = env[key];
    if (value !== undefined) result[key] = value;
  }
  return Object.freeze(result);
}

export function windowsLocalApplicationData(): string | undefined {
  return process.env.LOCALAPPDATA;
}
