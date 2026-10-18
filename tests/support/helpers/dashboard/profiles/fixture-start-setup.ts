import { WorkflowBootstrapPrimitiveSchema } from "../../../../../src/models/dashboard/bootstrap.js";
import { separationsDescriptor } from "../../registered-workflows.js";
import { FrontendBootstrapWireSchema, type FrontendBootstrapWire } from "../../../../../src/models/dashboard/bootstrap.js";
import { DashboardDayWireSchema, type DashboardDayWire } from "../../../../../src/models/dashboard/projection.js";
import { StartPlanWireSchema as StartPlanResponseSchema, type StartPlanWire as StartPlanResponse } from "../../../../../src/models/dashboard/start-plan.js";
import { descriptorSetHash } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { WORKFLOW_MODULES } from "../../../../../src/backend/app/registries/workflow-registry.js";
import type * as BootstrapTypes from "../../../../../src/backend/runs/queries/bootstrap.js";
import type * as FixtureBootstrapTypes from "../../../fixtures/dashboard/fixture-bootstrap.js";
import type * as FixtureIdentityTypes from "../../../fixtures/dashboard/fixture-identity.js";
import type * as FixtureQueueTypes from "../../../fixtures/dashboard/fixture-queue.js";


export function createFixtureStartSetup({ projectFixtureSteps, FIXTURE_BOOTSTRAP, CONFIG_FINGERPRINT, CONTRACT_FINGERPRINT, uuidOf, WORKFLOW_ID, FIXTURE_DAY_WIRE }: {
projectFixtureSteps: (module: (typeof WORKFLOW_MODULES)[number]) => ReturnType<typeof BootstrapTypes.projectWorkflowStartSteps>;
FIXTURE_BOOTSTRAP: typeof FixtureBootstrapTypes.FIXTURE_BOOTSTRAP;
CONFIG_FINGERPRINT: typeof FixtureIdentityTypes.CONFIG_FINGERPRINT;
CONTRACT_FINGERPRINT: typeof FixtureIdentityTypes.CONTRACT_FINGERPRINT;
uuidOf: typeof FixtureIdentityTypes.uuidOf;
WORKFLOW_ID: typeof FixtureIdentityTypes.WORKFLOW_ID;
FIXTURE_DAY_WIRE: typeof FixtureQueueTypes.FIXTURE_DAY_WIRE;
}) {
  const START_PICKER_MODULES = WORKFLOW_MODULES;
  const mockLookupStart = WorkflowBootstrapPrimitiveSchema.parse(FIXTURE_BOOTSTRAP.workflows[0]).start;

  const FIXTURE_START_PICKER_DESCRIPTOR_HASH = descriptorSetHash(
    START_PICKER_MODULES.map(({ descriptor }) => descriptor.contractFingerprint),
  );

  const FIXTURE_START_PICKER_BOOTSTRAP: FrontendBootstrapWire = FrontendBootstrapWireSchema.parse({
    ...FIXTURE_BOOTSTRAP,
    descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
    workflows: START_PICKER_MODULES.map((module) => ({
      id: module.descriptor.id,
      code: module.descriptor.code,
      label: module.descriptor.label,
      categoryId: module.descriptor.category,
      descriptorFingerprint: module.descriptor.contractFingerprint,
      availability: { state: "available" },
      role: module.role,
      start: {
        ...(module.descriptor.summary === undefined ? {} : { summary: module.descriptor.summary }),
        enqueue: module.descriptor.enqueue,
        version: module.descriptor.id === "person-lookup" ? 1 : module.descriptor.version,
        steps: module.descriptor.id === "person-lookup" ? mockLookupStart.steps : projectFixtureSteps(module),
        ...(module.descriptor.id === "person-lookup"
          ? { inputRun: mockLookupStart.inputRun, summary: mockLookupStart.summary }
          : module.descriptor.surfaces.inputRun === undefined ? {} : { inputRun: module.descriptor.surfaces.inputRun }),

        spreadsheetIntake: "intake" in module && module.intake !== undefined,
      },
    })),
  });

  const FIXTURE_START_PICKER_DAY_WIRE: DashboardDayWire = DashboardDayWireSchema.parse({
    ...FIXTURE_DAY_WIRE,
    descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
  });

  const FIXTURE_START_PLAN: StartPlanResponse = StartPlanResponseSchema.parse({
    wireVersion: 1,
    startPlanId: uuidOf(900),
    workflowId: WORKFLOW_ID,
    expectedVersion: 1,
    expiresAt: "2026-08-03T10:15:00.000-07:00",
    dryRun: false,
    priority: "interactive",
    plannedBy: "local-operator",
    configSnapshotId: uuidOf(901),
    fingerprints: {
      descriptorFingerprint: CONTRACT_FINGERPRINT,
      configFingerprint: CONFIG_FINGERPRINT,
      ingressSchemaHash: "c".repeat(64),
      canonicalInputSchemaHash: "d".repeat(64),
      inputFingerprint: "e".repeat(64),
    },
    planned: [
      { logicalKey: "entry:1", title: "EID 10873698", subtitle: "person lookup", matchKey: "eid:10873698" },
      { logicalKey: "entry:2", title: "Battistessa, Johnnie", subtitle: "person lookup", matchKey: "name:Battistessa, Johnnie" },
    ],
    refused: [
      { entry: 3, code: "active-run-exists", message: "an active run already exists for eid:10873698" },
    ],
  });

  const FIXTURE_SEPARATIONS_START_PLAN: StartPlanResponse = StartPlanResponseSchema.parse({
    wireVersion: 1,
    startPlanId: uuidOf(930),
    workflowId: separationsDescriptor.id,
    expectedVersion: separationsDescriptor.version,
    expiresAt: "2026-08-03T10:15:00.000-07:00",
    dryRun: false,
    priority: "interactive",
    plannedBy: "local-operator",
    configSnapshotId: uuidOf(931),
    fingerprints: {
      descriptorFingerprint: separationsDescriptor.contractFingerprint,
      configFingerprint: CONFIG_FINGERPRINT,
      ingressSchemaHash: "c".repeat(64),
      canonicalInputSchemaHash: "d".repeat(64),
      inputFingerprint: "e".repeat(64),
    },
    planned: [
      {
        logicalKey: "entry:1",
        title: "Fixture plan row",
        subtitle: "generic layout evidence",
        matchKey: "fixture:plan-row-1",
      },
    ],
    refused: [],
  });

  return { FIXTURE_START_PICKER_DESCRIPTOR_HASH, FIXTURE_START_PICKER_BOOTSTRAP, FIXTURE_START_PICKER_DAY_WIRE, FIXTURE_START_PLAN, FIXTURE_SEPARATIONS_START_PLAN };
}
