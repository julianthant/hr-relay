
import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { descriptorSetHash as descriptorSetHash_m0 } from "../../../../src/backend/app/registries/workflow-registry.js";
import { INTAKE_PROJECTIONS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { buildBootstrap, type BootstrapQueryDeps } from "../../../../src/backend/runs/queries/bootstrap.js";
import { projectStartSteps } from "../../../../src/backend/runs/start/step-selection.js";
import { FrontendBootstrapWireSchema, WorkflowBootstrapPrimitiveSchema } from "../../../../src/models/dashboard/bootstrap.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { flow as flow_m0 } from "../../../../src/workflow-kit/flow.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { defineWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { WORKFLOW_DESCRIPTORS } from "../../../../src/workflows/descriptor-registry.js";
import { FixtureReadReceipt } from "../../../support/fixtures/descriptor-fixtures.js";
import { healthyDashboardPreflightReport } from "../../../support/fixtures/preflight-seams.js";
import { AUDITING_FORM, FOLDING_FORM, omissionCascadingDescriptor, READING_FORM } from "../../../support/fixtures/start-step-omission-fixtures.js";
import { AT, makeWorld, type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";

import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import { StorageHealthSummaryWireSchema } from "../../../../src/models/dashboard/bootstrap.js";
import { PreflightReportSchema } from "../../../../src/models/preflight/preflight.js";

import { fixtureDescriptor } from "../../../support/fixtures/descriptor-fixtures.js";

{

const VersionSevenInput = z.strictObject({ eid: EidSchema });
const VersionSevenCanonicalInput = defineCanonicalInput(
  VersionSevenInput,
  z.strictObject({ eid: EidSchema }),
  [{ eid: "10873698" }],
);
const VERSION_SEVEN_DESCRIPTOR = defineWorkflowDescriptor({
  id: "version-seven-fixture",
  version: 7,
  contractFingerprint: descriptorSetHash_m0(["version-seven-fixture"]),
  code: "vs",
  label: "Version seven fixture",
  icon: "Search",
  category: "operations",
  canonicalInput: VersionSevenCanonicalInput,
  inputSubject: "eid",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {},
  details: [],
  identity: { matchKey: ({ eid }) => `eid:${eid}` },
  presentation: { title: ({ eid }) => `EID ${eid}` },
  scenarios: ["ucpath/person-org-happy"],
  flow: flow_m0(VersionSevenInput).step("probe", FixtureReadReceipt, {
    dependsOn: [],
    replay: "checkpoint",
    bind: ({ input }) => ({ eid: input.eid }),
  }).build({
    schema: z.strictObject({ eid: EidSchema }),
    dependsOn: ["probe"],
    derive: ({ input }) => ({ eid: input.eid }),
  }),
});

// Flatten module roles only; preserve descriptor facts to test the bootstrap projection independently.
function depsOf(world: DashboardWorld): BootstrapQueryDeps {
  return {
    appVersion: "0.1.0",
    clock: manualClock(AT),
    modules: WORKFLOW_DESCRIPTORS.map((descriptor) => ({
      descriptor,
      role: defineWorkflowRole({ kind: "standalone" }),

      ...(INTAKE_PROJECTIONS[String(descriptor.id)] === undefined
        ? {}
        : { intake: INTAKE_PROJECTIONS[String(descriptor.id)] }),
    })),
    descriptorSetHash: descriptorSetHash_m0(WORKFLOW_DESCRIPTORS.map((d) => d.contractFingerprint)),
    settingsSchemaHash: descriptorSetHash_m0(["settings-schema"]),
    projection: world.projection,
    authorityMeta: () => ({ schemaVersion: 13, authorityGeneration: 4 }),
    backupSummary: () => "current",
    preflightReport: () => healthyDashboardPreflightReport(manualClock(AT)),
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
      const systemsByStep: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
        "person-lookup": { searching: ["ucpath"], "cross-verify": ["crm"], "active-status": ["ucpath"], "crm-dates": ["crm"] },
        separations: { "kuali-extraction": ["kuali"], "identity-check": ["ucpath"], "job-summary": ["ucpath"], "kronos-timecard": ["new-kronos"], "ucpath-transaction": ["ucpath"], "kuali-finalization": ["ucpath", "kuali"] },
      };
      for (const descriptor of WORKFLOW_DESCRIPTORS) {
        expect(served.get(String(descriptor.id)), String(descriptor.id)).toEqual({
          ...(descriptor.summary === undefined ? {} : { summary: descriptor.summary }),
          enqueue: descriptor.enqueue,
          version: descriptor.version,

          spreadsheetIntake: INTAKE_PROJECTIONS[String(descriptor.id)] !== undefined,
          steps: projectStartSteps(descriptor).map((step) => ({
            key: step.key,
            label: step.label,
            includedByDefault: step.includedByDefault,
            systems: systemsByStep[String(descriptor.id)]?.[step.key],
            // Reconstruct the control union independently; calling the producer helper would compare it with itself.
            control: step.control.state === "selectable"
              ? { state: "selectable", inputField: step.control.inputField }
              : step.control.state === "omittable"
                ? { state: "omittable", form: step.control.form, forces: step.control.forces }
                : { state: "required", reason: step.control.reason },
          })),
          ...(descriptor.surfaces.inputRun === undefined
            ? {}
            : { inputRun: descriptor.surfaces.inputRun }),
        });
      }
      // Both operator workflows carry a typed start door. The absent arm is
      // exercised by the synthetic descriptor below.
      const doors = [...served.values()].map((start) => start?.inputRun !== undefined);
      expect(doors).toContain(true);
    } finally {
      world.dispose();
    }
  });

  it("serves a synthetic bumped descriptor version verbatim", () => {
    const world = makeWorld();
    try {
      const wire = FrontendBootstrapWireSchema.parse(buildBootstrap({
        ...depsOf(world),
        modules: [{
          descriptor: VERSION_SEVEN_DESCRIPTOR,
          role: defineWorkflowRole({ kind: "standalone" }),
        }],
      }));

      expect(wire.workflows).toHaveLength(1);
      expect(WorkflowBootstrapPrimitiveSchema.array().parse(wire.workflows)[0]?.start.version).toBe(VERSION_SEVEN_DESCRIPTOR.version);
      expect(WorkflowBootstrapPrimitiveSchema.array().parse(wire.workflows)[0]?.start.inputRun).toBeUndefined();
    } finally {
      world.dispose();
    }
  });

  it("serves a declared omission's form and cascade on the step's control", () => {
    const world = makeWorld();
    try {
      const wire = FrontendBootstrapWireSchema.parse(buildBootstrap({
        ...depsOf(world),
        modules: [{
          descriptor: omissionCascadingDescriptor,
          role: defineWorkflowRole({ kind: "standalone" }),
        }],
      }));
      const served = WorkflowBootstrapPrimitiveSchema.array().parse(wire.workflows)[0]?.start.steps;
      assert.deepEqual(served, [
        {
          key: "reading",
          label: "Reading",
          includedByDefault: true,
          systems: ["ucpath"],
          control: { state: "omittable", form: READING_FORM, forces: ["folding"] },
        },
        {
          key: "folding",
          label: "Folding",
          includedByDefault: true,
          systems: ["ucpath"],
          control: { state: "omittable", form: FOLDING_FORM, forces: [] },
        },
        {
          key: "auditing",
          label: "Auditing",
          includedByDefault: true,
          systems: ["ucpath"],
          control: { state: "omittable", form: AUDITING_FORM, forces: [] },
        },
      ]);
    } finally {
      world.dispose();
    }
  });
});
}

{

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
    descriptorSetHash: descriptorSetHash_m0([fixtureDescriptor.contractFingerprint]),
    settingsSchemaHash: descriptorSetHash_m0(["settings-schema"]),
    projection: world.projection,
    authorityMeta: () => {

      if (!storage.authorityReachable) throw new Error("authority database is unreadable");
      return { schemaVersion: 13, authorityGeneration: 4 };
    },
    backupSummary: () => storage.backup,
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
  it("serves both ordinary and protected command schema identities", () => {
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
      for (const backup of ["current", "stale", "missing", "unavailable"] as const) {
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
}
