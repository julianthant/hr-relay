/**
 * `FrontendBootstrapWire` (ref frontend-backend-integration §3.1): the one startup document. Everything
 * here is a projection of real registration/config/authority state; a fact
 * this slice cannot yet serve is an explicit `unavailable` with its owning
 * milestone named — never a plausible placeholder.
 */
import type { CapabilityAvailability } from "../../../domain/absence.js";
import type { AnyWorkflowDescriptor } from "../../../base/workflow.js";
import { workflowProjections } from "../../../base/workflow.js";
import type { Clock } from "../../../domain/clock.js";
import { PreflightReportSchema } from "../../../domain/preflight.js";
import { z } from "zod";
import {
  FrontendBootstrapWireSchema,
  type FrontendBootstrapWire,
} from "../../../domain/dashboard/bootstrap.js";
import {
  SETTINGS_SYSTEM_HOSTS_SECTION_ID,
  SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID,
} from "../../../domain/dashboard/settings.js";
import { LOCAL_OPERATOR_ACTOR_ID, type Fingerprint } from "../../../domain/ids.js";
import type { WorkflowModuleRole } from "../../../domain/workflow/module-role.js";
import { projectStartSteps, startStepWireControl } from "../../../services/start/step-selection.js";
import type { RunQueueProjection } from "../projectors/run-queue-projection.js";

/**
 * One registered workflow MODULE, as this query needs to see it (D219).
 *
 * The bootstrap wire used to take bare descriptors, and cannot any more: the
 * `role` it serves is the module's declaration, not the descriptor's, precisely
 * so taxonomy stays out of `contractFingerprint` (ref workflow-model §1.2.1). Deriving the
 * role from an id prefix here would be a second answer beside the composition
 * root's — the one thing D219's "no two surfaces disagree" rests on not
 * existing.
 */
export interface BootstrapModuleView {
  readonly descriptor: AnyWorkflowDescriptor;
  readonly role: WorkflowModuleRole;
  /**
   * The module's intake projection, when it declares one (D296). It is read
   * for its PRESENCE only — the served `spreadsheetIntake` boolean — because
   * the Run Modal's question is whether the second start method exists, and
   * the projection's target fields belong to the intake workspace's own wire.
   *
   * Optional here because it is optional on the module: `intakeProjectionRegistry`
   * skips a module that declares none, and the same tuple feeds both. Reading
   * it from the module rather than re-deriving it from `INTAKE_PROJECTIONS`
   * keeps one source, exactly as `role` does.
   */
  readonly intake?: unknown;
}

export interface BootstrapQueryDeps {
  readonly appVersion: string;
  readonly clock: Clock;
  /** The composition root's own tuple — never a re-listed copy of it. */
  readonly modules: readonly BootstrapModuleView[];
  readonly descriptorSetHash: Fingerprint;
  readonly settingsSchemaHash: Fingerprint;
  readonly projection: RunQueueProjection;
  /** Probes the authority store; throws when it cannot be reached. */
  readonly authorityMeta: () => { schemaVersion: number; authorityGeneration: number };
  /**
   * The cheap backup indicator (2i-D): newest write-time-verified manifest
   * judged by age + generation gap. Full byte re-verification is the doctor
   * route. Must not throw when authority itself is unavailable.
   */
  readonly backupSummary: () => "current" | "stale" | "missing";
  /** The one retained report produced by the composed preflight authority. */
  readonly preflightReport: () => z.infer<typeof PreflightReportSchema>;
  /**
   * Whether this process composed an `ai.advisory` provider (2i-G, D178).
   *
   * `ai-advisory` came off the deferred table when the producer landed, so
   * the wire now reports a real fact about THIS process rather than a
   * milestone: composed keys make the feature available, and no key makes it
   * `not-configured` naming the environment family to set. A feature that
   * says "deferred" after it shipped is the same lie as one that says
   * "available" when nothing is wired.
   */
  readonly advisoryAvailability: () => CapabilityAvailability;
}

const DEFERRED_FEATURES = [
  ["ocr", "OCR review surfaces land in 2h"],
  ["archive", "archive snapshots land with the version service in 2i"],
  ["workflow-editor", "the editor is a Phase-3 surface"],
] as const;

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
    projectionGeneration: deps.projection.generation(),
    actor: { id: LOCAL_OPERATOR_ACTOR_ID, label: "Local operator" },
    serverClock: { now: deps.clock.now().toISOString(), zone: "America/Los_Angeles" },
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
    // `code` is the descriptor's own, guarded 2-char code (ref frontend-backend-integration §3.1). The
    // category is served RAW: the heading text and the display order are the
    // frontend's, so nothing here invents a label from an id. `role` is served
    // RAW for the same reason (D219) — it is the MODULE's declaration, and how
    // a harness nests under its composition is the frontend's ONE rule.
    workflows: deps.modules.map(({ descriptor, role, intake }) => ({
      id: descriptor.id,
      code: descriptor.code,
      label: descriptor.label,
      categoryId: descriptor.category,
      descriptorFingerprint: descriptor.contractFingerprint,
      availability: { state: "available" },
      role,
      // D264/D285 (amending D251) — the Run Modal's start facts, projected
      // from the SAME descriptor this process plans with. They used to be read
      // off the bundle-safe descriptor tuple in the browser, which is what kept
      // the whole composition root in the dashboard bundle; serving them here
      // is what lets it leave. Each is passed through verbatim: `summary` and
      // `inputRun` are omitted when the descriptor declares none, because their
      // ABSENCE is the fact the modal renders, and `enqueue` is always declared
      // so it is always served — the client no longer has a default to fall
      // back to, which is the point.
      start: {
        ...(descriptor.summary === undefined ? {} : { summary: descriptor.summary }),
        enqueue: descriptor.enqueue,
        // C96 — the descriptor's own version, verbatim, for the modal footer's
        // `{label} v{n}`. It is the same integer the run envelope and every
        // archived row carry, so the footer names the shape the planner is
        // about to enqueue rather than a second opinion about it.
        version: descriptor.version,
        steps: projectStartSteps(descriptor).map((step) => ({
          key: step.key,
          label: step.label,
          includedByDefault: step.includedByDefault,
          control: startStepWireControl(step.control),
        })),
        ...(descriptor.surfaces.inputRun === undefined
          ? {}
          : { inputRun: descriptor.surfaces.inputRun }),
        // D296 — the second start door, served as the fact it is. `undefined`
        // is the module declaring no projection, which `intakeProjectionRegistry`
        // reads the same way and `command-kernel` refuses a commit by; the
        // modal draws no spreadsheet method for it.
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
    // Every section here is READ-ONLY status. Editable settings
    // (`apply-settings`) stay a deferred command family (doc 04), so the list
    // carries no editable group and the nav draws none.
    //
    // D274 item 6 (ledger 3 SE40–SE42) added the second and third: both are
    // projections of authority this process already composed — the resolved
    // config, and the descriptor tuple the kernel plans with — served by
    // `GET /api/v1/settings/facts`. They were absent for exactly one reason,
    // which the ledger names: this list said `storage` and nothing else.
    //
    // `Storage health`, not `Storage`: the nav word and the page it opens are
    // one name, and the demo spells it once (legacy 1ec1d870
    // `src/dashboard/components/dev/rebuild-demo/DemoSettings.tsx:170-176`, the
    // nav entry carrying `label: "Storage health"` at :172).
    // D276 item 4 ported the PANEL HEADER and left the nav entry behind, so the
    // two disagreed on screen (UF-SET-9). The label is served rather than
    // authored in the surface, so this list is where it is spelled.
    settingsSections: [
      { id: "storage", label: "Storage health", revision: 1 },
      { id: SETTINGS_SYSTEM_HOSTS_SECTION_ID, label: "System hosts", revision: 1 },
      { id: SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID, label: "Workflow capabilities", revision: 1 },
    ],
    featureAvailability: [
      ...DEFERRED_FEATURES.map(([feature, reason]) => ({
        feature,
        availability: { state: "unavailable", code: "deferred", reason },
      })),
      { feature: "ai-advisory", availability: deps.advisoryAvailability() },
    ],
  });
}
