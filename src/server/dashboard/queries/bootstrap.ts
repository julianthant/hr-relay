/**
 * `FrontendBootstrapWire` (doc 13 §3.1): the one startup document. Everything
 * here is a projection of real registration/config/authority state; a fact
 * this slice cannot yet serve is an explicit `unavailable` with its owning
 * milestone named — never a plausible placeholder.
 */
import { z } from "zod";
import type { AnyWorkflowDescriptor } from "../../../base/workflow.js";
import { workflowProjections } from "../../../base/workflow.js";
import type { Clock } from "../../../domain/clock.js";
import {
  FrontendBootstrapWireSchema,
  type FrontendBootstrapWire,
} from "../../../domain/dashboard/bootstrap.js";
import { LOCAL_OPERATOR_ACTOR_ID, type Fingerprint } from "../../../domain/ids.js";
import type { RunQueueProjection } from "../projectors/run-queue-projection.js";

export interface BootstrapQueryDeps {
  readonly appVersion: string;
  readonly clock: Clock;
  readonly descriptors: readonly AnyWorkflowDescriptor[];
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
}

const DEFERRED_FEATURES = [
  ["capture", "mobile capture authority lands in 2h"],
  ["ocr", "OCR review surfaces land in 2h"],
  ["ai-advisory", "advisory providers land in 2h"],
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
  const categories = new Map<string, number>();
  for (const descriptor of deps.descriptors) {
    if (!categories.has(descriptor.category)) categories.set(descriptor.category, categories.size);
  }
  const systems = new Set<string>();
  for (const descriptor of deps.descriptors) {
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
    workflows: deps.descriptors.map((descriptor) => ({
      id: descriptor.id,
      label: descriptor.label,
      categoryId: descriptor.category,
      descriptorFingerprint: descriptor.contractFingerprint,
      availability: { state: "available" },
    })),
    workflowCategories: [...categories.entries()].map(([id, order]) => ({
      id,
      label: id.replace(/-/g, " "),
      order,
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
    featureAvailability: DEFERRED_FEATURES.map(([feature, reason]) => ({
      feature,
      availability: { state: "unavailable", code: "deferred", reason },
    })),
  });
}

export const BootstrapDaySchema = z.iso.date();
