import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJsonStringify } from "../canonical-json.js";
import type { Clock } from "../clock.js";
import { systemClock } from "../clock.js";
import { deepFreeze } from "../immutability.js";
import { FingerprintSchema } from "../ids.js";
import {
  ConfigSchema,
  SettingsOverrideInputSchema,
  UsDateSchema,
  type Config,
  type SettingsOverride,
} from "./schema.js";

export const ConfigProvenanceSchema = z.enum(["env", "settings", "default"]);
export const ConfigLeafPathSchema = z.string().regex(/^[a-z][A-Za-z0-9]*(?:\.(?:[A-Za-z][A-Za-z0-9]*|\*))*$/);
export const ResolvedConfigSchema = z.strictObject({
  config: ConfigSchema,
  /** Provenance is explanatory metadata, never runtime decision input. */
  provenance: z.record(ConfigLeafPathSchema, ConfigProvenanceSchema),
  fingerprint: FingerprintSchema,
});
export type ConfigProvenance = z.infer<typeof ConfigProvenanceSchema>;
export type ConfigLeafPath = z.infer<typeof ConfigLeafPathSchema>;
export type ResolvedConfig = z.infer<typeof ResolvedConfigSchema>;

type ConfigEnvApply = (config: Config, raw: string, fiscalYear: string) => Config;
export const ConfigEnvBindingSchema = z.strictObject({
  env: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  path: ConfigLeafPathSchema,
  apply: z.custom<ConfigEnvApply>((value) => typeof value === "function"),
});
export type ConfigEnvBinding = z.infer<typeof ConfigEnvBindingSchema>;

const PositiveIntegerTextSchema = z.string().regex(/^\d+$/).transform((value) => Number(value)).pipe(z.number().int().positive());
const NonNegativeIntegerTextSchema = z.string().regex(/^\d+$/).transform((value) => Number(value)).pipe(z.number().int().nonnegative());
const BooleanFlagSchema = z.enum(["0", "1"]).transform((value) => value === "1");

function parsed(config: unknown): Config {
  return ConfigSchema.parse(config);
}

function integer(raw: string): number {
  return PositiveIntegerTextSchema.parse(raw);
}

function nonNegativeInteger(raw: string): number {
  return NonNegativeIntegerTextSchema.parse(raw);
}

function flag(raw: string): boolean {
  return BooleanFlagSchema.parse(raw);
}

function testEntryBinding(
  env: string,
  system: "kuali" | "newKronos" | "crm" | "onbase" | "i9" | "oldKronos" | "servicenow" | "sharepoint",
): ConfigEnvBinding {
  return {
    env,
    path: `urls.${system}.test.entry`,
    apply(config, raw) {
      const url = z.url().parse(raw);
      switch (system) {
        case "kuali": return parsed({ ...config, urls: { ...config.urls, kuali: { ...config.urls.kuali, test: { ...config.urls.kuali.test, entry: url } } } });
        case "newKronos": return parsed({ ...config, urls: { ...config.urls, newKronos: { ...config.urls.newKronos, test: { ...config.urls.newKronos.test, entry: url } } } });
        case "crm": return parsed({ ...config, urls: { ...config.urls, crm: { ...config.urls.crm, test: { ...config.urls.crm.test, entry: url } } } });
        case "onbase": return parsed({ ...config, urls: { ...config.urls, onbase: { ...config.urls.onbase, test: { ...config.urls.onbase.test, entry: url } } } });
        case "i9": return parsed({ ...config, urls: { ...config.urls, i9: { ...config.urls.i9, test: { ...config.urls.i9.test, entry: url } } } });
        case "oldKronos": return parsed({ ...config, urls: { ...config.urls, oldKronos: { ...config.urls.oldKronos, test: { ...config.urls.oldKronos.test, entry: url } } } });
        case "servicenow": return parsed({ ...config, urls: { ...config.urls, servicenow: { ...config.urls.servicenow, test: { ...config.urls.servicenow.test, entry: url } } } });
        case "sharepoint": return parsed({ ...config, urls: { ...config.urls, sharepoint: { ...config.urls.sharepoint, test: { ...config.urls.sharepoint.test, entry: url } } } });
      }
    },
  };
}

const CONFIG_ENV_BINDING_INPUTS: readonly ConfigEnvBinding[] = [
  testEntryBinding("HRAUTO_KUALI_TEST_URL", "kuali"),
  testEntryBinding("HRAUTO_NEW_KRONOS_TEST_URL", "newKronos"),
  testEntryBinding("HRAUTO_CRM_TEST_URL", "crm"),
  testEntryBinding("HRAUTO_ONBASE_TEST_URL", "onbase"),
  testEntryBinding("HRAUTO_I9_TEST_URL", "i9"),
  testEntryBinding("HRAUTO_OLD_KRONOS_TEST_URL", "oldKronos"),
  testEntryBinding("HRAUTO_SERVICENOW_TEST_URL", "servicenow"),
  testEntryBinding("HRAUTO_SHAREPOINT_TEST_URL", "sharepoint"),
  {
    env: "HRAUTO_UCPATH_TEST_URL",
    path: "urls.ucpath.test.smartHr",
    apply: (config, raw) => parsed({
      ...config,
      urls: { ...config.urls, ucpath: { ...config.urls.ucpath, test: { ...config.urls.ucpath.test, smartHr: z.url().parse(raw) } } },
    }),
  },
  {
    env: "TIMEKEEPER_NAME",
    path: "operator.timekeeperName",
    apply: (config, raw) => parsed({ ...config, operator: { ...config.operator, timekeeperName: z.string().min(1).parse(raw) } }),
  },
  {
    env: "ANNUAL_DATES_END",
    path: "annualDates.*.jobEndDate",
    apply: (config, raw, fiscalYear) => parsed({
      ...config,
      annualDates: { ...config.annualDates, [fiscalYear]: { ...config.annualDates[fiscalYear], jobEndDate: raw } },
    }),
  },
  {
    env: "KRONOS_DEFAULT_END_DATE",
    path: "annualDates.*.kronosDefaultEndDate",
    apply: (config, raw, fiscalYear) => parsed({
      ...config,
      annualDates: { ...config.annualDates, [fiscalYear]: { ...config.annualDates[fiscalYear], kronosDefaultEndDate: raw } },
    }),
  },
  {
    env: "KRONOS_DEFAULT_START_DATE",
    path: "annualDates.*.kronosDefaultStartDate",
    apply: (config, raw, fiscalYear) => parsed({
      ...config,
      annualDates: { ...config.annualDates, [fiscalYear]: { ...config.annualDates[fiscalYear], kronosDefaultStartDate: raw } },
    }),
  },
  {
    env: "HRAUTO_NAVIGATION_RETRIES",
    path: "performance.navigationRetries",
    apply: (config, raw) => parsed({ ...config, performance: { ...config.performance, navigationRetries: integer(raw) } }),
  },
  {
    env: "HRAUTO_SEPARATION_TERMINATION_WINDOW_DAYS",
    path: "performance.separationTerminationWindowDays",
    apply: (config, raw) => parsed({ ...config, performance: { ...config.performance, separationTerminationWindowDays: integer(raw) } }),
  },
  {
    env: "OCR_SECOND_OPINION_MAX",
    path: "ocr.secondOpinionMax",
    apply: (config, raw) => parsed({ ...config, ocr: { ...config.ocr, secondOpinionMax: integer(raw) } }),
  },
  {
    env: "OCR_PAGE_MAX_WAIT_MS",
    path: "ocr.pageMaxWaitMs",
    apply: (config, raw) => parsed({ ...config, ocr: { ...config.ocr, pageMaxWaitMs: integer(raw) } }),
  },
  {
    env: "OCR_TIER1_PATIENCE_MS",
    path: "ocr.tier1PatienceMs",
    apply: (config, raw) => parsed({ ...config, ocr: { ...config.ocr, tier1PatienceMs: integer(raw) } }),
  },
  {
    env: "OCR_PAGE_CONCURRENCY",
    path: "ocr.pageConcurrency",
    apply: (config, raw) => parsed({ ...config, ocr: { ...config.ocr, pageConcurrency: nonNegativeInteger(raw) } }),
  },
  {
    env: "OCR_DISAMBIG_CONCURRENCY",
    path: "ocr.disambigConcurrency",
    apply: (config, raw) => parsed({ ...config, ocr: { ...config.ocr, disambigConcurrency: integer(raw) } }),
  },
  {
    env: "OCR_SUGGEST_CONCURRENCY",
    path: "ocr.suggestConcurrency",
    apply: (config, raw) => parsed({ ...config, ocr: { ...config.ocr, suggestConcurrency: integer(raw) } }),
  },
  {
    env: "OCR_BACKOFF_BASE_MS",
    path: "ocr.backoffBaseMs",
    apply: (config, raw) => parsed({ ...config, ocr: { ...config.ocr, backoffBaseMs: integer(raw) } }),
  },
  {
    env: "OCR_BACKOFF_CAP_MS",
    path: "ocr.backoffCapMs",
    apply: (config, raw) => parsed({ ...config, ocr: { ...config.ocr, backoffCapMs: integer(raw) } }),
  },
  {
    env: "OCR_MAX_VALIDATION_RETRIES",
    path: "ocr.maxValidationRetries",
    apply: (config, raw) => parsed({ ...config, ocr: { ...config.ocr, maxValidationRetries: nonNegativeInteger(raw) } }),
  },
  {
    env: "HRAUTO_CAPTURE_WIDTH",
    path: "capture.width",
    apply: (config, raw) => parsed({ ...config, capture: { ...config.capture, width: integer(raw) } }),
  },
  {
    env: "HRAUTO_CAPTURE_MAX_WIDTH",
    path: "capture.maxWidth",
    apply: (config, raw) => parsed({ ...config, capture: { ...config.capture, maxWidth: integer(raw) } }),
  },
  {
    env: "HRAUTO_CAPTURE_SLICE_HEIGHT",
    path: "capture.sliceHeight",
    apply: (config, raw) => parsed({ ...config, capture: { ...config.capture, sliceHeight: integer(raw) } }),
  },
  {
    env: "HRAUTO_CAPTURE_SLICE_OVERLAP",
    path: "capture.sliceOverlap",
    apply: (config, raw) => parsed({ ...config, capture: { ...config.capture, sliceOverlap: nonNegativeInteger(raw) } }),
  },
  {
    env: "HRAUTO_CAPTURE_MAX_SLICES",
    path: "capture.maxSlices",
    apply: (config, raw) => parsed({ ...config, capture: { ...config.capture, maxSlices: integer(raw) } }),
  },
  {
    env: "HRAUTO_HEALTH_MONITOR_TICK_MS",
    path: "browserHealth.monitorTickMs",
    apply: (config, raw) => parsed({ ...config, browserHealth: { ...config.browserHealth, monitorTickMs: integer(raw) } }),
  },
  {
    env: "HRAUTO_HEALTH_MONITOR_MAX_REFRESH",
    path: "browserHealth.maxAutoRefresh",
    apply: (config, raw) => parsed({ ...config, browserHealth: { ...config.browserHealth, maxAutoRefresh: nonNegativeInteger(raw) } }),
  },
  {
    env: "HRAUTO_HEALTH_MONITOR_MAX_REOPEN",
    path: "browserHealth.maxReopen",
    apply: (config, raw) => parsed({ ...config, browserHealth: { ...config.browserHealth, maxReopen: nonNegativeInteger(raw) } }),
  },
  {
    env: "HRAUTO_DEFAULT_WORKERS",
    path: "concurrency.defaultWorkers",
    apply: (config, raw) => parsed({ ...config, concurrency: { defaultWorkers: integer(raw) } }),
  },
  {
    env: "HRAUTO_DAEMON_IDLE_MS",
    path: "daemon.idleMs",
    apply: (config, raw) => parsed({ ...config, daemon: { ...config.daemon, idleMs: integer(raw) } }),
  },
  {
    env: "HRAUTO_DAEMON_IDLE_REPOLL_MS",
    path: "daemon.idleRepollMs",
    apply: (config, raw) => parsed({ ...config, daemon: { ...config.daemon, idleRepollMs: integer(raw) } }),
  },
  {
    env: "DEBUG_SCREENSHOTS",
    path: "features.debugScreenshots",
    apply: (config, raw) => parsed({ ...config, features: { ...config.features, debugScreenshots: flag(raw) } }),
  },
  {
    env: "HR_AUTOMATION_DUO_WEBAUTHN",
    path: "features.duoWebAuthn",
    apply: (config, raw) => parsed({ ...config, features: { ...config.features, duoWebAuthn: flag(raw) } }),
  },
];

export const ConfigEnvBindingRegistrySchema = ConfigEnvBindingSchema.array().min(1).superRefine((bindings, context) => {
  for (const field of ["env", "path"] as const) {
    const values = bindings.map((binding) => binding[field]);
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", message: `config environment binding ${field} values must be unique` });
    }
  }
});

export const CONFIG_ENV_BINDINGS = deepFreeze(ConfigEnvBindingRegistrySchema.parse(CONFIG_ENV_BINDING_INPUTS));

function mergeOptional<Base extends object>(base: Partial<Base> | undefined, override: Partial<Base> | undefined): Partial<Base> | undefined {
  if (base === undefined && override === undefined) return undefined;
  return { ...base, ...override };
}

function endpointWithTest<Prod extends object, Test extends object>(
  base: { readonly prod: Prod; readonly test?: Partial<Test> },
  test: Partial<Test> | undefined,
): { readonly prod: Prod; readonly test?: Partial<Test> } {
  if (test === undefined) return { prod: base.prod };
  return { prod: base.prod, test };
}

function mergeAnnualDates(
  defaults: Config["annualDates"],
  override: SettingsOverride["annualDates"],
): unknown {
  const entries: Array<readonly [string, unknown]> = Object.entries(defaults).map(([key, entry]) => [
    key,
    { ...entry, ...override?.[key] },
  ]);
  for (const [key, entry] of Object.entries(override ?? {})) {
    if (defaults[key] === undefined) entries.push([key, entry]);
  }
  return Object.fromEntries(entries);
}

function mergeSettings(defaults: Config, override: SettingsOverride): Config {
  return parsed({
    ...defaults,
    actor: { ...defaults.actor, ...override.actor },
    urls: {
      kuali: endpointWithTest(defaults.urls.kuali, mergeOptional(defaults.urls.kuali.test, override.urls?.kuali?.test)),
      newKronos: endpointWithTest(defaults.urls.newKronos, mergeOptional(defaults.urls.newKronos.test, override.urls?.newKronos?.test)),
      crm: endpointWithTest(defaults.urls.crm, mergeOptional(defaults.urls.crm.test, override.urls?.crm?.test)),
      onbase: endpointWithTest(defaults.urls.onbase, mergeOptional(defaults.urls.onbase.test, override.urls?.onbase?.test)),
      ucpath: endpointWithTest(defaults.urls.ucpath, mergeOptional(defaults.urls.ucpath.test, override.urls?.ucpath?.test)),
      i9: endpointWithTest(defaults.urls.i9, mergeOptional(defaults.urls.i9.test, override.urls?.i9?.test)),
      oldKronos: endpointWithTest(defaults.urls.oldKronos, mergeOptional(defaults.urls.oldKronos.test, override.urls?.oldKronos?.test)),
      servicenow: endpointWithTest(defaults.urls.servicenow, mergeOptional(defaults.urls.servicenow.test, override.urls?.servicenow?.test)),
      sharepoint: endpointWithTest(defaults.urls.sharepoint, mergeOptional(defaults.urls.sharepoint.test, override.urls?.sharepoint?.test)),
    },
    timeouts: { ...defaults.timeouts, ...override.timeouts },
    paths: { ...defaults.paths, ...override.paths },
    annualDates: mergeAnnualDates(defaults.annualDates, override.annualDates),
    operator: { ...defaults.operator, ...override.operator },
    display: { ...defaults.display, ...override.display },
    performance: { ...defaults.performance, ...override.performance },
    ocr: { ...defaults.ocr, ...override.ocr },
    capture: { ...defaults.capture, ...override.capture },
    browserHealth: { ...defaults.browserHealth, ...override.browserHealth },
    concurrency: { ...defaults.concurrency, ...override.concurrency },
    daemon: { ...defaults.daemon, ...override.daemon },
    features: { ...defaults.features, ...override.features },
    providers: { ...defaults.providers, ...override.providers },
  });
}

function collectLeafPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return prefix ? [prefix] : [];
  return Object.entries(value).flatMap(([key, child]) => collectLeafPaths(child, prefix ? `${prefix}.${key}` : key));
}

function environmentValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return undefined;
  return raw.trim();
}

function resolveInternal(env: NodeJS.ProcessEnv, settingsInput: unknown, clock: Clock): ResolvedConfig {
  const settings = SettingsOverrideInputSchema.parse(settingsInput);
  const defaults = ConfigSchema.parse({});
  let config = mergeSettings(defaults, settings);
  const fiscalYear = `FY${String(clock.fiscalYear())}`;
  const appliedEnvPaths: string[] = [];

  const annualBindings = CONFIG_ENV_BINDINGS.filter(({ path }) => path.startsWith("annualDates.*."));
  const annualValues = annualBindings.map((binding) => ({ binding, raw: environmentValue(env, binding.env) }))
    .filter((entry): entry is { binding: ConfigEnvBinding; raw: string } => entry.raw !== undefined);
  if (annualValues.length > 0 && config.annualDates[fiscalYear] === undefined && annualValues.length !== annualBindings.length) {
    throw new Error(`environment overrides for ${fiscalYear} are incomplete; set all three annual-date variables`);
  }
  if (annualValues.length > 0) {
    const current = config.annualDates[fiscalYear];
    const jobEndDate = environmentValue(env, "ANNUAL_DATES_END") ?? current?.jobEndDate;
    const kronosDefaultEndDate = environmentValue(env, "KRONOS_DEFAULT_END_DATE") ?? current?.kronosDefaultEndDate;
    const kronosDefaultStartDate = environmentValue(env, "KRONOS_DEFAULT_START_DATE") ?? current?.kronosDefaultStartDate;
    config = parsed({
      ...config,
      annualDates: {
        ...config.annualDates,
        [fiscalYear]: {
          jobEndDate: UsDateSchema.parse(jobEndDate),
          kronosDefaultEndDate: UsDateSchema.parse(kronosDefaultEndDate),
          kronosDefaultStartDate: UsDateSchema.parse(kronosDefaultStartDate),
        },
      },
    });
    appliedEnvPaths.push(...annualValues.map(({ binding }) => binding.path.replace("*", fiscalYear)));
  }

  for (const binding of CONFIG_ENV_BINDINGS) {
    if (binding.path.startsWith("annualDates.*.")) continue;
    const raw = environmentValue(env, binding.env);
    if (raw === undefined) continue;
    config = binding.apply(config, raw, fiscalYear);
    appliedEnvPaths.push(binding.path.replace("*", fiscalYear));
  }

  const settingsPaths = new Set(collectLeafPaths(settings));
  const envPaths = new Set(appliedEnvPaths);
  const effectivePaths = collectLeafPaths(config);
  const provenance = Object.fromEntries(effectivePaths.map((path): readonly [string, ConfigProvenance] => [
    path,
    envPaths.has(path) ? "env" : settingsPaths.has(path) ? "settings" : "default",
  ]));

  const provenancePaths = Object.keys(provenance).sort();
  if (JSON.stringify(provenancePaths) !== JSON.stringify([...effectivePaths].sort())) {
    throw new Error("config provenance is not bidirectionally complete");
  }

  const fingerprint = FingerprintSchema.parse(
    createHash("sha256").update(canonicalJsonStringify(config)).digest("hex"),
  );
  return ResolvedConfigSchema.parse({ config, provenance, fingerprint });
}

export function resolveConfig(env: NodeJS.ProcessEnv, settingsInput: unknown, clock: Clock = systemClock): Config {
  return resolveInternal(env, settingsInput, clock).config;
}

export function resolveConfigWithProvenance(
  env: NodeJS.ProcessEnv,
  settingsInput: unknown,
  clock: Clock = systemClock,
): ResolvedConfig {
  return resolveInternal(env, settingsInput, clock);
}
