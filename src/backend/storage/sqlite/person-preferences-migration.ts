import { z } from "zod";
import { EditableSettingsOverrideSchema } from "../../../models/config/schema.js";
import { SETTINGS_SCHEMA_HASH } from "../../../models/config/settings.js";
import { ConfigSnapshotRecordSchema } from "../../../models/config/snapshot.js";
import { NEUTRAL_PERSON_PREFERENCES, derivePersonPreferencesFingerprint } from "../../../models/config/person-preferences.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";

export const PRE_PREFERENCES_SETTINGS_SCHEMA_HASH = deriveSchemaHash(EditableSettingsOverrideSchema.omit({ preferences: true }), "input");
export const PERSON_PREFERENCES_CONVERSION_ID = sha256Hex(canonicalJsonStringify({ conversion: 1, from: PRE_PREFERENCES_SETTINGS_SCHEMA_HASH, to: SETTINGS_SCHEMA_HASH, preferences: NEUTRAL_PERSON_PREFERENCES }));
const ObjectSchema = z.record(z.string(), z.unknown());
const BaselineSchema = z.strictObject({ revision: z.literal(1), settingsSchemaHash: z.literal(PRE_PREFERENCES_SETTINGS_SCHEMA_HASH),
  settingsFingerprint: z.string(), settings: z.strictObject({}) });
function baseline(input: unknown) { return { ...BaselineSchema.parse(input), settingsSchemaHash: SETTINGS_SCHEMA_HASH }; }
function initialization(input: unknown) {
  const value = ObjectSchema.parse(input);
  return { ...value, settings: baseline(value.settings) };
}
function audit(input: unknown) {
  const value = ObjectSchema.parse(input);
  return { ...value, request: initialization(value.request) };
}

/** Used only by stopped predecessor inspection and its explicit forward conversion. */
export function convertPersonPreferencesRow(table: string, input: unknown): Record<string, unknown> {
  const row = ObjectSchema.parse(input);
  if (table === "settings_snapshots") {
    const value = ObjectSchema.parse(JSON.parse(z.string().parse(row.payload_json)));
    if (Object.hasOwn(value, "preferences") || Object.hasOwn(value, "preferencesFingerprint")) throw new Error("person-preferences-predecessor-shape-invalid");
    const converted = ConfigSnapshotRecordSchema.parse({ ...value, preferences: NEUTRAL_PERSON_PREFERENCES,
      preferencesFingerprint: derivePersonPreferencesFingerprint(NEUTRAL_PERSON_PREFERENCES) });
    return { ...row, payload_json: canonicalJsonStringify(converted) };
  }
  if (table === "settings") {
    const value = ObjectSchema.parse(JSON.parse(z.string().parse(row.payload_json)));
    if (value.saved !== null && Object.hasOwn(ObjectSchema.parse(ObjectSchema.parse(value.saved).settings), "preferences")) throw new Error("person-preferences-predecessor-shape-invalid");
    return { ...row, payload_json: canonicalJsonStringify({ ...value, initialization: initialization(value.initialization) }) };
  }
  if (table === "commands" && row.family === "settings-initialization") {
    const before = ObjectSchema.parse(JSON.parse(z.string().parse(row.request_json)));
    if (sha256Hex(canonicalJsonStringify(before)) !== row.request_digest) throw new Error("command-row-identity-mismatch");
    const request = initialization(before);
    const json = canonicalJsonStringify(request);
    if (row.outcome_json === null) return { ...row, request_json: json, request_digest: sha256Hex(json) };
    const outcome = ObjectSchema.parse(JSON.parse(z.string().parse(row.outcome_json)));
    if (canonicalJsonStringify(outcome.request) !== canonicalJsonStringify(before)) throw new Error("command-row-outcome-mismatch");
    return { ...row, request_json: json, request_digest: sha256Hex(json), outcome_json: canonicalJsonStringify(audit(outcome)) };
  }
  if (table === "command_audits") {
    const value = ObjectSchema.parse(JSON.parse(z.string().parse(row.payload_json)));
    if (value.kind === "settings-initialization") return { ...row, payload_json: canonicalJsonStringify(audit(value)) };
  }
  return row;
}
