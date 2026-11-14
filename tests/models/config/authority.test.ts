import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
AUTHORITY_TABLE_REGISTRY,
AuthorityTableNameSchema,
AuthorityTableRegistrySchema,
AuthorityUpgradeRecordSchema,
ProjectionTableNameSchema,
auditAuthorityTableRegistry,
} from "../../../src/models/config/authority.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../src/rules/identity/ids.js";

describe("authority classification and command families", () => {
  it("classifies every table exactly once and freezes the registry", () => {
    assert.deepEqual(auditAuthorityTableRegistry(AUTHORITY_TABLE_REGISTRY), []);
    assert.equal(AUTHORITY_TABLE_REGISTRY.length, AuthorityTableNameSchema.options.length + ProjectionTableNameSchema.options.length);
    assert.equal(Object.isFrozen(AUTHORITY_TABLE_REGISTRY), true);
    assert.equal(Object.isFrozen(AUTHORITY_TABLE_REGISTRY[0]), true);
    assert.equal(AuthorityTableRegistrySchema.safeParse(AUTHORITY_TABLE_REGISTRY.slice(1)).success, false);
    assert.equal(AuthorityTableRegistrySchema.safeParse([
      ...AUTHORITY_TABLE_REGISTRY,
      { ...AUTHORITY_TABLE_REGISTRY[0], classification: "projection" },
    ]).success, false);
  });
});

it("accepts the current library-capable authority baseline and refuses unsupported versions", () => {
  const baseline = {
    recordKey: "2fb8e9f6-65a8-4b44-a644-2c134f63bade",
    upgradeId: "fresh",
    phase: "baseline",
    fromSchemaVersion: 0,
    toSchemaVersion: 22,
    by: LOCAL_OPERATOR_ACTOR_ID,
    recordedAt: "2026-11-02T00:00:00.000Z",
  };
  assert.deepEqual(AuthorityUpgradeRecordSchema.parse(baseline), baseline);
  assert.equal(AuthorityUpgradeRecordSchema.safeParse({ ...baseline, toSchemaVersion: 12 }).success, true);
  assert.equal(AuthorityUpgradeRecordSchema.safeParse({ ...baseline, toSchemaVersion: 13 }).success, true);
  assert.equal(AuthorityUpgradeRecordSchema.safeParse({ ...baseline, toSchemaVersion: 14 }).success, true);
  assert.equal(AuthorityUpgradeRecordSchema.safeParse({ ...baseline, toSchemaVersion: 15 }).success, true);
  assert.equal(AuthorityUpgradeRecordSchema.safeParse({ ...baseline, toSchemaVersion: 16 }).success, true);
  assert.equal(AuthorityUpgradeRecordSchema.safeParse({ ...baseline, toSchemaVersion: 17 }).success, true);
  assert.equal(AuthorityUpgradeRecordSchema.safeParse({ ...baseline, toSchemaVersion: 18 }).success, true);
  assert.equal(AuthorityUpgradeRecordSchema.safeParse({ ...baseline, toSchemaVersion: 20 }).success, true);
  assert.equal(AuthorityUpgradeRecordSchema.safeParse({ ...baseline, toSchemaVersion: 21 }).success, true);
  assert.equal(AuthorityUpgradeRecordSchema.safeParse({ ...baseline, toSchemaVersion: 23 }).success, true);
  for (const toSchemaVersion of [24, 25, 26, 27, 28, 29, 30]) assert.equal(AuthorityUpgradeRecordSchema.safeParse({ ...baseline, toSchemaVersion }).success, true);
  for (const toSchemaVersion of [0, 31, 16.5, 17.5, 18.5, 19.5]) {
    assert.equal(AuthorityUpgradeRecordSchema.safeParse({ ...baseline, toSchemaVersion }).success, false);
  }
  assert.equal(AuthorityUpgradeRecordSchema.safeParse({ ...baseline, fromSchemaVersion: 11 }).success, false);
});
