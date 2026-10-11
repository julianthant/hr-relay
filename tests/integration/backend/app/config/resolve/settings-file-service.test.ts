import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { hostConfigFacts } from "../../../../../../src/models/config/host-display.js";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { resolveConfigWithProvenance } from "../../../../../../src/backend/app/config/resolve.js";
import { createSettingsApplicationExecutor } from "../../../../../../src/backend/runs/commands/settings-service.js";
import { executeSettingsCommand } from "../../../../../../src/backend/runs/commands/command-kernel.js";
import { readSettings } from "../../../../../../src/backend/runtime/settings/settings-runtime.js";
import { AuthorityDatabase, createCredentialStore } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../../../src/models/config/settings.js";
import { PROTECTED_SETTINGS_SET_MARKER, markProtectedSettingsPatch } from "../../../../../../src/models/config/protected-settings.js";
import { canonicalJsonStringify } from "../../../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../../../src/rules/validation/sha256.js";
import { seedInitialSettingsRuntimeConfig } from "../../../../../support/fixtures/operator-command-fixtures.js";
import { settingsSetOperations } from "../../../../../support/fixtures/settings-operation-fixtures.js";
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "native-settings-domain-"));
  const clock = manualClock(new Date("2026-08-30T12:00:00.000Z"));
  const database = AuthorityDatabase.open({ path: join(root, "state.db"), busyTimeoutMs: 250, migrationOwner: "settings-domain-test" }, clock);
  cleanups.push(() => { database.close(); rmSync(root, { recursive: true, force: true }); });
  seedInitialSettingsRuntimeConfig(database, clock);
  const store = createCredentialStore({ stateRoot: root });
  const settings = createSettingsApplicationExecutor(value => resolveConfigWithProvenance(value, hostConfigFacts({}), clock), store);
  return { database, read: () => readSettings(database.authority), execute: (request: unknown) => executeSettingsCommand({ authority: database, clock, ids: { uuid: randomUUID }, settings }, request) };
}
function apply(service: ReturnType<typeof fixture>, expectedRevision: number, value: unknown) {
  const patch = settingsSetOperations(value);
  return service.execute({ commandId: randomUUID(), requestedAt: "2026-08-30T12:00:00.000Z", requestedBy: "local-operator", source: "settings-surface", family: "settings", type: "apply-settings",
    target: { expectedRevision }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
}
describe("native settings domain invariants", () => {
  it("accepts a job-end-date-only annual entry over the baseline", () => {
    const service = fixture();

    assert.equal(apply(service, 1, { annualDates: { FY2027: { jobEndDate: "06/30/2027" } } }).state, "applied");
    assert.deepEqual(service.read().settings, { annualDates: { FY2027: { jobEndDate: "06/30/2027" } } });
    assert.equal(service.read().revision, 2);
  });

  it("preserves untouched catalog leaves while replacing one catalog leaf", () => {
    const service = fixture();
    const crmDefaults = resolveConfigWithProvenance(
      {}, hostConfigFacts({}), manualClock(new Date("2026-08-30T12:00:00.000Z")),
    ).config.urls.crm.prod;
    const firstRoutes = { ...crmDefaults, ucPathEntrySheet: "https://crm.example.test" };
    assert.equal(apply(service, 1, {
      browser: { headless: false },
      urls: { crm: { prod: firstRoutes } },
    }).state, "applied");

    const second = apply(service, 2, {
      browser: { closeProofMs: 25_000 },
      urls: { crm: { prod: { ...firstRoutes, onboardingSearch: "https://crm-search.example.test" } } },
    });

    assert.equal(second.state, "applied");
    assert.deepEqual(service.read().settings, {
      browser: { headless: false, closeProofMs: 25_000 },
      urls: { crm: { prod: { ...firstRoutes, onboardingSearch: "https://crm-search.example.test" } } },
    });
    assert.equal(service.read().revision, 3);
  });

  it("sets one annual-date leaf after the fiscal year is complete", () => {
    const service = fixture();
    assert.equal(apply(service, 1, { annualDates: { FY2027: {
      jobEndDate: "06/30/2027",
      kronosDefaultEndDate: "06/29/2027",
      kronosDefaultStartDate: "07/01/2026",
    } } }).state, "applied");

    const changed = apply(service, 2, {
      "annualDates.FY2027.jobEndDate": { set: "06/28/2027" },
    });

    assert.equal(changed.state, "applied");
    assert.deepEqual(service.read().settings.annualDates?.FY2027, {
      jobEndDate: "06/28/2027",
      kronosDefaultEndDate: "06/29/2027",
      kronosDefaultStartDate: "07/01/2026",
    });
  });

  it("preserves historical fiscal-year entries when setting the current job-end date alone", () => {
    const service = fixture();
    const historical = {
      jobEndDate: "06/30/2024",
      kronosDefaultEndDate: "06/29/2024",
      kronosDefaultStartDate: "07/01/2023",
    };
    assert.equal(apply(service, 1, { annualDates: { FY2024: historical } }).state, "applied");
    assert.equal(apply(service, 2, { annualDates: { FY2027: { jobEndDate: "06/30/2027" } } }).state, "applied");
    assert.deepEqual(service.read().settings.annualDates, {
      FY2024: historical,
      FY2027: { jobEndDate: "06/30/2027" },
    });
  });

  it("canonicalizes every protected set to the one journal marker", () => {
    const firstValue = "first-synthetic-value";
    const secondValue = "second-distinct-value";
    const first = markProtectedSettingsPatch({
      ucpathPassword: { set: firstValue },
      timekeeperName: { clear: true },
    });
    const second = markProtectedSettingsPatch({
      ucpathPassword: { set: secondValue },
      timekeeperName: { clear: true },
    });

    assert.deepEqual(first, second);
    assert.deepEqual(first, {
      ucpathPassword: { set: PROTECTED_SETTINGS_SET_MARKER },
      timekeeperName: { clear: true },
    });
    const journalBytes = canonicalJsonStringify(first);
    assert.equal(journalBytes.includes(firstValue), false);
    assert.equal(journalBytes.includes(secondValue), false);
    assert.equal(journalBytes.includes(sha256Hex(firstValue)), false);
  });

  it("refuses invalid and incomplete annual dates without changing native authority", () => {
    const service = fixture();
    assert.equal(apply(service, 1, { annualDates: { FY2027: { jobEndDate: "06/30/2027", kronosDefaultEndDate: "06/29/2027", kronosDefaultStartDate: "07/01/2026" } } }).state, "applied");
    const before = service.read(); const generation = service.database.getMeta().authorityGeneration;
    assert.throws(() => apply(service, 2, { "annualDates.FY2027.jobEndDate": { set: "not-a-date" } }), /invalid value/u);
    assert.equal(apply(service, 2, { "annualDates.FY2027.jobEndDate": { clear: true } }).state, "rejected");
    assert.deepEqual(service.read(), before); assert.equal(service.database.getMeta().authorityGeneration, generation);
  });
  it("refuses a stale revision without changing native authority", () => {
    const service = fixture(); assert.equal(apply(service, 1, { browser: { headless: false } }).state, "applied");
    const before = service.read(); const generation = service.database.getMeta().authorityGeneration;
    const stale = apply(service, 1, { concurrency: { defaultWorkers: 3 } });
    assert.equal(stale.state, "conflict"); if (stale.state === "conflict") assert.equal(stale.currentVersion, 2);
    assert.deepEqual(service.read(), before); assert.equal(service.database.getMeta().authorityGeneration, generation);
  });
});
