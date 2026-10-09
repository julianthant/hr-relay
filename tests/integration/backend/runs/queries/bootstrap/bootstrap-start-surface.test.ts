
import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { flow } from "../../../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor } from "../../../../../../src/workflow-kit/workflow.js";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { FrontendBootstrapWireSchema, WorkflowBootstrapPrimitiveSchema, WorkflowStartWireSchema } from "../../../../../../src/models/dashboard/bootstrap.js";
import { EidSchema } from "../../../../../../src/rules/identity/ids.js";
import { defineWorkflowRole } from "../../../../../../src/workflow-kit/validation/module-role.js";
import { defineCanonicalInput } from "../../../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../../../src/models/workflow/presentation.js";
import { buildBootstrap, type BootstrapQueryDeps } from "../../../../../../src/backend/runs/queries/bootstrap.js";
import { descriptorSetHash } from "../../../../../../src/backend/app/composition/dashboard/compose.js";
import { projectStartSteps } from "../../../../../../src/backend/runs/start/step-selection.js";
import { INTAKE_PROJECTIONS } from "../../../../../../src/backend/app/registries/workflow-registry.js";
import { WORKFLOW_DESCRIPTORS } from "../../../../../../src/workflows/descriptor-registry.js";
import { FixtureReadReceipt } from "../../../../../support/fixtures/descriptor-fixtures.js";
import { AT, makeWorld, type DashboardWorld } from "../../../../../support/helpers/backend/dashboard-harness.js";
import { healthyDashboardPreflightReport } from "../../../../../support/fixtures/preflight-seams.js";
import { AUDITING_FORM, FOLDING_FORM, omissionCascadingDescriptor, READING_FORM } from "../../../../../support/fixtures/start-step-omission-fixtures.js";

const VersionSevenInput = z.strictObject({ eid: EidSchema });
const VersionSevenCanonicalInput = defineCanonicalInput(
  VersionSevenInput,
  z.strictObject({ eid: EidSchema }),
  [{ eid: "10873698" }],
);
const VERSION_SEVEN_DESCRIPTOR = defineWorkflowDescriptor({
  id: "version-seven-fixture",
  version: 7,
  contractFingerprint: descriptorSetHash(["version-seven-fixture"]),
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
  flow: flow(VersionSevenInput).step("probe", FixtureReadReceipt, {
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
    descriptorSetHash: descriptorSetHash(WORKFLOW_DESCRIPTORS.map((d) => d.contractFingerprint)),
    settingsSchemaHash: descriptorSetHash(["settings-schema"]),
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
        "person-lookup": { searching: ["ucpath"], "cross-verify": ["crm"], "active-status": [], "crm-dates": ["crm"] },
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

  it("refuses a start control arm that names a field kind the form vocabulary does not close over", () => {
    const step = {
      key: "reading",
      label: "Reading",
      includedByDefault: true,
      control: {
        state: "omittable",
        form: { fields: [{ key: "value", label: "Value", kind: "free-form" }] },
        forces: [],
      },
    };
    expect(WorkflowStartWireSchema.safeParse({
      enqueue: "reject-active", version: 1, spreadsheetIntake: false, steps: [step],
    }).success).toBe(false);
  });

  it("refuses a start block carrying a field the modal does not read", () => {
    const block = { enqueue: "reject-active", version: 1, inputRun: undefined, note: "extra" };
    expect(WorkflowStartWireSchema.safeParse(block).success).toBe(false);
  });


  it("requires the version — a modal cannot guess which shape it is starting", () => {
    const block = { enqueue: "reject-active" };
    expect(WorkflowStartWireSchema.safeParse(block).success).toBe(false);
  });

  it("refuses a version that is not a positive integer", () => {
    for (const version of [0, -1, 1.5]) {
      expect(
        WorkflowStartWireSchema.safeParse({ enqueue: "reject-active", version }).success,
        String(version),
      ).toBe(false);
    }
  });
});
