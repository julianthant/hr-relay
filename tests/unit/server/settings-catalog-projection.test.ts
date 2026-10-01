import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { SETTINGS_CATALOG } from "../../../src/domain/config/catalog.js";
import { EditableSettingsWireSchema } from "../../../src/domain/dashboard/settings-editor.js";
import { SETTINGS_SCHEMA_HASH, initialSettingsFileRecord, settingsRuntimeIdentity } from "../../../src/domain/config/settings.js";
import { manualClock } from "../../../src/domain/clock.js";
import { resolveConfigWithProvenance } from "../../../src/backend/app/config/resolve.js";
import { hostConfigFacts } from "../../../src/domain/config/host-display.js";
import { initialProtectedStoreRecord } from "../../../src/domain/config/protected-settings.js";
import { createProtectedSettingsRuntimeReader } from "../../../src/server/settings-runtime.js";
import { buildSettingsEditor } from "../../../src/server/dashboard/queries/settings-editor.js";
import { StoredConfigSchema } from "../../../src/domain/config/snapshot-generations.js";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import { sha256Hex } from "../../../src/domain/sha256.js";
import { fixtureSettingsDocument } from "../../parity/helpers/fixture-settings.js";

function fixture() {
  const clock = manualClock(new Date("2026-09-13T12:00:00.000Z"));
  const environment = { HRAUTO_HOST_PRIMARY_DISPLAY: "1920x1080" };
  const record = initialSettingsFileRecord();
  const config = resolveConfigWithProvenance({}, hostConfigFacts(environment), clock);
  const snapshot = { record, runtimeStatus: { state: "current" as const, identity: settingsRuntimeIdentity(record, config.fingerprint) } };
  const deps = { settings: { read: () => snapshot }, protectedSettings: createProtectedSettingsRuntimeReader({ read: initialProtectedStoreRecord }), environment, clock };
  return { deps, snapshot };
}
describe("complete Settings catalog projection", () => {
  it("serves the canonical catalog plus exactly one server-selected annual date leaf", () => {
    const document = fixtureSettingsDocument();
    assert.deepEqual(document.catalog.map(row => row.key).sort(), SETTINGS_CATALOG.map(row => row.key).sort());
    const leaves = document.sections.flatMap(section => section.leaves);
    const expected = SETTINGS_CATALOG.filter(row => row.sourceClass === "ordinary-settings" && !row.key.startsWith("annualDates.")).map(row => row.key);
    assert.deepEqual(leaves.map(leaf => leaf.catalogKey).filter(key => !key.startsWith("annualDates.")).sort(), expected.sort());
    assert.deepEqual(leaves.filter(leaf => leaf.path.startsWith("annualDates.")).map(leaf => leaf.path), [`annualDates.FY${String(document.currentFiscalYear)}.jobEndDate`]);
    assert.deepEqual([...new Set(document.catalog.map(row => row.sourceClass))].sort(), ["derived-host", "ordinary-settings", "protected-store", "provider-env", "runtime-isolation"]);
    assert.equal(document.settingsSchemaHash, SETTINGS_SCHEMA_HASH);
    assert.equal(JSON.stringify(document).includes("currentSource"), false);
    assert.equal(JSON.stringify(document).includes("canary"), false);
  });
  it("keeps one ordinary read coherent with identity, observed host and an independent unavailable credential store", () => {
    const { deps, snapshot } = fixture(); let reads = 0;
    const document = buildSettingsEditor({ ...deps, settings: { read: () => { reads += 1; return snapshot; } }, protectedSettings: { read: () => { throw new Error("synthetic-secret-do-not-echo"); } } });
    assert.equal(reads, 1); assert.equal(document.protectedSettings.state, "unknown");
    assert.deepEqual(document.host.primaryDisplay, { screenWidth: 1920, screenHeight: 1080 });
    assert.equal(JSON.stringify(document).includes("synthetic-secret"), false);
    assert.throws(() => buildSettingsEditor({ ...deps, settings: { read: () => ({ ...snapshot, record: { ...snapshot.record, settings: { actor: { label: "changed without identity" } } } }) } }), /snapshot-mismatch/u);
  });
  it("shows production Routes from a historical active snapshot while keeping its exact identity", () => {
    const { deps, snapshot } = fixture();
    const current = resolveConfigWithProvenance({}, hostConfigFacts(deps.environment), deps.clock);
    const activeConfig = StoredConfigSchema.parse({ ...current.config,
      urls: { ...current.config.urls, crm: { ...current.config.urls.crm,
        test: { entry: "https://retired.example.test/hr" } } },
    });
    const historicalFingerprint = sha256Hex(canonicalJsonStringify(activeConfig));
    const document = buildSettingsEditor({ ...deps, settings: { read: () => ({
      ...snapshot, activeConfig, runtimeStatus: { state: "restart-required" as const,
        active: settingsRuntimeIdentity(snapshot.record, historicalFingerprint),
        persisted: settingsRuntimeIdentity(snapshot.record, current.fingerprint) },
    }) } });
    const crm = document.sections.find(section => section.id === "routes")?.leaves.find(leaf => leaf.path === "urls.crm.prod");
    assert.equal(document.activeConfigFingerprint, historicalFingerprint);
    assert.equal((crm?.activeValue as { entry?: string } | undefined)?.entry, current.config.urls.crm.prod.entry);
    assert.equal(JSON.stringify(document).includes("retired.example.test"), false);
  });
  it("projects provider values with their counts, missing or unknown", () => {
    const { deps } = fixture();
    const document = buildSettingsEditor({ ...deps, environment: { ...deps.environment, GEMINI_API_KEY: "provider-sentinel-one", GEMINI_API_KEY2: "provider-sentinel-two" } });
    assert.deepEqual(document.providers.geminiApiKeys, { state: "present", count: 2, values: ["provider-sentinel-one", "provider-sentinel-two"] });
    assert.deepEqual(document.providers.groqApiKeys, { state: "missing" });
    assert.match(JSON.stringify(document), /provider-sentinel-one|provider-sentinel-two/u);
    const env = new Proxy(deps.environment, { get: (target, key) => { if (key === "GEMINI_API_KEY") throw new Error("provider-sentinel"); return Reflect.get(target, key) as unknown; } });
    assert.deepEqual(buildSettingsEditor({ ...deps, environment: env }).providers.geminiApiKeys, { state: "unknown" });
  });
  for (const mutation of ["missing", "duplicate", "classification", "wrong-section", "wrong-type", "wrong-control", "wrong-current-year", "legacy-readback"] as const) {
    it(`rejects ${mutation} payloads`, () => {
      const document = fixtureSettingsDocument();
      const general = document.sections.find(section => section.id === "general");
      const label = general?.leaves.find(leaf => leaf.path === "actor.label");
      assert.ok(general && label);
      switch (mutation) {
        case "missing": general.leaves.splice(general.leaves.indexOf(label), 1); break;
        case "duplicate": general.leaves.push(label); break;
        case "classification": document.catalog[0].sourceClass = "ordinary-settings"; break;
        case "wrong-section": document.sections.find(section => section.id === "paths")?.leaves.push(general.leaves.shift()!); break;
        case "wrong-type": label.effectiveValue = 42; break;
        case "wrong-control": label.control = { input: "number", minimum: 0 }; break;
        case "wrong-current-year": {
          const annual = document.sections.flatMap(section => section.leaves).find(leaf => leaf.path.startsWith("annualDates."));
          assert.ok(annual); annual.path = "annualDates.FY2028.jobEndDate"; break;
        }
        case "legacy-readback": {
          assert.equal(document.protectedSettings.state, "available");
          if (document.protectedSettings.state !== "available") throw new Error("fixture unavailable");
          Reflect.set(document.protectedSettings.readback.entries, "personLookupCanaryEid", { present: false }); break;
        }
      }
      assert.equal(EditableSettingsWireSchema.safeParse(document).success, false);
    });
  }
  it("shows only the current fiscal year's required date and retains stored history without exposing it", () => {
    const document = fixtureSettingsDocument({ annualDates: { FY2027: { jobEndDate: "6/30/2027", kronosDefaultStartDate: "7/1/2026", kronosDefaultEndDate: "6/30/2027" } }, providers: { gemini: { models: ["first", "second"] } } }, 2);
    assert.equal(document.catalog.length, 77);
    assert.equal(document.sections.flatMap(section => section.leaves).length, 60);
    const model = document.sections.flatMap(section => section.leaves).find(leaf => leaf.path === "providers.gemini.models");
    assert.deepEqual(model?.settingsValue, ["first", "second"]);
    assert.equal(model?.defaultValue, undefined);
    assert.equal(document.currentFiscalYear, 2027);
    const annual = document.sections.flatMap(section => section.leaves).filter(leaf => leaf.path.startsWith("annualDates."));
    assert.deepEqual(annual.map(leaf => leaf.path), ["annualDates.FY2027.jobEndDate"]);
    assert.equal(annual[0]?.settingsValue, "6/30/2027");
    const absent = fixtureSettingsDocument({ annualDates: { FY2024: { jobEndDate: "6/30/2024" } } }, 2);
    assert.deepEqual(absent.sections.flatMap(section => section.leaves).filter(leaf => leaf.path.startsWith("annualDates.")).map(leaf => leaf.path), ["annualDates.FY2027.jobEndDate"]);
    assert.equal(absent.sections.flatMap(section => section.leaves).find(leaf => leaf.path.startsWith("annualDates."))?.validity, "unset");
  });
});
