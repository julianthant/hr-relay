import { z } from "zod";
import { MIGRATED_SETTINGS_ENVIRONMENT_KEYS, RETIRED_TEST_TARGET_ENVIRONMENT_KEYS } from "../config/catalog.js";
import { HOST_PRIMARY_DISPLAY_ENV } from "../config/host-display.js";
import { deepFreeze } from "../../rules/validation/immutability.js";
import { WORKER_PROCESS_MECHANIC_KEYS, SECRET_SPECS } from "../config/secrets.js";

const EnvironmentKeySchema = z.string().regex(/^[A-Z_][A-Z0-9_]*$/);
const EnvironmentFamilyPrefixSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/);
const SourcePathSchema = z.string().regex(/^[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)*\.(?:[cm]?[jt]sx?)$/);
export const RuntimeEnvironmentExactSpecSchema = z.discriminatedUnion("disposition", [
  z.strictObject({
    key: EnvironmentKeySchema,
    classification: z.enum(["secret", "direct-identifier", "non-secret-config"]),
    disposition: z.literal("active"),
    channel: z.enum(["config", "config-default", "secret", "config-and-secret", "provider-model", "process-ownership"]),
    owner: z.string().regex(/^src\/[a-z0-9/_-]+\.ts$/),
    documented: z.boolean(),
  }),
  z.strictObject({
    key: EnvironmentKeySchema,
    classification: z.enum(["secret", "direct-identifier", "non-secret-config"]),
    disposition: z.literal("migrated-refused"),
    reason: z.string().min(1),
    documented: z.boolean(),
  }),
  z.strictObject({
    key: EnvironmentKeySchema,
    classification: z.literal("test-only"),
    disposition: z.literal("test-only"),
    owners: z.array(SourcePathSchema).min(1),
    documented: z.boolean(),
  }),
  z.strictObject({
    key: EnvironmentKeySchema,
    classification: z.literal("retired-in-target"),
    disposition: z.literal("retired-in-target"),
    reason: z.string().min(1),
    documented: z.boolean(),
  }),
]);

export const RuntimeEnvironmentFamilySpecSchema = z.strictObject({
  prefix: EnvironmentFamilyPrefixSchema,
  maximum: z.number().int().positive(),
  classification: z.enum(["secret", "test-only"]),
  disposition: z.enum(["active", "test-only"]),
  owners: z.array(SourcePathSchema).min(1),
});

export const ExactEnvironmentReaderOwnerSchema = z.strictObject({
  key: EnvironmentKeySchema,
  paths: z.array(SourcePathSchema).min(1),
});

const ComputedReaderClosedTargetsSchema = z.strictObject({
  kind: z.literal("closed-targets"),
  exact: z.array(EnvironmentKeySchema),
  families: z.array(EnvironmentFamilyPrefixSchema),
}).superRefine((targets, context) => {
  if (targets.exact.length === 0 && targets.families.length === 0) {
    context.addIssue({ code: "custom", message: "computed environment reader needs at least one closed target" });
  }
});

const ComputedReaderBulkTargetSchema = z.strictObject({
  kind: z.literal("bulk-pass-through"),
  boundary: z.enum([
    "dashboard-child-processes",
    "secure-local-environment-admission",
    "test-command-child",
  ]),
  reason: z.string().min(1),
});

/** Worker spawn mechanics are not settings or provider bindings. */
const WorkerProcessMechanicsTargetsSchema = z.strictObject({
  kind: z.literal("closed-process-mechanics"),
  exact: z.array(z.enum(WORKER_PROCESS_MECHANIC_KEYS)).length(WORKER_PROCESS_MECHANIC_KEYS.length),
}).superRefine((targets, ctx) => {
  if (new Set(targets.exact).size !== WORKER_PROCESS_MECHANIC_KEYS.length)
    ctx.addIssue({ code: "custom", message: "worker mechanics must name each closed process key exactly once" });
});

export const ComputedEnvironmentReaderSchema = z.strictObject({
  path: SourcePathSchema,
  enclosingSymbol: z.string().min(1),
  accessKind: z.enum(["unresolved", "bulk"]),
  operation: z.literal("read"),
  occurrenceCount: z.number().int().positive(),
  expressionFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  classification: z.enum(["target-accessor", "target-bootstrap", "test-only"]),
  owner: SourcePathSchema,
  targets: z.union([ComputedReaderClosedTargetsSchema, ComputedReaderBulkTargetSchema, WorkerProcessMechanicsTargetsSchema]),
}).superRefine((reader, context) => {
  if (reader.owner !== reader.path) context.addIssue({ code: "custom", path: ["owner"], message: "computed reader owner must be its exact source path" });
  if (reader.accessKind === "unresolved" && reader.targets.kind !== "closed-targets" && reader.targets.kind !== "closed-process-mechanics") {
    context.addIssue({ code: "custom", path: ["targets"], message: "unresolved reader requires closed exact/family targets" });
  }
  if (reader.accessKind === "bulk" && reader.targets.kind !== "bulk-pass-through" && reader.classification !== "target-accessor") {
    context.addIssue({ code: "custom", path: ["targets"], message: "bulk reader requires an explicit pass-through boundary" });
  }
});


const SECRET_ENVIRONMENT_SPECS = [
  { key: "UCPATH_USER_ID", classification: "direct-identifier" },
  { key: "UCPATH_PASSWORD", classification: "secret" },
  { key: "ONBOARDING_ROSTER_URL", classification: "secret" },
  { key: "HRAUTO_ACTIVITY_PERSON_PSEUDONYM_HMAC_KEY", classification: "secret" },
  { key: "HRAUTO_ACTIVITY_PERSON_PSEUDONYM_KEY_GENERATION", classification: "non-secret-config" },
] as const;

/** Retired canary names stay refused by name; their home is `config/test-data.local.json`. */
const TEST_TARGET_SECRET_ENVIRONMENT_KEY_SET: ReadonlySet<string> = new Set(
  RETIRED_TEST_TARGET_ENVIRONMENT_KEYS,
);

const PROVIDER_MODEL_ENVIRONMENT_KEYS = [
  "OCR_GEMINI_MODELS", "OCR_GROQ_MODELS", "OCR_MISTRAL_MODELS",
  "OCR_OPENROUTER_MODELS", "OCR_SAMBANOVA_MODELS",
] as const;
const SINGULAR_PROVIDER_MODEL_ENVIRONMENT_KEYS = [
  "OCR_GEMINI_MODEL", "OCR_GROQ_MODEL", "OCR_MISTRAL_MODEL",
  "OCR_OPENROUTER_MODEL", "OCR_SAMBANOVA_MODEL",
] as const;

const TEST_ONLY_ENVIRONMENT_KEYS = ["PARITY_UPDATE", "TZ", "NODE_OPTIONS", "RELAY_TEST_KEYCHAIN"] as const;

const INERT_RETIRED_ENVIRONMENT_KEYS = [
  ...PROVIDER_MODEL_ENVIRONMENT_KEYS, ...SINGULAR_PROVIDER_MODEL_ENVIRONMENT_KEYS,
  "CAPTURE_NGROK", "CAPTURE_NGROK_URL", "CAPTURE_PUBLIC_URL",
  "DEBUG", "E2E_DEBUG",
  "HRAUTO_DASHBOARD_ALLOWED_ORIGINS", "HRAUTO_DASHBOARD_ALLOW_LAN",
  "HRAUTO_DASHBOARD_DEV_ORIGIN", "HRAUTO_DASHBOARD_HOST", "HRAUTO_DASHBOARD_LAN_PASSWORD",
  "HRAUTO_ELECTIONS_CSV", "HRAUTO_NAV_RETRIES", "HRAUTO_SESSION_CLOSE_TIMEOUT_MS", "HRAUTO_TRACKER_DIR",
  "HR_AUTOMATION_DUO_WEBAUTHN_CREDENTIAL_PATH", "HR_AUTOMATION_DUO_WEBAUTHN_LOCK_DIR",
  "HR_AUTOMATION_DUO_WEBAUTHN_LOCK_STALE_MS", "HR_AUTOMATION_VOICE_CUES",
  "HR_DUO_FACTOR_TIMEOUT_MS", "HR_DUO_PROMPT_RENDER_GRACE_MS", "I9_CHECK_TRACKER_PATH",
  "KRONOS_CALENDAR_BIND_MS", "KRONOS_CALENDAR_POLL_MS", "KRONOS_CALENDAR_SETTLE_MS",
  "KRONOS_CALENDAR_STEP_TIMEOUT_MS", "KRONOS_PICKER_APPLY_MS", "KRONOS_PICKER_OPEN_MS",
  "KRONOS_PICKER_RANGE_MS", "KRONOS_RANGE_READBACK_POLL_MS", "KRONOS_RANGE_READBACK_TIMEOUT_MS",
  "OCR_PROVIDER_ATTEMPT_TIMEOUT_MS", "OCR_SQLITE_DEPENDENCIES", "OCR_VERIFY_WATCH_TIMEOUT_MS",
  "PLAYWRIGHT_BROWSERS_PATH", "SEPARATIONS_ROSTER_URL",
] as const;

/** Names whose values moved to settings/protected authority and now refuse boot. */
export const RETIRED_ENVIRONMENT_KEYS = deepFreeze(
  [...MIGRATED_SETTINGS_ENVIRONMENT_KEYS],
);

const DOCUMENTED_ENVIRONMENT_KEYS: ReadonlySet<string> = new Set();

const TEST_ONLY_ENVIRONMENT_OWNERS = {
  NODE_OPTIONS: ["playwright.parity.config.ts", "tests/support/duo-ceremony-setup.ts", "tests/support/helpers/credential-keychain-fake.ts"],
  RELAY_TEST_KEYCHAIN: ["tests/support/helpers/credential-keychain-fake.ts"],
  PARITY_UPDATE: ["tests/parity/helpers/reference-store.ts"],
  TZ: [
    "tests/backend/runs/projections/run-summary.derivation.integration.test.ts",
    "tests/perf/dashboard-fixture.integration.test.ts",
    "tests/backend/storage/sqlite/runtime-process-locks.storage-restore-drill.integration.test.ts",
  ],
} as const;

export const RUNTIME_ENVIRONMENT_EXACT = deepFreeze(RuntimeEnvironmentExactSpecSchema.array().parse([
  {
    key: "HRAUTO_DASHBOARD_LAUNCH_NONCE",
    classification: "direct-identifier",
    disposition: "active",
    channel: "process-ownership",
    owner: "src/models/dashboard/dashboard-frontend-owner.ts",
    documented: false,
  },
  {
    // The host's primary display, published once per process tree by the
    // composition that first resolves config and inherited by every child.
    key: HOST_PRIMARY_DISPLAY_ENV,
    classification: "non-secret-config",
    disposition: "active",
    channel: "config-default",
    owner: "src/models/config/host-display.ts",
    documented: false,
  },
  ...RETIRED_ENVIRONMENT_KEYS.map((key) => ({
    key,
    classification: SECRET_ENVIRONMENT_SPECS.find((spec) => spec.key === key)?.classification
      ?? (key === "TIMEKEEPER_NAME" || TEST_TARGET_SECRET_ENVIRONMENT_KEY_SET.has(key)
        ? "direct-identifier" : "non-secret-config"),
    disposition: "migrated-refused",
    reason: TEST_TARGET_SECRET_ENVIRONMENT_KEY_SET.has(key)
      ? "test-target input moved to ignored config/test-data.local.json; remove it"
      : "setting moved to the settings authority; set it in Settings, then remove it",
    documented: false,
  })),
  ...TEST_ONLY_ENVIRONMENT_KEYS.map((key) => ({
    key,
    classification: "test-only",
    disposition: "test-only",
    owners: TEST_ONLY_ENVIRONMENT_OWNERS[key],
    documented: DOCUMENTED_ENVIRONMENT_KEYS.has(key),
  })),
  ...INERT_RETIRED_ENVIRONMENT_KEYS.map((key) => ({
    key,
    classification: "retired-in-target",
    disposition: "retired-in-target",
    reason: "legacy environment override is not read by the isolated rebuild runtime",
    documented: DOCUMENTED_ENVIRONMENT_KEYS.has(key),
  })),
]));

export const RUNTIME_ENVIRONMENT_FAMILIES = deepFreeze(RuntimeEnvironmentFamilySpecSchema.array().parse([]));

export const EXACT_ENVIRONMENT_READER_OWNERS = deepFreeze(ExactEnvironmentReaderOwnerSchema.array().parse([
  { key: "NODE_OPTIONS", paths: ["playwright.parity.config.ts"] },
]));

interface ComputedReaderInput {
  readonly path: string;
  readonly enclosingSymbol: string;
  readonly accessKind: "unresolved" | "bulk";
  readonly occurrenceCount: number;
  readonly expressionFingerprint: string;
  readonly classification: "target-accessor" | "target-bootstrap" | "test-only";
  readonly targets:
    | { readonly kind: "closed-process-mechanics"; readonly exact: readonly (typeof WORKER_PROCESS_MECHANIC_KEYS)[number][] }
    | {
        readonly kind: "closed-targets";
        readonly exact: readonly string[];
        readonly families: readonly string[];
      }
  | {
        readonly kind: "bulk-pass-through";
        readonly boundary:
          | "dashboard-child-processes"
          | "secure-local-environment-admission"
          | "test-command-child";
        readonly reason: string;
      };
}

function computedReader(input: ComputedReaderInput): z.input<typeof ComputedEnvironmentReaderSchema> {
  const targets = input.targets.kind === "closed-process-mechanics"
    ? { ...input.targets, exact: [...input.targets.exact] }
    : input.targets.kind === "closed-targets"
    ? { ...input.targets, exact: [...input.targets.exact], families: [...input.targets.families] }
    : input.targets;
  return { ...input, targets, operation: "read", owner: input.path };
}


export const COMPUTED_ENVIRONMENT_READERS = deepFreeze(ComputedEnvironmentReaderSchema.array().parse([
  computedReader({ path: "src/models/config/secrets.ts", enclosingSymbol: "assertNoMigratedEnvironmentKeys", accessKind: "bulk", occurrenceCount: 1, expressionFingerprint: "a7f05948ce91ea69218acec2e51b3c4f2783ab3c908b4330831213b1f2b7c007", classification: "target-accessor", targets: { kind: "closed-targets", exact: RETIRED_ENVIRONMENT_KEYS, families: [] } }),
  computedReader({ path: "src/models/config/secrets.ts", enclosingSymbol: "workerBootstrapEnvironment", accessKind: "bulk", occurrenceCount: 2, expressionFingerprint: "a7f05948ce91ea69218acec2e51b3c4f2783ab3c908b4330831213b1f2b7c007", classification: "target-accessor", targets: { kind: "closed-targets", exact: [...RETIRED_ENVIRONMENT_KEYS, HOST_PRIMARY_DISPLAY_ENV], families: [] } }),
  computedReader({ path: "src/models/config/secrets.ts", enclosingSymbol: "workerBootstrapEnvironment", accessKind: "unresolved", occurrenceCount: 1, expressionFingerprint: "72b51583d255ce06b58a1fb09a91cfed0e89cd4cf7406fc6dea176093c81757c", classification: "target-accessor", targets: { kind: "closed-process-mechanics", exact: WORKER_PROCESS_MECHANIC_KEYS } }),
  computedReader({ path: "src/models/config/secrets.ts", enclosingSymbol: "hostAwareResolutionEnvironment", accessKind: "bulk", occurrenceCount: 2, expressionFingerprint: "a7f05948ce91ea69218acec2e51b3c4f2783ab3c908b4330831213b1f2b7c007", classification: "target-accessor", targets: { kind: "closed-targets", exact: [HOST_PRIMARY_DISPLAY_ENV], families: [] } }),
  computedReader({ path: "scripts/dev/dashboard.ts", enclosingSymbol: "<module>", accessKind: "bulk", occurrenceCount: 1, expressionFingerprint: "e4db44daa6ead5a1e592c02fa32cfe50b23a07fb388949c32664a0ea298f82ea", classification: "target-bootstrap", targets: { kind: "bulk-pass-through", boundary: "dashboard-child-processes", reason: "the dashboard launcher forwards its inherited environment plus one owned nonce to the two same-runtime child processes" } }),
  computedReader({ path: "scripts/test/runner.ts", enclosingSymbol: "main", accessKind: "bulk", occurrenceCount: 1, expressionFingerprint: "e4db44daa6ead5a1e592c02fa32cfe50b23a07fb388949c32664a0ea298f82ea", classification: "test-only", targets: { kind: "bulk-pass-through", boundary: "test-command-child", reason: "the batch test wrapper forwards its inherited environment with owned scratch paths to the installed Vitest child" } }),
  computedReader({ path: "scripts/verify-parity-json.ts", enclosingSymbol: "main", accessKind: "bulk", occurrenceCount: 1, expressionFingerprint: "e4db44daa6ead5a1e592c02fa32cfe50b23a07fb388949c32664a0ea298f82ea", classification: "test-only", targets: { kind: "bulk-pass-through", boundary: "test-command-child", reason: "the parity wrapper forwards its inherited environment to its same-checkout Playwright child" } }),
  computedReader({ path: "vite.dashboard.config.ts", enclosingSymbol: "<module>", accessKind: "unresolved", occurrenceCount: 1, expressionFingerprint: "5c77e74cb49d532097f685ae27e9a8029afb783349dbaff9f709b90a7cece316", classification: "target-bootstrap", targets: { kind: "closed-targets", exact: ["HRAUTO_DASHBOARD_LAUNCH_NONCE"], families: [] } }),
]));

export const RuntimeEnvironmentRegistrySchema = z.strictObject({
  exact: z.array(RuntimeEnvironmentExactSpecSchema).min(1),
  families: z.array(RuntimeEnvironmentFamilySpecSchema),
  exactReaderOwners: z.array(ExactEnvironmentReaderOwnerSchema),
  computedReaders: z.array(ComputedEnvironmentReaderSchema).min(1),
});

export const RUNTIME_ENVIRONMENT_REGISTRY = deepFreeze(RuntimeEnvironmentRegistrySchema.parse({
  exact: RUNTIME_ENVIRONMENT_EXACT,
  families: RUNTIME_ENVIRONMENT_FAMILIES,
  exactReaderOwners: EXACT_ENVIRONMENT_READER_OWNERS,
  computedReaders: COMPUTED_ENVIRONMENT_READERS,
}));

function duplicateValues(values: readonly string[]): readonly string[] {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

export function auditRuntimeEnvironmentInventory(input: unknown): readonly string[] {
  const parsed = RuntimeEnvironmentRegistrySchema.safeParse(input);
  if (!parsed.success) return ["runtime environment registry failed strict parsing"];
  const registry = parsed.data;
  const violations: string[] = [];
  const duplicateExact = duplicateValues(registry.exact.map(({ key }) => key));
  if (duplicateExact.length > 0) violations.push(`duplicate exact environment keys: ${[...new Set(duplicateExact)].join(", ")}`);
  const duplicateFamilies = duplicateValues(registry.families.map(({ prefix }) => prefix));
  if (duplicateFamilies.length > 0) violations.push(`duplicate environment families: ${[...new Set(duplicateFamilies)].join(", ")}`);
  const duplicateReaders = duplicateValues(registry.computedReaders.map((reader) =>
    [reader.path, reader.enclosingSymbol, reader.accessKind, reader.operation, reader.expressionFingerprint].join("|")
  ));
  if (duplicateReaders.length > 0) violations.push(`duplicate computed environment readers: ${[...new Set(duplicateReaders)].join(", ")}`);
  const duplicateExactReaderKeys = duplicateValues(registry.exactReaderOwners.map(({ key }) => key));
  if (duplicateExactReaderKeys.length > 0) violations.push(`duplicate exact reader ownership entries: ${[...new Set(duplicateExactReaderKeys)].join(", ")}`);

  for (const family of registry.families) {
    for (const exactSpec of registry.exact) {
      if (isEnvironmentFamilyMember(exactSpec.key, family.prefix, family.maximum)) {
        violations.push(`exact environment key ${exactSpec.key} overlaps family ${family.prefix}`);
      }
    }
  }

  const exact = new Map(registry.exact.map((spec) => [spec.key, spec]));
  for (const spec of registry.exact) {
    if (spec.disposition !== "active") continue;
    const expectedOwner = spec.channel === "process-ownership"
      ? "src/models/dashboard/dashboard-frontend-owner.ts"
      : spec.channel === "config-default"
        ? "src/models/config/host-display.ts"
        : undefined;
    if (expectedOwner === undefined) {
      violations.push(`${spec.key} retains forbidden active ${spec.channel} environment ownership`);
      continue;
    }
    if (spec.owner !== expectedOwner) violations.push(`${spec.key} is owned by ${spec.owner}; expected ${expectedOwner}`);
  }
  for (const family of registry.families) {
    const duplicateOwners = duplicateValues(family.owners);
    if (duplicateOwners.length > 0) violations.push(`duplicate family owners for ${family.prefix}: ${duplicateOwners.join(", ")}`);
    if (family.disposition === "active" && (family.owners.length !== 1 || family.owners[0] !== "src/models/config/secrets.ts")) {
      violations.push(`active secret family ${family.prefix} must be owned solely by src/models/config/secrets.ts`);
    }
  }
  const migratedKeys = new Set(MIGRATED_SETTINGS_ENVIRONMENT_KEYS);
  for (const key of migratedKeys) {
    if (exact.get(key)?.disposition !== "migrated-refused") {
      violations.push(`migrated settings environment ${key} is not explicitly refused`);
    }
  }
  for (const spec of registry.exact) {
    if (spec.disposition === "migrated-refused" && !migratedKeys.has(spec.key)) {
      violations.push(`migrated-refused environment ${spec.key} has no settings catalog migration edge`);
    }
  }

  for (const secret of SECRET_SPECS) {
    if (secret.source !== "protected-store") {
      violations.push(`secret ${secret.name} must use protected-store`);
    }
  }
  for (const key of RETIRED_TEST_TARGET_ENVIRONMENT_KEYS) {
    if (exact.get(key)?.disposition !== "migrated-refused") {
      violations.push(`retired test-target environment ${key} is not explicitly refused`);
    }
  }

  for (const reader of registry.exactReaderOwners) {
    if (!exact.has(reader.key)) violations.push(`exact reader ownership references unknown environment key ${reader.key}`);
    const duplicatePaths = duplicateValues(reader.paths);
    if (duplicatePaths.length > 0) violations.push(`duplicate exact reader paths for ${reader.key}: ${[...new Set(duplicatePaths)].join(", ")}`);
  }
  for (const reader of registry.computedReaders) {
    if (reader.classification === "target-accessor" && reader.path !== "src/models/config/secrets.ts") {
      violations.push(`target computed reader must be owned by src/models/config/secrets.ts: ${reader.path}`);
    }
    if (reader.classification === "target-bootstrap") {
      const isDashboardLauncher = reader.path === "scripts/dev/dashboard.ts"
        && reader.accessKind === "bulk"
        && reader.targets.kind === "bulk-pass-through"
        && reader.targets.boundary === "dashboard-child-processes";
      const isViteOwnerRead = reader.path === "vite.dashboard.config.ts"
        && reader.accessKind === "unresolved"
        && reader.targets.kind === "closed-targets"
        && reader.targets.exact.length === 1
        && reader.targets.exact[0] === "HRAUTO_DASHBOARD_LAUNCH_NONCE"
        && reader.targets.families.length === 0;
      if (!isDashboardLauncher && !isViteOwnerRead) {
        violations.push(`target bootstrap reader is outside the exact dashboard launcher/Vite contract: ${reader.path}`);
      }
    }
    if (reader.targets.kind === "closed-process-mechanics" && (reader.path !== "src/models/config/secrets.ts"
      || reader.enclosingSymbol !== "workerBootstrapEnvironment" || reader.accessKind !== "unresolved"
      || reader.classification !== "target-accessor"))
      violations.push("closed process mechanics belong only to the worker bootstrap accessor");
    if (reader.targets.kind !== "closed-targets") continue;
    for (const key of reader.targets.exact) {
      if (!exact.has(key)) violations.push(`computed reader ${reader.path} targets unknown exact key ${key}`);
    }
    for (const prefix of reader.targets.families) {
      if (!registry.families.some((family) => family.prefix === prefix)) {
        violations.push(`computed reader ${reader.path} targets unknown environment family ${prefix}`);
      }
    }
  }
  return violations;
}

function isEnvironmentFamilyMember(key: string, prefix: string, maximum: number): boolean {
  if (key === prefix) return true;
  const suffix = key.slice(prefix.length);
  return /^\d+$/.test(suffix) && Number(suffix) >= 2 && Number(suffix) <= maximum;
}

export function runtimeEnvironmentFamilyForKey(key: string) {
  return RUNTIME_ENVIRONMENT_FAMILIES.find(({ prefix, maximum }) =>
    isEnvironmentFamilyMember(key, prefix, maximum)
  );
}

export function isRegisteredEnvironmentKey(key: string): boolean {
  if (RUNTIME_ENVIRONMENT_EXACT.some((spec) => spec.key === key)) return true;
  return runtimeEnvironmentFamilyForKey(key) !== undefined;
}
