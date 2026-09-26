import {
FrontendBootstrapWireSchema,
type FrontendBootstrapWire,
} from "../../../src/domain/dashboard/bootstrap.js";
import {
  SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID
} from "../../../src/domain/dashboard/settings.js";
import { descriptorSetHash } from "../../../src/server/dashboard/compose.js";
import { projectStartSteps,startStepWireControl } from "../../../src/services/start/step-selection.js";
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
    // D219 — the served taxonomy fact. The corpus carries one standalone
    // workflow, so nothing here nests under anything.
    role: { kind: "standalone" },
    // D264/D11/C96 — the Run Modal's four start facts, now SERVED rather than read
    // off the bundled descriptor tuple. Projected from the descriptor exactly
    // as `buildBootstrap` projects it, because a fixture that composed its own
    // sentence here would photograph a modal no server can produce.
    start: {
      ...(personLookupDescriptor.summary === undefined
        ? {}
        : { summary: personLookupDescriptor.summary }),
      enqueue: personLookupDescriptor.enqueue,
      // C96's deliberate non-1 producer value. The start-run parity corpus
      // observes this as `Person Lookup v7`, so a client that guesses or
      // hardcodes v1 cannot agree with this fixture's bootstrap document.
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
      // D296 — projected from the MODULE, exactly as `buildBootstrap` projects
      // it. Person Lookup declares the tree's one intake projection, so the
      // corpus photographs the modal WITH its second start method.
      spreadsheetIntake: personLookupModule.intake !== undefined,
    },
  }],
  systemInstances: [
    { system: "ucpath", prod: "available", test: { state: "available" } },
    { system: "crm", prod: "available", test: { state: "unavailable", code: "not-configured", reason: "no CRM test instance is configured" } },
  ],
  /*
    The SERVER's served sections, spelled by the same shared constants
    `buildBootstrap` spells them with (D274 item 6, ledger 3 SE40–SE42). The
    corpus served a single invented `general` section, so the only Settings
    page it could ever have photographed was the NAMED BUILD GAP arm — "this
    build has no renderer for `general`" — and the three real panes behind the
    gear had never been rendered by the lane at all.
  */
  settingsSections: [
    { id: "storage", label: "Storage checks", revision: 1 },
    { id: SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID, label: "Workflow capabilities", revision: 1 },
  ],
  featureAvailability: [
    { feature: "ocr", availability: { state: "unavailable", code: "deferred", reason: "OCR review lands in 2h" } },
    // D178: the advisory SHIPPED, so the fixture mirrors what a real process
    // with no key composed says — `not-configured` naming the family — rather
    // than a `deferred` milestone the server no longer produces.
    {
      feature: "ai-advisory",
      availability: {
        state: "unavailable",
        code: "not-configured",
        reason: "no GEMINI_API_KEY is set, so no ai.advisory provider is composed in this process",
      },
    },
    { feature: "archive", availability: { state: "unavailable", code: "deferred", reason: "archive lands in 2i" } },
    { feature: "workflow-editor", availability: { state: "unavailable", code: "deferred", reason: "the editor lands in a later phase" } },
  ],
});
