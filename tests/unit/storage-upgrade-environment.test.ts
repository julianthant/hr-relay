import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { MIGRATED_SETTINGS_ENVIRONMENT_KEYS } from "../../src/domain/config/catalog.js";
import { createCredentialStore } from "../../src/infra/config/credential-store.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/authority-database.js";
import { readSettings } from "../../src/server/settings-runtime.js";
import { upgradeStorage } from "../../src/server/storage/upgrade.js";
const clock = manualClock(new Date("2026-09-06T12:00:00.000Z"));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const bindings = {
  HRAUTO_KUALI_TEST_URL: "https://fixture.invalid/kuali", HRAUTO_NEW_KRONOS_TEST_URL: "https://fixture.invalid/new-kronos",
  HRAUTO_CRM_TEST_URL: "https://fixture.invalid/crm", HRAUTO_ONBASE_TEST_URL: "https://fixture.invalid/onbase",
  HRAUTO_UCPATH_TEST_URL: "https://fixture.invalid/ucpath", HRAUTO_I9_TEST_URL: "https://fixture.invalid/i9",
  HRAUTO_OLD_KRONOS_TEST_URL: "https://fixture.invalid/old-kronos", HRAUTO_SERVICENOW_TEST_URL: "https://fixture.invalid/servicenow",
  HRAUTO_SHAREPOINT_TEST_URL: "https://fixture.invalid/sharepoint", HRAUTO_UKG_NAVIGATION_MS: "7000",
  ANNUAL_DATES_END: "06/30/2027", KRONOS_DEFAULT_END_DATE: "06/30/2027", KRONOS_DEFAULT_START_DATE: "07/01/2026",
  HRAUTO_NAVIGATION_RETRIES: "7", HRAUTO_SEPARATION_TERMINATION_WINDOW_DAYS: "7", OCR_SECOND_OPINION_MAX: "7",
  OCR_PAGE_MAX_WAIT_MS: "7000", OCR_TIER1_PATIENCE_MS: "7000", OCR_PAGE_CONCURRENCY: "7", OCR_DISAMBIG_CONCURRENCY: "7",
  OCR_SUGGEST_CONCURRENCY: "7", OCR_BACKOFF_BASE_MS: "7000", OCR_BACKOFF_CAP_MS: "7000", OCR_MAX_VALIDATION_RETRIES: "7",
  HRAUTO_HEALTH_MONITOR_TICK_MS: "7000", HRAUTO_HEALTH_MONITOR_MAX_REFRESH: "7", HRAUTO_HEALTH_MONITOR_MAX_REOPEN: "7",
  HRAUTO_DEFAULT_WORKERS: "7", HRAUTO_DAEMON_IDLE_MS: "7000", HRAUTO_DAEMON_IDLE_REPOLL_MS: "7000",
  DEBUG_SCREENSHOTS: "true", HR_AUTOMATION_DUO_WEBAUTHN: "0", OCR_GEMINI_MODELS: "fixture-model", OCR_GROQ_MODELS: "fixture-model",
  OCR_MISTRAL_MODELS: "fixture-model", OCR_OPENROUTER_MODELS: "fixture-model", OCR_SAMBANOVA_MODELS: "fixture-model",
  OCR_GEMINI_MODEL: "retired-model", OCR_GROQ_MODEL: "retired-model", OCR_MISTRAL_MODEL: "retired-model", OCR_OPENROUTER_MODEL: "retired-model", OCR_SAMBANOVA_MODEL: "retired-model",
  UCPATH_USER_ID: "synthetic-user", UCPATH_PASSWORD: "synthetic-private-password", TIMEKEEPER_NAME: "Synthetic Keeper",
  ONBOARDING_ROSTER_URL: "https://fixture.invalid/private-roster", HRAUTO_ACTIVITY_PERSON_PSEUDONYM_HMAC_KEY: "ab".repeat(32),
  HRAUTO_ACTIVITY_PERSON_PSEUDONYM_KEY_GENERATION: "activity-person-fixture",
};
// D341: the two test-target canary keys are retired from the env import; a stale `.env` still naming one is refused by name (proved below).
const RETIRED_TEST_TARGET_ENV = {
  HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER: "12345678", HRAUTO_TEST_SUBJECT_PERSON_LOOKUP_CANARY_EID: "10123456",
};
function fixture(body: string) {
  const root = mkdtempSync(join(tmpdir(), "upgrade-env-")); roots.push(root);
  const environmentFile = join(root, ".env"); writeFileSync(environmentFile, body, { mode: 0o600 });
  return { root, environmentFile, input: { stateRoot: root, processLockRoot: join(root, "locks"), environmentFile, plan: false } };
}
describe("D336 total migration environment admission", () => {
  it("imports every declared input, names every cleanup key, and excludes retired/provider values", async () => {
    assert.deepEqual([...Object.keys(bindings), ...Object.keys(RETIRED_TEST_TARGET_ENV)].sort(), [...MIGRATED_SETTINGS_ENVIRONMENT_KEYS]);
    const retired = { I9_USER_ID: "synthetic-retired-id", I9_PASSWORD: "synthetic-retired-password", TELEGRAM_BOT_TOKEN: "synthetic-retired-token", TELEGRAM_CHAT_ID: "synthetic-retired-chat" };
    const body = Object.entries({ ...bindings, ...retired, GEMINI_API_KEY: "synthetic-provider-never-imported" }).map(([key, value]) => `${key}=${value}`).join("\n") + "\n";
    const f = fixture(body); const before = readdirSync(f.root);
    const plan = await upgradeStorage({ ...f.input, plan: true }, clock);
    assert.deepEqual(plan.envKeysToRemove, [...Object.keys(bindings), ...Object.keys(retired)].sort());
    assert.equal(plan.importedKeys.length, 42); assert.deepEqual(readdirSync(f.root), before);
    const applied = await upgradeStorage(f.input, clock); assert.deepEqual(applied.importedKeys, plan.importedKeys);
    const database = AuthorityDatabase.open({ path: join(f.root, "state.db"), busyTimeoutMs: 500, migrationOwner: "all-env-proof" }, clock);
    try {
      assert.deepEqual(readSettings(database.authority).settings, {
        urls: { kuali: { test: { entry: bindings.HRAUTO_KUALI_TEST_URL } }, newKronos: { test: { entry: bindings.HRAUTO_NEW_KRONOS_TEST_URL } },
          crm: { test: { entry: bindings.HRAUTO_CRM_TEST_URL } }, onbase: { test: { entry: bindings.HRAUTO_ONBASE_TEST_URL } },
          ucpath: { test: { smartHr: bindings.HRAUTO_UCPATH_TEST_URL } }, i9: { test: { entry: bindings.HRAUTO_I9_TEST_URL } },
          oldKronos: { test: { entry: bindings.HRAUTO_OLD_KRONOS_TEST_URL } }, servicenow: { test: { entry: bindings.HRAUTO_SERVICENOW_TEST_URL } }, sharepoint: { test: { entry: bindings.HRAUTO_SHAREPOINT_TEST_URL } } },
        timeouts: { ukgNavigationMs: 7000 }, annualDates: { FY2027: { jobEndDate: "06/30/2027", kronosDefaultEndDate: "06/30/2027", kronosDefaultStartDate: "07/01/2026" } },
        performance: { navigationRetries: 7, separationTerminationWindowDays: 7 }, ocr: { secondOpinionMax: 7, pageMaxWaitMs: 7000, tier1PatienceMs: 7000,
          pageConcurrency: 7, disambigConcurrency: 7, suggestConcurrency: 7, backoffBaseMs: 7000, backoffCapMs: 7000, maxValidationRetries: 7 },
        browserHealth: { monitorTickMs: 7000, maxAutoRefresh: 7, maxReopen: 7 }, concurrency: { defaultWorkers: 7 }, daemon: { idleMs: 7000, idleRepollMs: 7000 },
        features: { debugScreenshots: true, duoWebAuthn: false }, providers: { gemini: { models: ["fixture-model"] }, groq: { models: ["fixture-model"] }, mistral: { models: ["fixture-model"] }, openRouter: { models: ["fixture-model"] }, sambanova: { models: ["fixture-model"] } },
      });
    } finally { database.close(); }
    const credentials = createCredentialStore({ stateRoot: f.root }).read(); assert.equal(credentials.revision, 2);
    assert.deepEqual(Object.fromEntries(Object.entries(credentials.entries).map(([key, entry]) => [key, entry?.value])), {
      ucpathUserId: bindings.UCPATH_USER_ID, ucpathPassword: bindings.UCPATH_PASSWORD, timekeeperName: bindings.TIMEKEEPER_NAME,
      sharepointOnboardingRosterUrl: bindings.ONBOARDING_ROSTER_URL, activityPersonPseudonym: { keyHex: bindings.HRAUTO_ACTIVITY_PERSON_PSEUDONYM_HMAC_KEY, keyGeneration: bindings.HRAUTO_ACTIVITY_PERSON_PSEUDONYM_KEY_GENERATION },
    });
    assert.equal(readFileSync(f.environmentFile, "utf8"), body);
    for (const value of Object.values(retired)) assert.equal(JSON.stringify(credentials).includes(value), false);
    for (const value of [...Object.values(retired), bindings.UCPATH_PASSWORD, bindings.UCPATH_USER_ID, "synthetic-provider-never-imported"]) assert.equal(readFileSync(join(f.root, "state.db")).includes(Buffer.from(value)), false);
  });
  it.each(Object.entries(RETIRED_TEST_TARGET_ENV))("refuses the retired test-target env key %s by name before creating authority (D341)", async (key, value) => {
    const body = Object.entries({ ...bindings, [key]: value }).map(([name, entry]) => `${name}=${entry}`).join("\n") + "\n";
    const f = fixture(body); const before = readdirSync(f.root);
    for (const input of [{ ...f.input, plan: true }, f.input]) {
      await assert.rejects(upgradeStorage(input, clock), (error: unknown) => {
        const diagnostic = String(error);
        assert.match(diagnostic, new RegExp(`retired-test-target-env \\{ key: ${key} \\}`, "u"));
        assert.match(diagnostic, /config\/test-data\.local\.json \(D341\)/u);
        assert.equal(diagnostic.includes(value), false);
        return true;
      });
    }
    assert.deepEqual(readdirSync(f.root), before); assert.equal(readFileSync(f.environmentFile, "utf8"), body);
  });
  it.each(["UNREGISTERED_SETTING=1", "I9_USER_ID_EXTRA=synthetic-private", "TELEGRAM_TOKEN=synthetic-private", "I9_USER_ID=one\nI9_USER_ID=two", "TELEGRAM_BOT_TOKEN=\"unterminated", "HRAUTO_DEFAULT_WORKERS=abc", "HRAUTO_KUALI_TEST_URL=not-a-url", "HRAUTO_DEFAULT_WORKERS=2\nHRAUTO_DEFAULT_WORKERS=3", "HRAUTO_ACTIVITY_PERSON_PSEUDONYM_HMAC_KEY=" + "ab".repeat(32)])("refuses invalid migration input before creating authority (case %#)", async (body) => {
    const f = fixture(body); const before = readdirSync(f.root);
    await assert.rejects(upgradeStorage({ ...f.input, plan: true }, clock));
    await assert.rejects(upgradeStorage(f.input, clock));
    assert.deepEqual(readdirSync(f.root), before); assert.equal(readFileSync(f.environmentFile, "utf8"), body);
  });
});
