import assert from "node:assert/strict";
import { it } from "vitest";
import { AuthorityUpgradeRecordSchema, type AuthorityUpgradeRecord } from "../../../src/models/config/authority.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../src/models/config/authority-schema-versions.js";
import {
  authorityUpgradeJournalOf,
  authorityUpgradeTransition,
  type AuthorityUpgradeJournalEvent,
  type AuthorityUpgradeRefusal,
  type AuthorityUpgradeTransition,
} from "../../../src/rules/storage/upgrade-journal.js";

const INSTALLATION = "11111111-1111-4111-8111-111111111111";
const PROFILE = "22222222-2222-4222-8222-222222222222";
const LOGOUT_OPERATION = "33333333-3333-4333-8333-333333333333";
const hex = (digit: string) => digit.repeat(64);
let key = 0;
const recordKey = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++key).padStart(12, "0")}`;
const common = () => ({ recordKey: recordKey(), by: "local-operator", recordedAt: "2026-11-01T00:00:00.000Z" });
const backup = { manifestPath: "backups/authority/a.sqlite.manifest.json", sha256: hex("c"), authorityGeneration: 3 };

const baseline = (toSchemaVersion: number) => AuthorityUpgradeRecordSchema.parse({
  ...common(), upgradeId: "fresh", phase: "baseline", fromSchemaVersion: 0, toSchemaVersion });
const forward = (fromSchemaVersion: number, toSchemaVersion: number, logout = false) => AuthorityUpgradeRecordSchema.parse({
  ...common(), upgradeId: hex(String(fromSchemaVersion % 10)), phase: "settled", fromSchemaVersion, toSchemaVersion, planDigest: hex("b"), backup,
  ...(logout ? { startupLogout: { operation: {
    schemaVersion: 3, kind: "logout", operationId: LOGOUT_OPERATION, profileId: PROFILE, sessionGeneration: 1,
    source: { database: { device: 1, inode: 2 } }, at: "2026-11-01T00:00:00.000Z", phase: "admitted" }, postimage: hex("d") } } : {}) });
const evidence = (id: "profile-name-domain" | "retired-input-generation") => AuthorityUpgradeRecordSchema.parse({
  ...common(), upgradeId: hex(id === "profile-name-domain" ? "e" : "f"), phase: "settled",
  fromSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, planDigest: hex("b"), backup,
  evidenceSchemaMac: hex("9"),
  evidenceSchemas: id === "profile-name-domain"
    ? { id, installationId: INSTALLATION, profileId: PROFILE, admissions: [{ owner: { kind: "run-input", id: INSTALLATION },
      sourceSchemaHash: hex("1"), currentSchemaHash: hex("2"), sourceDigest: hex("3") }] }
    : { id, installationId: INSTALLATION, profileId: PROFILE, retirements: [{ owner: { kind: "run-input", id: INSTALLATION },
      workflowId: "separations", sourceSchemaHash: hex("1"), sourceDigest: hex("3") }] } });

const CURRENT = CURRENT_AUTHORITY_SCHEMA_VERSION;
const logoutUpgrade = forward(20, CURRENT, true);
const JOURNALS = {
  empty: [],
  "baseline at current": [baseline(CURRENT)],
  "baseline at 20": [baseline(20)],
  "settled at current": [baseline(20), forward(20, CURRENT)],
  "settled at 22": [baseline(20), forward(20, 22)],
  "settled with startup logout": [baseline(20), logoutUpgrade],
  "settled with one evidence conversion": [baseline(CURRENT), evidence("profile-name-domain")],
  "settled with both evidence conversions": [baseline(CURRENT), evidence("profile-name-domain"), evidence("retired-input-generation")],
  "evidence after a startup logout": [baseline(20), logoutUpgrade, evidence("retired-input-generation")],
} satisfies Record<string, readonly AuthorityUpgradeRecord[]>;
type Journal = keyof typeof JOURNALS;

it("derives the journal state, its schema, latest forward upgrade and evidence conversions from the rows", () => {
  const summary = (journal: Journal) => {
    const state = authorityUpgradeJournalOf(JOURNALS[journal]);
    if (state.journal === "empty") return ["empty"];
    if (state.journal === "baseline") return ["baseline", state.schemaVersion];
    return ["settled", state.schemaVersion, state.latestForward?.fromSchemaVersion ?? "none",
      state.latestForward?.startupLogout === undefined ? "no logout" : "logout", state.evidence.map(record => record.evidenceSchemas.id)];
  };
  assert.deepEqual(summary("empty"), ["empty"]);
  assert.deepEqual(summary("baseline at current"), ["baseline", CURRENT]);
  assert.deepEqual(summary("baseline at 20"), ["baseline", 20]);
  assert.deepEqual(summary("settled at current"), ["settled", CURRENT, 20, "no logout", []]);
  assert.deepEqual(summary("settled at 22"), ["settled", 22, 20, "no logout", []]);
  assert.deepEqual(summary("settled with startup logout"), ["settled", CURRENT, 20, "logout", []]);
  assert.deepEqual(summary("settled with one evidence conversion"), ["settled", CURRENT, "none", "no logout", ["profile-name-domain"]]);
  assert.deepEqual(summary("settled with both evidence conversions"), ["settled", CURRENT, "none", "no logout", ["profile-name-domain", "retired-input-generation"]]);
  // A later evidence row never hides the forward upgrade that carries the startup logout.
  assert.deepEqual(summary("evidence after a startup logout"), ["settled", CURRENT, 20, "logout", ["retired-input-generation"]]);
  const latest = authorityUpgradeJournalOf(JOURNALS["evidence after a startup logout"]);
  assert.equal(latest.journal === "settled" ? latest.latestForward?.recordKey : undefined, logoutUpgrade.recordKey);
});

const EVENTS = {
  initialize: { type: "initialize" },
  "forward from 20": { type: "forward-upgrade", from: 20 },
  "forward from 7": { type: "forward-upgrade", from: 7 },
  "forward from current": { type: "forward-upgrade", from: CURRENT },
  "convert profile-name-domain": { type: "convert-evidence", id: "profile-name-domain" },
  "convert retired-input-generation": { type: "convert-evidence", id: "retired-input-generation" },
} satisfies Record<string, AuthorityUpgradeJournalEvent>;
type Expected = "baseline" | "settled" | `!${AuthorityUpgradeRefusal}`;
type Row = readonly [initialize: Expected, from20: Expected, from7: Expected, fromCurrent: Expected, nameDomain: Expected, retired: Expected];

// Columns follow EVENTS. The journal only appends: `baseline` or `settled` is the phase of the appended row.
const TABLE: Record<Journal, Row> = {
  empty: ["baseline", "!not-upgradeable", "!not-upgradeable", "!not-upgradeable", "!not-upgradeable", "!not-upgradeable"],
  "baseline at current": ["!already-initialized", "settled", "!not-upgradeable", "!not-upgradeable", "settled", "settled"],
  "baseline at 20": ["!already-initialized", "settled", "!not-upgradeable", "!not-upgradeable", "!not-upgradeable", "!not-upgradeable"],
  "settled at current": ["!already-initialized", "settled", "!not-upgradeable", "!not-upgradeable", "settled", "settled"],
  "settled at 22": ["!already-initialized", "settled", "!not-upgradeable", "!not-upgradeable", "!not-upgradeable", "!not-upgradeable"],
  "settled with startup logout": ["!already-initialized", "settled", "!not-upgradeable", "!not-upgradeable", "settled", "settled"],
  "settled with one evidence conversion": ["!already-initialized", "settled", "!not-upgradeable", "!not-upgradeable", "!evidence-schema-conversion-duplicate", "settled"],
  "settled with both evidence conversions": ["!already-initialized", "settled", "!not-upgradeable", "!not-upgradeable", "!evidence-schema-conversion-duplicate", "!evidence-schema-conversion-duplicate"],
  "evidence after a startup logout": ["!already-initialized", "settled", "!not-upgradeable", "!not-upgradeable", "settled", "!evidence-schema-conversion-duplicate"],
};

const answerOf = (transition: AuthorityUpgradeTransition): Expected => "append" in transition ? transition.append : `!${transition.refused}`;

it("walks every journal state and event, appending only a legal row and refusing the rest", () => {
  assert.deepEqual(Object.keys(TABLE).sort(), Object.keys(JOURNALS).sort());
  for (const [journal, row] of Object.entries(TABLE) as [Journal, Row][]) {
    const state = authorityUpgradeJournalOf(JOURNALS[journal]);
    Object.entries(EVENTS).forEach(([name, event], column) => {
      assert.equal(answerOf(authorityUpgradeTransition(state, event)), row[column], `${journal}, ${name}`);
    });
  }
});

it("reads only the two phases a build writes", () => {
  for (const phase of ["planned", "committed", "schema-migrated"]) {
    const row = { ...forward(20, CURRENT), phase };
    assert.equal(AuthorityUpgradeRecordSchema.safeParse(row).success, false, phase);
  }
});
