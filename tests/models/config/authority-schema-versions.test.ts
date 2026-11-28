import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { StorageUpgradeReportSchema } from "../../../src/backend/storage/maintenance/upgrade.js";
import { SQLITE_MIGRATIONS } from "../../../src/backend/storage/sqlite/migrations.js";
import { AuthorityUpgradeRecordSchema } from "../../../src/models/config/authority.js";
import {
  AUTHORITY_APPLICATION_ID,
  BASELINE_FROM_AUTHORITY_SCHEMA_VERSIONS,
  BOUND_AUTHORITY_SCHEMA_VERSIONS,
  CURRENT_AUTHORITY_SCHEMA_VERSION,
  EVIDENCE_SCHEMA_UPGRADE_VERSIONS,
  MAINTENANCE_AUTHORITY_SCHEMA_VERSIONS,
  OPENABLE_AUTHORITY_SCHEMA_VERSIONS,
  RECOGNIZED_AUTHORITY_SCHEMA_VERSIONS,
  SUPPORTED_STOPPED_AUTHORITY_SCHEMA_VERSIONS,
  UNBOUND_PREDECESSOR_AUTHORITY_SCHEMA_VERSIONS,
  UPGRADEABLE_AUTHORITY_SCHEMA_VERSIONS,
  isCurrentAuthoritySchemaVersion,
  isOpenableAuthoritySchemaVersion,
  isSupportedStoppedAuthoritySchemaVersion,
  isUpgradeableAuthoritySchemaVersion,
} from "../../../src/models/config/authority-schema-versions.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../src/rules/identity/ids.js";

const stopped = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48] as const;
const upgradeable = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48] as const;
const openable = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49] as const;
const recognized = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49] as const;
const baselineFrom = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49] as const;
const bound = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49] as const;
const unbound = [1, 2, 3, 4, 5, 6] as const;
const maintenance = [6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49] as const;
const evidence = [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49] as const;

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
const _stoppedLiterals: Expect<Equal<(typeof SUPPORTED_STOPPED_AUTHORITY_SCHEMA_VERSIONS)[number], (typeof stopped)[number]>> = true;
const _upgradeableLiterals: Expect<Equal<(typeof UPGRADEABLE_AUTHORITY_SCHEMA_VERSIONS)[number], (typeof upgradeable)[number]>> = true;
const _openableLiterals: Expect<Equal<(typeof OPENABLE_AUTHORITY_SCHEMA_VERSIONS)[number], (typeof openable)[number]>> = true;
const _recognizedLiterals: Expect<Equal<(typeof RECOGNIZED_AUTHORITY_SCHEMA_VERSIONS)[number], (typeof recognized)[number]>> = true;
const _baselineLiterals: Expect<Equal<(typeof BASELINE_FROM_AUTHORITY_SCHEMA_VERSIONS)[number], (typeof baselineFrom)[number]>> = true;
const _boundLiterals: Expect<Equal<(typeof BOUND_AUTHORITY_SCHEMA_VERSIONS)[number], (typeof bound)[number]>> = true;
const _unboundLiterals: Expect<Equal<(typeof UNBOUND_PREDECESSOR_AUTHORITY_SCHEMA_VERSIONS)[number], (typeof unbound)[number]>> = true;
const _maintenanceLiterals: Expect<Equal<(typeof MAINTENANCE_AUTHORITY_SCHEMA_VERSIONS)[number], (typeof maintenance)[number]>> = true;
const _evidenceLiterals: Expect<Equal<(typeof EVIDENCE_SCHEMA_UPGRADE_VERSIONS)[number], (typeof evidence)[number]>> = true;

const lists = [
  ["stopped", SUPPORTED_STOPPED_AUTHORITY_SCHEMA_VERSIONS, stopped, isSupportedStoppedAuthoritySchemaVersion],
  ["upgradeable", UPGRADEABLE_AUTHORITY_SCHEMA_VERSIONS, upgradeable, isUpgradeableAuthoritySchemaVersion],
  ["openable", OPENABLE_AUTHORITY_SCHEMA_VERSIONS, openable, isOpenableAuthoritySchemaVersion],
  ["recognized", RECOGNIZED_AUTHORITY_SCHEMA_VERSIONS, recognized, undefined],
  ["baseline-from", BASELINE_FROM_AUTHORITY_SCHEMA_VERSIONS, baselineFrom, undefined],
  ["bound", BOUND_AUTHORITY_SCHEMA_VERSIONS, bound, undefined],
  ["unbound", UNBOUND_PREDECESSOR_AUTHORITY_SCHEMA_VERSIONS, unbound, undefined],
  ["maintenance", MAINTENANCE_AUTHORITY_SCHEMA_VERSIONS, maintenance, undefined],
  ["evidence", EVIDENCE_SCHEMA_UPGRADE_VERSIONS, evidence, undefined],
] as const;

const probe = [-1, 6.5, 7.5, 31.5, 32.5, 33.5, 34.5, 35.5, 36.5, 37.5, 38.5, 39.5, 40.5, 41.5, 42.5, 43.5, 44.5, 45.5, 46.5, 47.5, 48.5, 49.5, ...Array.from({ length: 51 }, (_, index) => index)];

describe("authority schema version lists", () => {
  it("keeps one application id and the current schema at 49", () => {
    assert.equal(AUTHORITY_APPLICATION_ID, 1_217_249_861);
    assert.equal(CURRENT_AUTHORITY_SCHEMA_VERSION, 49);
    assert.equal(isCurrentAuthoritySchemaVersion(49), true);
    assert.equal(isCurrentAuthoritySchemaVersion(48), false);
    assert.equal(isCurrentAuthoritySchemaVersion(50), false);
  });

  it("matches the accepted version of every list, and refuses every other probe", () => {
    for (const [name, actual, expected, admit] of lists) {
      assert.deepEqual([...actual], [...expected], name);
      for (const version of probe) {
        const allowed = expected.some(item => item === version);
        assert.equal(actual.some(item => item === version), allowed, `${name} ${String(version)}`);
        assert.equal(z.literal(actual).safeParse(version).success, allowed, `${name} zod ${String(version)}`);
        if (admit !== undefined) assert.equal(admit(version), allowed, `${name} admit ${String(version)}`);
      }
    }
  });

  it("pins the last migration to the current schema", () => {
    assert.equal(SQLITE_MIGRATIONS.at(-1)?.version, CURRENT_AUTHORITY_SCHEMA_VERSION);
  });

  it("refuses a baseline or upgrade report outside the derived lists", () => {
    const baseline = {
      recordKey: "2fb8e9f6-65a8-4b44-a644-2c134f63bade",
      upgradeId: "fresh" as const,
      phase: "baseline" as const,
      fromSchemaVersion: 0,
      toSchemaVersion: 1,
      by: LOCAL_OPERATOR_ACTOR_ID,
      recordedAt: "2026-11-02T00:00:00.000Z",
    };
    assert.equal(AuthorityUpgradeRecordSchema.safeParse(baseline).success, true);
    assert.equal(AuthorityUpgradeRecordSchema.safeParse({ ...baseline, toSchemaVersion: 44 }).success, true);
    assert.equal(AuthorityUpgradeRecordSchema.safeParse({ ...baseline, toSchemaVersion: 0 }).success, false);
    assert.equal(AuthorityUpgradeRecordSchema.safeParse({ ...baseline, toSchemaVersion: 50 }).success, false);
    const report = { state: "planned" as const, fromSchemaVersion: 0, toSchemaVersion: 49, credentials: "unchanged" as const };
    assert.equal(StorageUpgradeReportSchema.safeParse(report).success, true);
    assert.equal(StorageUpgradeReportSchema.safeParse({ ...report, fromSchemaVersion: 39 }).success, true);
    assert.equal(StorageUpgradeReportSchema.safeParse({ ...report, state: "already-upgraded", fromSchemaVersion: 49 }).success, true);
    assert.equal(StorageUpgradeReportSchema.safeParse({ ...report, fromSchemaVersion: 50 }).success, false);
    assert.equal(StorageUpgradeReportSchema.safeParse({ ...report, toSchemaVersion: 39 }).success, false);
  });
});
