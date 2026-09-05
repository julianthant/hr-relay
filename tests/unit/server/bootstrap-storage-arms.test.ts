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
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../src/domain/config/protected-settings.js";
import { PreflightReportSchema } from "../../../src/domain/preflight.js";
import {
  FrontendBootstrapWireSchema,
  StorageHealthSummaryWireSchema,
} from "../../../src/domain/dashboard/bootstrap.js";
import { defineWorkflowRole } from "../../../src/domain/workflow/module-role.js";
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
    modules: [{ descriptor: fixtureDescriptor, role: defineWorkflowRole({ kind: "standalone" }) }],
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
    preflightReport: () => PreflightReportSchema.parse({
      configFingerprint: "a".repeat(64),
      checkedAt: AT.toISOString(),
      requestedCapabilities: ["dashboard.serve"],
      results: [
        { status: "pass", check: "runtime.compatibility", summary: "runtime compatible" },
        { status: "pass", check: "config.valid", summary: "config valid" },
        { status: "pass", check: "filesystem.health", summary: "filesystem healthy" },
        { status: "pass", check: "authority.health", summary: "authority healthy" },
        { status: "pass", check: "ports.available", summary: "ports available" },
        {
          status: "warning",
          check: "process.orphans",
          summary: "one stale process record",
          impact: "operator review required",
          remediation: "review and explicitly clear stale rebuild processes or leases",
        },
      ],
    }),
  };
}

describe("bootstrap storage summary", () => {
  it("P14 serves both ordinary and protected command schema identities", () => {
    const world = makeWorld();
    try {
      const deps = depsOf(world, { authorityReachable: true, backup: "current" });
      const wire = buildBootstrap(deps);
      assert.equal(wire.settingsSchemaHash, deps.settingsSchemaHash);
      assert.equal(wire.protectedSchemaHash, PROTECTED_SETTINGS_SCHEMA_HASH);
      assert.equal(FrontendBootstrapWireSchema.safeParse({
        ...wire,
        protectedSchemaHash: undefined,
      }).success, false);
    } finally {
      world.dispose();
    }
  });

  it("projects the retained strict preflight report in registry order", () => {
    const world = makeWorld();
    try {
      const wire = buildBootstrap(depsOf(world, { authorityReachable: true, backup: "current" }));
      assert.deepEqual(wire.preflight, [
        {
          id: "runtime.compatibility",
          label: "runtime.compatibility",
          verdict: "pass",
          detail: "runtime compatible",
          blocks: [],
          checkedAt: AT.toISOString(),
        },
        {
          id: "config.valid",
          label: "config.valid",
          verdict: "pass",
          detail: "config valid",
          blocks: [],
          checkedAt: AT.toISOString(),
        },
        {
          id: "filesystem.health",
          label: "filesystem.health",
          verdict: "pass",
          detail: "filesystem healthy",
          blocks: [],
          checkedAt: AT.toISOString(),
        },
        {
          id: "authority.health",
          label: "authority.health",
          verdict: "pass",
          detail: "authority healthy",
          blocks: [],
          checkedAt: AT.toISOString(),
        },
        {
          id: "ports.available",
          label: "ports.available",
          verdict: "pass",
          detail: "ports available",
          blocks: [],
          checkedAt: AT.toISOString(),
        },
        {
          id: "process.orphans",
          label: "process.orphans",
          verdict: "warning",
          detail: "one stale process record — operator review required",
          blocks: [],
          remediation: "review and explicitly clear stale rebuild processes or leases",
          checkedAt: AT.toISOString(),
        },
      ]);
    } finally {
      world.dispose();
    }
  });

  it("projects retained preflight failures with their exact blocks and remediation", () => {
    const world = makeWorld();
    try {
      const deps = depsOf(world, { authorityReachable: true, backup: "current" });
      const retained = deps.preflightReport();
      const failing = PreflightReportSchema.parse({
        ...retained,
        results: retained.results.map((result) => result.check === "filesystem.health"
          ? {
              status: "fail",
              check: result.check,
              summary: "artifact root is not privately writable",
              blocks: ["dashboard.serve"],
              remediation: "restore the configured artifact root with mode 0700",
            }
          : result),
      });

      const wire = buildBootstrap({ ...deps, preflightReport: () => failing });

      assert.ok(wire.preflight);
      assert.deepEqual(wire.preflight.find(({ id }) => id === "filesystem.health"), {
        id: "filesystem.health",
        label: "filesystem.health",
        verdict: "fail",
        detail: "artifact root is not privately writable",
        blocks: ["dashboard.serve"],
        remediation: "restore the configured artifact root with mode 0700",
        checkedAt: AT.toISOString(),
      });
    } finally {
      world.dispose();
    }
  });

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
