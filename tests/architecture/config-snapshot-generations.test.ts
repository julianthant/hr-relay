import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { configLeafPaths } from "../../src/domain/config/resolve.js";
import { defaultRuntimePaths } from "../../src/domain/config/runtime-paths.js";
import { ConfigSchema } from "../../src/domain/config/schema.js";
import {
  CONFIG_SNAPSHOT_GENERATIONS,
  CURRENT_CONFIG_SNAPSHOT_GENERATION,
  POST_BASELINE_CONFIG_LEAVES,
  StoredConfigSchema,
  auditConfigSnapshotGenerations,
  configLeafDigest,
  configSnapshotGeneration,
} from "../../src/domain/config/snapshot-generations.js";

function currentLeafPaths(): readonly string[] {
  return configLeafPaths(ConfigSchema.parse({ paths: defaultRuntimePaths() }));
}

describe("durable config-leaf generations", () => {
  it("P38/M14 retains the retired timekeeper leaf only in immutable pre-floor snapshots", () => {
    const current = ConfigSchema.parse({ paths: defaultRuntimePaths() });
    const historical = { ...current, operator: { timekeeperName: "synthetic historical timekeeper" } };
    assert.equal(ConfigSchema.safeParse(historical).success, false);
    const stored = StoredConfigSchema.parse(historical);
    assert.deepEqual(stored, historical);
    assert.equal(configSnapshotGeneration(stored), 4);
    assert.equal(configSnapshotGeneration(StoredConfigSchema.parse(current)), 5);
    assert.deepEqual(CONFIG_SNAPSHOT_GENERATIONS[4]?.retired, ["operator.timekeeperName"]);
    assert.deepEqual(auditConfigSnapshotGenerations(currentLeafPaths()), []);
    const unretired = auditConfigSnapshotGenerations(currentLeafPaths().filter((leaf) => leaf !== "timeouts.sessionAcquireMs"));
    assert.match(unretired.join("\n"), /registered config leaf timeouts\.sessionAcquireMs is absent/u);
  });
  it("pins the current config leaf set and every older generation's reconstruction", () => {
    assert.deepEqual(auditConfigSnapshotGenerations(currentLeafPaths()), []);
    assert.equal(CURRENT_CONFIG_SNAPSHOT_GENERATION, CONFIG_SNAPSHOT_GENERATIONS.at(-1)?.generation);
  });

  it("fails loud when a required leaf is added without a generation bump", () => {
    // The exact shape of the D125 defect: a leaf lands inside an already
    // existing group, every stored snapshot silently stops validating, and the
    // authority database is unopenable. It must die here instead.
    const added = auditConfigSnapshotGenerations([...currentLeafPaths(), "timeouts.sessionReleaseMs"]);
    assert.equal(added.length > 0, true);
    assert.match(added.join("\n"), /register every added leaf in CONFIG_SNAPSHOT_GENERATIONS/);
  });

  it("fails loud when a released generation's pinned leaf set is edited away", () => {
    const removed = auditConfigSnapshotGenerations(
      currentLeafPaths().filter((leaf) => leaf !== "timeouts.sessionAcquireMs"),
    );
    assert.equal(removed.length > 0, true);
    assert.match(removed.join("\n"), /registered config leaf timeouts\.sessionAcquireMs is absent/);
  });

  it("digests a leaf set independently of order and duplication, and not of content", () => {
    const base = ["alpha.one", "beta.two"];
    assert.equal(configLeafDigest(base), configLeafDigest(["beta.two", "alpha.one", "alpha.one"]));
    assert.notEqual(configLeafDigest(base), configLeafDigest([...base, "beta.three"]));
    assert.notEqual(configLeafDigest(base), configLeafDigest(["alpha.one"]));
  });

  it("tolerates exactly the registered post-baseline leaves in a stored snapshot", () => {
    const config = ConfigSchema.parse({ paths: defaultRuntimePaths() });
    assert.deepEqual(
      [...POST_BASELINE_CONFIG_LEAVES],
      ["timeouts.sessionAcquireMs", "timeouts.duoCeremonyLeaseGraceMs"],
    );

    const { sessionAcquireMs: _bound, ...withoutBound } = config.timeouts;
    assert.equal(StoredConfigSchema.safeParse({ ...config, timeouts: withoutBound }).success, true);
    // D267: a generation-2 snapshot (no grace leaf) and a generation-1 snapshot
    // (neither leaf) both still parse — read forward, never back-filled.
    const { duoCeremonyLeaseGraceMs: _grace, ...withoutGrace } = config.timeouts;
    assert.equal(StoredConfigSchema.safeParse({ ...config, timeouts: withoutGrace }).success, true);
    const { sessionAcquireMs: _b, duoCeremonyLeaseGraceMs: _g, ...baseline } = config.timeouts;
    assert.equal(StoredConfigSchema.safeParse({ ...config, timeouts: baseline }).success, true);

    for (const unregistered of ["taskMs", "navigationMs", "retryDelayMs"] as const) {
      const { [unregistered]: _dropped, ...rest } = config.timeouts;
      assert.equal(
        StoredConfigSchema.safeParse({ ...config, timeouts: rest }).success,
        false,
        `timeouts.${unregistered} is not a registered post-baseline leaf and must fail loud when absent`,
      );
    }
    assert.equal(StoredConfigSchema.safeParse({ ...config, unknownGroup: {} }).success, false);
  });
});
