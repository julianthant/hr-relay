import assert from "node:assert/strict";
import { describe,it,vi } from "vitest";
import { ConfigProvenanceSchema,configLeafPaths,resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { defaultRuntimePaths } from "../../../../src/backend/app/config/runtime-paths.js";
import { MIGRATED_SETTINGS_ENVIRONMENT_KEYS } from "../../../../src/models/config/catalog.js";
import { assertNotPast,requireAnnualDates } from "../../../../src/models/config/fiscal-year.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { resolveInstances,resolveSystemEntryUrl } from "../../../../src/models/config/instance.js";
import { ConfigSchema,SettingsOverrideSchema } from "../../../../src/models/config/schema.js";
import { SettingsPatchSchema,derivePersistedSettingsFingerprint,mergeSettingsPatch } from "../../../../src/models/config/settings.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
const CLOCK = manualClock(new Date("2026-08-10T12:00:00-07:00"));
describe("strict config resolution", () => {
  it("makes empty settings exactly equal schema defaults", () => {
    assert.deepEqual(resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK).config, ConfigSchema.parse({ paths: defaultRuntimePaths() }));
    assert.equal(resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK).config.timeouts.ukgNavigationMs, 60_000);
    assert.equal(ConfigSchema.safeParse({ unexpected: true }).success, false);
    assert.equal(ConfigSchema.safeParse({ urls: { unexpected: true } }).success, false);
    assert.equal(SettingsOverrideSchema.safeParse({ urls: { ucpath: { test: { typo: "https://example.test" } } } }).success, false);
    assert.equal(SettingsOverrideSchema.safeParse({ actor: { id: "someone-else" } }).success, false);
    assert.equal(ConfigSchema.safeParse({ actor: { id: "someone-else", label: "Other" } }).success, false);
  });

  it("resolves an admitted storage pair without changing ordinary settings or an older snapshot", () => {
    const settings = { paths: { browserProfileRoot: "/tmp/profile" }, browser: { headless: false } };
    const ordinaryFingerprint = derivePersistedSettingsFingerprint(settings);
    const oldSnapshot = resolveConfigWithProvenance(settings, hostConfigFacts({}), CLOCK);
    const oldConfig = structuredClone(oldSnapshot.config);
    const pair = { stateRoot: "/tmp/relocated-state", artifactRoot: "/tmp/relocated-state/artifacts" };
    const moved = resolveConfigWithProvenance(settings, hostConfigFacts({}), CLOCK, pair);

    assert.equal(moved.config.paths.stateRoot, pair.stateRoot);
    assert.equal(moved.config.paths.artifactRoot, pair.artifactRoot);
    assert.equal(moved.config.paths.browserProfileRoot, "/tmp/profile");
    assert.equal(moved.provenance["paths.stateRoot"], "default");
    assert.equal(moved.provenance["paths.artifactRoot"], "default");
    assert.equal(moved.provenance["paths.browserProfileRoot"], "settings");
    assert.deepEqual(Object.keys(moved.provenance).sort(), [...configLeafPaths(moved.config)].sort());
    assert.notEqual(moved.fingerprint, oldSnapshot.fingerprint);
    assert.deepEqual(oldSnapshot.config, oldConfig);
    assert.equal(derivePersistedSettingsFingerprint(settings), ordinaryFingerprint);
    assert.deepEqual(resolveConfigWithProvenance(settings, hostConfigFacts({}), CLOCK), oldSnapshot);
    assert.deepEqual(resolveConfigWithProvenance(settings, hostConfigFacts({}), CLOCK, pair), moved);
  });

  it("refuses noncanonical or overlapping admitted storage pairs", () => {
    const valid = { stateRoot: "/tmp/state", artifactRoot: "/tmp/state/artifacts" };
    for (const pair of [
      { ...valid, stateRoot: "relative/state" },
      { ...valid, stateRoot: "/tmp/state/../state" },
      { ...valid, artifactRoot: "/tmp//state/artifacts" },
      { ...valid, artifactRoot: "/tmp/state" },
      { ...valid, artifactRoot: "/tmp" },
      { ...valid, extra: "unexpected" },
    ]) {
      assert.throws(() => resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK, pair), (error) => error instanceof Error, JSON.stringify(pair));
    }
    assert.equal(resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK, valid).config.paths.artifactRoot,
      valid.artifactRoot);
  });

  it("accepts complete production route edits and rejects retired test routes", () => {
    const defaults = resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK).config;
    const crm = { ...defaults.urls.crm.prod, entry: "https://crm.example.test/hr" };
    const patch = { "urls.crm.prod": { set: crm } };
    assert.equal(SettingsPatchSchema.safeParse(patch).success, true);
    const saved = mergeSettingsPatch({}, patch);
    assert.equal(resolveConfigWithProvenance(saved, hostConfigFacts({}), CLOCK).config.urls.crm.prod.entry, crm.entry);
    assert.equal(SettingsPatchSchema.safeParse({ "urls.crm.prod": { set: { entry: crm.entry } } }).success, false);
    assert.equal(SettingsPatchSchema.safeParse({ "urls.crm.test": { set: { entry: crm.entry } } }).success, true);
    assert.throws(() => mergeSettingsPatch({}, { "urls.crm.test": { set: { entry: crm.entry } } }), /retired test routes/u);
  });

  it("applies settings over defaults with complete value-free provenance", () => {
    const settings = {
      ocr: { secondOpinionMax: 7 },
      timeouts: { ukgNavigationMs: 75_000 },
      urls: { ucpath: { prod: { login: "https://login.example.test", smartHr: "https://settings-ucpath.example.test", jobSummary: "https://jobs.example.test", personalData: "https://personal.example.test", personProfile: "https://profile.example.test" } } },
    };
    const resolved = resolveConfigWithProvenance(settings, hostConfigFacts({}), CLOCK);
    assert.equal(resolved.config.ocr.secondOpinionMax, 7);
    assert.equal(resolved.config.urls.ucpath.prod.smartHr, "https://settings-ucpath.example.test");
    assert.equal(resolved.config.timeouts.ukgNavigationMs, 75_000);
    assert.equal(resolved.provenance["ocr.secondOpinionMax"], "settings");
    assert.equal(resolved.provenance["timeouts.ukgNavigationMs"], "settings");
    assert.equal(resolved.provenance["timeouts.taskMs"], "default");
    assert.equal(Object.hasOwn(resolved.config, "operator"), false);
    assert.deepEqual(Object.keys(resolved.provenance).sort(), [...configLeafPaths(resolved.config)].sort());
    assert.equal(Object.values(resolved.provenance).every((source) => source === "settings" || source === "default"), true);
    assert.match(resolved.fingerprint, /^[0-9a-f]{64}$/u);
  });

  it("applies the browser settings group instead of accepting and dropping it", () => {
    const resolved = resolveConfigWithProvenance({
      browser: { headless: false, closeProofMs: 25_000 },
    }, hostConfigFacts({}), CLOCK);

    assert.deepEqual(resolved.config.browser, { headless: false, closeProofMs: 25_000 });
    assert.equal(resolved.provenance["browser.headless"], "settings");
    assert.equal(resolved.provenance["browser.closeProofMs"], "settings");
  });

  it("rejects malformed ordinary values, missing job-end dates and half-display overrides", () => {
    assert.throws(() => resolveConfigWithProvenance({ ocr: { pageConcurrency: "auto" } }, hostConfigFacts({}), CLOCK));
    const jobEndOnly = resolveConfigWithProvenance({ annualDates: { FY2027: { jobEndDate: "06/30/2027" } } }, hostConfigFacts({}), CLOCK).config;
    assert.equal(jobEndOnly.annualDates.FY2027?.jobEndDate, "06/30/2027");
    assert.equal(jobEndOnly.annualDates.FY2027?.kronosDefaultStartDate, undefined);
    assert.equal(jobEndOnly.annualDates.FY2027?.kronosDefaultEndDate, undefined);
    assert.throws(() => resolveConfigWithProvenance({ annualDates: { FY2027: { kronosDefaultEndDate: "06/30/2027" } } }, hostConfigFacts({}), CLOCK));
    assert.throws(() => resolveConfigWithProvenance({ display: { screenWidth: 1920 } }, hostConfigFacts({}), CLOCK));
    assert.throws(() => resolveConfigWithProvenance({ display: { screenHeight: 1080 } }, hostConfigFacts({}), CLOCK));
    const config = resolveConfigWithProvenance({ annualDates: { FY2027: {
      jobEndDate: "06/30/2027", kronosDefaultEndDate: "2/1/2027", kronosDefaultStartDate: "1/1/2017",
    } } }, hostConfigFacts({}), CLOCK).config;
    assert.equal(config.annualDates.FY2027?.jobEndDate, "06/30/2027");
  });

  it("refuses restored environment provenance in resolved settings", () => {
    assert.equal(ConfigProvenanceSchema.safeParse("env").success, false);
    assert.deepEqual(ConfigProvenanceSchema.options, ["settings", "default"]);
  });

  it("ignores every migrated process environment key and rejects the old resolver signature", () => {
    const settings = { concurrency: { defaultWorkers: 2 } };
    const facts = hostConfigFacts({});
    const before = resolveConfigWithProvenance(settings, facts, CLOCK);
    assert.equal(MIGRATED_SETTINGS_ENVIRONMENT_KEYS.length, 40);
    try {
      for (const key of MIGRATED_SETTINGS_ENVIRONMENT_KEYS) vi.stubEnv(key, "hostile-migrated-value");
      assert.deepEqual(resolveConfigWithProvenance(settings, facts, CLOCK), before);
      assert.throws(() => {
        // @ts-expect-error A4: an environment object is no longer the resolver's second input.
        resolveConfigWithProvenance({}, {}, CLOCK);
      }, /primaryDisplay/u);
    } finally {
      vi.unstubAllEnvs();
    }
  });

});

describe("instance and fiscal safety", () => {
  it("defaults declared systems to production and refuses retired test targets", () => {
    const config = resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK).config;
    assert.deepEqual(resolveInstances(config, ["ucpath", "crm"], undefined, "run-1"), { ucpath: "prod", crm: "prod" });
    assert.throws(() => resolveInstances(config, ["ucpath"], { ucpath: "test" }, "run-1"), /retired test instance/u);
    assert.throws(() => resolveSystemEntryUrl(config, "ucpath", "test", "run-1"), /retired test instance/u);
    assert.equal(resolveSystemEntryUrl(config, "ucpath", "prod", "run-1"), config.urls.ucpath.prod.smartHr);
  });

  it("fails on missing and stale current-fiscal-year values", () => {
    const defaults = resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK).config;
    assert.throws(() => requireAnnualDates(defaults, CLOCK), /FY2027/);
    const jobEndOnly = resolveConfigWithProvenance({
      annualDates: { FY2027: { jobEndDate: "06/30/2027" } },
    }, hostConfigFacts({}), CLOCK).config;
    assert.deepEqual(requireAnnualDates(jobEndOnly, CLOCK), { jobEndDate: "06/30/2027" });
    const stale = resolveConfigWithProvenance({
      annualDates: { FY2027: {
        jobEndDate: "06/30/2026",
        kronosDefaultEndDate: "2/1/2027",
        kronosDefaultStartDate: "1/1/2017",
      } },
    }, hostConfigFacts({}), CLOCK).config;
    assert.throws(() => requireAnnualDates(stale, CLOCK), /stale/);
    assert.throws(() => assertNotPast("02/30/2027", "badDate", CLOCK), /valid calendar date/);
  });
});
