import assert from "node:assert/strict";
import { describe, it } from "vitest";
import inventory from "../../../config/legacy-test-disposition.json" with { type: "json" };
import {
  FROZEN_LEGACY_ARCHITECTURE_PROVENANCE,
  FrozenLegacyArchitectureProvenanceSchema,
} from "./helpers/frozen-legacy-architecture-provenance.js";

/**
 * Every path in this guard and its inventory is a LEGACY-repo path (D93): the
 * subject is the legacy test tree this rebuild will eventually retire. The set
 * is single-rooted, so paths stay unprefixed; only inventories that MIX both
 * repos carry the `legacy:` scheme.
 */

function baselineDirectories(): string[] {
  const frozen = FROZEN_LEGACY_ARCHITECTURE_PROVENANCE.testDisposition;
  if (frozen.baselineCommit !== inventory.baselineCommit) {
    throw new Error("frozen legacy test provenance baseline commit disagrees with the disposition inventory");
  }
  return requiredLegacyDirectories(frozen.baselineFiles, frozen.currentFiles);
}

export function requiredLegacyDirectories(
  baselineFiles: readonly string[],
  currentFiles: readonly string[],
): string[] {
  const directories = new Set(["tests"]);
  for (const file of [...baselineFiles, ...currentFiles]) {
    if (file === "tests/rebuild" || file.startsWith("tests/rebuild/")) continue;
    const parts = file.split("/");
    parts.pop();
    while (parts.length > 1) {
      const directory = parts.join("/");
      if (directory !== "tests/rebuild" && !directory.startsWith("tests/rebuild/")) {
        directories.add(directory);
      }
      parts.pop();
    }
  }
  return [...directories].sort();
}

describe("legacy test disposition inventory", () => {
  it("classifies the union of baseline and current legacy test directories exactly once", () => {
    const paths = inventory.entries.map(({ path }) => path);
    assert.equal(new Set(paths).size, paths.length);
    assert.deepEqual(paths, baselineDirectories());
  });

  it("excludes only tests/rebuild while retaining newly added legacy helper directories", () => {
    assert.deepEqual(
      requiredLegacyDirectories(
        ["tests/unit/original.test.ts"],
        [
          "tests/unit/architecture/helpers/guard-files.ts",
          "tests/rebuild/unit/new.test.ts",
          "tests/rebuild/scenario/helper.ts",
        ],
      ),
      ["tests", "tests/unit", "tests/unit/architecture", "tests/unit/architecture/helpers"],
    );
    assert.ok(inventory.entries.some(({ path }) => path === "tests/unit/architecture/helpers"));
  });

  it("requires port evidence before any later-retirement candidacy", () => {
    for (const entry of inventory.entries) {
      assert.ok(["preserved", "ported-and-preserved", "candidate-for-later-retirement"].includes(entry.disposition));
      if (entry.disposition !== "preserved") {
        assert.ok(entry.rebuildEvidenceIds.length > 0, `${entry.path} needs rebuild evidence`);
      }
    }
  });

  it("refuses malformed frozen baseline or current test inventories", () => {
    const malformed = structuredClone(FROZEN_LEGACY_ARCHITECTURE_PROVENANCE) as Record<string, unknown>;
    const disposition = malformed.testDisposition as Record<string, unknown>;
    disposition.currentFiles = ["tests/unit/a.test.ts", "tests/unit/a.test.ts"];
    assert.throws(() => FrozenLegacyArchitectureProvenanceSchema.parse(malformed), /must be unique/i);
  });
});
