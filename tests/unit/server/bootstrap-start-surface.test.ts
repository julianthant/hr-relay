/**
 * D264/D11 — the run modal's three start facts are SERVED, and the descriptor
 * registry leaves the browser bundle.
 *
 * D251 read `summary`, `enqueue` and `surfaces.inputRun` straight off the
 * bundled `WORKFLOW_DESCRIPTORS` tuple on the argument that serving a fact the
 * bundle already carries would give one surface two sources for one value.
 * That argument holds only while the bundle carries the tuple — and carrying it
 * ships every registered workflow's whole descriptor closure to the browser for
 * three plain-data fields. D264 amends it the other way: the fields are served,
 * the tuple is not bundled, and there is still exactly ONE source.
 *
 * So this pins the direction that makes the amendment safe: for EVERY registered
 * descriptor, the block the server emits is byte-equal to what that descriptor
 * declares. A served block that drifted from the registry would be the second
 * source D251 was right to refuse.
 */
import { describe, expect, it } from "vitest";
import { manualClock } from "../../../src/domain/clock.js";
import {
  FrontendBootstrapWireSchema,
  WorkflowBootstrapPrimitiveSchema,
  WorkflowStartWireSchema,
} from "../../../src/domain/dashboard/bootstrap.js";
import { defineWorkflowRole } from "../../../src/domain/workflow/module-role.js";
import { buildBootstrap, type BootstrapQueryDeps } from "../../../src/server/dashboard/queries/bootstrap.js";
import { descriptorSetHash } from "../../../src/server/dashboard/compose.js";
import { WORKFLOW_DESCRIPTORS } from "../../../src/workflows/descriptor-registry.js";
import { AT, makeWorld, type DashboardWorld } from "./helpers/dashboard-harness.js";

/**
 * Every registered descriptor, each served as a `standalone` module.
 *
 * The composition's real role is `composition` and its chunks declare
 * `chunk-harness of` it — a nesting the wire's own `superRefine` checks. That
 * fact is D219's and is pinned where it lives; flattening it here keeps this
 * test about the start block and nothing else.
 */
function depsOf(world: DashboardWorld): BootstrapQueryDeps {
  return {
    appVersion: "0.1.0",
    clock: manualClock(AT),
    modules: WORKFLOW_DESCRIPTORS.map((descriptor) => ({
      descriptor,
      role: defineWorkflowRole({ kind: "standalone" }),
    })),
    descriptorSetHash: descriptorSetHash(WORKFLOW_DESCRIPTORS.map((d) => d.contractFingerprint)),
    settingsSchemaHash: descriptorSetHash(["settings-schema"]),
    projection: world.projection,
    authorityMeta: () => ({ schemaVersion: 13, authorityGeneration: 4 }),
    backupSummary: () => "current",
    advisoryAvailability: () => ({
      state: "unavailable",
      code: "not-configured",
      reason: "no ai.advisory provider is composed in this test",
    }),
  };
}

describe("bootstrap start-surface block", () => {
  it("serves, for every registered workflow, exactly what its descriptor declares", () => {
    const world = makeWorld();
    try {
      // Re-parsed on purpose: the producer's own `.parse` is what makes this a
      // statement about the WIRE rather than about an object literal.
      const wire = FrontendBootstrapWireSchema.parse(buildBootstrap(depsOf(world)));
      const served = new Map(
        WorkflowBootstrapPrimitiveSchema.array().parse(wire.workflows)
          .map((entry) => [String(entry.id), entry.start] as const),
      );
      expect([...served.keys()].sort())
        .toEqual(WORKFLOW_DESCRIPTORS.map((d) => String(d.id)).sort());
      for (const descriptor of WORKFLOW_DESCRIPTORS) {
        expect(served.get(String(descriptor.id)), String(descriptor.id)).toEqual({
          ...(descriptor.summary === undefined ? {} : { summary: descriptor.summary }),
          enqueue: descriptor.enqueue,
          ...(descriptor.surfaces.inputRun === undefined
            ? {}
            : { inputRun: descriptor.surfaces.inputRun }),
        });
      }
      // Non-vacuous: the corpus really does carry both arms of the optional
      // door, so "startable" and "not startable" are both being asserted.
      const doors = [...served.values()].map((start) => start?.inputRun !== undefined);
      expect(doors).toContain(true);
      expect(doors).toContain(false);
    } finally {
      world.dispose();
    }
  });

  it("refuses a start block carrying a field the modal does not read", () => {
    const block = { enqueue: "reject-active", inputRun: undefined, note: "extra" };
    expect(WorkflowStartWireSchema.safeParse(block).success).toBe(false);
  });
});
