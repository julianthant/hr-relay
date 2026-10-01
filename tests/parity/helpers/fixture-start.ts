import {
FrontendBootstrapWireSchema,
type FrontendBootstrapWire,
} from "../../../src/domain/dashboard/bootstrap.js";
import {
DashboardDayWireSchema,
type DashboardDayWire
} from "../../../src/domain/dashboard/projection.js";
import { StartPlanWireSchema as StartPlanResponseSchema,type StartPlanWire as StartPlanResponse } from "../../../src/domain/dashboard/start-plan.js";
import { descriptorSetHash } from "../../../src/backend/app/dashboard/compose.js";
import { projectStartSteps,startStepWireControl } from "../../../src/backend/runs/start/step-selection.js";
import {
WORKFLOW_MODULES,
} from "../../../src/backend/app/control/workflow-registry.js";
import { separationsDescriptor } from "../../helpers/registered-workflows.js";
import { FIXTURE_BOOTSTRAP } from "./fixture-bootstrap.js";
import { CONFIG_FINGERPRINT,CONTRACT_FINGERPRINT,uuidOf,WORKFLOW_ID } from "./fixture-identity.js";
import { FIXTURE_DAY_WIRE } from "./fixture-queue.js";


/**
 * The start-picker reference uses the active registry while the day fixture
 * remains the Person Lookup queue corpus. Keeping these separate prevents a
 * picker change from redrawing unrelated queue references.
 */
const START_PICKER_MODULES = WORKFLOW_MODULES;


export const FIXTURE_START_PICKER_DESCRIPTOR_HASH = descriptorSetHash(
  START_PICKER_MODULES.map(({ descriptor }) => descriptor.contractFingerprint),
);


export const FIXTURE_START_PICKER_BOOTSTRAP: FrontendBootstrapWire = FrontendBootstrapWireSchema.parse({
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
      version: module.descriptor.version,
      steps: projectStartSteps(module.descriptor).map((step) => ({
        key: step.key,
        label: step.label,
        includedByDefault: step.includedByDefault,
        control: startStepWireControl(step.control),
      })),
      ...(module.descriptor.surfaces.inputRun === undefined
        ? {}
        : { inputRun: module.descriptor.surfaces.inputRun }),
      // D296, read off each MODULE's own declaration exactly as `buildBootstrap`
      // reads it. `intake` is an optional property a module may not declare at
      // all, so the `in` test is what distinguishes "declares none" from
      // "declares one" without an invented default — this profile carries one
      // spreadsheet-capable workflow and one that is not.
      spreadsheetIntake: "intake" in module && module.intake !== undefined,
    },
  })),
});


/** The start-picker profile's day and bootstrap name the same current descriptor set. */
export const FIXTURE_START_PICKER_DAY_WIRE: DashboardDayWire = DashboardDayWireSchema.parse({
  ...FIXTURE_DAY_WIRE,
  descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
});


/* ── start plan + command results ────────────────────────────────────────── */

export const FIXTURE_START_PLAN: StartPlanResponse = StartPlanResponseSchema.parse({
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


/**
 * The Separations Start Run references exercise the dialog's real typed-input
 * and two-command continuity. The plan rows deliberately name themselves as
 * fixture layout evidence: the fixture cannot honestly derive the composition
 * planner's workflow plan, so it must not imply that it did.
 */
export const FIXTURE_SEPARATIONS_START_PLAN: StartPlanResponse = StartPlanResponseSchema.parse({
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
