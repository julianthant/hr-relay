/**
 * `FrontendBootstrapWire` (ref frontend-backend-integration §3.1): the one startup document. Everything
 * here is a projection of real registration/config/authority state; a fact
 * this slice cannot yet serve is an explicit `unavailable` with its owning
 * milestone named — never a plausible placeholder.
 */
import { z } from "zod";
import type { CapabilityAvailability } from "../../../domain/absence.js";
import type { AnyWorkflowDescriptor } from "../../../base/workflow.js";
import { workflowProjections } from "../../../base/workflow.js";
import type { Clock } from "../../../domain/clock.js";
import {
  FrontendBootstrapWireSchema,
  type FrontendBootstrapWire,
} from "../../../domain/dashboard/bootstrap.js";
import { LOCAL_OPERATOR_ACTOR_ID, type Fingerprint } from "../../../domain/ids.js";
import type { WorkflowModuleRole } from "../../../domain/workflow/module-role.js";
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
  ["capture", "mobile capture authority lands in 2h"],
  ["ocr", "OCR review surfaces land in 2h"],
  ["archive", "archive snapshots land with the version service in 2i"],
  ["workflow-editor", "the editor is a Phase-3 surface"],
] as const;

export function buildBootstrap(deps: BootstrapQueryDeps): FrontendBootstrapWire {
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
    // `code` is the descriptor's own, guarded 2-char code (ref frontend-backend-integration §3.1). The
    // category is served RAW: the heading text and the display order are the
    // frontend's, so nothing here invents a label from an id. `role` is served
    // RAW for the same reason (D219) — it is the MODULE's declaration, and how
    // a harness nests under its composition is the frontend's ONE rule.
    workflows: deps.modules.map(({ descriptor, role }) => ({
      id: descriptor.id,
      code: descriptor.code,
      label: descriptor.label,
      categoryId: descriptor.category,
      descriptorFingerprint: descriptor.contractFingerprint,
      availability: { state: "available" },
      role,
      // D264 (amending D251) — the Run Modal's three start facts, projected
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
        ...(descriptor.surfaces.inputRun === undefined
          ? {}
          : { inputRun: descriptor.surfaces.inputRun }),
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
    // 2i-D: the one real section. Editable settings (`apply-settings`) stay a
    // deferred command family; Storage is read-only health + the doctor.
    settingsSections: [{ id: "storage", label: "Storage", revision: 1 }],
    featureAvailability: [
      ...DEFERRED_FEATURES.map(([feature, reason]) => ({
        feature,
        availability: { state: "unavailable", code: "deferred", reason },
      })),
      { feature: "ai-advisory", availability: deps.advisoryAvailability() },
    ],
  });
}

export const BootstrapDaySchema = z.iso.date();
