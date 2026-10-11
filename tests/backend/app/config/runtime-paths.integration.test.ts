import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach,describe,it } from "vitest";
import { defaultRuntimePaths } from "../../../../src/backend/app/config/runtime-paths.js";
import { ConfigSchema } from "../../../../src/models/config/schema.js";
import { ConfigSnapshotRecordSchema,ConfigSnapshotWriteSchema,StoredConfigSchema } from "../../../../src/models/config/snapshot.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { NOW,UUID_4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const roots: string[] = [];
const SNAPSHOT_ID = UUID_4;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function currentConfig() {
  return ConfigSchema.parse({ paths: defaultRuntimePaths() });
}

describe("strict current config snapshots", () => {
  it("rejects every missing current group and required timeout or provider leaf on both read and write", () => {
    const config = currentConfig();
    for (const key of Object.keys(config)) {
      const missing = { ...config }; Reflect.deleteProperty(missing, key);
      assert.equal(StoredConfigSchema.safeParse(missing).success, false, key);
    }
    for (const key of Object.keys(config.timeouts)) {
      const timeouts = { ...config.timeouts }; Reflect.deleteProperty(timeouts, key);
      assert.equal(StoredConfigSchema.safeParse({ ...config, timeouts }).success, false, key);
    }
    for (const configValue of [{ ...config, providers: { geocodeCensus: config.providers.geocodeCensus } }, { ...config, providers: { ...config.providers, geocodeNominatim: {} } }, { ...config, operator: {} }, { ...config, capture: {} }, { ...config, providers: { ...config.providers, geocodeCensus: { ...config.providers.geocodeCensus, concurrency: 1 } } }]) {
      const record = { configSnapshotId: SNAPSHOT_ID, revision: 1, fingerprint: sha256Hex(canonicalJsonStringify(configValue)), capturedAt: NOW, capturedBy: "local-operator", config: configValue, provenance: {} };
      assert.equal(ConfigSnapshotRecordSchema.safeParse(record).success, false);
      assert.equal(ConfigSnapshotWriteSchema.safeParse(record).success, false);
    }
    assert.equal(ConfigSchema.parse({ paths: defaultRuntimePaths() }).browser.headless, true);
  });
});
