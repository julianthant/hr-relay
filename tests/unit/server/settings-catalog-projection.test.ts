import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { SETTINGS_CATALOG } from "../../../src/domain/config/catalog.js";
import { EditableSettingsWireSchema } from "../../../src/domain/dashboard/settings-editor.js";
import { SETTINGS_SCHEMA_HASH, initialSettingsFileRecord, settingsRuntimeIdentity } from "../../../src/domain/config/settings.js";
import { manualClock } from "../../../src/domain/clock.js";
import { resolveConfigWithProvenance } from "../../../src/domain/config/resolve.js";
import { hostConfigFacts } from "../../../src/domain/config/host-display.js";
import { initialProtectedStoreRecord } from "../../../src/domain/config/protected-settings.js";
import { createProtectedSettingsRuntimeReader } from "../../../src/server/settings-runtime.js";
import { buildSettingsEditor } from "../../../src/server/dashboard/queries/settings-editor.js";
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
  it("serves exactly the 86 canonical rows in both directions, including three templates and all five source classes", () => {
    const document = fixtureSettingsDocument();
    assert.deepEqual(document.catalog.map(row => row.key).sort(), SETTINGS_CATALOG.map(row => row.key).sort());
    assert.deepEqual(document.sections.flatMap(section => section.leaves.map(leaf => leaf.catalogKey)).concat(document.fiscalYearTemplate.leaves.map(leaf => leaf.catalogKey)).sort(), SETTINGS_CATALOG.filter(row => row.sourceClass === "ordinary-settings").map(row => row.key).sort());
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
  it("projects only provider counts, missing or unknown, never values or cell names", () => {
    const { deps } = fixture();
    const document = buildSettingsEditor({ ...deps, environment: { ...deps.environment, GEMINI_API_KEY: "provider-sentinel-one", GEMINI_API_KEY2: "provider-sentinel-two" } });
    assert.deepEqual(document.providers.geminiApiKeys, { state: "present", count: 2 });
    assert.deepEqual(document.providers.groqApiKeys, { state: "missing" });
    assert.doesNotMatch(JSON.stringify(document), /provider-sentinel|GEMINI_API_KEY/u);
    const env = new Proxy(deps.environment, { get: (target, key) => { if (key === "GEMINI_API_KEY") throw new Error("provider-sentinel"); return Reflect.get(target, key) as unknown; } });
    assert.deepEqual(buildSettingsEditor({ ...deps, environment: env }).providers.geminiApiKeys, { state: "unknown" });
  });
  for (const mutation of ["missing", "duplicate", "classification", "wrong-section", "wrong-type", "wrong-control", "template", "legacy-readback"] as const) {
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
        case "template": document.fiscalYearTemplate.leaves[0].path = "annualDates.*.missing"; break;
        case "legacy-readback": {
          assert.equal(document.protectedSettings.state, "available");
          if (document.protectedSettings.state !== "available") throw new Error("fixture unavailable");
          Reflect.set(document.protectedSettings.readback.entries, "personLookupCanaryEid", { present: false }); break;
        }
      }
      assert.equal(EditableSettingsWireSchema.safeParse(document).success, false);
    });
  }
  it("retains optional/unset rows and expands fiscal years without redefining catalog membership", () => {
    const document = fixtureSettingsDocument({ annualDates: { FY2027: { jobEndDate: "6/30/2027", kronosDefaultStartDate: "7/1/2026", kronosDefaultEndDate: "6/30/2027" } }, providers: { gemini: { models: ["first", "second"] } } }, 2);
    assert.equal(document.catalog.length, 86);
    assert.equal(document.sections.flatMap(section => section.leaves).length, 59);
    const model = document.sections.flatMap(section => section.leaves).find(leaf => leaf.path === "providers.gemini.models");
    assert.deepEqual(model?.settingsValue, ["first", "second"]);
    assert.equal(model?.defaultValue, undefined);
  });
});
