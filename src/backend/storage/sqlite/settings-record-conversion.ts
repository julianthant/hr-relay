import { z } from "zod";
import { derivePersistedSettingsFingerprint, SettingsFileRecordSchema } from "../../../models/config/settings.js";
import { PRE_ASSISTANT_FULL_ACCESS_SETTINGS_SCHEMA_HASH, PRE_PANEL_MODE_RETIREMENT_SETTINGS_SCHEMA_HASH, PRE_PREFERENCES_SETTINGS_SCHEMA_HASH,
  PRE_RUNS_NOTIFICATIONS_SETTINGS_SCHEMA_HASH, PRE_SEND_SHORTCUT_SETTINGS_SCHEMA_HASH,
  RETIRED_PANEL_MODE, RetiredPanelModeSchema, SettingsSchemaWithPanelMode } from "../../../models/config/settings-record-conversion.js";
import { ConfigSnapshotRecordSchema } from "../../../models/config/snapshot.js";
import { derivePersonPreferencesFingerprint } from "../../../models/config/person-preferences.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";

/** The newest schema whose migration converts settings records; a stopped store below it is read through the converter. */
export const SETTINGS_RECORD_CONVERSION_VERSION = 45;

type SettingsRecordConversion = Readonly<{
  /** The settings schema hash a stored row carries before this conversion, and after it. */
  from: string; to: string;
  adds: Readonly<Record<string, unknown>>;
  removes?: readonly string[];
  /** The migration statement after which the forward conversion runs. */
  marker: string;
}>;

function conversion(ordinal: number, name: string, from: string, to: string, adds: Record<string, unknown>, removes?: readonly string[]): SettingsRecordConversion {
  const removal = removes === undefined ? {} : { removes };
  const id = sha256Hex(canonicalJsonStringify({ conversion: ordinal, from, to, preferences: adds, ...removal }));
  return { from, to, adds, ...removal, marker: `SELECT '${name}-forward-conversion:${id}'` };
}

const PERSON_PREFERENCES_CONVERSION = conversion(1, "person-preferences", PRE_PREFERENCES_SETTINGS_SCHEMA_HASH, PRE_RUNS_NOTIFICATIONS_SETTINGS_SCHEMA_HASH, {
  theme: "dark", animations: true, [RETIRED_PANEL_MODE]: "floating", selectedWorkflowId: "",
  shortcuts: { numberMode: "runs", bindings: { search: ["/"], start: ["r"], next: ["j", "ArrowDown"], previous: ["k", "ArrowUp"], attention: ["n"] } },
});
const RUNS_NOTIFICATIONS_CONVERSION = conversion(2, "runs-notifications-settings", PRE_RUNS_NOTIFICATIONS_SETTINGS_SCHEMA_HASH, PRE_SEND_SHORTCUT_SETTINGS_SCHEMA_HASH, {
  preventSleepWhileRunning: true, confirmCloseDuringRun: "active-run",
  notifications: { runFinished: "unfocused", needsYou: true, failures: true, sound: "default" },
});
const SEND_SHORTCUT_CONVERSION = conversion(3, "send-shortcut", PRE_SEND_SHORTCUT_SETTINGS_SCHEMA_HASH, PRE_PANEL_MODE_RETIREMENT_SETTINGS_SCHEMA_HASH, {
  sendShortcut: "enter",
});
const PANEL_MODE_RETIREMENT_CONVERSION = conversion(4, "panel-mode-retirement", PRE_PANEL_MODE_RETIREMENT_SETTINGS_SCHEMA_HASH,
  PRE_ASSISTANT_FULL_ACCESS_SETTINGS_SCHEMA_HASH, {}, [RETIRED_PANEL_MODE]);
const ASSISTANT_FULL_ACCESS_CONVERSION = conversion(5, "assistant-full-access", PRE_ASSISTANT_FULL_ACCESS_SETTINGS_SCHEMA_HASH,
  "e101baaff44410844db1a6afa5857aa7a8f8c30052c035e08a03a4dde45bd7e2", { assistantFullAccess: false });
/**
 * Every conversion of the stored settings record, oldest first; each entry starts at the hash the one before it ends on.
 * An entry is frozen: its hashes and defaults are literals, so the SQL of its migration never changes. A change to the
 * settings schema appends one entry, whose `to` is the new SETTINGS_SCHEMA_HASH, and one migration that runs its marker.
 */
export const SETTINGS_RECORD_CONVERSIONS: readonly SettingsRecordConversion[] = deepFreeze([
  PERSON_PREFERENCES_CONVERSION, RUNS_NOTIFICATIONS_CONVERSION, SEND_SHORTCUT_CONVERSION, PANEL_MODE_RETIREMENT_CONVERSION, ASSISTANT_FULL_ACCESS_CONVERSION,
]);
export const PERSON_PREFERENCES_CONVERSION_MARKER = PERSON_PREFERENCES_CONVERSION.marker;
export const RUNS_NOTIFICATIONS_CONVERSION_MARKER = RUNS_NOTIFICATIONS_CONVERSION.marker;
export const SEND_SHORTCUT_CONVERSION_MARKER = SEND_SHORTCUT_CONVERSION.marker;
export const PANEL_MODE_RETIREMENT_CONVERSION_MARKER = PANEL_MODE_RETIREMENT_CONVERSION.marker;
export const ASSISTANT_FULL_ACCESS_CONVERSION_MARKER = ASSISTANT_FULL_ACCESS_CONVERSION.marker;

export function isSettingsRecordConversionMarker(statement: string): boolean {
  return SETTINGS_RECORD_CONVERSIONS.some(entry => entry.marker === statement);
}

const ObjectSchema = z.record(z.string(), z.unknown());
function json(text: unknown) { return ObjectSchema.parse(JSON.parse(z.string().parse(text))); }

/** The conversions between the hash a row carries and the newest one; none for a row that is current or unknown. */
function conversionsFrom(hash: unknown): readonly SettingsRecordConversion[] {
  const start = SETTINGS_RECORD_CONVERSIONS.findIndex(entry => entry.from === hash);
  return start === -1 ? [] : SETTINGS_RECORD_CONVERSIONS.slice(start);
}

/** A hash no entry starts from must be this build's; the settings record schema refuses any other. */
function baseline(input: unknown) {
  const value = ObjectSchema.parse(input);
  const pending = conversionsFrom(value.settingsSchemaHash);
  SettingsFileRecordSchema.parse({ ...value, settingsSchemaHash: pending.at(-1)?.to ?? value.settingsSchemaHash });
  return { pending, value: pending.length === 0 ? value : { ...value, settingsSchemaHash: pending.at(-1)?.to } };
}
function initialization(input: unknown) {
  const value = ObjectSchema.parse(input);
  const settings = baseline(value.settings);
  return { pending: settings.pending, value: { ...value, settings: settings.value } };
}
function audit(input: unknown) {
  const value = ObjectSchema.parse(input);
  return { ...value, request: initialization(value.request).value };
}

function convertPreferences(stored: Record<string, unknown>, entries: readonly SettingsRecordConversion[]) {
  const preferences = { ...stored };
  for (const entry of entries) {
    Object.assign(preferences, entry.adds);
    for (const key of entry.removes ?? []) delete preferences[key];
  }
  return preferences;
}

function snapshotRow(row: Record<string, unknown>) {
  const value = json(row.payload_json);
  const stored = value.preferences === undefined ? undefined : ObjectSchema.parse(value.preferences);
  if (stored === undefined ? Object.hasOwn(value, "preferencesFingerprint") : value.preferencesFingerprint !== sha256Hex(canonicalJsonStringify(stored))) {
    throw new Error("settings-record-predecessor-shape-invalid");
  }
  // A stored snapshot has no preferences, or exactly the members of the first conversions up to the one its build had.
  const members = (preferences: Record<string, unknown>) => canonicalJsonStringify(Object.keys(preferences).sort());
  const held = stored === undefined ? 0 : SETTINGS_RECORD_CONVERSIONS.findIndex((_entry, index) =>
    members(convertPreferences({}, SETTINGS_RECORD_CONVERSIONS.slice(0, index + 1))) === members(stored)) + 1;
  if (stored !== undefined && held === 0) throw new Error("settings-record-predecessor-shape-invalid");
  if (held === SETTINGS_RECORD_CONVERSIONS.length) return row;
  if (stored !== undefined && Object.hasOwn(stored, RETIRED_PANEL_MODE) && !RetiredPanelModeSchema.safeParse(stored[RETIRED_PANEL_MODE]).success) {
    throw new Error("settings-record-predecessor-shape-invalid");
  }
  const preferences = convertPreferences(stored ?? {}, SETTINGS_RECORD_CONVERSIONS.slice(held));
  return { ...row, payload_json: canonicalJsonStringify(ConfigSnapshotRecordSchema.parse({ ...value, preferences,
    preferencesFingerprint: derivePersonPreferencesFingerprint(preferences) })) };
}

function savedPanelModeRetirement(value: Record<string, unknown>) {
  if (value.saved === null) return undefined;
  const saved = ObjectSchema.parse(value.saved);
  const settings = ObjectSchema.parse(saved.settings);
  const preferences = ObjectSchema.parse(settings.preferences ?? {});
  if (!Object.hasOwn(preferences, RETIRED_PANEL_MODE)) return undefined;
  const source = ObjectSchema.parse(ObjectSchema.parse(value.initialization).settings);
  const before = sha256Hex(`hrauto:persisted-settings:v1\0${canonicalJsonStringify(settings)}`);
  if (saved.settingsFingerprint !== before || !SettingsSchemaWithPanelMode.safeParse(source.settingsSchemaHash).success
    || !RetiredPanelModeSchema.safeParse(preferences[RETIRED_PANEL_MODE]).success) {
    throw new Error("settings-record-predecessor-shape-invalid");
  }
  delete preferences[RETIRED_PANEL_MODE];
  if (Object.keys(preferences).length === 0) delete settings.preferences;
  else settings.preferences = preferences;
  const after = derivePersistedSettingsFingerprint(settings);
  return { before, after, commandId: z.string().parse(saved.commandId), auditId: z.string().parse(saved.auditId),
    revision: z.number().parse(saved.revision), saved: { ...saved, settings, settingsFingerprint: after } };
}

type SavedPanelModeRetirement = NonNullable<ReturnType<typeof savedPanelModeRetirement>>;

function settingsRow(row: Record<string, unknown>, retirement: SavedPanelModeRetirement | undefined) {
  const value = json(row.payload_json);
  const converted = initialization(value.initialization);
  if (converted.pending.length === 0) return row;
  const saved = value.saved === null ? {} : ObjectSchema.parse(ObjectSchema.parse(ObjectSchema.parse(value.saved).settings).preferences ?? {});
  // A store cannot have saved a preference its schema did not have yet.
  if (converted.pending.some(entry => Object.keys(entry.adds).some(key => Object.hasOwn(saved, key)))) throw new Error("settings-record-predecessor-shape-invalid");
  const active = value.active === null ? null : ObjectSchema.parse(value.active);
  if (retirement !== undefined && active?.settingsRevision === retirement.revision) {
    if (active.settingsFingerprint !== retirement.before) throw new Error("settings-record-predecessor-shape-invalid");
    active.settingsFingerprint = retirement.after;
  }
  return { ...row, payload_json: canonicalJsonStringify({ ...value, initialization: converted.value, saved: retirement?.saved ?? value.saved, active }) };
}

function commandRow(row: Record<string, unknown>) {
  const before = json(row.request_json);
  if (sha256Hex(canonicalJsonStringify(before)) !== row.request_digest) throw new Error("command-row-identity-mismatch");
  const converted = initialization(before);
  if (converted.pending.length === 0) return row;
  const request = canonicalJsonStringify(converted.value);
  if (row.outcome_json === null) return { ...row, request_json: request, request_digest: sha256Hex(request) };
  const outcome = json(row.outcome_json);
  if (canonicalJsonStringify(outcome.request) !== canonicalJsonStringify(before)) throw new Error("command-row-outcome-mismatch");
  return { ...row, request_json: request, request_digest: sha256Hex(request), outcome_json: canonicalJsonStringify(audit(outcome)) };
}

function auditRow(row: Record<string, unknown>) {
  const value = json(row.payload_json);
  if (value.kind !== "settings-initialization" || initialization(value.request).pending.length === 0) return row;
  return { ...row, payload_json: canonicalJsonStringify(audit(value)) };
}

function retireSavedResult(input: unknown, retirement: SavedPanelModeRetirement) {
  const outcome = ObjectSchema.parse(input);
  const request = ObjectSchema.parse(outcome.request);
  const result = ObjectSchema.parse(outcome.result);
  if (outcome.auditId !== retirement.auditId || request.commandId !== retirement.commandId
    || result.state !== "applied" || result.commandId !== retirement.commandId || result.settingsRevision !== retirement.revision
    || result.settingsFingerprint !== retirement.before) throw new Error("settings-record-predecessor-shape-invalid");
  return canonicalJsonStringify({ ...outcome, result: { ...result, settingsFingerprint: retirement.after } });
}

/**
 * Brings one stored row to this build's settings schema. A current row comes back unchanged, so the conversion may run
 * again over a store it has partly or wholly converted. Used by stopped inspection of an older store and by the
 * forward migrations; no reader of a current store calls it.
 */
export function convertSettingsRecordRow(table: string, input: unknown, retirement?: SavedPanelModeRetirement): Record<string, unknown> {
  const row = ObjectSchema.parse(input);
  if (table === "settings_snapshots") return snapshotRow(row);
  if (table === "settings") return settingsRow(row, retirement ?? savedPanelModeRetirement(json(row.payload_json)));
  if (retirement !== undefined && table === "commands" && row.id === retirement.commandId) {
    return { ...row, outcome_json: retireSavedResult(json(row.outcome_json), retirement) };
  }
  if (retirement !== undefined && table === "command_audits" && row.id === retirement.auditId) {
    return { ...row, payload_json: retireSavedResult(json(row.payload_json), retirement) };
  }
  if (table === "commands" && row.family === "settings-initialization") return commandRow(row);
  if (table === "command_audits") return auditRow(row);
  return row;
}

/** Captures the binding before any row changes so the saved row and both settlement copies advance together. */
export function createSettingsRecordConversion(payloadJson: unknown) {
  const retirement = payloadJson === undefined ? undefined : savedPanelModeRetirement(json(payloadJson));
  return (table: string, input: unknown) => convertSettingsRecordRow(table, input, retirement);
}
