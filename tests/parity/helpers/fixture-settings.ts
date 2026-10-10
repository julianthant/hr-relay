import { FingerprintSchema, PositiveIntSchema } from "../../../src/rules/identity/ids.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { hostConfigFacts } from "../../../src/models/config/host-display.js";
import { resolveConfigWithProvenance } from "../../../src/backend/app/config/resolve.js";
import { buildSettingsEditor } from "../../../src/backend/runs/queries/settings-editor.js";
import { SETTINGS_SCHEMA_HASH, derivePersistedSettingsFingerprint, settingsRuntimeIdentity } from "../../../src/models/config/settings.js";
import { ConfigSchema, type SettingsOverride } from "../../../src/models/config/schema.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../src/rules/validation/sha256.js";
import { initialProtectedStoreRecord } from "../../../src/models/config/protected-settings.js";
import { createProtectedSettingsRuntimeReader } from "../../../src/backend/runtime/settings/settings-runtime.js";
import { type SettingsFactsWire } from "../../../src/models/dashboard/settings.js";
import { buildSettingsFacts } from "../../../src/backend/runs/queries/settings.js";
import { personLookupDescriptor } from "../../support/helpers/registered-workflows.js";
import { FIXTURE_NOW } from "./fixture-identity.js";


/* ── settings facts ──────────────────────────────────────────────────────── */


export const FIXTURE_SETTINGS_FACTS: SettingsFactsWire = buildSettingsFacts({
  config: resolveConfigWithProvenance({}, hostConfigFacts({}), manualClock(new Date(FIXTURE_NOW))).config,
  descriptors: [personLookupDescriptor],
});


/** Synthetic Settings projection built by the complete production fold. Paths have a stable fixture root. */
export function fixtureSettingsDocument(settings: SettingsOverride = {}, revision = 1) {
  const clock = manualClock(new Date(FIXTURE_NOW));
  const resolve = (overrides: SettingsOverride) => {
    const resolved = resolveConfigWithProvenance(overrides, hostConfigFacts({}), clock);
    const config = ConfigSchema.parse({ ...resolved.config, paths: {
      ...resolved.config.paths,
      reportsDir: overrides.paths?.reportsDir ?? "/tmp/reports",
      downloadsDir: overrides.paths?.downloadsDir ?? "/tmp/settings-fixture/downloads",
      onboardingDocsDir: overrides.paths?.onboardingDocsDir ?? "/tmp/settings-fixture/onboarding",
      i9CheckTrackerPath: overrides.paths?.i9CheckTrackerPath ?? "/tmp/settings-fixture/i9.xlsx",
      stateRoot: "/tmp/settings-fixture/state", artifactRoot: "/tmp/settings-fixture/artifacts",
      browserProfileRoot: "/tmp/settings-fixture/auth", duoCredential: "/tmp/settings-fixture/auth/duo-webauthn.json",
      duoExtensionDir: "/tmp/settings-fixture/duo-autopilot",
    } });
    return { ...resolved, config, fingerprint: FingerprintSchema.parse(sha256Hex(canonicalJsonStringify(config))) };
  };
  const record = { revision: PositiveIntSchema.parse(revision), settingsSchemaHash: SETTINGS_SCHEMA_HASH, settingsFingerprint: FingerprintSchema.parse(derivePersistedSettingsFingerprint(settings)), settings };
  return buildSettingsEditor({ settings: { read: () => ({ record, runtimeStatus: { state: "current", identity: settingsRuntimeIdentity(record, resolve(settings).fingerprint) } }) },
    protectedSettings: createProtectedSettingsRuntimeReader({ read: initialProtectedStoreRecord }), environment: {}, clock, resolve });
}
export const FIXTURE_EDITABLE_SETTINGS = fixtureSettingsDocument();
export const FIXTURE_STORAGE_RELOCATION = {
  revision: 0,
  installationId: "11111111-1111-4111-8111-111111111111",
  sourceGeneration: 0,
  sourcePair: { stateRoot: "/tmp/settings-fixture/state", artifactRoot: "/tmp/settings-fixture/artifacts" },
  pending: null,
} as const;
