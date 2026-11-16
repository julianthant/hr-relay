import { WorkflowBootstrapPrimitiveSchema } from "../../../../../src/models/dashboard/bootstrap.js";
import { separationsDescriptor } from "../../registered-workflows.js";
import { FrontendBootstrapWireSchema, type FrontendBootstrapWire } from "../../../../../src/models/dashboard/bootstrap.js";
import { projectWorkbookCompatibility } from "../../../../../src/models/dashboard/workbook-library.js";
import { DashboardDayWireSchema, type DashboardDayWire } from "../../../../../src/models/dashboard/projection.js";
import { StartPlanWireSchema as StartPlanResponseSchema, type StartPlanWire as StartPlanResponse } from "../../../../../src/models/dashboard/start-plan.js";
import { descriptorSetHash } from "../../../../../src/backend/app/registries/workflow-registry.js";
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
  const mockLookupStart = WorkflowBootstrapPrimitiveSchema.parse(FIXTURE_BOOTSTRAP.workflows[0]).start;

  const FIXTURE_START_PICKER_DESCRIPTOR_HASH = descriptorSetHash(
    WORKFLOW_MODULES.map(({ descriptor }) => descriptor.contractFingerprint),
  );

  const FIXTURE_START_PICKER_BOOTSTRAP: FrontendBootstrapWire = FrontendBootstrapWireSchema.parse({
    ...FIXTURE_BOOTSTRAP,
    workbookCompatibility: projectWorkbookCompatibility(WORKFLOW_MODULES.map(module => module.descriptor), []),
    descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
    workflows: WORKFLOW_MODULES.map((module) => ({
      id: module.descriptor.id,
      code: module.descriptor.code,
      label: module.descriptor.label,
      categoryId: module.descriptor.category,
      descriptorFingerprint: module.descriptor.contractFingerprint,
      availability: { state: "available" },
      role: module.role,
      start: {
        readiness: module.descriptor.requiredWorkbookFields.length === 0
          ? { scope: "workbook-sources", state: "ready" }
          : { scope: "workbook-sources", state: "unavailable", reasonCode: "WORKBOOK_LIBRARY_EMPTY",
            reason: "Import a Library spreadsheet before selecting a workflow source.",
            fixAction: { kind: "import-workbook", workflowId: module.descriptor.id } },
        ...(module.descriptor.summary === undefined ? {} : { summary: module.descriptor.summary }),
        enqueue: module.descriptor.enqueue,
        version: module.descriptor.id === "person-lookup" ? 1 : module.descriptor.version,
        steps: module.descriptor.id === "person-lookup" ? mockLookupStart.steps : projectFixtureSteps(module),
        ...(module.descriptor.id === "person-lookup"
          ? { inputRun: mockLookupStart.inputRun, summary: mockLookupStart.summary }
          : module.descriptor.surfaces.inputRun === undefined ? {} : { inputRun: module.descriptor.surfaces.inputRun }),
        ...(module.descriptor.surfaces.uploadRun === undefined ? {} : { uploadRun: module.descriptor.surfaces.uploadRun }),

        ...(module.descriptor.surfaces.uploadRun === undefined ? {} : { uploadRun: module.descriptor.surfaces.uploadRun }),
        spreadsheetIntake: "intake" in module && module.intake !== undefined, requiredWorkbookFields: [...module.descriptor.requiredWorkbookFields],
        ...(module.descriptor.workbookReference === undefined ? {} : { workbookReference: module.descriptor.workbookReference }),
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
