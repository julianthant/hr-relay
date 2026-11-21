import assert from "node:assert/strict";
import { it } from "vitest";
import * as authority from "../../../src/models/config/authority-schema-versions.js";

it.each([
  ["upgradeable", authority.UPGRADEABLE_AUTHORITY_SCHEMA_VERSIONS],
  ["supported stopped", authority.SUPPORTED_STOPPED_AUTHORITY_SCHEMA_VERSIONS],
  ["openable", authority.OPENABLE_AUTHORITY_SCHEMA_VERSIONS],
  ["unbound predecessor", authority.UNBOUND_PREDECESSOR_AUTHORITY_SCHEMA_VERSIONS],
  ["bound", authority.BOUND_AUTHORITY_SCHEMA_VERSIONS],
  ["evidence upgrade", authority.EVIDENCE_SCHEMA_UPGRADE_VERSIONS],
  ["recognized", authority.RECOGNIZED_AUTHORITY_SCHEMA_VERSIONS],
  ["baseline", authority.BASELINE_FROM_AUTHORITY_SCHEMA_VERSIONS],
  ["maintenance", authority.MAINTENANCE_AUTHORITY_SCHEMA_VERSIONS],
] as const)("refuses writes to %s authority schema versions", (_name, versions) => {
  assert.throws(() => Object.assign(versions, { 0: versions[0] }), TypeError);
});
