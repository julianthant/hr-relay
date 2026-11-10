import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { descriptorRuntimeNodes, workflowProjections } from "../../../workflow-kit/workflow.js";
import { runtimeTimeZone, type Clock } from "../../../rules/time/clock.js";
import { PreflightReportSchema } from "../../../models/preflight/preflight.js";
import { z } from "zod";
import { FrontendBootstrapWireSchema, type FrontendBootstrapWire, type WorkflowStartWire, type WorkflowStartReadiness } from "../../../models/dashboard/bootstrap.js";
import { SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID } from "../../../models/dashboard/settings.js";
import { BrowserSystemIdSchema, LOCAL_OPERATOR_ACTOR_ID, type Fingerprint } from "../../../rules/identity/ids.js";
import type { WorkflowModuleRole } from "../../../workflow-kit/validation/module-role.js";
import { projectStartSteps, startStepWireControl } from "../start/step-selection.js";
import type { RunQueueProjection } from "../projections/run-queue-projection.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../models/config/protected-settings.js";
import type { WorkbookLibraryService, WorkbookReferenceWorkflow } from "../../workbooks/workbook-library-service.js";

import type { WorkbookReferenceSlot } from "../../../models/dashboard/workbook-library.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";

interface BootstrapModuleView {
  readonly descriptor: AnyWorkflowDescriptor;
  readonly role: WorkflowModuleRole;

  readonly intake?: unknown;
}

export interface BootstrapQueryDeps {
  readonly appVersion: string;
  readonly actorLabel: () => string;
  readonly clock: Clock;
  /** Composition's local-calendar authority, shared with Activity summaries. */
  readonly timeZone?: string;
  /** The composition root's own tuple — never a re-listed copy of it. */
  readonly modules: readonly BootstrapModuleView[];
  readonly descriptorSetHash: Fingerprint;
  readonly settingsSchemaHash: Fingerprint;
  readonly projection: Pick<RunQueueProjection, "generation">;
  /** Probes the authority store; throws when it cannot be reached. */
  readonly authorityMeta: () => { schemaVersion: number; authorityGeneration: number };
  readonly workbookReferences: (workflows: readonly WorkbookReferenceWorkflow[]) => ReturnType<WorkbookLibraryService["references"]>;
  /** The one retained report produced by the composed preflight authority. */
  readonly preflightReport: () => z.infer<typeof PreflightReportSchema>;
}

const DEFERRED_FEATURES = [
  ["archive", "archive snapshots land with the version service in 2i"],
  ["workflow-editor", "the editor is a Phase-3 surface"],
] as const;

export function projectWorkflowStartSteps(descriptor: AnyWorkflowDescriptor): WorkflowStartWire["steps"] {
  const nodes = descriptorRuntimeNodes(descriptor);
  return projectStartSteps(descriptor).map(step => {
    const category = descriptor.timeline.find(entry => String(entry.key) === step.key);
    if (category === undefined) throw new Error("START_STEP_TIMELINE_UNAVAILABLE");
    const members = nodes.filter(node => category.nodes.some(member => member.id === node.id));
    return {
      key: step.key, label: step.label,
      systems: BrowserSystemIdSchema.options.filter(system => members.some(node => node.kind === "task"
        ? node.uses.id.startsWith(`${system}/`)
        : node.kind === "transaction" && (node.prepare.uses.id.startsWith(`${system}/`) || node.commit.uses.id.startsWith(`${system}/`)))),
      includedByDefault: step.includedByDefault, control: startStepWireControl(step.control),
    };
  });
}

export function projectWorkflowStartReadiness(workflow: WorkbookReferenceWorkflow, references: readonly WorkbookReferenceSlot[]): WorkflowStartReadiness {
  for (const typeId of workflow.requiredWorkbookTypeIds) {
    const slot = references.find(slot => slot.workflowId === workflow.id && slot.typeId === typeId);
    if (slot === undefined) throw new Error(`WORKBOOK_REFERENCE_SLOT_UNAVAILABLE: ${workflow.id}/${typeId}`);
    if (slot.type === null || slot.current.state === "unavailable") return {
      scope: "default-workbook-references", state: "unavailable",
      reason: ERROR_CATALOG[slot.current.state === "unavailable" ? slot.current.code : "WORKBOOK_TYPE_UNAVAILABLE"].text,
      fixAction: { kind: "review-workbook-reference", workflowId: slot.workflowId, typeId: slot.typeId },
    };
    if (slot.current.state === "bound") continue;
    return {
      scope: "default-workbook-references", state: "blocked", reason: `${workflow.label} needs ${slot.type.name}.`,
      fixAction: { kind: "import-workbook", workflowId: slot.workflowId, typeId: slot.typeId },
    };
  }
  return { scope: "default-workbook-references", state: "ready" };
}

export function buildBootstrap(deps: BootstrapQueryDeps): FrontendBootstrapWire {
  const preflight = PreflightReportSchema.parse(deps.preflightReport());
  const workbookReferences = deps.workbookReferences(deps.modules.map(module => module.descriptor));
  let storageAuthority: "healthy" | "unavailable" = "healthy";
  try {
    deps.authorityMeta();
  } catch {
    // The wire enum is closed; the exact failure surfaces through the
    // authority routes themselves, which throw rather than degrade.
    storageAuthority = "unavailable";
  }
  const systems = new Set<string>();
  for (const { descriptor } of deps.modules) {
    for (const system of workflowProjections(descriptor).systems) systems.add(system);
  }
  return FrontendBootstrapWireSchema.parse({
    wireVersion: 1,
    appVersion: deps.appVersion,
    descriptorHash: deps.descriptorSetHash,
    settingsSchemaHash: deps.settingsSchemaHash,
    protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
    projectionGeneration: deps.projection.generation(),
    actor: { id: LOCAL_OPERATOR_ACTOR_ID, label: deps.actorLabel() },
    serverClock: { now: deps.clock.now().toISOString(), zone: deps.timeZone ?? runtimeTimeZone() },
    storage: {
      authority: storageAuthority,
    },
    preflight: preflight.results.map((result) => ({
      id: result.check,
      label: result.check,
      verdict: result.status,
      detail: result.status === "warning" ? `${result.summary} — ${result.impact}` : result.summary,
      blocks: result.status === "fail" ? result.blocks : [],
      ...(result.status === "pass" ? {} : { remediation: result.remediation }),
      checkedAt: preflight.checkedAt,
    })),

    workbookReferences,
    workflows: deps.modules.map(({ descriptor, role, intake }) => ({
      id: descriptor.id,
      code: descriptor.code,
      label: descriptor.label,
      categoryId: descriptor.category,
      descriptorFingerprint: descriptor.contractFingerprint,
      availability: { state: "available" },
      role,

      start: {
        readiness: projectWorkflowStartReadiness(descriptor, workbookReferences),
        ...(descriptor.summary === undefined ? {} : { summary: descriptor.summary }),
        enqueue: descriptor.enqueue,
        // The modal's Options and Confirm facts use the envelope's descriptor version.
        version: descriptor.version,
        steps: projectWorkflowStartSteps(descriptor),
        ...(descriptor.surfaces.inputRun === undefined
          ? {}
          : { inputRun: descriptor.surfaces.inputRun }),
        ...(descriptor.surfaces.uploadRun === undefined ? {} : { uploadRun: descriptor.surfaces.uploadRun }),

        spreadsheetIntake: intake !== undefined,
        requiredWorkbookTypeIds: [...descriptor.requiredWorkbookTypeIds],
      },
    })),
    systemInstances: [...systems.values()].sort().map((system) => ({
      system,
      prod: "available",
      test: {
        state: "unavailable",
        code: "not-configured",
        reason: "test-instance selection lands with the settings surface (2i)",
      },
    })),

    settingsSections: [
      { id: "storage", label: "Storage checks", revision: 1 },
      { id: SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID, label: "Workflow capabilities", revision: 1 },
    ],
    featureAvailability: [
      ...DEFERRED_FEATURES.map(([feature, reason]) => ({
        feature,
        availability: { state: "unavailable", code: "deferred", reason },
      })),
    ],
  });
}
