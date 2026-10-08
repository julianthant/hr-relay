import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { MIGRATED_SETTINGS_ENVIRONMENT_KEYS } from "../../../../../../src/models/config/catalog.js";
import { credentialTrap, storageTree } from "../../../../../support/helpers/integration/storage-recovery-fixture.js";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { readSettings } from "../../../../../../src/backend/runtime/settings/settings-runtime.js";
import { upgradeStorage } from "../../../../../support/helpers/synthetic-storage-admission.js";
const clock = manualClock(new Date("2026-09-06T12:00:00.000Z"));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const HISTORICAL_PROVIDER_MODEL_ENVIRONMENT_KEYS = ["OCR_GEMINI_MODEL", "OCR_GEMINI_MODELS", "OCR_GROQ_MODEL", "OCR_GROQ_MODELS", "OCR_MISTRAL_MODEL", "OCR_MISTRAL_MODELS", "OCR_OPENROUTER_MODEL", "OCR_OPENROUTER_MODELS", "OCR_SAMBANOVA_MODEL", "OCR_SAMBANOVA_MODELS"];
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
describe("D332.9 expired environment import", () => {
  it("covers every former input while fresh authority and credentials remain independent", async () => {
    assert.deepEqual([...Object.keys(bindings), ...Object.keys(RETIRED_TEST_TARGET_ENV)].sort(), [...MIGRATED_SETTINGS_ENVIRONMENT_KEYS, ...HISTORICAL_PROVIDER_MODEL_ENVIRONMENT_KEYS].sort());
    const retired = { I9_USER_ID: "synthetic-retired-id", I9_PASSWORD: "synthetic-retired-password", TELEGRAM_BOT_TOKEN: "synthetic-retired-token", TELEGRAM_CHAT_ID: "synthetic-retired-chat" };
    const body = Object.entries({ ...bindings, ...retired, GEMINI_API_KEY: "synthetic-provider-never-imported" }).map(([key, value]) => `${key}=${value}`).join("\n") + "\n";
    const f = fixture(body); credentialTrap(f.root); const before = storageTree(f.root);
    const plan = await upgradeStorage({ ...f.input, plan: true }, clock);
    assert.deepEqual(plan.envKeysToRemove, []); assert.deepEqual(plan.importedKeys, []);
    assert.deepEqual(storageTree(f.root), before);
    const applied = await upgradeStorage(f.input, clock);
    assert.deepEqual(applied.importedKeys, []); assert.equal(applied.credentials, "unchanged");
    const database = AuthorityDatabase.open({ path: join(f.root, "state.db"), busyTimeoutMs: 500, migrationOwner: "expired-env-proof" }, clock);
    try { assert.deepEqual(readSettings(database.authority).settings, {}); } finally { database.close(); }
    assert.equal(readFileSync(f.environmentFile, "utf8"), body);
    for (const value of [...Object.values(retired), bindings.UCPATH_PASSWORD, bindings.UCPATH_USER_ID, "synthetic-provider-never-imported"])
      assert.equal(readFileSync(join(f.root, "state.db")).includes(Buffer.from(value)), false);
    const settled = storageTree(f.root); assert.equal((await upgradeStorage(f.input, clock)).state, "already-upgraded");
    assert.deepEqual(storageTree(f.root), settled);
  });
  it.each(Object.entries(RETIRED_TEST_TARGET_ENV))("does not read or adopt expired test-target key %s", async (key, value) => {
    const body = `${key}=${value}\n`; const f = fixture(body); credentialTrap(f.root);
    const report = await upgradeStorage(f.input, clock);
    assert.deepEqual(report.importedKeys, []); assert.equal(JSON.stringify(report).includes(value), false);
    assert.equal(readFileSync(f.environmentFile, "utf8"), body);
    assert.equal(readFileSync(join(f.root,"state.db")).includes(Buffer.from(value)), false);
  });
  it.each(["UNREGISTERED_SETTING=1", "I9_USER_ID_EXTRA=synthetic-private", "TELEGRAM_TOKEN=synthetic-private", "I9_USER_ID=one\nI9_USER_ID=two", "TELEGRAM_BOT_TOKEN=\"unterminated", "HRAUTO_DEFAULT_WORKERS=abc", "HRAUTO_KUALI_TEST_URL=not-a-url"])("does not parse expired environment bytes: %s", async body => {
    const f=fixture(body);credentialTrap(f.root);const before=storageTree(f.root);
    assert.equal((await upgradeStorage({...f.input,plan:true},clock)).state,"planned");assert.deepEqual(storageTree(f.root),before);
    const result=await upgradeStorage(f.input,clock);assert.deepEqual(result.importedKeys,[]);assert.equal(readFileSync(f.environmentFile,"utf8"),body);
  });
});
