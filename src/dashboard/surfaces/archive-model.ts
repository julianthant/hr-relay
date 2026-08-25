/**
 * The archive route's index sentinel: `?archive=` with no run id is the ledger
 * itself, and any other value is the archived run it names.
 *
 * It sits in a plain module rather than in `archive.tsx` because a module that
 * exports a component may export nothing else if React Fast Refresh is to
 * treat it as a refresh boundary — one non-component export makes every edit
 * to the archive surface invalidate upward into `dashboard-app.tsx` and remount
 * the app instead of hot-swapping the component.
 */
export const ARCHIVE_INDEX = "";

import type {
  ArchiveEntryWire,
  ArchiveSweepWire,
  ArchivedRunDetailWire,
  WorkflowVersionStateWire,
} from "../../domain/dashboard/archive.js";
import type { VersionBumpChangeRecord } from "../../domain/archive/change-record.js";
import type { DsStatus } from "../ds/ui.js";
import { testInstanceSystems } from "./test-instance-hazard.js";
import { PROPOSED_STATUS, dsStatusOf, type QueueStatus } from "./status-model.js";

/**
 * Whether this archived run touched a TEST instance of any system. The fact is
 * the frozen row's own `resolvedInstances`, copied onto the index entry when
 * the archive projects — never inferred from a workflow id or a title.
 */
export function archivedRunTouchedTest(entry: ArchiveEntryWire): boolean {
  return testInstanceSystems(entry.resolvedInstances).length > 0;
}

/** The warning-count chip, including the honest no-chip arm and its reason. */
export type ArchiveWarningChip =
  | { readonly state: "present"; readonly count: number; readonly title: string }
  | { readonly state: "absent"; readonly reason: string };

export function archiveWarningChip(warnings: ArchiveEntryWire["warnings"]): ArchiveWarningChip {
  switch (warnings.state) {
    case "present":
      return { state: "present", count: warnings.count, title: warnings.first };
    case "absent":
      return { state: "absent", reason: warnings.reason };
  }
}

/**
 * The detail header's two row-owned identity facts.
 *
 * `displayName` has the wire contract's one verified fallback: the composed
 * row title. `subtitle` has no substitute; its absent arm remains absent so the
 * component can append archive provenance without fabricating descriptive
 * copy the start plan never supplied.
 */
export function archivedRunHeading(row: ArchivedRunDetailWire["row"]): Readonly<{
  title: string;
  subtitle: ArchivedRunDetailWire["row"]["subtitle"];
}> {
  switch (row.displayName.state) {
    case "present":
      return { title: row.displayName.value, subtitle: row.subtitle };
    case "absent":
      return { title: row.title, subtitle: row.subtitle };
  }
}

/** A priority's existing design-system tone, exhaustively over the wire enum. */
export function archivePriorityTone(
  priority: ArchivedRunDetailWire["row"]["priority"],
): "neutral" | "info" {
  switch (priority) {
    case "bulk": return "neutral";
    case "interactive": return "info";
  }
}

/**
 * A queue status is never printed as its transport spelling. The archive's
 * native select has no status hue, icon or warning-count chip, so its options
 * use the DS's unambiguous name rather than the deliberately shortened word a
 * status pill draws.
 */
export function archiveStatusLabel(status: QueueStatus): string {
  return PROPOSED_STATUS[dsStatusOf(status)].accessibleLabel;
}

type VersionBumpBlocker = WorkflowVersionStateWire["blockers"][number];

/**
 * Authority run states folded into the same visual vocabulary as every other
 * status on the dashboard. `terminal` is rejected by the blocker schema; if a
 * caller bypasses that boundary, rendering it as a blocker would be a lie.
 */
export function blockerStatusOf(state: VersionBumpBlocker["runState"]): DsStatus {
  switch (state) {
    case "queued": return "queued";
    case "claimed":
    case "validating":
    case "running": return "running";
    case "parked-gate": return "waiting";
    case "parked-write": return "parked";
    case "terminal":
      throw new Error("a terminal run is archivable and cannot be rendered as a version-bump blocker");
  }
}

/**
 * The kind vocabulary already authored into every generation-2 change record.
 * Copied from the incumbent surface's two-arm presentation at
 * legacy hr-automation@1bffbd658db34ce84a08e69484db3a40b3658d6e,
 * `demo-archive-wire.ts`, narrowed to the current contract's broader MINOR
 * meaning (behaviour inside an unchanged shape).
 */
export const BUMP_KIND_LABEL = {
  major: "Major — the run's shape changed",
  minor: "Minor — behaviour inside the same shape",
} as const satisfies Record<VersionBumpChangeRecord["kind"], string>;

export type ArchiveBumpKind =
  | {
    readonly state: "present";
    readonly kind: VersionBumpChangeRecord["kind"];
    readonly label: string;
    readonly tone: "warning" | "neutral";
  }
  | { readonly state: "absent"; readonly reason: string };

/** A pre-generation-2 sweep names the absent change record instead of guessing a kind. */
export function archiveBumpKind(record: ArchiveSweepWire["changeRecord"]): ArchiveBumpKind {
  switch (record.state) {
    case "present":
      return {
        state: "present",
        kind: record.value.kind,
        label: BUMP_KIND_LABEL[record.value.kind],
        tone: record.value.kind === "major" ? "warning" : "neutral",
      };
    case "absent":
      return { state: "absent", reason: record.reason };
  }
}

export type ArchiveSweepVersionRange =
  | { readonly state: "present"; readonly text: string }
  | { readonly state: "absent"; readonly target: string; readonly reason: string };

/**
 * A sweep that archived rows names their frozen source versions. An empty
 * source list is the real "archived nothing" state and remains a reason arm.
 */
export function archiveSweepVersionRange(sweep: ArchiveSweepWire): ArchiveSweepVersionRange {
  if (sweep.fromVersions.length === 0) {
    return {
      state: "absent",
      target: sweep.targetVersion,
      reason: "archived nothing, so no from-version",
    };
  }
  return {
    state: "present",
    text: `v${sweep.fromVersions.join(", v")} → ${sweep.targetVersion}`,
  };
}

/**
 * The archived facts that change a relaunch's risk. The command always creates
 * an interactive REAL run and resolves instances afresh; these sentences are
 * therefore derived from the frozen row, never assumed from its workflow.
 */
export function archivedRelaunchCautions(
  row: Pick<ArchivedRunDetailWire["row"], "dryRun" | "resolvedInstances">,
): readonly string[] {
  const cautions: string[] = [];
  if (row.dryRun) {
    cautions.push(
      "The archived run was a DRY RUN. The fresh run is not — it will write for real.",
    );
  }
  const testSystems = testInstanceSystems(row.resolvedInstances);
  if (testSystems.length > 0) {
    cautions.push(
      `The archived run targeted the TEST instance of ${testSystems.join(", ")}. The fresh run resolves its instances again; it does not reuse that target.`,
    );
  }
  return cautions;
}

/** The applied banner may only be drawn for the relaunch arm the command used. */
export function archivedRelaunchHeadline(detail: ArchivedRunDetailWire): string {
  switch (detail.relaunch.state) {
    case "available":
      return `New ${detail.workflowLabel} run enqueued on v${String(detail.relaunch.current.descriptorVersion)}`;
    case "unavailable":
      throw new Error(
        `archived run ${detail.runId} cannot show an applied relaunch banner: ${detail.relaunch.reason}`,
      );
  }
}
