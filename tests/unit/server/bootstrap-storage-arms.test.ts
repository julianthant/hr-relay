/**
 * Every arm of the bootstrap's storage summary is EMITTABLE by its producer.
 *
 * This exists because one of them was not. `StorageHealthSummaryWireSchema`
 * carried `authority: "degraded"` while `buildBootstrap` types the value it
 * computes as `"healthy" | "unavailable"` — the D181 shape at wire scale: a
 * complete, schema-valid, renderable state that nothing in production could
 * ever produce, and every gate green over it because a schema arm is not a
 * code path anyone runs.
 *
 * So the check is deliberately in BOTH directions and label-blind: it walks
 * the schema's own arms rather than a list retyped here, and for each one it
 * drives the producer into that state and asserts the produced document says
 * so. A new arm added to the wire without a way to reach it fails here on the
 * day it is added, not on the day an operator needs it.
 */
import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { manualClock } from "../../../src/domain/clock.js";
import {
  FrontendBootstrapWireSchema,
  StorageHealthSummaryWireSchema,
} from "../../../src/domain/dashboard/bootstrap.js";
import { buildBootstrap, type BootstrapQueryDeps } from "../../../src/server/dashboard/queries/bootstrap.js";
import { descriptorSetHash } from "../../../src/server/dashboard/compose.js";
import { fixtureDescriptor } from "../architecture/helpers/descriptor-fixtures.js";
import { AT, makeWorld, type DashboardWorld } from "./helpers/dashboard-harness.js";

type BackupSummary = ReturnType<BootstrapQueryDeps["backupSummary"]>;

/** The wire's own vocabulary, read off the schema — never retyped. */
function armsOf(key: "authority" | "backup"): readonly string[] {
  const field = StorageHealthSummaryWireSchema.shape[key];
  assert.ok(field instanceof z.ZodEnum, `${key} is expected to be a closed enum`);
  return Object.values(field.enum).map(String);
}

function depsOf(
  world: DashboardWorld,
  storage: Readonly<{ authorityReachable: boolean; backup: BackupSummary }>,
): BootstrapQueryDeps {
  return {
    appVersion: "0.1.0",
    clock: manualClock(AT),
    descriptors: [fixtureDescriptor],
    descriptorSetHash: descriptorSetHash([fixtureDescriptor.contractFingerprint]),
    settingsSchemaHash: descriptorSetHash(["settings-schema"]),
    projection: world.projection,
    authorityMeta: () => {
      // The exact shape of the real failure: `AuthorityDatabase.getMeta`
      // throws when the store cannot be read. Nothing returns a reduced
      // handle, which is the whole reason the third arm was unreachable.
      if (!storage.authorityReachable) throw new Error("authority database is unreadable");
      return { schemaVersion: 13, authorityGeneration: 4 };
    },
    backupSummary: () => storage.backup,
    advisoryAvailability: () => ({
      state: "unavailable",
      code: "not-configured",
      reason: "no ai.advisory provider is composed in this test",
    }),
  };
}

describe("bootstrap storage summary", () => {
  it("emits every authority arm the wire declares", () => {
    const world = makeWorld();
    try {
      const reached = new Set<string>();
      for (const authorityReachable of [true, false]) {
        const wire = buildBootstrap(depsOf(world, { authorityReachable, backup: "current" }));
        // Parsed again on purpose: the producer's own `.parse` is what makes
        // this a statement about the WIRE and not about a literal.
        reached.add(FrontendBootstrapWireSchema.parse(wire).storage.authority);
      }
      expect([...reached].sort()).toEqual([...armsOf("authority")].sort());
    } finally {
      world.dispose();
    }
  });

  it("emits every backup arm the wire declares", () => {
    const world = makeWorld();
    try {
      const reached = new Set<string>();
      for (const backup of ["current", "stale", "missing"] as const) {
        const wire = buildBootstrap(depsOf(world, { authorityReachable: true, backup }));
        reached.add(FrontendBootstrapWireSchema.parse(wire).storage.backup);
      }
      expect([...reached].sort()).toEqual([...armsOf("backup")].sort());
    } finally {
      world.dispose();
    }
  });

  it("an unreachable authority still serves the backup indicator", () => {
    const world = makeWorld();
    try {
      // `backupSummary` judges manifests on disk and must not depend on the
      // authority handle — the composition documents that contract, and this
      // is the arm where it matters.
      const wire = buildBootstrap(depsOf(world, { authorityReachable: false, backup: "stale" }));
      assert.deepEqual(
        { authority: wire.storage.authority, backup: wire.storage.backup },
        { authority: "unavailable", backup: "stale" },
      );
    } finally {
      world.dispose();
    }
  });
});
