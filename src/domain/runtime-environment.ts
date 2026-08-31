import { z } from "zod";
import { CONFIG_ENV_BINDINGS } from "./config/resolve.js";
import { deepFreeze } from "./immutability.js";
import {
  ACTIVITY_PERSON_PSEUDONYM_SECRET_REFERENCE,
  SECRET_FAMILY_SPECS,
  SECRET_SPECS,
  TEST_TARGET_SECRET_SPECS,
} from "./secrets.js";

const EnvironmentKeySchema = z.string().regex(/^[A-Z_][A-Z0-9_]*$/);
const EnvironmentFamilyPrefixSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/);
/**
 * A source path in one of the TWO repositories this inventory spans (D93).
 *
 * Both repos have a `src/`, so a bare path is ambiguous across them. Legacy-repo
 * paths therefore carry an explicit `legacy:` scheme; unprefixed paths are this
 * repo's. See `tests/unit/architecture/helpers/guard-files.ts`.
 */
const SourcePathSchema = z.string().regex(/^(?:legacy:)?[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)*\.(?:[cm]?[jt]sx?)$/);
export const RuntimeEnvironmentExactSpecSchema = z.discriminatedUnion("disposition", [
  z.strictObject({
    key: EnvironmentKeySchema,
    classification: z.enum(["secret", "direct-identifier", "non-secret-config"]),
    disposition: z.literal("active"),
    channel: z.enum(["config", "secret", "config-and-secret", "provider-model", "process-ownership"]),
    owner: z.string().regex(/^src\/[a-z0-9/_-]+\.ts$/),
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
    "legacy-daemon-child",
    "legacy-settings-projection",
    "dashboard-child-processes",
    "secure-local-environment-admission",
  ]),
  reason: z.string().min(1),
});

export const ComputedEnvironmentReaderSchema = z.strictObject({
  path: SourcePathSchema,
  enclosingSymbol: z.string().min(1),
  accessKind: z.enum(["unresolved", "bulk"]),
  operation: z.literal("read"),
  occurrenceCount: z.number().int().positive(),
  expressionFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  classification: z.enum(["legacy-production", "target-accessor", "target-bootstrap"]),
  owner: SourcePathSchema,
  targets: z.union([ComputedReaderClosedTargetsSchema, ComputedReaderBulkTargetSchema]),
}).superRefine((reader, context) => {
  if (reader.owner !== reader.path) context.addIssue({ code: "custom", path: ["owner"], message: "computed reader owner must be its exact source path" });
  if (reader.accessKind === "unresolved" && reader.targets.kind !== "closed-targets") {
    context.addIssue({ code: "custom", path: ["targets"], message: "unresolved reader requires closed exact/family targets" });
  }
  if (reader.accessKind === "bulk" && reader.targets.kind !== "bulk-pass-through" && reader.classification !== "target-accessor") {
    context.addIssue({ code: "custom", path: ["targets"], message: "legacy bulk reader requires an explicit pass-through boundary" });
  }
});

const CONFIG_ENVIRONMENT_KEYS = [
  "ANNUAL_DATES_END",
  "DEBUG_SCREENSHOTS",
  "HRAUTO_CAPTURE_MAX_SLICES",
  "HRAUTO_CAPTURE_MAX_WIDTH",
  "HRAUTO_CAPTURE_SLICE_HEIGHT",
  "HRAUTO_CAPTURE_SLICE_OVERLAP",
  "HRAUTO_CAPTURE_WIDTH",
  "HRAUTO_CRM_TEST_URL",
  "HRAUTO_DAEMON_IDLE_MS",
  "HRAUTO_DAEMON_IDLE_REPOLL_MS",
  "HRAUTO_DEFAULT_WORKERS",
  "HRAUTO_HEALTH_MONITOR_MAX_REFRESH",
  "HRAUTO_HEALTH_MONITOR_MAX_REOPEN",
  "HRAUTO_HEALTH_MONITOR_TICK_MS",
  "HRAUTO_I9_TEST_URL",
  "HRAUTO_KUALI_TEST_URL",
  "HRAUTO_NAVIGATION_RETRIES",
  "HRAUTO_NEW_KRONOS_TEST_URL",
  "HRAUTO_OLD_KRONOS_TEST_URL",
  "HRAUTO_ONBASE_TEST_URL",
  "HRAUTO_SEPARATION_TERMINATION_WINDOW_DAYS",
  "HRAUTO_SERVICENOW_TEST_URL",
  "HRAUTO_SHAREPOINT_TEST_URL",
  "HRAUTO_UCPATH_TEST_URL",
  "HRAUTO_UKG_NAVIGATION_MS",
  "HR_AUTOMATION_DUO_WEBAUTHN",
  "KRONOS_DEFAULT_END_DATE",
  "KRONOS_DEFAULT_START_DATE",
  "OCR_BACKOFF_BASE_MS",
  "OCR_BACKOFF_CAP_MS",
  "OCR_DISAMBIG_CONCURRENCY",
  "OCR_MAX_VALIDATION_RETRIES",
  "OCR_PAGE_CONCURRENCY",
  "OCR_PAGE_MAX_WAIT_MS",
  "OCR_SECOND_OPINION_MAX",
  "OCR_SUGGEST_CONCURRENCY",
  "OCR_TIER1_PATIENCE_MS",
  "TIMEKEEPER_NAME",
] as const;

const SECRET_ENVIRONMENT_SPECS = [
  { key: "UCPATH_USER_ID", classification: "direct-identifier", channel: "secret" },
  { key: "UCPATH_PASSWORD", classification: "secret", channel: "secret" },
  { key: "ONBOARDING_ROSTER_URL", classification: "secret", channel: "secret" },
  {
    key: ACTIVITY_PERSON_PSEUDONYM_SECRET_REFERENCE.key.env,
    classification: "secret",
    channel: "secret",
  },
  {
    key: ACTIVITY_PERSON_PSEUDONYM_SECRET_REFERENCE.generation.env,
    classification: "non-secret-config",
    channel: "secret",
  },
] as const;

const TEST_TARGET_SECRET_ENVIRONMENT_KEYS = TEST_TARGET_SECRET_SPECS.map(({ env }) => env);

const PROVIDER_MODEL_ENVIRONMENT_KEYS = [
  "OCR_GEMINI_MODELS", "OCR_GROQ_MODELS", "OCR_MISTRAL_MODELS",
  "OCR_OPENROUTER_MODELS", "OCR_SAMBANOVA_MODELS",
] as const;
const LEGACY_PROVIDER_MODEL_ENVIRONMENT_KEYS = [
  "OCR_GEMINI_MODEL", "OCR_GROQ_MODEL", "OCR_MISTRAL_MODEL",
  "OCR_OPENROUTER_MODEL", "OCR_SAMBANOVA_MODEL",
] as const;

const TEST_ONLY_ENVIRONMENT_KEYS = [
  "HRAUTO_E2E_STUBS", "HRAUTO_LEGACY_REPO", "HR_DRYRUN_DOC_ID", "HR_SOAK_ITERATIONS",
  "HR_TEARDOWN_SOAK_ITERATIONS", "HR_TEST_HEADED", "PARITY_UPDATE", "SEL_SESSION", "TZ",
  "__NUMENV_TEST__",
] as const;

const RETIRED_ENVIRONMENT_KEYS = [
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
  ...LEGACY_PROVIDER_MODEL_ENVIRONMENT_KEYS,
] as const;

const DOCUMENTED_ENVIRONMENT_KEYS = new Set([
  "UCPATH_USER_ID", "UCPATH_PASSWORD", "TIMEKEEPER_NAME",
  ACTIVITY_PERSON_PSEUDONYM_SECRET_REFERENCE.key.env,
  ACTIVITY_PERSON_PSEUDONYM_SECRET_REFERENCE.generation.env,
  ...TEST_TARGET_SECRET_ENVIRONMENT_KEYS,
  "ANNUAL_DATES_END", "KRONOS_DEFAULT_END_DATE", "KRONOS_DEFAULT_START_DATE",
  "ONBOARDING_ROSTER_URL", "HR_AUTOMATION_DUO_WEBAUTHN",
  "CAPTURE_PUBLIC_URL", "CAPTURE_NGROK_URL", "DEBUG_SCREENSHOTS",
  "HRAUTO_NAVIGATION_RETRIES", "HRAUTO_SEPARATION_TERMINATION_WINDOW_DAYS",
  "HRAUTO_UKG_NAVIGATION_MS",
  "OCR_SECOND_OPINION_MAX", "OCR_PAGE_MAX_WAIT_MS", "OCR_PAGE_CONCURRENCY",
  "OCR_DISAMBIG_CONCURRENCY", "OCR_SUGGEST_CONCURRENCY",
]);

const TEST_ONLY_ENVIRONMENT_OWNERS = {
  // D93: the guard lane locates the legacy repo it audits. Test-lane only —
  // no rebuild RUNTIME module may read across the split.
  HRAUTO_LEGACY_REPO: ["tests/unit/architecture/helpers/guard-files.ts"],
  HRAUTO_E2E_STUBS: ["legacy:src/core/daemon/client.ts", "legacy:src/core/e2e/stub-workflows.ts", "legacy:src/core/workflow-loaders.ts"],
  HR_DRYRUN_DOC_ID: ["legacy:tests/live/separations-dryrun.test.ts"],
  HR_SOAK_ITERATIONS: ["legacy:tests/delegation/concurrency-soak.test.ts"],
  HR_TEARDOWN_SOAK_ITERATIONS: ["legacy:tests/delegation/daemon-teardown-soak.test.ts"],
  HR_TEST_HEADED: ["legacy:tests/live/auth.test.ts", "legacy:tests/live/onbase-import.test.ts", "legacy:tests/live/separations-collect.test.ts", "legacy:tests/live/separations-dryrun.test.ts", "legacy:tests/live/session-launch-multi.test.ts"],
  // D132: the ONE switch that turns the ref frontend-backend-integration §7 parity lane from asserting
  // its stored references into deliberately re-freezing them. Read in exactly
  // one place, which the config and both capture halves share.
  PARITY_UPDATE: ["tests/parity/helpers/reference-store.ts"],
  SEL_SESSION: ["duo-autopilot/launch-selector-browser.mjs", "legacy:duo-autopilot/launch-selector-browser.mjs"],
  TZ: ["legacy:tests/env-bootstrap.ts"],
  __NUMENV_TEST__: ["legacy:tests/unit/utils/env.test.ts"],
} as const satisfies Record<(typeof TEST_ONLY_ENVIRONMENT_KEYS)[number], readonly string[]>;

export const RUNTIME_ENVIRONMENT_EXACT = deepFreeze(RuntimeEnvironmentExactSpecSchema.array().parse([
  ...CONFIG_ENVIRONMENT_KEYS.map((key) => ({
    key,
    classification: key === "TIMEKEEPER_NAME" ? "direct-identifier" : "non-secret-config",
    disposition: "active",
    channel: key === "TIMEKEEPER_NAME" ? "config-and-secret" : "config",
    owner: "src/domain/config/resolve.ts",
    documented: DOCUMENTED_ENVIRONMENT_KEYS.has(key),
  })),
  ...SECRET_ENVIRONMENT_SPECS.map((spec) => ({
    ...spec,
    disposition: "active",
    owner: "src/domain/secrets.ts",
    documented: DOCUMENTED_ENVIRONMENT_KEYS.has(spec.key),
  })),
  {
    key: "HRAUTO_DASHBOARD_LAUNCH_NONCE",
    classification: "direct-identifier",
    disposition: "active",
    channel: "process-ownership",
    owner: "src/domain/dashboard-frontend-owner.ts",
    documented: false,
  },
  ...TEST_TARGET_SECRET_SPECS.map((spec) => ({
    key: spec.env,
    classification: spec.classification,
    disposition: "active" as const,
    channel: "secret" as const,
    owner: "src/domain/secrets.ts",
    documented: DOCUMENTED_ENVIRONMENT_KEYS.has(spec.env),
  })),
  ...PROVIDER_MODEL_ENVIRONMENT_KEYS.map((key) => ({
    key,
    classification: "non-secret-config",
    disposition: "active",
    channel: "provider-model",
    owner: "src/domain/runtime-dependencies.ts",
    documented: DOCUMENTED_ENVIRONMENT_KEYS.has(key),
  })),
  ...TEST_ONLY_ENVIRONMENT_KEYS.map((key) => ({
    key,
    classification: "test-only",
    disposition: "test-only",
    owners: TEST_ONLY_ENVIRONMENT_OWNERS[key],
    documented: DOCUMENTED_ENVIRONMENT_KEYS.has(key),
  })),
  ...RETIRED_ENVIRONMENT_KEYS.map((key) => ({
    key,
    classification: "retired-in-target",
    disposition: "retired-in-target",
    reason: "legacy environment override is not read by the isolated rebuild runtime",
    documented: DOCUMENTED_ENVIRONMENT_KEYS.has(key),
  })),
]));

export const RUNTIME_ENVIRONMENT_FAMILIES = deepFreeze(RuntimeEnvironmentFamilySpecSchema.array().parse([
  ...SECRET_FAMILY_SPECS.map(({ envPrefix, maximum }) => ({
    prefix: envPrefix,
    maximum,
    classification: "secret",
    disposition: "active",
    owners: ["src/domain/secrets.ts"],
  })),
  { prefix: "CEREBRAS_API_KEY", maximum: 8, classification: "test-only", disposition: "test-only", owners: ["legacy:scripts/ocr/probe-providers.ts"] },
  { prefix: "COHERE_API_KEY", maximum: 8, classification: "test-only", disposition: "test-only", owners: ["legacy:scripts/ocr/probe-providers.ts"] },
  { prefix: "OCRSPACE_API_KEY", maximum: 8, classification: "test-only", disposition: "test-only", owners: ["legacy:scripts/ocr/probe-providers.ts"] },
  { prefix: "ZEP_API_KEY", maximum: 8, classification: "test-only", disposition: "test-only", owners: ["legacy:scripts/ocr/probe-providers.ts"] },
]));

export const EXACT_ENVIRONMENT_READER_OWNERS = deepFreeze(ExactEnvironmentReaderOwnerSchema.array().parse([
  {
    key: ACTIVITY_PERSON_PSEUDONYM_SECRET_REFERENCE.key.env,
    paths: ["src/domain/secrets.ts"],
  },
  {
    key: ACTIVITY_PERSON_PSEUDONYM_SECRET_REFERENCE.generation.env,
    paths: ["src/domain/secrets.ts"],
  },
  { key: "ANNUAL_DATES_END", paths: ["legacy:src/config.ts"] },
  { key: "CAPTURE_NGROK", paths: ["legacy:src/cli.ts"] },
  { key: "CAPTURE_NGROK_URL", paths: ["legacy:src/cli.ts"] },
  { key: "CAPTURE_PUBLIC_URL", paths: ["legacy:src/cli.ts", "legacy:src/tracker/dashboard/hono/app.ts", "legacy:src/tracker/dashboard/hono/routes/capture.ts"] },
  { key: "DEBUG_SCREENSHOTS", paths: ["legacy:src/systems/new-kronos/navigate.ts", "legacy:src/utils/screenshot.ts"] },
  { key: "HRAUTO_DASHBOARD_ALLOWED_ORIGINS", paths: ["legacy:src/tracker/dashboard/hono/security.ts"] },
  { key: "HRAUTO_DASHBOARD_ALLOW_LAN", paths: ["legacy:src/tracker/dashboard/hono/security.ts"] },
  { key: "HRAUTO_DASHBOARD_DEV_ORIGIN", paths: ["legacy:src/tracker/dashboard/hono/security.ts"] },
  { key: "HRAUTO_DASHBOARD_HOST", paths: ["legacy:src/tracker/dashboard/hono/security.ts"] },
  { key: "HRAUTO_DASHBOARD_LAN_PASSWORD", paths: ["legacy:src/tracker/dashboard/hono/security.ts"] },
  { key: "HRAUTO_E2E_STUBS", paths: ["legacy:src/core/daemon/client.ts", "legacy:src/core/e2e/stub-workflows.ts", "legacy:src/core/workflow-loaders.ts"] },
  { key: "HRAUTO_ELECTIONS_CSV", paths: ["legacy:src/workflows/kronos-pay-rule/csv-lookup.ts"] },
  { key: "HRAUTO_NAVIGATION_RETRIES", paths: ["legacy:src/infra/browser/launch.ts"] },
  { key: "HRAUTO_SEPARATION_TERMINATION_WINDOW_DAYS", paths: ["legacy:src/systems/ucpath/ss-smart-hr.ts"] },
  { key: "HRAUTO_TRACKER_DIR", paths: ["legacy:src/cli.ts", "legacy:src/config.ts", "legacy:src/core/daemon/daemon.ts", "legacy:src/core/e2e/gates.ts"] },
  { key: "HR_AUTOMATION_DUO_WEBAUTHN", paths: ["legacy:src/cli-daemon.ts", "legacy:src/cli.ts", "legacy:src/infra/auth/duo-webauthn.ts"] },
  { key: "HR_AUTOMATION_DUO_WEBAUTHN_CREDENTIAL_PATH", paths: ["legacy:src/infra/auth/duo-webauthn.ts"] },
  { key: "HR_AUTOMATION_DUO_WEBAUTHN_LOCK_DIR", paths: ["legacy:src/infra/auth/duo-webauthn.ts"] },
  { key: "HR_AUTOMATION_VOICE_CUES", paths: ["legacy:src/infra/auth/voice-cue.ts"] },
  { key: "I9_CHECK_TRACKER_PATH", paths: ["legacy:src/config.ts"] },
  { key: "KRONOS_CALENDAR_BIND_MS", paths: ["legacy:src/systems/new-kronos/navigate.ts"] },
  { key: "KRONOS_CALENDAR_POLL_MS", paths: ["legacy:src/systems/new-kronos/navigate.ts"] },
  { key: "KRONOS_CALENDAR_SETTLE_MS", paths: ["legacy:src/systems/new-kronos/navigate.ts"] },
  { key: "KRONOS_CALENDAR_STEP_TIMEOUT_MS", paths: ["legacy:src/systems/new-kronos/navigate.ts"] },
  { key: "KRONOS_DEFAULT_END_DATE", paths: ["legacy:src/config.ts"] },
  { key: "KRONOS_DEFAULT_START_DATE", paths: ["legacy:src/config.ts"] },
  { key: "KRONOS_PICKER_APPLY_MS", paths: ["legacy:src/systems/new-kronos/navigate.ts"] },
  { key: "KRONOS_PICKER_OPEN_MS", paths: ["legacy:src/systems/new-kronos/navigate.ts"] },
  { key: "KRONOS_PICKER_RANGE_MS", paths: ["legacy:src/systems/new-kronos/navigate.ts"] },
  { key: "KRONOS_RANGE_READBACK_POLL_MS", paths: ["legacy:src/systems/new-kronos/navigate.ts"] },
  { key: "KRONOS_RANGE_READBACK_TIMEOUT_MS", paths: ["legacy:src/systems/new-kronos/navigate.ts"] },
  { key: "OCR_DISAMBIG_CONCURRENCY", paths: ["legacy:src/workflows/ocr/orchestrator.ts"] },
  { key: "OCR_PAGE_CONCURRENCY", paths: ["legacy:src/services/ocr/per-page.ts"] },
  { key: "OCR_PAGE_MAX_WAIT_MS", paths: ["legacy:src/services/ocr/per-page.ts"] },
  { key: "OCR_PROVIDER_ATTEMPT_TIMEOUT_MS", paths: ["legacy:src/services/ocr/per-page.ts"] },
  { key: "OCR_SECOND_OPINION_MAX", paths: ["legacy:src/workflows/ocr/orchestrator.ts"] },
  { key: "OCR_SQLITE_DEPENDENCIES", paths: ["legacy:src/workflows/ocr/orchestrator.ts"] },
  { key: "OCR_SUGGEST_CONCURRENCY", paths: ["legacy:src/workflows/ocr/orchestrator.ts"] },
  { key: "OCR_TIER1_PATIENCE_MS", paths: ["legacy:src/services/ocr/per-page.ts"] },
  { key: "OCR_VERIFY_WATCH_TIMEOUT_MS", paths: ["legacy:src/services/ocr/forms/verify.ts"] },
  { key: "PLAYWRIGHT_BROWSERS_PATH", paths: ["legacy:src/scripts/ops/setup.ts"] },
  { key: "SEL_SESSION", paths: ["duo-autopilot/launch-selector-browser.mjs", "legacy:duo-autopilot/launch-selector-browser.mjs"] },
  { key: "TIMEKEEPER_NAME", paths: ["legacy:src/config.ts"] },
  { key: "UCPATH_PASSWORD", paths: ["legacy:src/utils/env.ts"] },
  { key: "UCPATH_USER_ID", paths: ["legacy:src/utils/env.ts"] },
]));

const ACTIVE_PROVIDER_FAMILIES = [
  "GEMINI_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "OPEN_ROUTER_API_KEY", "SAMBANOVA_API_KEY",
] as const;
const PROBE_PROVIDER_FAMILIES = [
  ...ACTIVE_PROVIDER_FAMILIES, "CEREBRAS_API_KEY", "COHERE_API_KEY", "OCRSPACE_API_KEY", "ZEP_API_KEY",
] as const;
const PROVIDER_MODEL_TARGETS = [...PROVIDER_MODEL_ENVIRONMENT_KEYS, ...LEGACY_PROVIDER_MODEL_ENVIRONMENT_KEYS] as const;
const SECRET_EXACT_TARGETS = [
  "UCPATH_USER_ID",
  "UCPATH_PASSWORD",
  "TIMEKEEPER_NAME",
  "ONBOARDING_ROSTER_URL",
] as const;

interface ComputedReaderInput {
  readonly path: string;
  readonly enclosingSymbol: string;
  readonly accessKind: "unresolved" | "bulk";
  readonly occurrenceCount: number;
  readonly expressionFingerprint: string;
  readonly classification: "legacy-production" | "target-accessor" | "target-bootstrap";
  readonly targets:
    | {
        readonly kind: "closed-targets";
        readonly exact: readonly string[];
        readonly families: readonly string[];
      }
  | {
        readonly kind: "bulk-pass-through";
        readonly boundary:
          | "legacy-daemon-child"
          | "legacy-settings-projection"
          | "dashboard-child-processes"
          | "secure-local-environment-admission";
        readonly reason: string;
      };
}

function computedReader(input: ComputedReaderInput): z.input<typeof ComputedEnvironmentReaderSchema> {
  const targets = input.targets.kind === "closed-targets"
    ? { ...input.targets, exact: [...input.targets.exact], families: [...input.targets.families] }
    : input.targets;
  return { ...input, targets, operation: "read", owner: input.path };
}

const keyPoolTargets = { kind: "closed-targets", exact: [], families: ACTIVE_PROVIDER_FAMILIES } as const;
const probePoolTargets = { kind: "closed-targets", exact: [], families: PROBE_PROVIDER_FAMILIES } as const;
const secretTargets = { kind: "closed-targets", exact: SECRET_EXACT_TARGETS, families: ACTIVE_PROVIDER_FAMILIES } as const;

export const COMPUTED_ENVIRONMENT_READERS = deepFreeze(ComputedEnvironmentReaderSchema.array().parse([
  computedReader({ path: "legacy:scripts/ocr/probe-providers.ts", enclosingSymbol: "readKeys", accessKind: "unresolved", occurrenceCount: 1, expressionFingerprint: "b4215dca8be6208439605ebf023b0d99c8edd39bbc4e770ea89d2f8996b187b9", classification: "legacy-production", targets: probePoolTargets }),
  computedReader({ path: "legacy:scripts/ocr/probe-providers.ts", enclosingSymbol: "readKeys", accessKind: "unresolved", occurrenceCount: 1, expressionFingerprint: "25f486281cf6b7f139c27ffc95ef10afba8ce6af830997fa88178a9e5d29b11c", classification: "legacy-production", targets: probePoolTargets }),
  computedReader({ path: "legacy:scripts/ocr/probe-vision.ts", enclosingSymbol: "firstKey", accessKind: "unresolved", occurrenceCount: 1, expressionFingerprint: "b4215dca8be6208439605ebf023b0d99c8edd39bbc4e770ea89d2f8996b187b9", classification: "legacy-production", targets: keyPoolTargets }),
  computedReader({ path: "legacy:src/core/daemon/registry.ts", enclosingSymbol: "spawnDaemon", accessKind: "bulk", occurrenceCount: 1, expressionFingerprint: "e4db44daa6ead5a1e592c02fa32cfe50b23a07fb388949c32664a0ea298f82ea", classification: "legacy-production", targets: { kind: "bulk-pass-through", boundary: "legacy-daemon-child", reason: "legacy daemon spawning forwards the inherited environment to its same-runtime child" } }),
  computedReader({ path: "legacy:src/infra/auth/duo-webauthn.ts", enclosingSymbol: "numericEnv", accessKind: "unresolved", occurrenceCount: 1, expressionFingerprint: "1471aca1b99d7410cc61adcc6d5158de7ed8e5d7d10cd02509424d750fded359", classification: "legacy-production", targets: { kind: "closed-targets", exact: ["HR_AUTOMATION_DUO_WEBAUTHN_LOCK_STALE_MS", "HR_DUO_FACTOR_TIMEOUT_MS", "HR_DUO_PROMPT_RENDER_GRACE_MS"], families: [] } }),
  computedReader({ path: "legacy:src/services/llm/text-pool.ts", enclosingSymbol: "readKeys", accessKind: "unresolved", occurrenceCount: 1, expressionFingerprint: "b4215dca8be6208439605ebf023b0d99c8edd39bbc4e770ea89d2f8996b187b9", classification: "legacy-production", targets: keyPoolTargets }),
  computedReader({ path: "legacy:src/services/llm/text-pool.ts", enclosingSymbol: "readKeys", accessKind: "unresolved", occurrenceCount: 1, expressionFingerprint: "25f486281cf6b7f139c27ffc95ef10afba8ce6af830997fa88178a9e5d29b11c", classification: "legacy-production", targets: keyPoolTargets }),
  computedReader({ path: "legacy:src/services/ocr/env-keys.ts", enclosingSymbol: "readGeminiKeys", accessKind: "unresolved", occurrenceCount: 1, expressionFingerprint: "1471aca1b99d7410cc61adcc6d5158de7ed8e5d7d10cd02509424d750fded359", classification: "legacy-production", targets: { kind: "closed-targets", exact: [], families: ["GEMINI_API_KEY"] } }),
  computedReader({ path: "legacy:src/services/ocr/per-page-pool.ts", enclosingSymbol: "readKeys", accessKind: "unresolved", occurrenceCount: 1, expressionFingerprint: "b4215dca8be6208439605ebf023b0d99c8edd39bbc4e770ea89d2f8996b187b9", classification: "legacy-production", targets: keyPoolTargets }),
  computedReader({ path: "legacy:src/services/ocr/per-page-pool.ts", enclosingSymbol: "readKeys", accessKind: "unresolved", occurrenceCount: 1, expressionFingerprint: "25f486281cf6b7f139c27ffc95ef10afba8ce6af830997fa88178a9e5d29b11c", classification: "legacy-production", targets: keyPoolTargets }),
  computedReader({ path: "legacy:src/services/ocr/provider-limits.ts", enclosingSymbol: "resolveModelChain", accessKind: "unresolved", occurrenceCount: 1, expressionFingerprint: "f8618e08518953f0787f6591a6e087d798b4798dac003e95d637590497b72844", classification: "legacy-production", targets: { kind: "closed-targets", exact: PROVIDER_MODEL_TARGETS, families: [] } }),
  computedReader({ path: "legacy:src/services/ocr/provider-limits.ts", enclosingSymbol: "resolveModelChain", accessKind: "unresolved", occurrenceCount: 1, expressionFingerprint: "0dab717481bea1e33b1fc7c3fd365e3ff2cd4abe9bc81fa35e6667fba7ebafab", classification: "legacy-production", targets: { kind: "closed-targets", exact: LEGACY_PROVIDER_MODEL_ENVIRONMENT_KEYS, families: [] } }),
  computedReader({ path: "legacy:src/tracker/dashboard/hono/routes/settings.ts", enclosingSymbol: "has", accessKind: "unresolved", occurrenceCount: 1, expressionFingerprint: "a867d2208d468f7a765a91bf4f0e8e80a42cf8ad76951a648d0452a61ff40f86", classification: "legacy-production", targets: { kind: "closed-targets", exact: SECRET_EXACT_TARGETS, families: [] } }),
  computedReader({ path: "legacy:src/tracker/settings/store.ts", enclosingSymbol: "applyOperatorSettingsToEnv", accessKind: "bulk", occurrenceCount: 1, expressionFingerprint: "e4db44daa6ead5a1e592c02fa32cfe50b23a07fb388949c32664a0ea298f82ea", classification: "legacy-production", targets: { kind: "bulk-pass-through", boundary: "legacy-settings-projection", reason: "legacy settings projects its closed override schema into the same-runtime environment" } }),
  computedReader({ path: "legacy:src/utils/env.ts", enclosingSymbol: "numEnv", accessKind: "unresolved", occurrenceCount: 1, expressionFingerprint: "a867d2208d468f7a765a91bf4f0e8e80a42cf8ad76951a648d0452a61ff40f86", classification: "legacy-production", targets: { kind: "closed-targets", exact: [...CONFIG_ENVIRONMENT_KEYS, ...RETIRED_ENVIRONMENT_KEYS], families: [] } }),
  computedReader({ path: "legacy:src/utils/log.ts", enclosingSymbol: "envBool", accessKind: "unresolved", occurrenceCount: 2, expressionFingerprint: "1471aca1b99d7410cc61adcc6d5158de7ed8e5d7d10cd02509424d750fded359", classification: "legacy-production", targets: { kind: "closed-targets", exact: ["DEBUG", "E2E_DEBUG"], families: [] } }),
  computedReader({ path: "legacy:src/workflows/sharepoint-download/handler.ts", enclosingSymbol: "buildSharePointListHandler", accessKind: "unresolved", occurrenceCount: 1, expressionFingerprint: "1471aca1b99d7410cc61adcc6d5158de7ed8e5d7d10cd02509424d750fded359", classification: "legacy-production", targets: { kind: "closed-targets", exact: ["ONBOARDING_ROSTER_URL", "SEPARATIONS_ROSTER_URL"], families: [] } }),
  computedReader({ path: "legacy:src/workflows/sharepoint-download/handler.ts", enclosingSymbol: "queueSharePointDownloadJob", accessKind: "unresolved", occurrenceCount: 1, expressionFingerprint: "1471aca1b99d7410cc61adcc6d5158de7ed8e5d7d10cd02509424d750fded359", classification: "legacy-production", targets: { kind: "closed-targets", exact: ["ONBOARDING_ROSTER_URL", "SEPARATIONS_ROSTER_URL"], families: [] } }),
  computedReader({ path: "legacy:src/workflows/sharepoint-download/handler.ts", enclosingSymbol: "buildSharePointRosterDownloadHandler", accessKind: "unresolved", occurrenceCount: 1, expressionFingerprint: "1471aca1b99d7410cc61adcc6d5158de7ed8e5d7d10cd02509424d750fded359", classification: "legacy-production", targets: { kind: "closed-targets", exact: ["ONBOARDING_ROSTER_URL", "SEPARATIONS_ROSTER_URL"], families: [] } }),
  computedReader({ path: "src/domain/secrets.ts", enclosingSymbol: "admitLocalEnvironmentFile", accessKind: "bulk", occurrenceCount: 1, expressionFingerprint: "a7f05948ce91ea69218acec2e51b3c4f2783ab3c908b4330831213b1f2b7c007", classification: "target-accessor", targets: { kind: "bulk-pass-through", boundary: "secure-local-environment-admission", reason: "the validated and exactly parsed local source fills only bindings absent from the inherited parent environment" } }),
  computedReader({ path: "src/domain/secrets.ts", enclosingSymbol: "inspectSecret", accessKind: "bulk", occurrenceCount: 1, expressionFingerprint: "a7f05948ce91ea69218acec2e51b3c4f2783ab3c908b4330831213b1f2b7c007", classification: "target-accessor", targets: { kind: "closed-targets", exact: SECRET_EXACT_TARGETS, families: [] } }),
  computedReader({ path: "src/domain/secrets.ts", enclosingSymbol: "optionalSecret", accessKind: "bulk", occurrenceCount: 1, expressionFingerprint: "a7f05948ce91ea69218acec2e51b3c4f2783ab3c908b4330831213b1f2b7c007", classification: "target-accessor", targets: { kind: "closed-targets", exact: SECRET_EXACT_TARGETS, families: [] } }),
  computedReader({ path: "src/domain/secrets.ts", enclosingSymbol: "optionalTestTargetSecret", accessKind: "unresolved", occurrenceCount: 1, expressionFingerprint: "631a29fcc2465c1dc0a0e9d09d6ce9f9c51b624b3e7d5d2dd19bdb9b68efa39b", classification: "target-accessor", targets: { kind: "closed-targets", exact: TEST_TARGET_SECRET_ENVIRONMENT_KEYS, families: [] } }),
  // Ref clock-config-secrets: the config resolver takes the environment as a VALUE and reads
  // only its statically-declared CONFIG_ENV_BINDINGS keys; this accessor is
  // where a composition root obtains that value, so no module outside the
  // secrets owner ever touches process.env.
  computedReader({ path: "src/domain/secrets.ts", enclosingSymbol: "configResolutionEnvironment", accessKind: "bulk", occurrenceCount: 1, expressionFingerprint: "a7f05948ce91ea69218acec2e51b3c4f2783ab3c908b4330831213b1f2b7c007", classification: "target-accessor", targets: { kind: "closed-targets", exact: [...CONFIG_ENVIRONMENT_KEYS], families: [] } }),
  computedReader({ path: "src/domain/secrets.ts", enclosingSymbol: "requireSecret", accessKind: "bulk", occurrenceCount: 1, expressionFingerprint: "a7f05948ce91ea69218acec2e51b3c4f2783ab3c908b4330831213b1f2b7c007", classification: "target-accessor", targets: secretTargets }),
  computedReader({ path: "src/domain/secrets.ts", enclosingSymbol: "optionalSecretFamily", accessKind: "unresolved", occurrenceCount: 1, expressionFingerprint: "72b51583d255ce06b58a1fb09a91cfed0e89cd4cf7406fc6dea176093c81757c", classification: "target-accessor", targets: { kind: "closed-targets", exact: [], families: ACTIVE_PROVIDER_FAMILIES } }),
  // D161: providerModelChain reads the family's `modelsEnv` chain and its
  // single-model legacy spelling; both dynamic keys resolve only into the
  // registered provider-model target set.
  computedReader({ path: "src/domain/secrets.ts", enclosingSymbol: "providerModelChain", accessKind: "unresolved", occurrenceCount: 1, expressionFingerprint: "4e1462e06eb808e0e0248225f2e039640bd9c00421d1404351bf48ffd280d4de", classification: "target-accessor", targets: { kind: "closed-targets", exact: PROVIDER_MODEL_TARGETS, families: [] } }),
  computedReader({ path: "src/domain/secrets.ts", enclosingSymbol: "providerModelChain", accessKind: "unresolved", occurrenceCount: 1, expressionFingerprint: "7c167b1839ff9416f38fd09168d6ac7d0f9dedf84e6bc44a2df92f0d428569ea", classification: "target-accessor", targets: { kind: "closed-targets", exact: PROVIDER_MODEL_TARGETS, families: [] } }),
  computedReader({ path: "src/domain/secrets.ts", enclosingSymbol: "requireSecretFamily", accessKind: "bulk", occurrenceCount: 1, expressionFingerprint: "a7f05948ce91ea69218acec2e51b3c4f2783ab3c908b4330831213b1f2b7c007", classification: "target-accessor", targets: secretTargets }),
  computedReader({ path: "src/domain/secrets.ts", enclosingSymbol: "validateBootSecrets", accessKind: "bulk", occurrenceCount: 2, expressionFingerprint: "a7f05948ce91ea69218acec2e51b3c4f2783ab3c908b4330831213b1f2b7c007", classification: "target-accessor", targets: secretTargets }),
  computedReader({ path: "src/domain/secrets.ts", enclosingSymbol: "validateDescriptorSecrets", accessKind: "bulk", occurrenceCount: 2, expressionFingerprint: "a7f05948ce91ea69218acec2e51b3c4f2783ab3c908b4330831213b1f2b7c007", classification: "target-accessor", targets: secretTargets }),
  computedReader({ path: "scripts/dev-dashboard.ts", enclosingSymbol: "<module>", accessKind: "bulk", occurrenceCount: 1, expressionFingerprint: "e4db44daa6ead5a1e592c02fa32cfe50b23a07fb388949c32664a0ea298f82ea", classification: "target-bootstrap", targets: { kind: "bulk-pass-through", boundary: "dashboard-child-processes", reason: "the dashboard launcher forwards its inherited environment plus one owned nonce to the two same-runtime child processes" } }),
  computedReader({ path: "vite.dashboard.config.ts", enclosingSymbol: "<module>", accessKind: "unresolved", occurrenceCount: 1, expressionFingerprint: "5c77e74cb49d532097f685ae27e9a8029afb783349dbaff9f709b90a7cece316", classification: "target-bootstrap", targets: { kind: "closed-targets", exact: ["HRAUTO_DASHBOARD_LAUNCH_NONCE"], families: [] } }),
]));

export const RuntimeEnvironmentRegistrySchema = z.strictObject({
  exact: z.array(RuntimeEnvironmentExactSpecSchema).min(1),
  families: z.array(RuntimeEnvironmentFamilySpecSchema).min(1),
  exactReaderOwners: z.array(ExactEnvironmentReaderOwnerSchema).min(1),
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
  const dualChannelKeys = registry.exact.filter((spec) => spec.disposition === "active" && spec.channel === "config-and-secret");
  if (dualChannelKeys.length !== 1 || dualChannelKeys[0]?.key !== "TIMEKEEPER_NAME") {
    violations.push("TIMEKEEPER_NAME must be the sole config-and-secret environment channel overlap");
  }
  for (const spec of registry.exact) {
    if (spec.disposition !== "active") continue;
    const expectedOwner = spec.channel === "provider-model"
      ? "src/domain/runtime-dependencies.ts"
      : spec.channel === "process-ownership"
        ? "src/domain/dashboard-frontend-owner.ts"
      : spec.channel === "secret"
        ? "src/domain/secrets.ts"
        : "src/domain/config/resolve.ts";
    if (spec.owner !== expectedOwner) violations.push(`${spec.key} is owned by ${spec.owner}; expected ${expectedOwner}`);
  }
  for (const family of registry.families) {
    const duplicateOwners = duplicateValues(family.owners);
    if (duplicateOwners.length > 0) violations.push(`duplicate family owners for ${family.prefix}: ${duplicateOwners.join(", ")}`);
    if (family.disposition === "active" && (family.owners.length !== 1 || family.owners[0] !== "src/domain/secrets.ts")) {
      violations.push(`active secret family ${family.prefix} must be owned solely by src/domain/secrets.ts`);
    }
  }
  const configKeys = new Set(CONFIG_ENV_BINDINGS.map(({ env }) => env));
  for (const key of configKeys) {
    const spec = exact.get(key);
    if (spec?.disposition !== "active" || (spec.channel !== "config" && spec.channel !== "config-and-secret")) {
      violations.push(`config binding ${key} has no active config environment inventory entry`);
    }
  }
  for (const spec of registry.exact) {
    if (spec.disposition === "active" && (spec.channel === "config" || spec.channel === "config-and-secret") && !configKeys.has(spec.key)) {
      violations.push(`active config environment ${spec.key} has no CONFIG_ENV_BINDINGS entry`);
    }
  }

  for (const secret of SECRET_SPECS) {
    if (secret.source !== "environment") continue;
    const spec = exact.get(secret.env);
    if (spec?.disposition !== "active" || (spec.channel !== "secret" && spec.channel !== "config-and-secret")) {
      violations.push(`secret environment ${secret.env} has no active secret inventory entry`);
    }
  }
  for (const secret of TEST_TARGET_SECRET_SPECS) {
    const spec = exact.get(secret.env);
    if (spec?.disposition !== "active" || spec.channel !== "secret") {
      violations.push(`test-target person-secret environment ${secret.env} has no active secret inventory entry`);
    }
  }
  for (const family of SECRET_FAMILY_SPECS) {
    const spec = registry.families.find(({ prefix }) => prefix === family.envPrefix);
    if (spec?.disposition !== "active" || spec.classification !== "secret" || spec.maximum !== family.maximum) {
      violations.push(`secret family ${family.envPrefix} does not match environment inventory`);
    }
    const models = exact.get(family.modelsEnv);
    if (models?.disposition !== "active" || models.channel !== "provider-model") {
      violations.push(`provider model environment ${family.modelsEnv} has no active provider-model entry`);
    }
    const legacy = exact.get(family.legacyModelEnv);
    if (legacy?.disposition !== "retired-in-target") {
      violations.push(`legacy provider model environment ${family.legacyModelEnv} lacks target retirement`);
    }
  }

  for (const reader of registry.exactReaderOwners) {
    if (!exact.has(reader.key)) violations.push(`exact reader ownership references unknown environment key ${reader.key}`);
    const duplicatePaths = duplicateValues(reader.paths);
    if (duplicatePaths.length > 0) violations.push(`duplicate exact reader paths for ${reader.key}: ${[...new Set(duplicatePaths)].join(", ")}`);
  }
  for (const reader of registry.computedReaders) {
    if (reader.classification === "target-accessor" && reader.path !== "src/domain/secrets.ts") {
      violations.push(`target computed reader must be owned by src/domain/secrets.ts: ${reader.path}`);
    }
    // D93: the two sides are now two repositories, so a reader's side IS its
    // path scheme. A legacy-production reader must name a legacy-repo file; an
    // unprefixed path belongs to this repo and can never be legacy production.
    if (reader.classification === "legacy-production" && !reader.path.startsWith("legacy:")) {
      violations.push(`legacy computed reader must carry the legacy: scheme: ${reader.path}`);
    }
    if (reader.classification === "target-bootstrap") {
      const isDashboardLauncher = reader.path === "scripts/dev-dashboard.ts"
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
