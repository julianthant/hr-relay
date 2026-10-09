import {
FrontendBootstrapWireSchema,
type FrontendBootstrapWire,
} from "../../../../src/models/dashboard/bootstrap.js";
import {
  SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID
} from "../../../../src/models/dashboard/settings.js";
import { descriptorSetHash } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { projectStartSteps,startStepWireControl } from "../../../../src/backend/runs/start/step-selection.js";
import { personLookupDescriptor,personLookupModule } from "../../helpers/registered-workflows.js";
import { at,CONTRACT_FINGERPRINT,FIXTURE_APP_VERSION,FIXTURE_DESCRIPTOR_HASH,FIXTURE_NOW,WORKFLOW_ID } from "./fixture-identity.js";


/* ── bootstrap ───────────────────────────────────────────────────────────── */

export const FIXTURE_BOOTSTRAP: FrontendBootstrapWire = FrontendBootstrapWireSchema.parse({
  wireVersion: 1,
  appVersion: FIXTURE_APP_VERSION,
  descriptorHash: FIXTURE_DESCRIPTOR_HASH,
  settingsSchemaHash: descriptorSetHash(["settings-schema"]),
  protectedSchemaHash: descriptorSetHash(["protected-settings-schema"]),
  projectionGeneration: 1,
  actor: { id: "local-operator", label: "Local operator" },
  serverClock: { now: FIXTURE_NOW, zone: "America/Los_Angeles" },
  storage: { authority: "healthy", backup: "current", checkedAt: at(0) },
  workflows: [{
    id: WORKFLOW_ID,
    code: personLookupDescriptor.code,
    label: personLookupDescriptor.label,
    categoryId: personLookupDescriptor.category,
    descriptorFingerprint: CONTRACT_FINGERPRINT,
    availability: { state: "available" },

    role: { kind: "standalone" },

    start: {
      ...(personLookupDescriptor.summary === undefined
        ? {}
        : { summary: personLookupDescriptor.summary }),
      enqueue: personLookupDescriptor.enqueue,
      // Use a non-default version so the corpus detects a client that hardcodes version 1.
      version: 7,
      steps: projectStartSteps(personLookupDescriptor).map((step) => ({
        key: step.key,
        label: step.label,
        includedByDefault: step.includedByDefault,
        control: startStepWireControl(step.control),
      })),
      ...(personLookupDescriptor.surfaces.inputRun === undefined
        ? {}
        : { inputRun: personLookupDescriptor.surfaces.inputRun }),

      spreadsheetIntake: personLookupModule.intake !== undefined,
    },
  }],
  systemInstances: [
    { system: "ucpath", prod: "available", test: { state: "available" } },
    { system: "crm", prod: "available", test: { state: "unavailable", code: "not-configured", reason: "no CRM test instance is configured" } },
  ],

  settingsSections: [
    { id: "storage", label: "Storage checks", revision: 1 },
    { id: SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID, label: "Workflow capabilities", revision: 1 },
  ],
  featureAvailability: [
    { feature: "ocr", availability: { state: "unavailable", code: "deferred", reason: "OCR review lands in 2h" } },
    { feature: "archive", availability: { state: "unavailable", code: "deferred", reason: "archive lands in 2i" } },
    { feature: "workflow-editor", availability: { state: "unavailable", code: "deferred", reason: "the editor lands in a later phase" } },
  ],
});
