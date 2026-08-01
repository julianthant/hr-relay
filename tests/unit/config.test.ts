import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { assertNotPast, requireAnnualDates } from "../../src/domain/config/fiscal-year.js";
import { resolveInstances, resolveSystemEntryUrl } from "../../src/domain/config/instance.js";
import { CONFIG_ENV_BINDINGS, resolveConfig, resolveConfigWithProvenance } from "../../src/domain/config/resolve.js";
import { ConfigSchema, SettingsOverrideSchema } from "../../src/domain/config/schema.js";

const CLOCK = manualClock(new Date("2026-08-10T12:00:00-07:00"));

describe("strict config resolution", () => {
  it("makes empty settings exactly equal schema defaults", () => {
    assert.deepEqual(resolveConfig({}, {}, CLOCK), ConfigSchema.parse({}));
    assert.equal(resolveConfig({}, {}, CLOCK).timeouts.ukgNavigationMs, 60_000);
    assert.equal(ConfigSchema.safeParse({ unexpected: true }).success, false);
    assert.equal(ConfigSchema.safeParse({ urls: { unexpected: true } }).success, false);
    assert.equal(SettingsOverrideSchema.safeParse({ urls: { ucpath: { test: { typo: "https://example.test" } } } }).success, false);
    assert.equal(SettingsOverrideSchema.safeParse({ actor: { id: "someone-else" } }).success, false);
    assert.equal(ConfigSchema.safeParse({ actor: { id: "someone-else", label: "Other" } }).success, false);
  });

  it("applies env over settings over defaults and records complete provenance", () => {
    const settings = {
      operator: { timekeeperName: "settings-name" },
      ocr: { secondOpinionMax: 7 },
      urls: { ucpath: { test: { smartHr: "https://settings-ucpath.example.test" } } },
    };
    const resolved = resolveConfigWithProvenance({
      TIMEKEEPER_NAME: "env-name",
      HRAUTO_UCPATH_TEST_URL: "https://env-ucpath.example.test",
      HRAUTO_UKG_NAVIGATION_MS: "75000",
    }, settings, CLOCK);
    assert.equal(resolved.config.operator.timekeeperName, "env-name");
    assert.equal(resolved.config.ocr.secondOpinionMax, 7);
    assert.equal(resolved.config.urls.ucpath.test?.smartHr, "https://env-ucpath.example.test");
    assert.equal(resolved.config.timeouts.ukgNavigationMs, 75_000);
    assert.equal(resolved.provenance["operator.timekeeperName"], "env");
    assert.equal(resolved.provenance["ocr.secondOpinionMax"], "settings");
    assert.equal(resolved.provenance["timeouts.ukgNavigationMs"], "env");
    assert.equal(resolved.provenance["timeouts.taskMs"], "default");
    assert.match(resolved.fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(Object.keys(resolved.provenance).length > 70, true);
  });

  it("rejects malformed env values and incomplete annual-date env groups", () => {
    assert.throws(() => resolveConfig({ OCR_PAGE_CONCURRENCY: "auto" }, {}, CLOCK));
    assert.throws(() => resolveConfig({ ANNUAL_DATES_END: "06/30/2027" }, {}, CLOCK), /incomplete/);
    const config = resolveConfig({
      ANNUAL_DATES_END: "06/30/2027",
      KRONOS_DEFAULT_END_DATE: "2/1/2027",
      KRONOS_DEFAULT_START_DATE: "1/1/2017",
    }, {}, CLOCK);
    assert.equal(config.annualDates.FY2027?.jobEndDate, "06/30/2027");
  });

  it("keeps the env map one-to-one", () => {
    const keys = CONFIG_ENV_BINDINGS.map(({ env }) => env);
    const paths = CONFIG_ENV_BINDINGS.map(({ path }) => path);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(new Set(paths).size, paths.length);
  });

  it("binds every declared environment path to a real schema leaf and provenance channel", () => {
    const env = Object.fromEntries(CONFIG_ENV_BINDINGS.map(({ env }) => [
      env,
      env.endsWith("_URL") ? "https://config.example.test"
        : env === "TIMEKEEPER_NAME" ? "Operator"
          : env === "ANNUAL_DATES_END" ? "06/30/2027"
            : env === "KRONOS_DEFAULT_END_DATE" ? "2/1/2027"
              : env === "KRONOS_DEFAULT_START_DATE" ? "1/1/2017"
                : env === "DEBUG_SCREENSHOTS" || env === "HR_AUTOMATION_DUO_WEBAUTHN" ? "1"
                  : env.includes("CONCURRENCY") || env.includes("RETRIES") ? "1" : "1000",
    ]));
    const resolved = resolveConfigWithProvenance(env, {}, CLOCK);
    for (const binding of CONFIG_ENV_BINDINGS) {
      assert.equal(resolved.provenance[binding.path.replace("*", "FY2027")], "env", binding.path);
    }
  });
});

describe("instance and fiscal safety", () => {
  it("defaults declared systems to production and refuses absent/equal test endpoints", () => {
    const config = resolveConfig({}, {}, CLOCK);
    assert.deepEqual(resolveInstances(config, ["ucpath", "crm"], undefined, "run-1"), { ucpath: "prod", crm: "prod" });
    assert.throws(() => resolveInstances(config, ["ucpath"], { crm: "test" }, "run-1"), /undeclared systems/);
    assert.throws(() => resolveSystemEntryUrl(config, "ucpath", "test", "run-1"), /no distinct test URL/);

    const withDistinct = resolveConfig({}, {
      urls: { ucpath: { test: { smartHr: "https://ucpath-test.example.test" } } },
    }, CLOCK);
    assert.equal(resolveSystemEntryUrl(withDistinct, "ucpath", "test", "run-1"), "https://ucpath-test.example.test");
    const withEqual = resolveConfig({}, {
      urls: { ucpath: { test: { smartHr: config.urls.ucpath.prod.smartHr } } },
    }, CLOCK);
    assert.throws(() => resolveSystemEntryUrl(withEqual, "ucpath", "test", "run-1"), /no distinct test URL/);
  });

  it("fails on missing and stale current-fiscal-year values", () => {
    const defaults = resolveConfig({}, {}, CLOCK);
    assert.throws(() => requireAnnualDates(defaults, CLOCK), /FY2027/);
    const stale = resolveConfig({}, {
      annualDates: { FY2027: {
        jobEndDate: "06/30/2026",
        kronosDefaultEndDate: "2/1/2027",
        kronosDefaultStartDate: "1/1/2017",
      } },
    }, CLOCK);
    assert.throws(() => requireAnnualDates(stale, CLOCK), /stale/);
    assert.throws(() => assertNotPast("02/30/2027", "badDate", CLOCK), /valid calendar date/);
  });
});
