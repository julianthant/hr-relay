import {
  PROTECTED_SETTINGS_SCHEMA_HASH,
  ProtectedStoreRecordSchema,
  type ProtectedSettingsName,
} from "../../../src/models/config/protected-settings.js";
import type { ProtectedSecretSource } from "../../../src/models/config/secrets.js";

const TEST_INSTANT = "2026-09-04T00:00:00.000Z";
const TEST_COMMAND_ID = "00000000-0000-4000-8000-000000000001";
const TEST_WRITE_ID = "00000000-0000-4000-8000-000000000002";
const TEST_FINGERPRINT = "0".repeat(64);

/** Synthetic private-store source. Values are test-only and never cross a production wire. */
export function protectedSecretSource(
  values: Partial<Record<ProtectedSettingsName, unknown>> = {},
): ProtectedSecretSource {
  const entries = Object.fromEntries(Object.entries(values).map(([name, value], index) => [name, {
    valueId: `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
    value,
    updatedAt: TEST_INSTANT,
  }]));
  const hasEntries = Object.keys(entries).length > 0;
  const record = ProtectedStoreRecordSchema.parse({
    schemaVersion: 1,
    revision: hasEntries ? 2 : 1,
    protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
    entries,
    ...(hasEntries ? {
      lastApplied: {
        commandId: TEST_COMMAND_ID,
        commandFingerprint: TEST_FINGERPRINT,
        expectedRevision: 1,
        protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
        writeId: TEST_WRITE_ID,
      },
    } : {}),
  });
  return { read: () => record };
}
