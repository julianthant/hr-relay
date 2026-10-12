
import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { descriptorRuntimeNodes, workflowProjections } from "../../../workflow-kit/workflow.js";
import { runtimeTimeZone, type Clock } from "../../../rules/time/clock.js";
import { PreflightReportSchema } from "../../../models/preflight/preflight.js";
import { z } from "zod";
import { FrontendBootstrapWireSchema, type FrontendBootstrapWire, type WorkflowStartWire } from "../../../models/dashboard/bootstrap.js";
import { SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID } from "../../../models/dashboard/settings.js";
import { BrowserSystemIdSchema, LOCAL_OPERATOR_ACTOR_ID, type Fingerprint } from "../../../rules/identity/ids.js";
import type { WorkflowModuleRole } from "../../../workflow-kit/validation/module-role.js";
import { projectStartSteps, startStepWireControl } from "../start/step-selection.js";
import type { RunQueueProjection } from "../projections/run-queue-projection.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../models/config/protected-settings.js";


interface BootstrapModuleView {
  readonly descriptor: AnyWorkflowDescriptor;
  readonly role: WorkflowModuleRole;

  readonly intake?: unknown;
}

export interface BootstrapQueryDeps {
  readonly appVersion: string;
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
  // Use manifest age and generation for the cheap indicator; the doctor performs byte verification.
  readonly backupSummary: () => "current" | "stale" | "missing";
  /** The one retained report produced by the composed preflight authority. */
  readonly preflightReport: () => z.infer<typeof PreflightReportSchema>;
}

const DEFERRED_FEATURES = [
  ["ocr", "OCR review surfaces land in 2h"],
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

export function buildBootstrap(deps: BootstrapQueryDeps): FrontendBootstrapWire {
  const preflight = PreflightReportSchema.parse(deps.preflightReport());
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
    actor: { id: LOCAL_OPERATOR_ACTOR_ID, label: "Local operator" },
    serverClock: { now: deps.clock.now().toISOString(), zone: deps.timeZone ?? runtimeTimeZone() },
    storage: {
      authority: storageAuthority,
      backup: deps.backupSummary(),
      checkedAt: deps.clock.now().toISOString(),
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

    workflows: deps.modules.map(({ descriptor, role, intake }) => ({
      id: descriptor.id,
      code: descriptor.code,
      label: descriptor.label,
      categoryId: descriptor.category,
      descriptorFingerprint: descriptor.contractFingerprint,
      availability: { state: "available" },
      role,

      start: {
        ...(descriptor.summary === undefined ? {} : { summary: descriptor.summary }),
        enqueue: descriptor.enqueue,
        // The modal's Options and Confirm facts use the envelope's descriptor version.
        version: descriptor.version,
        steps: projectWorkflowStartSteps(descriptor),
        ...(descriptor.surfaces.inputRun === undefined
          ? {}
          : { inputRun: descriptor.surfaces.inputRun }),

        spreadsheetIntake: intake !== undefined,
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
