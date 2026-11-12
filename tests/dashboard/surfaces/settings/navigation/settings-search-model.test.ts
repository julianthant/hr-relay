import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { searchSettings,settingsSearchIndex } from "../../../../../src/dashboard/surfaces/settings/navigation/settings-search-model.js";
import { buildSettingsNav } from "../../../../../src/dashboard/surfaces/settings/settings-model.js";
import { fixtureSettingsDocument } from "../../../../mocks/helpers/fixture-settings.js";

const document = fixtureSettingsDocument();
const groups = buildSettingsNav(document);
const index = settingsSearchIndex(groups, document);

describe("Settings field search", () => {
  it("finds pages and the displayed field names with their canonical parent page", () => {
    assert.equal(searchSettings(index, "general")[0]?.target, undefined);
    assert.deepEqual(searchSettings(index, 'analytics').map(result => [result.label, result.entry.id]), [['Analytics', 'activity']]);
    assert.deepEqual(searchSettings(index, "archive"), []);
    assert.deepEqual(searchSettings(index, "backoff").map(result => [result.label, result.entry.id, result.target]), [
      ["Backoff base", "performance", "ocr.backoffBaseMs"], ["Backoff cap", "performance", "ocr.backoffCapMs"],
    ]);
    for (const [term, section, target] of [
      ["job end date", "general", `annualDates.FY${document.currentFiscalYear}.jobEndDate`],
      ["OpenAI login", "general", "chatgpt.account"],
      ["UCPath username", "account", "protected.ucpathUserId"],
    ]) assert.ok(searchSettings(index, term).some(result => result.entry.id === section && result.target === target), term);
    assert.deepEqual(searchSettings(index, "runtime state folder"), []);
    assert.deepEqual(searchSettings(index, "CRM onboarding search"), []);
    assert.equal(index.some(result => result.entry.id === "storage" || result.entry.id === "routes" || result.entry.id === "paths"), false);
    assert.equal(new Set(index.map(result => result.id)).size, index.length);
  });

  it("finds read-only profile facts without retaining the retired pseudonym field", () => {
    assert.deepEqual(searchSettings(index, "Timekeeper name").map(result => [result.entry.id, result.target]), [["account", "profile.displayName"]]);
    assert.deepEqual(searchSettings(index, "Timekeeper initials").map(result => [result.entry.id, result.target]), [["account", "profile.initials"]]);
    assert.deepEqual(searchSettings(index, "pseudonym"), []);
    assert.equal(index.some(result => result.target === "protected.timekeeperName"), false);
  });

  it("searches descriptions, normalizes whitespace/case, and ranks exact names first", () => {
    assert.equal(searchSettings(index, "  DARK  THEME ")[0]?.target, "appearance.theme");
    assert.deepEqual(searchSettings(index, "capture diagnostic"), []);
    assert.equal(searchSettings(index, "animations")[0]?.target, "appearance.animations");
    assert.equal(searchSettings(index, "browser window")[0]?.target, "browser.window");
    assert.deepEqual(searchSettings(index, "   "), []);
    assert.deepEqual(searchSettings(index, "this setting does not exist"), []);
  });

  it("has no search destinations for removed permission controls", () => {
    assert.deepEqual(searchSettings(index, "assistant permission"), []);
    assert.deepEqual(searchSettings(index, "ask before every action"), []);
    for (const query of ["ask before submits", "without asking"]) assert.deepEqual(searchSettings(index, query), []);
  });

  it("indexes each appearance control once through its visible destination", () => {
    assert.deepEqual(searchSettings(index, "theme").map(result => result.target), ["appearance.theme"]);
    assert.deepEqual(searchSettings(index, "animations").map(result => result.target), ["appearance.animations"]);
    assert.equal(index.some(result => result.target?.startsWith("preferences.")), false);
  });

  it("never searches or serializes current values, secrets, or source paths", () => {
    const value = "DO_NOT_INDEX_THIS_PRIVATE_VALUE";
    const copy = structuredClone(document);
    copy.sections[0].leaves[0].effectiveValue = value;
    const safe = settingsSearchIndex(groups, copy);
    assert.ok(!safe.some(result => result.target?.startsWith("provider-keys.") || result.target?.startsWith("providers.")));
    assert.deepEqual(searchSettings(safe, "Census daily request"), []);
    assert.deepEqual(searchSettings(safe, "API keys"), []);
    assert.deepEqual(searchSettings(safe, "Browser viewport"), []);
    assert.ok(!safe.some(result => result.target?.startsWith("display.")));
    assert.ok(!JSON.stringify(safe).includes(value));
    assert.deepEqual(searchSettings(safe, value), []);
    assert.deepEqual(searchSettings(safe, "/tmp/settings-fixture"), []);
    assert.ok(!index.some(result => result.target === "actor.label"), "the retired control has no search destination");
  });

  it("retains page search when reads fail without inventing served fields", () => {
    const unavailable = settingsSearchIndex(buildSettingsNav());
    assert.ok(searchSettings(unavailable, "performance").some(result => result.target === undefined));
    assert.deepEqual(searchSettings(unavailable, "backoff"), []);
    assert.deepEqual(searchSettings(unavailable, "runtime state folder"), []);
  });
});
