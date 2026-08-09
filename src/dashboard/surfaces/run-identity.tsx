/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/DemoRunIdentity.tsx
 *
 * WHICH RUN IS THIS, exactly — the run's PROVENANCE, in the Log Panel's bottom
 * bar, with the run HAZARD beside it and everything else behind its ⓘ: who
 * asked for this run, under which app build, against which system instance.
 * Every one of these is a served field; none is inferred.
 *
 * 1i adaptations against the demo (all rule-(c) omissions of fixture-only
 * data, recorded in the port report):
 *  - the workflow version tag renders the served DESCRIPTOR fingerprint
 *    short-prefix (the wire's name for the run's shape) instead of the demo's
 *    fixture `v3.1` pair; "shape moved" compares it against the bootstrap's
 *    current descriptor hash — same hazard, same tone, real fact;
 *  - the `dry run` chip is not drawn: the 1g queue wire serves no dry-run flag
 *    (the start plan's dry-run truth lives on the Start surface). Drawing one
 *    from anything else would be inference;
 *  - `RunSelector` (the `‹ #2 of 2 ›` attempt lineage strip with rerun diff)
 *    is not ported: the wire serves only the attempt ordinal — the demo
 *    itself renders nothing without at least two lineage attempts;
 *  - `RenameRunDialog` defers with the rename command (not in the Phase-1
 *    served-action vocabulary); priority and preset rows likewise.
 */
import { Info, TriangleAlert } from "lucide-react";
import type { z } from "zod";
import { cn } from "../lib/utils.js";
import {
  BulletList,
  IconButton,
  KeyValueList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  dsIcon,
  dsText,
} from "../ds/ui.js";
import type { QueueSurfaceWireSchema } from "../../domain/dashboard/projection.js";

export type QueueSurfaceWire = z.infer<typeof QueueSurfaceWireSchema>;

const FINGERPRINT_PREFIX = 8;

/** the served fingerprint, at chip length — the full hash stays in the ⓘ */
export function shortFingerprint(fingerprint: string): string {
  return fingerprint.slice(0, FINGERPRINT_PREFIX);
}

/**
 * The run's provenance, in the Log Panel's bottom bar.
 *
 * The two hazards stay VISIBLE: a moved run shape and a test instance are
 * outcomes about this run, not teaching, so they are never behind the
 * disclosure — a rehearsal that reads as a filing is the single most expensive
 * misread this product can produce.
 */
export function RunProvenanceBar({
  surface,
  workflowLabel,
  currentAppVersion,
  currentDescriptorHash,
}: {
  surface: QueueSurfaceWire;
  workflowLabel: string;
  currentAppVersion: string;
  currentDescriptorHash: string;
}) {
  const testSystems = surface.resolvedInstances.filter(({ instance }) => instance === "test");
  const ranShape = shortFingerprint(surface.descriptorHash);
  const shapeMoved = surface.descriptorHash !== currentDescriptorHash;
  /**
   * D179: the row now carries the build the RUN was enqueued under, so this
   * comparison can finally fire. Before D179 the projection stamped the
   * serving build here and `staleApp` was structurally always false — the
   * warning existed but could never appear.
   */
  const ranAppVersion = surface.appVersion.state === "present"
    ? surface.appVersion.value
    : undefined;
  const staleApp = ranAppVersion !== undefined && ranAppVersion !== currentAppVersion;

  return (
    <span className="flex min-w-0 shrink-0 items-center gap-[var(--ds-space-snug)]">
      <span
        title={
          shapeMoved
            ? `Ran under ${workflowLabel} shape ${ranShape}; runs are served by ${shortFingerprint(currentDescriptorHash)} now. The run's SHAPE moved, so these are not comparable — a retry would replay retired code.`
            : `${workflowLabel} ${ranShape} — the descriptor currently serving runs.`
        }
        className={cn(
          dsText.meta,
          dsText.nums,
          "shrink-0",
          shapeMoved ? "text-[color:var(--ds-status-waiting-fg)]" : "text-[color:var(--ds-fg-muted)]",
        )}
      >
        wf {ranShape}
      </span>

      {/* Hazards, never disclosed. */}
      {testSystems.length > 0 && (
        <span
          title={`Ran against the TEST instance of ${testSystems.map(({ system }) => system).join(", ")} — nothing here reached production.`}
          className={cn(
            dsText.meta,
            "inline-flex shrink-0 items-center gap-[var(--ds-space-tight)] text-[color:var(--ds-status-waiting-fg)]",
          )}
        >
          <TriangleAlert aria-hidden className={dsIcon.sm} />
          test
        </span>
      )}

      <Popover>
        <PopoverTrigger asChild>
          <IconButton size="xs" label="Run provenance" icon={<Info aria-hidden className={dsIcon.sm} />} />
        </PopoverTrigger>
        <PopoverContent title="Provenance" description={surface.traceId} width="lg" side="top" align="end">
          <div className="flex flex-col gap-[var(--ds-space-base)]">
            <KeyValueList
              items={[
                { key: "Workflow", value: `${workflowLabel} · ${ranShape}`, tone: shapeMoved ? "warning" : "default" },
                {
                  key: "App build",
                  value: ranAppVersion ?? "unstamped",
                  tone: staleApp || ranAppVersion === undefined ? "warning" : "default",
                },
                { key: "Requested by", value: surface.actorId },
                { key: "Config", value: shortFingerprint(surface.configFingerprint) },
                { key: "Attempt", value: `#${surface.attempt}` },
                ...surface.resolvedInstances.map(({ system, instance }) => ({
                  key: system,
                  value: instance,
                  tone: instance === "test" ? ("warning" as const) : ("default" as const),
                })),
              ]}
            />
            <BulletList
              items={[
                shapeMoved
                  ? `This run's SHAPE is a prior descriptor. It is not comparable with a ${shortFingerprint(currentDescriptorHash)} run, and a retry would replay retired code.`
                  : "The descriptor fingerprint is the run's shape; a row served under the same fingerprint is the same run shape.",
                ranAppVersion === undefined
                  ? `${surface.appVersion.state === "absent" ? surface.appVersion.reason : ""} — the app build is the other half of the archive key, so this run can only be told apart from a current one by its descriptor.`
                  : staleApp
                    ? `Ran under app ${ranAppVersion}; this dashboard is ${currentAppVersion}. The app build is the other half of the archive key.`
                    : `Ran under the app build this dashboard is running (${currentAppVersion}), which is why it is stated once on the Sessions bar rather than on every run.`,
              ]}
            />
          </div>
        </PopoverContent>
      </Popover>
    </span>
  );
}
