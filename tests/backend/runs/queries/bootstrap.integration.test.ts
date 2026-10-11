
import assert_m0 from "node:assert/strict";
import { describe as describe_m0,expect as expect_m0,it as it_m0 } from "vitest";
import { z as z_m0 } from "zod";
import { descriptorSetHash as descriptorSetHash_m0 } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { INTAKE_PROJECTIONS as INTAKE_PROJECTIONS_m0 } from "../../../../src/backend/app/registries/workflow-registry.js";
import { buildBootstrap as buildBootstrap_m0,type BootstrapQueryDeps as BootstrapQueryDeps_m0 } from "../../../../src/backend/runs/queries/bootstrap.js";
import { projectStartSteps as projectStartSteps_m0 } from "../../../../src/backend/runs/start/step-selection.js";
import { FrontendBootstrapWireSchema as FrontendBootstrapWireSchema_m0,WorkflowBootstrapPrimitiveSchema as WorkflowBootstrapPrimitiveSchema_m0 } from "../../../../src/models/dashboard/bootstrap.js";
import { defineCanonicalInput as defineCanonicalInput_m0 } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS as STANDARD_WORKFLOW_ACTIONS_m0 } from "../../../../src/models/workflow/presentation.js";
import { EidSchema as EidSchema_m0 } from "../../../../src/rules/identity/ids.js";
import { manualClock as manualClock_m0 } from "../../../../src/rules/time/clock.js";
import { flow as flow_m0 } from "../../../../src/workflow-kit/flow.js";
import { defineWorkflowRole as defineWorkflowRole_m0 } from "../../../../src/workflow-kit/validation/module-role.js";
import { defineWorkflowDescriptor as defineWorkflowDescriptor_m0 } from "../../../../src/workflow-kit/workflow.js";
import { WORKFLOW_DESCRIPTORS as WORKFLOW_DESCRIPTORS_m0 } from "../../../../src/workflows/descriptor-registry.js";
import { FixtureReadReceipt as FixtureReadReceipt_m0 } from "../../../support/fixtures/descriptor-fixtures.js";
import { healthyDashboardPreflightReport as healthyDashboardPreflightReport_m0 } from "../../../support/fixtures/preflight-seams.js";
import { AUDITING_FORM as AUDITING_FORM_m0,FOLDING_FORM as FOLDING_FORM_m0,omissionCascadingDescriptor as omissionCascadingDescriptor_m0,READING_FORM as READING_FORM_m0 } from "../../../support/fixtures/start-step-omission-fixtures.js";
import { AT as AT_m0,makeWorld as makeWorld_m0,type DashboardWorld as DashboardWorld_m0 } from "../../../support/helpers/backend/dashboard-harness.js";

import assert_m1 from "node:assert/strict";
import { describe as describe_m1,expect as expect_m1,it as it_m1 } from "vitest";
import { z as z_m1 } from "zod";
import { descriptorSetHash as descriptorSetHash_m1 } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { buildBootstrap as buildBootstrap_m1,type BootstrapQueryDeps as BootstrapQueryDeps_m1 } from "../../../../src/backend/runs/queries/bootstrap.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH as PROTECTED_SETTINGS_SCHEMA_HASH_m1 } from "../../../../src/models/config/protected-settings.js";
import { FrontendBootstrapWireSchema as FrontendBootstrapWireSchema_m1,StorageHealthSummaryWireSchema as StorageHealthSummaryWireSchema_m1 } from "../../../../src/models/dashboard/bootstrap.js";
import { PreflightReportSchema as PreflightReportSchema_m1 } from "../../../../src/models/preflight/preflight.js";
import { manualClock as manualClock_m1 } from "../../../../src/rules/time/clock.js";
import { defineWorkflowRole as defineWorkflowRole_m1 } from "../../../../src/workflow-kit/validation/module-role.js";
import { fixtureDescriptor as fixtureDescriptor_m1 } from "../../../support/fixtures/descriptor-fixtures.js";
import { AT as AT_m1,makeWorld as makeWorld_m1,type DashboardWorld as DashboardWorld_m1 } from "../../../support/helpers/backend/dashboard-harness.js";


{


const VersionSevenInput = z_m0.strictObject({ eid: EidSchema_m0 });
const VersionSevenCanonicalInput = defineCanonicalInput_m0(
  VersionSevenInput,
  z_m0.strictObject({ eid: EidSchema_m0 }),
  [{ eid: "10873698" }],
);
const VERSION_SEVEN_DESCRIPTOR = defineWorkflowDescriptor_m0({
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
  actions: STANDARD_WORKFLOW_ACTIONS_m0,
  surfaces: {},
  details: [],
  identity: { matchKey: ({ eid }) => `eid:${eid}` },
  presentation: { title: ({ eid }) => `EID ${eid}` },
  scenarios: ["ucpath/person-org-happy"],
  flow: flow_m0(VersionSevenInput).step("probe", FixtureReadReceipt_m0, {
    dependsOn: [],
    replay: "checkpoint",
    bind: ({ input }) => ({ eid: input.eid }),
  }).build({
    schema: z_m0.strictObject({ eid: EidSchema_m0 }),
    dependsOn: ["probe"],
    derive: ({ input }) => ({ eid: input.eid }),
  }),
});

// Flatten module roles only; preserve descriptor facts to test the bootstrap projection independently.
function depsOf(world: DashboardWorld_m0): BootstrapQueryDeps_m0 {
  return {
    appVersion: "0.1.0",
    clock: manualClock_m0(AT_m0),
    modules: WORKFLOW_DESCRIPTORS_m0.map((descriptor) => ({
      descriptor,
      role: defineWorkflowRole_m0({ kind: "standalone" }),

      ...(INTAKE_PROJECTIONS_m0[String(descriptor.id)] === undefined
        ? {}
        : { intake: INTAKE_PROJECTIONS_m0[String(descriptor.id)] }),
    })),
    descriptorSetHash: descriptorSetHash_m0(WORKFLOW_DESCRIPTORS_m0.map((d) => d.contractFingerprint)),
    settingsSchemaHash: descriptorSetHash_m0(["settings-schema"]),
    projection: world.projection,
    authorityMeta: () => ({ schemaVersion: 13, authorityGeneration: 4 }),
    backupSummary: () => "current",
    preflightReport: () => healthyDashboardPreflightReport_m0(manualClock_m0(AT_m0)),
  };
}

describe_m0("bootstrap start-surface block", () => {
  it_m0("serves, for every registered workflow, exactly what its descriptor declares", () => {
    const world = makeWorld_m0();
    try {
      // Re-parsed on purpose: the producer's own `.parse` is what makes this a
      // statement about the WIRE rather than about an object literal.
      const wire = FrontendBootstrapWireSchema_m0.parse(buildBootstrap_m0(depsOf(world)));
      const served = new Map(
        WorkflowBootstrapPrimitiveSchema_m0.array().parse(wire.workflows)
          .map((entry) => [String(entry.id), entry.start] as const),
      );
      expect_m0([...served.keys()].sort())
        .toEqual(WORKFLOW_DESCRIPTORS_m0.map((d) => String(d.id)).sort());
      const systemsByStep: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
        "person-lookup": { searching: ["ucpath"], "cross-verify": ["crm"], "active-status": [], "crm-dates": ["crm"] },
        separations: { "kuali-extraction": ["kuali"], "identity-check": ["ucpath"], "job-summary": ["ucpath"], "kronos-timecard": ["new-kronos"], "ucpath-transaction": ["ucpath"], "kuali-finalization": ["ucpath", "kuali"] },
      };
      for (const descriptor of WORKFLOW_DESCRIPTORS_m0) {
        expect_m0(served.get(String(descriptor.id)), String(descriptor.id)).toEqual({
          ...(descriptor.summary === undefined ? {} : { summary: descriptor.summary }),
          enqueue: descriptor.enqueue,
          version: descriptor.version,

          spreadsheetIntake: INTAKE_PROJECTIONS_m0[String(descriptor.id)] !== undefined,
          steps: projectStartSteps_m0(descriptor).map((step) => ({
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
      expect_m0(doors).toContain(true);
    } finally {
      world.dispose();
    }
  });

  it_m0("serves a synthetic bumped descriptor version verbatim", () => {
    const world = makeWorld_m0();
    try {
      const wire = FrontendBootstrapWireSchema_m0.parse(buildBootstrap_m0({
        ...depsOf(world),
        modules: [{
          descriptor: VERSION_SEVEN_DESCRIPTOR,
          role: defineWorkflowRole_m0({ kind: "standalone" }),
        }],
      }));

      expect_m0(wire.workflows).toHaveLength(1);
      expect_m0(WorkflowBootstrapPrimitiveSchema_m0.array().parse(wire.workflows)[0]?.start.version).toBe(VERSION_SEVEN_DESCRIPTOR.version);
      expect_m0(WorkflowBootstrapPrimitiveSchema_m0.array().parse(wire.workflows)[0]?.start.inputRun).toBeUndefined();
    } finally {
      world.dispose();
    }
  });


  it_m0("serves a declared omission's form and cascade on the step's control", () => {
    const world = makeWorld_m0();
    try {
      const wire = FrontendBootstrapWireSchema_m0.parse(buildBootstrap_m0({
        ...depsOf(world),
        modules: [{
          descriptor: omissionCascadingDescriptor_m0,
          role: defineWorkflowRole_m0({ kind: "standalone" }),
        }],
      }));
      const served = WorkflowBootstrapPrimitiveSchema_m0.array().parse(wire.workflows)[0]?.start.steps;
      assert_m0.deepEqual(served, [
        {
          key: "reading",
          label: "Reading",
          includedByDefault: true,
          systems: ["ucpath"],
          control: { state: "omittable", form: READING_FORM_m0, forces: ["folding"] },
        },
        {
          key: "folding",
          label: "Folding",
          includedByDefault: true,
          systems: ["ucpath"],
          control: { state: "omittable", form: FOLDING_FORM_m0, forces: [] },
        },
        {
          key: "auditing",
          label: "Auditing",
          includedByDefault: true,
          systems: ["ucpath"],
          control: { state: "omittable", form: AUDITING_FORM_m0, forces: [] },
        },
      ]);
    } finally {
      world.dispose();
    }
  });
});
}

{


type BackupSummary = ReturnType<BootstrapQueryDeps_m1["backupSummary"]>;

/** The wire's own vocabulary, read off the schema — never retyped. */
function armsOf(key: "authority" | "backup"): readonly string[] {
  const field = StorageHealthSummaryWireSchema_m1.shape[key];
  assert_m1.ok(field instanceof z_m1.ZodEnum, `${key} is expected to be a closed enum`);
  return Object.values(field.enum).map(String);
}

function depsOf(
  world: DashboardWorld_m1,
  storage: Readonly<{ authorityReachable: boolean; backup: BackupSummary }>,
): BootstrapQueryDeps_m1 {
  return {
    appVersion: "0.1.0",
    clock: manualClock_m1(AT_m1),
    modules: [{ descriptor: fixtureDescriptor_m1, role: defineWorkflowRole_m1({ kind: "standalone" }) }],
    descriptorSetHash: descriptorSetHash_m1([fixtureDescriptor_m1.contractFingerprint]),
    settingsSchemaHash: descriptorSetHash_m1(["settings-schema"]),
    projection: world.projection,
    authorityMeta: () => {

      if (!storage.authorityReachable) throw new Error("authority database is unreadable");
      return { schemaVersion: 13, authorityGeneration: 4 };
    },
    backupSummary: () => storage.backup,
    preflightReport: () => PreflightReportSchema_m1.parse({
      configFingerprint: "a".repeat(64),
      checkedAt: AT_m1.toISOString(),
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

describe_m1("bootstrap storage summary", () => {
  it_m1("serves both ordinary and protected command schema identities", () => {
    const world = makeWorld_m1();
    try {
      const deps = depsOf(world, { authorityReachable: true, backup: "current" });
      const wire = buildBootstrap_m1(deps);
      assert_m1.equal(wire.settingsSchemaHash, deps.settingsSchemaHash);
      assert_m1.equal(wire.protectedSchemaHash, PROTECTED_SETTINGS_SCHEMA_HASH_m1);
      assert_m1.equal(FrontendBootstrapWireSchema_m1.safeParse({
        ...wire,
        protectedSchemaHash: undefined,
      }).success, false);
    } finally {
      world.dispose();
    }
  });

  it_m1("projects the retained strict preflight report in registry order", () => {
    const world = makeWorld_m1();
    try {
      const wire = buildBootstrap_m1(depsOf(world, { authorityReachable: true, backup: "current" }));
      assert_m1.deepEqual(wire.preflight, [
        {
          id: "runtime.compatibility",
          label: "runtime.compatibility",
          verdict: "pass",
          detail: "runtime compatible",
          blocks: [],
          checkedAt: AT_m1.toISOString(),
        },
        {
          id: "config.valid",
          label: "config.valid",
          verdict: "pass",
          detail: "config valid",
          blocks: [],
          checkedAt: AT_m1.toISOString(),
        },
        {
          id: "filesystem.health",
          label: "filesystem.health",
          verdict: "pass",
          detail: "filesystem healthy",
          blocks: [],
          checkedAt: AT_m1.toISOString(),
        },
        {
          id: "authority.health",
          label: "authority.health",
          verdict: "pass",
          detail: "authority healthy",
          blocks: [],
          checkedAt: AT_m1.toISOString(),
        },
        {
          id: "ports.available",
          label: "ports.available",
          verdict: "pass",
          detail: "ports available",
          blocks: [],
          checkedAt: AT_m1.toISOString(),
        },
        {
          id: "process.orphans",
          label: "process.orphans",
          verdict: "warning",
          detail: "one stale process record — operator review required",
          blocks: [],
          remediation: "review and explicitly clear stale rebuild processes or leases",
          checkedAt: AT_m1.toISOString(),
        },
      ]);
    } finally {
      world.dispose();
    }
  });

  it_m1("projects retained preflight failures with their exact blocks and remediation", () => {
    const world = makeWorld_m1();
    try {
      const deps = depsOf(world, { authorityReachable: true, backup: "current" });
      const retained = deps.preflightReport();
      const failing = PreflightReportSchema_m1.parse({
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

      const wire = buildBootstrap_m1({ ...deps, preflightReport: () => failing });

      assert_m1.ok(wire.preflight);
      assert_m1.deepEqual(wire.preflight.find(({ id }) => id === "filesystem.health"), {
        id: "filesystem.health",
        label: "filesystem.health",
        verdict: "fail",
        detail: "artifact root is not privately writable",
        blocks: ["dashboard.serve"],
        remediation: "restore the configured artifact root with mode 0700",
        checkedAt: AT_m1.toISOString(),
      });
    } finally {
      world.dispose();
    }
  });

  it_m1("emits every authority arm the wire declares", () => {
    const world = makeWorld_m1();
    try {
      const reached = new Set<string>();
      for (const authorityReachable of [true, false]) {
        const wire = buildBootstrap_m1(depsOf(world, { authorityReachable, backup: "current" }));
        // Parsed again on purpose: the producer's own `.parse` is what makes
        // this a statement about the WIRE and not about a literal.
        reached.add(FrontendBootstrapWireSchema_m1.parse(wire).storage.authority);
      }
      expect_m1([...reached].sort()).toEqual([...armsOf("authority")].sort());
    } finally {
      world.dispose();
    }
  });

  it_m1("emits every backup arm the wire declares", () => {
    const world = makeWorld_m1();
    try {
      const reached = new Set<string>();
      for (const backup of ["current", "stale", "missing"] as const) {
        const wire = buildBootstrap_m1(depsOf(world, { authorityReachable: true, backup }));
        reached.add(FrontendBootstrapWireSchema_m1.parse(wire).storage.backup);
      }
      expect_m1([...reached].sort()).toEqual([...armsOf("backup")].sort());
    } finally {
      world.dispose();
    }
  });

  it_m1("an unreachable authority still serves the backup indicator", () => {
    const world = makeWorld_m1();
    try {

      const wire = buildBootstrap_m1(depsOf(world, { authorityReachable: false, backup: "stale" }));
      assert_m1.deepEqual(
        { authority: wire.storage.authority, backup: wire.storage.backup },
        { authority: "unavailable", backup: "stale" },
      );
    } finally {
      world.dispose();
    }
  });
});
}
