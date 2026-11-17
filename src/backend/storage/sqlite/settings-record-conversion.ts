import { z } from "zod";
import { SettingsFileRecordSchema } from "../../../models/config/settings.js";
import { ConfigSnapshotRecordSchema } from "../../../models/config/snapshot.js";
import { derivePersonPreferencesFingerprint } from "../../../models/config/person-preferences.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";

/** The settings schema hash of stores written before person preferences existed. */
export const PRE_PREFERENCES_SETTINGS_SCHEMA_HASH = "19627be7a40904943283fc624f14d93596d5fda16d3690ee4ed6f3407ed675d7";
/** The settings schema hash of stores written before the Runs and Notifications settings existed. */
export const PRE_RUNS_NOTIFICATIONS_SETTINGS_SCHEMA_HASH = "39fde8a538405f533301def527db504117799174867cc4d93beb55310382f29a";
/** The newest schema whose migration converts settings records; a stopped store below it is read through the converter. */
export const SETTINGS_RECORD_CONVERSION_VERSION = 32;

type SettingsRecordConversion = Readonly<{
  /** The settings schema hash a stored row carries before this conversion, and after it. */
  from: string; to: string;
  /** The preference members this conversion adds, with the defaults every stored snapshot gains. */
  adds: Readonly<Record<string, unknown>>;
  /** The migration statement after which the forward conversion runs. */
  marker: string;
}>;

function conversion(ordinal: number, name: string, from: string, to: string, adds: Record<string, unknown>): SettingsRecordConversion {
  const id = sha256Hex(canonicalJsonStringify({ conversion: ordinal, from, to, preferences: adds }));
  return { from, to, adds, marker: `SELECT '${name}-forward-conversion:${id}'` };
}

const PERSON_PREFERENCES_CONVERSION = conversion(1, "person-preferences", PRE_PREFERENCES_SETTINGS_SCHEMA_HASH, PRE_RUNS_NOTIFICATIONS_SETTINGS_SCHEMA_HASH, {
  theme: "dark", animations: true, workflowPanelMode: "floating", selectedWorkflowId: "",
  shortcuts: { numberMode: "runs", bindings: { search: ["/"], start: ["r"], next: ["j", "ArrowDown"], previous: ["k", "ArrowUp"], attention: ["n"] } },
});
const RUNS_NOTIFICATIONS_CONVERSION = conversion(2, "runs-notifications-settings", PRE_RUNS_NOTIFICATIONS_SETTINGS_SCHEMA_HASH, "a8ebb3d571f77af72aafeb62477b0950bd3e050c29101d4d7e460c54dc918bdf", {
  preventSleepWhileRunning: true, confirmCloseDuringRun: "active-run",
  notifications: { runFinished: "unfocused", needsYou: true, failures: true, sound: "default" },
});
/**
 * Every conversion of the stored settings record, oldest first; each entry starts at the hash the one before it ends on.
 * An entry is frozen: its hashes and defaults are literals, so the SQL of its migration never changes. A change to the
 * settings schema appends one entry, whose `to` is the new SETTINGS_SCHEMA_HASH, and one migration that runs its marker.
 */
export const SETTINGS_RECORD_CONVERSIONS: readonly SettingsRecordConversion[] = deepFreeze([PERSON_PREFERENCES_CONVERSION, RUNS_NOTIFICATIONS_CONVERSION]);
export const PERSON_PREFERENCES_CONVERSION_MARKER = PERSON_PREFERENCES_CONVERSION.marker;
export const RUNS_NOTIFICATIONS_CONVERSION_MARKER = RUNS_NOTIFICATIONS_CONVERSION.marker;

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

function snapshotRow(row: Record<string, unknown>) {
  const value = json(row.payload_json);
  const stored = value.preferences === undefined ? undefined : ObjectSchema.parse(value.preferences);
  if (stored === undefined ? Object.hasOwn(value, "preferencesFingerprint") : value.preferencesFingerprint !== sha256Hex(canonicalJsonStringify(stored))) {
    throw new Error("settings-record-predecessor-shape-invalid");
  }
  // A stored snapshot has no preferences, or exactly the members of the first conversions up to the one its build had.
  const members = (count: number) => SETTINGS_RECORD_CONVERSIONS.slice(0, count).flatMap(entry => Object.keys(entry.adds)).sort().join();
  const held = stored === undefined ? 0 : SETTINGS_RECORD_CONVERSIONS.findIndex((_entry, index) => members(index + 1) === Object.keys(stored).sort().join()) + 1;
  if (stored !== undefined && held === 0) throw new Error("settings-record-predecessor-shape-invalid");
  if (held === SETTINGS_RECORD_CONVERSIONS.length) return row;
  const preferences = SETTINGS_RECORD_CONVERSIONS.slice(held).reduce<Record<string, unknown>>((filled, entry) => ({ ...filled, ...entry.adds }), { ...stored });
  return { ...row, payload_json: canonicalJsonStringify(ConfigSnapshotRecordSchema.parse({ ...value, preferences,
    preferencesFingerprint: derivePersonPreferencesFingerprint(preferences) })) };
}

function settingsRow(row: Record<string, unknown>) {
  const value = json(row.payload_json);
  const converted = initialization(value.initialization);
  if (converted.pending.length === 0) return row;
  const saved = value.saved === null ? {} : ObjectSchema.parse(ObjectSchema.parse(ObjectSchema.parse(value.saved).settings).preferences ?? {});
  // A store cannot have saved a preference its schema did not have yet.
  if (converted.pending.some(entry => Object.keys(entry.adds).some(key => Object.hasOwn(saved, key)))) throw new Error("settings-record-predecessor-shape-invalid");
  return { ...row, payload_json: canonicalJsonStringify({ ...value, initialization: converted.value }) };
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

/**
 * Brings one stored row to this build's settings schema. A current row comes back unchanged, so the conversion may run
 * again over a store it has partly or wholly converted. Used by stopped inspection of an older store and by the
 * forward migrations; no reader of a current store calls it.
 */
export function convertSettingsRecordRow(table: string, input: unknown): Record<string, unknown> {
  const row = ObjectSchema.parse(input);
  if (table === "settings_snapshots") return snapshotRow(row);
  if (table === "settings") return settingsRow(row);
  if (table === "commands" && row.family === "settings-initialization") return commandRow(row);
  if (table === "command_audits") return auditRow(row);
  return row;
}
