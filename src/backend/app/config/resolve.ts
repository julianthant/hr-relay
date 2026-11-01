import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { Clock } from "../../../rules/time/clock.js";
import { systemClock } from "../../../rules/time/clock.js";
import { FingerprintSchema } from "../../../rules/identity/ids.js";
import { defaultRuntimePaths } from "./runtime-paths.js";
import { HostConfigFactsSchema, type HostConfigFacts } from "../../../models/config/host-display.js";
import {
  ConfigLeafPathSchema,
  ConfigProvenanceSchema,
  configLeafPaths,
  type ConfigProvenance,
} from "../../../models/config/provenance.js";
import {
  ConfigSchema,
  SettingsOverrideInputSchema,
  DEFAULT_DISPLAY,
  type Config,
  type SettingsOverride,
} from "../../../models/config/schema.js";

export { ConfigLeafPathSchema, ConfigProvenanceSchema, configLeafPaths } from "../../../models/config/provenance.js";
export type { ConfigLeafPath, ConfigProvenance } from "../../../models/config/provenance.js";
export const ResolvedConfigSchema = z.strictObject({
  config: ConfigSchema,
  /** Provenance is explanatory metadata, never runtime decision input. */
  provenance: z.record(ConfigLeafPathSchema, ConfigProvenanceSchema),
  fingerprint: FingerprintSchema,
});
export type ResolvedConfig = z.infer<typeof ResolvedConfigSchema>;

const RuntimeStoragePairSchema = z.strictObject({
  stateRoot: z.string().min(1),
  artifactRoot: z.string().min(1),
}).superRefine((pair, context) => {
  for (const key of ["stateRoot", "artifactRoot"] as const) {
    const path = pair[key];
    if (!isAbsolute(path) || resolve(path) !== path) {
      context.addIssue({ code: "custom", path: [key], message: "root must be canonical absolute path" });
    }
  }
  if (!isAbsolute(pair.stateRoot) || !isAbsolute(pair.artifactRoot)) return;
  const stateWithinArtifact = relative(pair.artifactRoot, pair.stateRoot);
  if (stateWithinArtifact === "" || (stateWithinArtifact !== ".."
    && !stateWithinArtifact.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    && !isAbsolute(stateWithinArtifact))) {
    context.addIssue({ code: "custom", path: ["artifactRoot"], message: "artifact root cannot contain state root" });
  }
}).readonly();
export type AdmittedRuntimeStoragePair = z.infer<typeof RuntimeStoragePairSchema>;

function parsed(config: unknown): Config {
  return ConfigSchema.parse(config);
}

function endpointWithOverride<Routes extends object>(
  base: { readonly prod: Routes },
  override: Routes | undefined,
): { readonly prod: Routes } {
  return { prod: override ?? base.prod };
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

type SettingsOverrideByConfigGroup = Exclude<keyof SettingsOverride, keyof Config> extends never
  ? { readonly [Group in keyof Config]: Group extends keyof SettingsOverride ? SettingsOverride[Group] : never }
  : never;


function settingsOverrideByConfigGroup(override: SettingsOverride): SettingsOverrideByConfigGroup {
  return {
    actor: override.actor,
    urls: override.urls,
    timeouts: override.timeouts,
    paths: override.paths,
    annualDates: override.annualDates,
    display: override.display,
    performance: override.performance,
    ocr: override.ocr,
    browserHealth: override.browserHealth,
    browser: override.browser,
    concurrency: override.concurrency,
    daemon: override.daemon,
    features: override.features,
    providers: override.providers,
  };
}

function mergeSettings(defaults: Config, override: SettingsOverride): Config {
  const groups = settingsOverrideByConfigGroup(override);
  return parsed({
    ...defaults,
    actor: { ...defaults.actor, ...groups.actor },
    urls: {
      kuali: endpointWithOverride(defaults.urls.kuali, groups.urls?.kuali?.prod),
      newKronos: endpointWithOverride(defaults.urls.newKronos, groups.urls?.newKronos?.prod),
      crm: endpointWithOverride(defaults.urls.crm, groups.urls?.crm?.prod),
      onbase: endpointWithOverride(defaults.urls.onbase, groups.urls?.onbase?.prod),
      ucpath: endpointWithOverride(defaults.urls.ucpath, groups.urls?.ucpath?.prod),
      i9: endpointWithOverride(defaults.urls.i9, groups.urls?.i9?.prod),
      oldKronos: endpointWithOverride(defaults.urls.oldKronos, groups.urls?.oldKronos?.prod),
      servicenow: endpointWithOverride(defaults.urls.servicenow, groups.urls?.servicenow?.prod),
      sharepoint: endpointWithOverride(defaults.urls.sharepoint, groups.urls?.sharepoint?.prod),
    },
    timeouts: { ...defaults.timeouts, ...groups.timeouts },
    paths: { ...defaults.paths, ...groups.paths },
    annualDates: mergeAnnualDates(defaults.annualDates, groups.annualDates),
    display: { ...defaults.display, ...groups.display },
    performance: { ...defaults.performance, ...groups.performance },
    ocr: { ...defaults.ocr, ...groups.ocr },
    browserHealth: { ...defaults.browserHealth, ...groups.browserHealth },
    browser: { ...defaults.browser, ...groups.browser },
    concurrency: { ...defaults.concurrency, ...groups.concurrency },
    daemon: { ...defaults.daemon, ...groups.daemon },
    features: { ...defaults.features, ...groups.features },
    providers: { ...defaults.providers, ...groups.providers },
  });
}

function resolveInternal(settingsInput: unknown, hostFactsInput: HostConfigFacts, runtimeStoragePair?: AdmittedRuntimeStoragePair): ResolvedConfig {
  const settings = SettingsOverrideInputSchema.parse(settingsInput);
  const hostFacts = HostConfigFactsSchema.parse(hostFactsInput);
  const admittedPair = runtimeStoragePair === undefined ? undefined : RuntimeStoragePairSchema.parse(runtimeStoragePair);
  const defaults = ConfigSchema.parse({
    paths: { ...defaultRuntimePaths(), ...admittedPair,
      ...(admittedPair === undefined ? {} : { reportsDir: join(admittedPair.stateRoot, "files", "reports"), downloadsDir: join(admittedPair.stateRoot, "files", "downloads"),
        onboardingDocsDir: join(admittedPair.stateRoot, "files", "onboarding"), i9CheckTrackerPath: join(admittedPair.stateRoot, "files", "reports", "i9-check-tracker.xlsx"), browserProfileRoot: join(admittedPair.stateRoot, "browsers"), duoCredential: join(admittedPair.stateRoot, "credentials", "duo-webauthn.json") }) }, display: hostFacts.primaryDisplay ?? DEFAULT_DISPLAY,
  });
  const config = mergeSettings(defaults, settings);

  const settingsPaths = new Set(configLeafPaths(settings));
  const effectivePaths = configLeafPaths(config);
  const provenance = Object.fromEntries(effectivePaths.map((path): readonly [string, ConfigProvenance] => [
    path,
    settingsPaths.has(path) ? "settings" : "default",
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

/** Ordinary document > host/contract defaults. No environment override parameter exists. */
export function resolveConfigWithProvenance(
  settingsInput: unknown,
  hostFacts: HostConfigFacts,
  _clock: Clock = systemClock,
  runtimeStoragePair?: AdmittedRuntimeStoragePair,
): ResolvedConfig {
  return resolveInternal(settingsInput, hostFacts, runtimeStoragePair);
}
