import { personLookupDescriptor } from "../../registered-workflows.js";
import { FingerprintSchema, PositiveIntSchema } from "../../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { hostConfigFacts } from "../../../../../src/models/config/host-display.js";
import { resolveConfigWithProvenance } from "../../../../../src/backend/app/config/resolve.js";
import { buildSettingsEditor } from "../../../../../src/backend/runs/queries/settings-editor.js";
import { SETTINGS_SCHEMA_HASH, derivePersistedSettingsFingerprint, settingsRuntimeIdentity } from "../../../../../src/models/config/settings.js";
import { ConfigSchema, type SettingsOverride } from "../../../../../src/models/config/schema.js";
import { canonicalJsonStringify } from "../../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../../src/rules/validation/sha256.js";
import { initialProtectedStoreRecord } from "../../../../../src/models/config/protected-settings.js";
import { createProtectedSettingsRuntimeReader } from "../../../../../src/backend/runtime/settings/settings-runtime.js";
import { SettingsFactsWireSchema, type SettingsFactsWire } from "../../../../../src/models/dashboard/settings.js";
import { buildSettingsFacts } from "../../../../../src/backend/runs/queries/settings.js";
import type * as FixtureIdentityTypes from "../../../fixtures/dashboard/fixture-identity.js";


export function createFixtureSettingsSetup({ FIXTURE_NOW }: {
FIXTURE_NOW: typeof FixtureIdentityTypes.FIXTURE_NOW;
}) {
  const facts = buildSettingsFacts({
    config: resolveConfigWithProvenance({}, hostConfigFacts({}), manualClock(new Date(FIXTURE_NOW))).config,
    descriptors: [personLookupDescriptor],
  });

  const FIXTURE_SETTINGS_FACTS: SettingsFactsWire = SettingsFactsWireSchema.parse({
    ...facts,
    workflowCapabilities: facts.workflowCapabilities.map(row => row.workflowId === "person-lookup"
      ? { ...row, editData: { state: "declared", editableFields: 3 } } : row),
  });

  function fixtureSettingsDocument(settings: SettingsOverride = {}, revision = 1) {
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
        browserProfileRoot: "/tmp/settings-fixture/auth",
        duoExtensionDir: "/tmp/settings-fixture/duo-autopilot",
      } });
      return { ...resolved, config, fingerprint: FingerprintSchema.parse(sha256Hex(canonicalJsonStringify(config))) };
    };
    const record = { revision: PositiveIntSchema.parse(revision), settingsSchemaHash: SETTINGS_SCHEMA_HASH, settingsFingerprint: FingerprintSchema.parse(derivePersistedSettingsFingerprint(settings)), settings };
    return buildSettingsEditor({ settings: { read: () => ({ record, runtimeStatus: { state: "current", identity: settingsRuntimeIdentity(record, resolve(settings).fingerprint) } }) },
      protectedSettings: createProtectedSettingsRuntimeReader({ read: initialProtectedStoreRecord }), environment: {}, clock, resolve });
  }

  const FIXTURE_EDITABLE_SETTINGS = fixtureSettingsDocument();

  const FIXTURE_STORAGE_RELOCATION = {
    revision: 0,
    installationId: "11111111-1111-4111-8111-111111111111",
    sourceGeneration: 0,
    sourcePair: { stateRoot: "/tmp/settings-fixture/state", artifactRoot: "/tmp/settings-fixture/artifacts" },
    pending: null,
  } as const;

  return { FIXTURE_SETTINGS_FACTS, fixtureSettingsDocument, FIXTURE_EDITABLE_SETTINGS, FIXTURE_STORAGE_RELOCATION };
}
