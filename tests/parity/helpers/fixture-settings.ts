import { FingerprintSchema, PositiveIntSchema } from "../../../src/domain/ids.js";
import { manualClock } from "../../../src/domain/clock.js";
import { hostConfigFacts } from "../../../src/domain/config/host-display.js";
import { resolveConfigWithProvenance } from "../../../src/domain/config/resolve.js";
import { buildSettingsEditor } from "../../../src/server/dashboard/queries/settings-editor.js";
import { SETTINGS_SCHEMA_HASH, derivePersistedSettingsFingerprint, settingsRuntimeIdentity } from "../../../src/domain/config/settings.js";
import { ConfigSchema, type SettingsOverride } from "../../../src/domain/config/schema.js";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import { sha256Hex } from "../../../src/domain/sha256.js";
import { initialProtectedStoreRecord } from "../../../src/domain/config/protected-settings.js";
import { createProtectedSettingsRuntimeReader } from "../../../src/server/settings-runtime.js";
import {
type SettingsFactsWire
} from "../../../src/domain/dashboard/settings.js";
import { buildSettingsFacts } from "../../../src/server/dashboard/queries/settings.js";
import { personLookupDescriptor } from "../../helpers/registered-workflows.js";
import { FIXTURE_NOW } from "./fixture-identity.js";


/* ── settings facts ──────────────────────────────────────────────────────── */

/**
 * `GET /api/v1/settings/facts` — BUILT by the production fold, never authored.
 *
 * `buildSettingsFacts` is the server's own projection of the resolved config
 * and the descriptor tuple (D274 item 6). Hand-writing a host list or a
 * capability row here would photograph the fixture's opinion of those
 * derivations instead of the derivations — the same reason `fixture-gate.ts`
 * builds its packet rather than spelling one.
 *
 * The inputs are the DEFAULTS and the day corpus's one descriptor: an empty
 * env and empty settings resolve to `ConfigSchema`'s shipped hosts for the
 * compatibility facts wire, and the capability row joins the single
 * `workflows[]` entry the bootstrap above serves. `manualClock` pins the
 * resolution instant so nothing here can be dated by the wall clock.
 */
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
