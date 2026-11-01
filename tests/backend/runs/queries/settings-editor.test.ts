import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { buildSettingsEditor } from "../../../../src/backend/runs/queries/settings-editor.js";
import { createProtectedSettingsRuntimeReader } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { initialProtectedStoreRecord } from "../../../../src/models/config/protected-settings.js";
import { initialSettingsFileRecord,settingsRuntimeIdentity } from "../../../../src/models/config/settings.js";
import { StoredConfigSchema } from "../../../../src/models/config/snapshot.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { fixtureSettingsDocument } from "../../../support/fixtures/dashboard/fixture-settings.js";

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
  it("keeps one ordinary read coherent with identity, observed host and an independent unavailable credential store", () => {
    const { deps, snapshot } = fixture(); let reads = 0;
    const document = buildSettingsEditor({ ...deps, settings: { read: () => { reads += 1; return snapshot; } }, protectedSettings: { read: () => { throw new Error("synthetic-secret-do-not-echo"); } } });
    assert.equal(reads, 1); assert.equal(document.protectedSettings.state, "unknown");
    assert.deepEqual(document.host.primaryDisplay, { screenWidth: 1920, screenHeight: 1080 });
    assert.equal(JSON.stringify(document).includes("synthetic-secret"), false);
    assert.throws(() => buildSettingsEditor({ ...deps, settings: { read: () => ({ ...snapshot, record: { ...snapshot.record, settings: { actor: { label: "changed without identity" } } } }) } }), /snapshot-mismatch/u);
  });
  it("shows production Routes from a retained active snapshot while keeping its exact identity", () => {
    const { deps, snapshot } = fixture();
    const current = resolveConfigWithProvenance({}, hostConfigFacts(deps.environment), deps.clock);
    const activeConfig = StoredConfigSchema.parse({ ...current.config,
      urls: { ...current.config.urls, crm: { ...current.config.urls.crm, prod: { ...current.config.urls.crm.prod, entry: "https://current.example.test/hr" } } },
    });
    const activeFingerprint = sha256Hex(canonicalJsonStringify(activeConfig));
    const document = buildSettingsEditor({ ...deps, settings: { read: () => ({
      ...snapshot, activeConfig, runtimeStatus: { state: "restart-required" as const,
        active: settingsRuntimeIdentity(snapshot.record, activeFingerprint),
        persisted: settingsRuntimeIdentity(snapshot.record, current.fingerprint) },
    }) } });
    const crm = document.sections.find(section => section.id === "routes")?.leaves.find(leaf => leaf.path === "urls.crm.prod");
    assert.equal(document.activeConfigFingerprint, activeFingerprint);
    assert.equal((crm?.activeValue as { entry?: string } | undefined)?.entry, activeConfig.urls.crm.prod.entry);
  });
  it("shows only the current fiscal year's required date and retains stored history without exposing it", () => {
    const document = fixtureSettingsDocument({ annualDates: { FY2027: { jobEndDate: "6/30/2027", kronosDefaultStartDate: "7/1/2026", kronosDefaultEndDate: "6/30/2027" } } }, 2);
    assert.equal(document.catalog.length, 64);
    const leaves = document.sections.flatMap(section => section.leaves);
    assert.equal(leaves.length, 52);
    assert.equal(leaves.some(leaf => leaf.path === "paths.duoCredential"), false);
    assert.equal(document.currentFiscalYear, 2027);
    const annual = document.sections.flatMap(section => section.leaves).filter(leaf => leaf.path.startsWith("annualDates."));
    assert.deepEqual(annual.map(leaf => leaf.path), ["annualDates.FY2027.jobEndDate"]);
    assert.equal(annual[0]?.settingsValue, "6/30/2027");
    const absent = fixtureSettingsDocument({ annualDates: { FY2024: { jobEndDate: "6/30/2024" } } }, 2);
    assert.deepEqual(absent.sections.flatMap(section => section.leaves).filter(leaf => leaf.path.startsWith("annualDates.")).map(leaf => leaf.path), ["annualDates.FY2027.jobEndDate"]);
    assert.equal(absent.sections.flatMap(section => section.leaves).find(leaf => leaf.path.startsWith("annualDates."))?.validity, "unset");
  });
});
