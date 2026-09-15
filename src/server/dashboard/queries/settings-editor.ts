import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import { sha256Hex } from "../../../domain/sha256.js";
/** One ordinary snapshot plus explicitly independent auxiliary authority reads. */
import { SETTINGS_CATALOG } from "../../../domain/config/catalog.js";
import { hostConfigFacts } from "../../../domain/config/host-display.js";
import { resolveConfigWithProvenance, type ResolvedConfig } from "../../../domain/config/resolve.js";
import { derivePersistedSettingsFingerprint, SettingsRuntimeStatusSchema } from "../../../domain/config/settings.js";
import type { Config, SettingsOverride } from "../../../domain/config/schema.js";
import { ProtectedSettingsNameSchema } from "../../../domain/config/protected-settings.js";
import { EditableSettingsWireSchema, type EditableSettingsWire } from "../../../domain/dashboard/settings-editor.js";
import { EditableSettingsSectionIdSchema, settingsCatalogEntry, settingsControlFor, settingsSectionFor } from "../../../domain/dashboard/settings-catalog.js";
import type { Clock } from "../../../domain/clock.js";
import { optionalSecretFamily, SecretFamilyNameSchema } from "../../../domain/secrets.js";
import type { ProtectedSettingsRuntimeSnapshot, SettingsRuntimeSnapshot } from "../../settings-runtime.js";

const SECTION_LABELS = { general: "General", display: "Display", performance: "Performance", paths: "Paths", routes: "Test routes", "annual-dates": "Annual dates", providers: "Provider budgets & models" } as const;
const LABELS: Readonly<Record<string, string>> = {
  "actor.label": "Operator label", "display.screenWidth": "Screen width", "display.screenHeight": "Screen height",
  "ocr.pageConcurrency": "OCR page concurrency", "ocr.maxValidationRetries": "OCR validation retries",
  "timeouts.duoApprovalSeconds": "Duo approval timeout", "concurrency.defaultWorkers": "Default workers", "paths.reportsDir": "Reports directory",
  ucpathUserId: "UCPath user ID", ucpathPassword: "UCPath password", timekeeperName: "Timekeeper name",
  sharepointOnboardingRosterUrl: "SharePoint onboarding roster URL", activityPersonPseudonym: "Historical Activity pseudonym",
};
export function settingsLabel(key: string): string {
  return LABELS[key] ?? key.split(".").map(part => part.replace(/([a-z])([A-Z])/gu, "$1 $2")).join(" · ");
}
function atPath(value: unknown, path: string): unknown {
  let current = value;
  for (const key of path.split(".")) {
    if (current === undefined) return undefined;
    if (current === null || typeof current !== "object" || Array.isArray(current)) throw new Error("settings-editor-path-invalid");
    current = Reflect.get(current, key);
  }
  return current;
}
export interface SettingsEditorQueryDeps {
  readonly settings: { read(): SettingsRuntimeSnapshot & { readonly activeConfig?: Config } };
  readonly protectedSettings: { read(): ProtectedSettingsRuntimeSnapshot };
  readonly environment: NodeJS.ProcessEnv;
  readonly clock: Clock;
  /** Injected resolution stays Settings-local; tests supply deterministic synthetic path facts. */
  readonly resolve?: (settings: SettingsOverride) => ResolvedConfig;
}

export function buildSettingsEditor(deps: SettingsEditorQueryDeps): EditableSettingsWire {
  const snapshot = deps.settings.read();
  const { record } = snapshot;
  const runtimeStatus = SettingsRuntimeStatusSchema.parse(snapshot.runtimeStatus);
  const resolve = deps.resolve ?? ((settings: SettingsOverride) => resolveConfigWithProvenance(settings, hostConfigFacts(deps.environment), deps.clock));
  const resolved = resolve(record.settings);
  const defaults = resolve({}).config;
  const persisted = runtimeStatus.state === "current" ? runtimeStatus.identity : runtimeStatus.persisted;
  const active = runtimeStatus.state === "current" ? runtimeStatus.identity : runtimeStatus.active;
  if (record.settingsFingerprint !== derivePersistedSettingsFingerprint(record.settings) || resolved.fingerprint !== persisted.configFingerprint) throw new Error("settings-editor-snapshot-mismatch");
  // A current snapshot already binds these exact values. A differing active identity requires its actual snapshot.
  const activeConfig = snapshot.activeConfig ?? (runtimeStatus.state === "current" ? resolved.config : undefined);
  if (activeConfig === undefined) throw new Error("settings-editor-active-snapshot-missing");
  if (sha256Hex(canonicalJsonStringify(activeConfig)) !== active.configFingerprint || sha256Hex(canonicalJsonStringify(resolved.config)) !== resolved.fingerprint) throw new Error("settings-editor-config-mismatch");
  const ordinary = SETTINGS_CATALOG.filter(row => row.sourceClass === "ordinary-settings");
  const years = [...new Set([...Object.keys(resolved.config.annualDates), ...Object.keys(activeConfig.annualDates)])].sort();
  const leaf = (key: string, path = key) => {
    const control = settingsControlFor(key);
    const settingsValue = atPath(record.settings, path);
    const effectiveValue = atPath(resolved.config, path);
    return {
      path, catalogKey: key, input: control.input, control, label: settingsLabel(path),
      description: key.startsWith("annualDates.") ? "M/D/YYYY or MM/DD/YYYY" : settingsLabel(key),
      ...(effectiveValue === undefined ? {} : { effectiveValue }),
      ...(atPath(activeConfig, path) === undefined ? {} : { activeValue: atPath(activeConfig, path) }),
      ...(atPath(defaults, path) === undefined ? {} : { defaultValue: atPath(defaults, path) }),
      ...(settingsValue === undefined ? {} : { settingsValue }),
      source: settingsValue === undefined ? "default" : "settings", sourceClass: "ordinary-settings", sensitivity: "ordinary",
      editable: true, validity: effectiveValue === undefined ? "unset" : "valid",
      activationScope: key.startsWith("daemon.") ? "next-idle" : "new-runs",
      ...(control.input === "number" ? { minimum: control.minimum } : {}),
      ...(key.startsWith("display.") ? { unit: "px" } : {}),
      ...(key === "concurrency.defaultWorkers" ? { hazard: "Review capacity for new worker pools." } : {}),
    };
  };
  const leaves = ordinary.flatMap(row => row.key.includes("*") ? years.map(year => leaf(row.key, row.key.replace("*", year))) : [leaf(row.key)]);
  const protectedRows = ProtectedSettingsNameSchema.options.map(name => ({ name, label: settingsLabel(name), activationScope: "next-use",
    purpose: name === "activityPersonPseudonym" ? "Historical records only; Activity pseudonym consumers remain retired." : `Used at the next ${name.startsWith("ucpath") ? "login" : "use"}.` }));
  let protectedSettings: unknown;
  try {
    const read = deps.protectedSettings.read();
    protectedSettings = { state: "available", rows: protectedRows, ...read };
  } catch {
    // Independent credential failure is an explicit unknown, never an empty store or leaked diagnostic.
    protectedSettings = { state: "unknown", rows: protectedRows, reason: "credential-store-unavailable" };
  }
  const providers = Object.fromEntries(SETTINGS_CATALOG.filter(row => row.sourceClass === "provider-env").map(row => {
    const name = SecretFamilyNameSchema.parse(row.key); // Registry defects must throw, outside availability handling.
    try {
      const count = optionalSecretFamily(name, deps.environment).length;
      return [row.key, count === 0 ? { state: "missing" } : { state: "present", count }];
    } catch { return [row.key, { state: "unknown" }]; }
  }));
  const deployment = Object.fromEntries(SETTINGS_CATALOG.filter(row => row.sourceClass === "runtime-isolation").map(row => {
    const value = atPath(activeConfig, row.key === "duoWebauthnCredential" ? "paths.duoCredential" : row.key);
    if (value === undefined) throw new Error("settings-editor-deployment-fact-missing");
    return [row.key, value];
  }));
  return EditableSettingsWireSchema.parse({
    revision: record.revision, settingsSchemaHash: record.settingsSchemaHash, settingsFingerprint: record.settingsFingerprint,
    activeConfigFingerprint: active.configFingerprint, runtimeStatus,
    catalog: SETTINGS_CATALOG.map(settingsCatalogEntry),
    sections: EditableSettingsSectionIdSchema.options.map(id => ({ id, label: SECTION_LABELS[id], description: "Ordinary settings · SQLite", leaves: leaves.filter(value => settingsSectionFor(value.path) === id) })),
    fiscalYearTemplate: { keyPattern: "^FY\\d{4}$", leaves: ordinary.filter(row => row.key.includes("*")).map(row => leaf(row.key)) },
    protectedSettings, providers, host: hostConfigFacts(deps.environment), deployment,
  });
}
