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

/**
 * The two real Archive views. This belongs beside the archive route sentinel
 * because the dashboard route owns which view is visible; keeping it local to
 * the component would leave another surface unable to name a destination.
 */
export type ArchiveView = "runs" | "versions";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import type {
  ArchiveEntryWire,
  ArchiveSweepWire,
  ArchivedRunDetailWire,
  WorkflowVersionStateWire,
} from "../../domain/dashboard/archive.js";
import type { VersionBumpChangeRecord } from "../../domain/archive/change-record.js";
import type { ArchivedCaptureTile } from "../../domain/archive/sections.js";
import type { DsStatus } from "../ds/ui.js";
import { testInstanceSystems } from "./test-instance-hazard.js";
import { PROPOSED_STATUS, dsStatusOf, type QueueStatus } from "./status-model.js";

/* ── the windowed table (D274 item 1) ────────────────────────────────────── */

/**
 * A sweep, as one section of the archive table: the applied bump and the runs
 * this query left inside it. `sweep` is `undefined` when the index carries no
 * record for the entries' `applicationId` — the one case where the archive
 * loses the reason it exists, and it is NAMED rather than degraded to an id.
 */
export interface ArchiveSection {
  readonly sweep: ArchiveSweepWire | undefined;
  readonly applicationId: string;
  readonly entries: readonly ArchiveEntryWire[];
}

/**
 * THE FLAT LIST A WINDOW WALKS — section headers and run rows in ONE sequence
 * (D274 item 1, ported from legacy hr-automation@1bffbd65,
 * `demo-archive-wire.ts` `flattenArchiveTable`).
 *
 * A header is an item exactly as a run is, so the window can hold either and
 * the two cannot get out of step. A COLLAPSED section contributes its header
 * and nothing else, which is what makes collapsing cheap at any size: the rows
 * are never built.
 */
export type ArchiveTableItem =
  | { readonly kind: "section"; readonly section: ArchiveSection; readonly collapsed: boolean }
  | { readonly kind: "run"; readonly entry: ArchiveEntryWire };

export function flattenArchiveTable(
  sections: readonly ArchiveSection[],
  collapsed: ReadonlySet<string>,
): readonly ArchiveTableItem[] {
  const items: ArchiveTableItem[] = [];
  for (const section of sections) {
    const shut = collapsed.has(section.applicationId);
    items.push({ kind: "section", section, collapsed: shut });
    if (shut) continue;
    for (const entry of section.entries) items.push({ kind: "run", entry });
  }
  return items;
}

/**
 * The two row heights the window's arithmetic is built on. They are not
 * estimates: the run row IS `--ds-h-row` and the sweep head IS
 * `--ds-h-archive-sweep`, both set on the element, and
 * `archive-window.test.ts` reads `ds/tokens.css` and asserts the two pairs
 * agree. A restated constant that nothing pins is how a spacer comes to be a
 * few pixels short of the rows it stands in for, and a table that drifts under
 * the scrollbar is worse than a table that is merely slow.
 */
export const ARCHIVE_ROW_PX = 32;
export const ARCHIVE_SECTION_PX = 52;

/** The demo's own window margin: twelve items above and below (D274 item 1). */
export const ARCHIVE_OVERSCAN = 12;

export function archiveItemHeightPx(item: ArchiveTableItem): number {
  switch (item.kind) {
    case "section": return ARCHIVE_SECTION_PX;
    case "run": return ARCHIVE_ROW_PX;
  }
}

/** The scroll container's measured state. `undefined` means NOT YET MEASURED. */
export interface ArchiveViewport {
  readonly scrollTop: number;
  readonly height: number;
}

/**
 * The half-open item range to render, and the two spacer heights that stand in
 * for everything outside it.
 */
export interface ArchiveTableWindow {
  readonly firstIndex: number;
  /** exclusive */
  readonly lastIndex: number;
  readonly beforePx: number;
  readonly afterPx: number;
  readonly totalPx: number;
}

/**
 * Which items a viewport can see, with the space above and below them.
 *
 * An UNMEASURED viewport renders every item. That is the honest arm: before
 * the container has a height, "nothing is visible" and "we have not looked
 * yet" are different facts, and rendering the whole list is correct-but-slow
 * where rendering none would be simply wrong.
 *
 * A negative `scrollTop` is clamped rather than refused, because elastic
 * overscroll reports one in Safari and WebKit and the visible top of the
 * content genuinely is 0 there. A NON-FINITE measurement is refused: that is
 * not a scroll position, and windowing from it would silently blank the table.
 */
export function windowArchiveTable(
  items: readonly ArchiveTableItem[],
  viewport: ArchiveViewport | undefined,
): ArchiveTableWindow {
  const offsets: number[] = [0];
  for (const item of items) offsets.push(offsets[offsets.length - 1] + archiveItemHeightPx(item));
  const totalPx = offsets[items.length];

  if (viewport === undefined) {
    return { firstIndex: 0, lastIndex: items.length, beforePx: 0, afterPx: 0, totalPx };
  }
  if (!Number.isFinite(viewport.scrollTop) || !Number.isFinite(viewport.height)) {
    throw new Error(
      `the archive table cannot be windowed from a non-finite viewport (scrollTop ${String(viewport.scrollTop)}, height ${String(viewport.height)})`,
    );
  }
  if (viewport.height < 0) {
    throw new Error(`the archive table cannot be windowed from a negative viewport height (${String(viewport.height)})`);
  }

  const top = Math.max(0, viewport.scrollTop);
  const bottom = top + viewport.height;

  let first = 0;
  while (first < items.length && offsets[first + 1] <= top) first += 1;
  let last = first;
  while (last < items.length && offsets[last] < bottom) last += 1;

  const firstIndex = Math.max(0, first - ARCHIVE_OVERSCAN);
  const lastIndex = Math.min(items.length, last + ARCHIVE_OVERSCAN);
  return {
    firstIndex,
    lastIndex,
    beforePx: offsets[firstIndex],
    afterPx: totalPx - offsets[lastIndex],
    totalPx,
  };
}

/**
 * The scroll container's own measurement, as a ref to attach and the viewport
 * it reports. Scroll and resize are the only two things that move the window,
 * and both are read off the element rather than computed from React state.
 *
 * The effect throws when the ref never attached: it runs after mount, so a
 * null element there is a wiring defect, and silently declining to window
 * would leave the 800-row case looking exactly like the windowed one.
 */
export function useArchiveViewport(): readonly [RefObject<HTMLDivElement | null>, ArchiveViewport | undefined] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<ArchiveViewport | undefined>(undefined);

  const read = useCallback((element: HTMLDivElement) => {
    setViewport((previous) => {
      const next = { scrollTop: element.scrollTop, height: element.clientHeight };
      return previous !== undefined && previous.scrollTop === next.scrollTop && previous.height === next.height
        ? previous
        : next;
    });
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (element === null) {
      throw new Error("the archive table's scroll container never mounted, so its rows cannot be windowed");
    }
    const onChange = () => { read(element); };
    onChange();
    element.addEventListener("scroll", onChange, { passive: true });
    const observer = new ResizeObserver(onChange);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", onChange);
      observer.disconnect();
    };
  }, [read]);

  return [ref, viewport] as const;
}

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

/* ── the capture viewer — what it WAS, without a byte (D274 item 10) ─────── */

/**
 * A viewer row: one thing the frozen tile knows, or the reason it knows none.
 * An absence keeps its own reason rather than printing a dash, because "the
 * bundle's origin named no step" and "this capture has no step" are different
 * facts and only one of them is about the capture.
 */
export type ArchivedCaptureFact =
  | { readonly state: "present"; readonly label: string; readonly value: string }
  | { readonly state: "absent"; readonly label: string; readonly reason: string };

/**
 * WHAT IT WAS — every fact the archived tile holds, in reading order.
 *
 * The archived read path resolves nothing and reaches no content store (D179:
 * evidence is POINTERS, and the bytes stay where they are), so this viewer is
 * never an image. That is not a degraded arm of an image viewer: a description
 * assembled from the frozen record is the whole product here, and it is
 * complete — kind, media type, size, digest, sensitivity, when, why, pixel
 * size, step, system and the DECLARED retention.
 *
 * Retention is a declaration, never an observation. The record cannot say
 * whether the bytes are still on disk, so this never prints "purged"; it
 * prints what the bundle was declared to be kept for.
 */
export function archivedCaptureFacts(tile: ArchivedCaptureTile): readonly ArchivedCaptureFact[] {
  const kilobytes = Math.max(1, Math.round(tile.byteLength / 1024));
  return [
    { state: "present", label: "Kind", value: tile.kind },
    { state: "present", label: "Media type", value: tile.mediaType },
    { state: "present", label: "Size", value: `${String(kilobytes)} KB (${String(tile.byteLength)} bytes)` },
    tile.dimensions === undefined
      ? {
        state: "absent",
        label: "Pixel size",
        reason: "this capture is not an image, so it has no pixel size",
      }
      : {
        state: "present",
        label: "Pixel size",
        value: `${String(tile.dimensions.width)} × ${String(tile.dimensions.height)}`,
      },
    tile.step.state === "present"
      ? { state: "present", label: "Step", value: tile.step.nodeId }
      : { state: "absent", label: "Step", reason: tile.step.reason },
    tile.system.state === "present"
      ? { state: "present", label: "System", value: tile.system.value }
      : { state: "absent", label: "System", reason: tile.system.reason },
    { state: "present", label: "Why it was captured", value: tile.origin },
    { state: "present", label: "Sensitivity", value: tile.sensitivity },
    { state: "present", label: "Digest", value: tile.digest },
    { state: "present", label: "Artifact", value: tile.artifactId },
    { state: "present", label: "Bundle", value: tile.bundleId },
  ];
}

/**
 * The one sentence the viewer owes the operator: why there is no image here.
 * It is stated as a property of the archive rather than as a failure, because
 * it IS one — nothing broke, and nothing is going to load.
 */
export const ARCHIVED_CAPTURE_VIEWER_NOTE =
  "The archive keeps the POINTER, never a copy of the bytes, so this record can be read with no old code and no "
  + "content store. What the capture was is here in full; the image itself is wherever it was filed.";

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
