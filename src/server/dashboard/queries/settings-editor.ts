import { settingsCatalogRow } from "../../../domain/config/catalog.js";
import { hostConfigFacts } from "../../../domain/config/host-display.js";
/** The server-owned, bounded Settings editor inventory and its current values. */
import {
  resolveConfigWithProvenance,
} from "../../../domain/config/resolve.js";
import { SettingsRuntimeStatusSchema, type SettingsFileRecord } from "../../../domain/config/settings.js";
import type { Config, SettingsOverride } from "../../../domain/config/schema.js";
import {
  EditableSettingsWireSchema,
  type EditableSettingsPath,
  type EditableSettingsSectionId,
  type EditableSettingsWire,
} from "../../../domain/dashboard/settings-editor.js";
import type { Clock } from "../../../domain/clock.js";
import type { SettingsRuntimeSnapshot } from "../../settings-runtime.js";

type EditorValue = string | number;

interface LeafSpec {
  readonly section: EditableSettingsSectionId;
  readonly path: EditableSettingsPath;
  readonly label: string;
  readonly description: string;
  readonly input: "text" | "number";
  readonly minimum?: number;
  readonly unit?: string;
  readonly hazard?: string;
  readonly configValue: (config: Config) => EditorValue;
  readonly settingsValue: (settings: SettingsOverride) => EditorValue | undefined;
}

const SECTION_COPY: Readonly<Record<EditableSettingsSectionId, Readonly<{ label: string; description: string }>>> = Object.freeze({
  general: { label: "General", description: "The operator identity this runtime reports." },
  display: { label: "Display", description: "The viewport assumptions used when browser work is composed." },
  performance: { label: "Performance", description: "Concurrency and wait budgets. Saved changes apply to new runs." },
  paths: { label: "Paths", description: "The durable report destination. Saved changes apply to new runs." },
});

/** One closed list. The client only renders this document and forms its patch from its paths. */
const EDITABLE_LEAVES: readonly LeafSpec[] = Object.freeze([
  {
    section: "general", path: "actor.label", input: "text", label: "Operator label",
    description: "The local operator label in dashboard and command evidence.",
    configValue: (config) => config.actor.label,
    settingsValue: (settings) => settings.actor?.label,
  },
  {
    section: "display", path: "display.screenWidth", input: "number", minimum: 1, unit: "px", label: "Screen width",
    description: "The composed browser viewport width.",
    configValue: (config) => config.display.screenWidth,
    settingsValue: (settings) => settings.display?.screenWidth,
  },
  {
    section: "display", path: "display.screenHeight", input: "number", minimum: 1, unit: "px", label: "Screen height",
    description: "The composed browser viewport height.",
    configValue: (config) => config.display.screenHeight,
    settingsValue: (settings) => settings.display?.screenHeight,
  },
  {
    section: "performance", path: "ocr.pageConcurrency", input: "number", minimum: 0, label: "OCR page concurrency",
    description: "Pages OCR may process concurrently; zero leaves provider admission to its own limit.",
    configValue: (config) => config.ocr.pageConcurrency,
    settingsValue: (settings) => settings.ocr?.pageConcurrency,
  },
  {
    section: "performance", path: "ocr.maxValidationRetries", input: "number", minimum: 0, label: "OCR validation retries",
    description: "Additional validation attempts after the first OCR answer.",
    configValue: (config) => config.ocr.maxValidationRetries,
    settingsValue: (settings) => settings.ocr?.maxValidationRetries,
  },
  {
    section: "performance", path: "timeouts.duoApprovalSeconds", input: "number", minimum: 1, unit: "seconds", label: "Duo approval timeout",
    description: "How long an authenticated browser may wait for the Duo ceremony.",
    configValue: (config) => config.timeouts.duoApprovalSeconds,
    settingsValue: (settings) => settings.timeouts?.duoApprovalSeconds,
  },
  {
    section: "performance", path: "concurrency.defaultWorkers", input: "number", minimum: 1, label: "Default workers",
    description: "Workers proposed for a newly planned pool.",
    hazard: "Sets the proposed worker count for new pools; verify capacity before saving.",
    configValue: (config) => config.concurrency.defaultWorkers,
    settingsValue: (settings) => settings.concurrency?.defaultWorkers,
  },
  {
    section: "paths", path: "paths.reportsDir", input: "text", label: "Reports directory",
    description: "Absolute directory where report artifacts are written.",
    configValue: (config) => config.paths.reportsDir,
    settingsValue: (settings) => settings.paths?.reportsDir,
  },
]);

export interface SettingsEditorQueryDeps {
  readonly settings: Readonly<{
    read(): SettingsRuntimeSnapshot;
  }>;
  readonly environment: NodeJS.ProcessEnv;
  readonly clock: Clock;
}

function activeConfigFingerprint(status: unknown): string {
  const parsed = SettingsRuntimeStatusSchema.parse(status);
  return parsed.state === "current" ? parsed.identity.configFingerprint : parsed.active.configFingerprint;
}

function buildLeaf(spec: LeafSpec, record: SettingsFileRecord, deps: SettingsEditorQueryDeps) {
  const resolved = resolveConfigWithProvenance(record.settings, hostConfigFacts(deps.environment), deps.clock);
  // D324: the "default" column shows the host display default, never the headless fallback.
  const defaults = resolveConfigWithProvenance({}, hostConfigFacts(deps.environment), deps.clock);
  const source = resolved.provenance[spec.path];
  if (source === undefined) throw new Error(`settings editor leaf ${spec.path} has no resolver provenance`);
  const common = {
    path: spec.path,
    label: spec.label,
    description: spec.description,
    effectiveValue: spec.configValue(resolved.config),
    defaultValue: spec.configValue(defaults.config),
    ...(spec.settingsValue(record.settings) === undefined ? {} : { settingsValue: spec.settingsValue(record.settings) }),
    source,
    editable: settingsCatalogRow(spec.path).editability === "operator",
    ...(spec.hazard === undefined ? {} : { hazard: spec.hazard }),
  };
  return spec.input === "text"
    ? { ...common, input: "text" as const }
    : { ...common, input: "number" as const, minimum: spec.minimum ?? 0, ...(spec.unit === undefined ? {} : { unit: spec.unit }) };
}

export function buildSettingsEditor(deps: SettingsEditorQueryDeps): EditableSettingsWire {
  const snapshot = deps.settings.read();
  const { record } = snapshot;
  const runtimeStatus = SettingsRuntimeStatusSchema.parse(snapshot.runtimeStatus);
  return EditableSettingsWireSchema.parse({
    revision: record.revision,
    settingsSchemaHash: record.settingsSchemaHash,
    settingsFingerprint: record.settingsFingerprint,
    activeConfigFingerprint: activeConfigFingerprint(runtimeStatus),
    runtimeStatus,
    sections: (Object.keys(SECTION_COPY) as EditableSettingsSectionId[]).map((id) => ({
      id,
      label: SECTION_COPY[id].label,
      description: SECTION_COPY[id].description,
      leaves: EDITABLE_LEAVES.filter((leaf) => leaf.section === id).map((leaf) => buildLeaf(leaf, record, deps)),
    })),
  });
}
