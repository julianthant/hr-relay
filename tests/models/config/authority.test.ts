import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
AUTHORITY_TABLE_REGISTRY,
AuthorityTableNameSchema,
AuthorityTableRegistrySchema,
ProjectionTableNameSchema,
auditAuthorityTableRegistry,
} from "../../../src/models/config/authority.js";

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
