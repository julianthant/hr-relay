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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

import type {
  ArchiveEntryWire,
  ArchiveSweepWire,
  ArchivedCaptureResourceWire,
  ArchivedRunDetailWire,
  WorkflowVersionStateWire,
} from "../../domain/dashboard/archive.js";
import {
  VersionBumpChangeRecordSchema,
  type VersionBumpChangeRecord,
} from "../../domain/archive/change-record.js";
import type { ArchivedCaptureTile } from "../../domain/archive/sections.js";
import type { VersionScope } from "../../domain/commands.js";
import type { DsStatus } from "../ds/ui.js";
import { fmtClock, plural, shortHash } from "./format.js";
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
/**
 * D307 — the one note an archived step that did NOT run is allowed to say
 * about itself, in the run-detail wire's own closed vocabulary.
 *
 * `operator-asserted` and `step-omitted` are the two halves of one omitted
 * step and they are completely different facts: the first node's output was
 * rebuilt from what the operator typed and DROVE the run, the second never
 * existed at all. A frozen page that drew both as a grey "skipped" segment
 * would hide which of the two happened here.
 */
export const ARCHIVED_NOT_RUN_NOTE: Record<
  Extract<ArchivedRunDetailWire["detail"]["timeline"]["events"][number]["notRun"], { state: "present" }>["reason"],
  string
> = {
  "condition-false": "did not run — its condition was false",
  "branch-not-selected": "did not run — its branch was not selected",
  "operator-asserted": "did not run — the operator asserted its facts at start",
  "step-omitted": "did not run — its step was omitted at start",
};

/**
 * ONE skipped step's note, across BOTH arms of the frozen wire's `notRun`.
 *
 * The `absent` arm is not an empty arm: it carries the server's own SENTENCE
 * saying why no reason is held ("its span recorded no reason"), and a frozen
 * page that drew the present arm and dropped the absent one told the operator
 * nothing at all about a step that did not run — the same blank a step that
 * ran leaves, which is the one reading that is false. The served reason is
 * drawn verbatim rather than prefixed: it is already a whole sentence about
 * this step, and `log-panel.tsx` reaches the same place through its own
 * "no reason was recorded".
 *
 * A step that RAN has no note at all, which is what the `undefined` arm is.
 */
export function archivedNotRunNote(
  event: ArchivedRunDetailWire["detail"]["timeline"]["events"][number],
): string | undefined {
  if (event.state !== "skipped") return undefined;
  return event.notRun.state === "present"
    ? ARCHIVED_NOT_RUN_NOTE[event.notRun.reason]
    : event.notRun.reason;
}

/**
 * D307 — the archived run's omitted steps, as one line. Keys only: the facts
 * the operator typed for those steps are the run's own input and were never
 * served to this page.
 */
export function archivedOmittedStepsNote(steps: readonly string[] | undefined): string | undefined {
  if (steps === undefined || steps.length === 0) return undefined;
  return `Omitted at start: ${steps.join(", ")}. Nothing read those steps; their nodes were asserted from typed facts or did not run.`;
}

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

/**
 * What each kind DOES, under the current contract (D274 item 2).
 *
 * The demo's minor arm reads "presentation only"; this tree's `minor` is the
 * broader "behaviour inside an unchanged shape", and that wording is prior
 * authority (`VersionBumpChangeRecordSchema.kind`) rather than drift. What
 * ports verbatim is the CONSEQUENCE, which is the half an operator is choosing
 * between: a major archives and can be blocked, a minor does neither.
 */
export const BUMP_KIND_NOTE = {
  major:
    "Steps added, removed or renamed, or the data contract moved. A run started under the old descriptor cannot be "
    + "rendered by the new one, so every prior-version run is ARCHIVED — and a run that is not terminal blocks the "
    + "bump until it is resolved.",
  minor:
    "Behaviour inside an unchanged shape. NOTHING is archived, runs in flight carry on, and every prior-version run "
    + "still renders — so there is nothing a run could be doing that would block this.",
} as const satisfies Record<VersionBumpChangeRecord["kind"], string>;

/**
 * WHAT A BUMP OF THIS KIND WOULD DO with the facts the index serves.
 *
 * This is the surface's half of `resolveBumpEffect` (`archive-service.ts`,
 * D274): the assessment answers a factual question — which prior-version runs
 * are terminal, and which are not — and the KIND decides what the bump does
 * about them. `versionState` is kind-AGNOSTIC, so the same numbers reach both
 * arms and only their meaning changes.
 *
 * The minor arm is the one that must not lie. A minor plan carries no
 * candidates and no blockers BY DEFINITION — the schema refuses one that does
 * — so drawing an empty candidate list beside an empty blocker list would read
 * as "we looked and found none", which is a claim about this scope rather than
 * about minor bumps. The numbers are therefore carried under names that say
 * what they are: what a MAJOR bump would face, stated as an aside.
 */
export type BumpKindEffect =
  | {
    readonly kind: "major";
    /** terminal prior-version runs this bump WOULD archive */
    readonly archivable: number;
    /** non-terminal prior-version runs that REFUSE it */
    readonly blockers: readonly VersionBumpBlocker[];
  }
  | {
    readonly kind: "minor";
    /** runs in flight — unaffected, because a minor bump archives nothing */
    readonly unaffected: readonly VersionBumpBlocker[];
    /** what a MAJOR bump on the same scope would have archived */
    readonly wouldHaveArchived: number;
  };

export function resolveBumpKindEffect(
  kind: VersionBumpChangeRecord["kind"],
  states: readonly WorkflowVersionStateWire[],
): BumpKindEffect {
  const archivable = states.reduce((total, state) => total + state.archivable, 0);
  const nonTerminal = states.flatMap((state) => state.blockers);
  switch (kind) {
    case "major":
      return { kind: "major", archivable, blockers: nonTerminal };
    case "minor":
      return { kind: "minor", unaffected: nonTerminal, wouldHaveArchived: archivable };
  }
}

/**
 * The resolution column's head, PARAMETERISED by kind (ledger 3 VB22). Under a
 * major bump these runs are the thing to act on; under a minor one the same
 * rows are context, and a head reading "What has to happen" over runs that
 * block nothing would be an instruction nobody owes.
 */
export function bumpResolutionColumnHead(kind: VersionBumpChangeRecord["kind"] | undefined): string {
  // A generation-1 plan recorded no kind at all, so neither head is true of it:
  // the demand is stated without claiming which bump is making it.
  if (kind === undefined) return "What would have to happen";
  switch (kind) {
    case "major": return "What has to happen";
    case "minor": return "What a MAJOR bump would have demanded";
  }
}

/**
 * What resolving one blocking run takes. Derived from `runState` because that
 * is the only fact the wire carries — `WorkflowVersionStateWire.blockers[]`
 * serves no `requiredResolution`, so this is the surface reading a served
 * enum, never a sentence it pretends the server sent.
 */
export function blockerResolution(state: VersionBumpBlocker["runState"]): string {
  switch (state) {
    case "parked-write":
      return "Resolve the parked write present or absent — an unresolved possible-submit is never archived.";
    case "parked-gate":
      return "Answer the open gate, or cancel the run.";
    case "queued":
    case "claimed":
    case "validating":
    case "running":
      return "Let it finish, or cancel it.";
    case "terminal":
      throw new Error("a terminal run is archivable and needs no resolution to be archived");
  }
}

/** How many of these blocking runs are PARKED WRITES — the non-negotiable half. */
export function parkedWriteBlockers(blockers: readonly VersionBumpBlocker[]): number {
  return blockers.filter((blocker) => blocker.runState === "parked-write").length;
}

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
 * The bump's SCOPE, in the operator's words. The demo keys three arms off its
 * own `BumpScope`; this tree's `VersionScope` has two, and a single-workflow
 * bump is the one-element case of the first rather than a third kind — so the
 * split is made where the fact is, on the length.
 */
export function bumpScopeLabel(scope: VersionScope): Readonly<{ label: string; note: string }> {
  switch (scope.kind) {
    case "application":
      return {
        label: `Dashboard update — every workflow (app ${scope.applicationVersion})`,
        note:
          "An app update bumps the EFFECTIVE version of every workflow, because an old run may not be interpretable "
          + "against new dashboard state.",
      };
    case "workflows":
      return scope.workflowIds.length === 1
        ? {
          label: "Single workflow",
          note: "Only this workflow's version moves, and only its prior-version runs are in scope.",
        }
        : {
          label: `Several workflows (${String(scope.workflowIds.length)})`,
          note: "Each named workflow's version moves together, under ONE change record.",
        };
  }
}

/* ── the sweep's NAME, and the frozen codes it joins against (AR80/AR82) ─── */

/**
 * The identity a frozen short code belongs to.
 *
 * A code is a fact about a workflow AT a descriptor version (D242) and never
 * about the workflow forever, so the join key is the PAIR. That is what keeps
 * a workflow renamed between two bumps printing each sweep's own code rather
 * than today's — the one case the frozen field exists for.
 */
export function archiveIdentityKey(workflowId: string, descriptorVersion: number): string {
  return `${workflowId}@${String(descriptorVersion)}`;
}

/**
 * `workflowId@version → that identity's short code` (AR80).
 *
 * `ArchiveSweepWire.appliedIdentities` carries workflow IDs and no code, so
 * the sweep head printed `separations-kuali-read v3` where the demo prints
 * `sk v3`. The codes ARE in the index and this is a join, not a rename and
 * not a new wire field — but they come from TWO places, and which one answers
 * an identity is not a preference:
 *
 * - `versionState` carries the registry's code beside the version it is the
 *   code OF, so it answers the identity a sweep moved runs ONTO (the one
 *   `appliedIdentities` names).
 * - every archived run froze its own code beside the version it RAN (D242), so
 *   the entries answer identities the registry no longer holds — a retired
 *   descriptor, or a code that has changed since.
 *
 * Both are exact `(workflowId, descriptorVersion)` matches; neither is a code
 * carried across a version it was not true at, which is the silently-wrong
 * derivation `ArchivedWorkflowCodeWireSchema`'s own docstring refuses. Where
 * both answer, the FROZEN code wins: the archive's copy is the authority for
 * what a run was planned under.
 */
export function archiveWorkflowCodes(
  index: Readonly<{
    entries: readonly ArchiveEntryWire[];
    versionState: readonly WorkflowVersionStateWire[];
  }>,
): ReadonlyMap<string, string> {
  const codes = new Map<string, string>();
  for (const state of index.versionState) {
    codes.set(archiveIdentityKey(state.workflowId, state.current.descriptorVersion), state.workflowCode);
  }
  for (const entry of index.entries) {
    if (entry.workflowCode.state !== "present") continue;
    codes.set(
      archiveIdentityKey(entry.workflowId, entry.archivedIdentity.descriptorVersion),
      entry.workflowCode.value,
    );
  }
  return codes;
}

/** What a sweep head prints, and the SECOND fact its hover carries. */
export interface ArchiveSweepName {
  /** the cell's own text — short codes where a run froze one */
  readonly text: string;
  /** the hover: the bump's SCOPE, then the unabbreviated identities (AR82) */
  readonly title: string;
}

/**
 * The unabbreviated identities a sweep's short codes stand in for — the same
 * fact `archiveSweepName`'s `title` carries and `archiveSweepFacts` restates,
 * because a fact reachable only through `title` is a fact reachable by
 * pointer and by nobody else (`src/dashboard/CLAUDE.md`, three times).
 */
function archiveSweepFullIdentities(sweep: ArchiveSweepWire): string {
  return sweep.appliedIdentities
    .map((identity) => `${identity.workflowId} v${String(identity.descriptorVersion)}`)
    .join(", ");
}

/**
 * The sweep's NAME, as the demo's `ec v3.1 → v4.0` reads.
 *
 * Two rules. An identity with no frozen code degrades to its workflow ID —
 * the degradation `ArchivedWorkflowCodeWireSchema` already rules, because a
 * workflow ID is a real name the operator can act on while a code has no such
 * fallback. And the `title` is a DIFFERENT fact from the cell (AR82): a
 * tooltip repeating its own cell text is a no-op, so the hover carries the
 * scope sentence and the ids the codes stand in for.
 */
export function archiveSweepName(
  sweep: ArchiveSweepWire,
  codes: ReadonlyMap<string, string>,
): ArchiveSweepName {
  const short = sweep.appliedIdentities
    .map((identity) => {
      const code = codes.get(archiveIdentityKey(identity.workflowId, identity.descriptorVersion));
      return `${code === undefined ? identity.workflowId : code} v${String(identity.descriptorVersion)}`;
    })
    .join(", ");
  const full = archiveSweepFullIdentities(sweep);
  return {
    text: `${short} → ${sweep.targetVersion}`,
    title: `${bumpScopeLabel(sweep.scope).label} — ${full} → ${sweep.targetVersion}`,
  };
}

/**
 * The sweep ⓘ's meta line (AR84/AR93).
 *
 * The sweep's id leads it. The trace column prints `shortHash(applicationId)`
 * because a uuid does not fit 148px, and until this fold the whole id was
 * recoverable from that cell's `title` and from nowhere else — a fact
 * reachable by pointer and by nobody else is a fact the product does not have
 * (`src/dashboard/CLAUDE.md`, three times). It is a fold rather than JSX
 * because the popover body only exists once the popover is open, so nothing
 * rendered could pin it.
 *
 * The unabbreviated identities join the same list for the same reason (AR82,
 * unit F10d): the sweep head prints only the short codes, and the popover was
 * the row's own route to their full form — carrying that only on the head's
 * `title` would leave it reachable by pointer and by nobody else.
 */
export function archiveSweepFacts(sweep: ArchiveSweepWire): string[] {
  const range = archiveSweepVersionRange(sweep);
  return [
    `sweep ${sweep.applicationId}`,
    sweep.appliedBy,
    `plan ${shortHash(sweep.versionPlanId)}`,
    `app ${sweep.appliedAppVersion}`,
    fmtClock(sweep.appliedAt),
    `${plural(sweep.archivedCount, "run")} archived`,
    range.state === "present" ? range.text : range.reason,
    archiveSweepFullIdentities(sweep),
  ];
}

/**
 * The authored change record, or the reason it is not one yet.
 *
 * The demo's primary button is NEVER disabled, and its argument is the right
 * one: an empty record is a real refusal (`change-record-incomplete`), and a
 * greyed-out control hides the rule this flow exists to enforce. So the button
 * stays pressable and this fold answers the press.
 *
 * What it must not do is pretend the answer came from the server. The schema
 * that refuses an empty `what` is the SAME schema on both sides of the wire,
 * so this refusal is composed here and says so — it names the missing fields,
 * which a round trip could not do better, and it carries the code a bug report
 * would quote.
 */
export type BumpRecordDraft = Readonly<{ kind: VersionBumpChangeRecord["kind"]; what: string; why: string; commit: string }>;

export type BumpRecordComposition =
  | { readonly state: "complete"; readonly record: VersionBumpChangeRecord }
  | {
    readonly state: "incomplete";
    readonly code: "change-record-incomplete";
    readonly missing: readonly string[];
    readonly sentence: string;
  };

export function composeBumpChangeRecord(draft: BumpRecordDraft): BumpRecordComposition {
  const commit = draft.commit.trim();
  const parsed = VersionBumpChangeRecordSchema.safeParse({
    kind: draft.kind,
    what: draft.what.trim(),
    why: draft.why.trim(),
    commit: commit === ""
      ? { state: "absent", reason: "the operator recorded no commit for this bump" }
      : { state: "present", value: commit },
  });
  if (parsed.success) return { state: "complete", record: parsed.data };

  const missing = [
    ...(draft.what.trim() === "" ? ["What moved"] : []),
    ...(draft.why.trim() === "" ? ["Why it had to move"] : []),
  ];
  return {
    state: "incomplete",
    code: "change-record-incomplete",
    missing,
    sentence: missing.length > 0
      ? `${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} still empty. `
        + "The change record is the only account of why a version moved, and nobody can write it later."
      : parsed.error.issues.map((issue) => issue.message).join(" "),
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
 * This byte-independent formatter reads only the frozen record (D179: evidence
 * is POINTERS). It describes kind, media type, size, digest, sensitivity, when,
 * why, pixel size, step, system and DECLARED retention. The viewer's separate
 * exact-resource read may display retained image bytes; it never replaces
 * these frozen facts.
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
        reason: tile.mediaType === "image/png" || tile.mediaType === "image/jpeg"
          ? "this image's pixel dimensions were not recorded"
          : "this capture is not an image, so it has no pixel size",
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
 * A capture tile's lead BADGE (AR184).
 *
 * It carried `tile.kind` in a tone keyed off `tile.origin`, so a routine
 * `screenshot` taken at a step's ordinary failure wore danger red while an
 * operator-requested one wore neutral — the badge's colour and its word came
 * from two different facts, and the reader had no way to tell which one the
 * red was about. The word is the ORIGIN now, which is the fact the colour was
 * always trying to say; `kind` is a physical property of the artifact and
 * lives with the others on the meta line.
 *
 * The map is TOTAL over `ArchivedCaptureTile["origin"]` and the test asserts
 * both directions, so a sixth origin is a typecheck failure and never a silent
 * default. Only the two that say something went wrong ABOUT THE SUBJECT take
 * danger: a wrong person is the worst thing this system can record.
 */
export const ARCHIVED_CAPTURE_ORIGIN_TONE = {
  "failure": "danger",
  "subject-mismatch": "danger",
  "unexpected-state": "warning",
  "recovery-park": "warning",
  "operator-request": "neutral",
} as const satisfies Record<ArchivedCaptureTile["origin"], "danger" | "warning" | "neutral">;

/** The snapshot and byte-check authorities the viewer must keep distinct. */
export const ARCHIVED_CAPTURE_VIEWER_NOTE =
  "This archive keeps the capture's POINTER facts frozen. The separate byte check is only for this exact archived id, "
  + "digest, size and media type.";

/** Read-time byte status, deliberately separate from the frozen capture tile. */
export type ArchivedCaptureResourceLoad =
  | { readonly state: "idle" }
  | { readonly state: "loading"; readonly request: ArchivedCaptureResourceRequest }
  | { readonly state: "loaded"; readonly request: ArchivedCaptureResourceRequest; readonly value: ArchivedCaptureResourceWire }
  | { readonly state: "failed"; readonly request: ArchivedCaptureResourceRequest; readonly message: string };

export interface ArchivedCaptureResourceRequest {
  readonly runId: string;
  readonly artifactId: string;
  /** A close/reopen must not reuse a prior response for the same exact tile. */
  readonly viewerEpoch: number;
}

function sameArchivedCaptureRequest(
  left: ArchivedCaptureResourceRequest,
  right: ArchivedCaptureResourceRequest,
): boolean {
  return left.runId === right.runId
    && left.artifactId === right.artifactId
    && left.viewerEpoch === right.viewerEpoch;
}

function archivedCaptureDownloadPath(request: ArchivedCaptureResourceRequest): string {
  return `/artifacts/v1/archive/${encodeURIComponent(request.runId)}/${encodeURIComponent(request.artifactId)}`;
}

/**
 * Owns a dialog's exact `(archived run, frozen artifact)` resource request.
 * Closing or walking to another capture invalidates the old result, so a
 * previous successful read cannot make a different tile look available.
 */
export function useArchivedCaptureResource(
  runId: string,
  tile: ArchivedCaptureTile | undefined,
  read: (runId: string, artifactId: string, signal?: AbortSignal) => Promise<ArchivedCaptureResourceWire>,
  viewerEpoch: number,
): ArchivedCaptureResourceLoad {
  const [resource, setResource] = useState<ArchivedCaptureResourceLoad>({ state: "idle" });
  const artifactId = tile?.artifactId;
  const request = useMemo(
    () => artifactId === undefined ? undefined : { runId, artifactId, viewerEpoch },
    [runId, artifactId, viewerEpoch],
  );
  useEffect(() => {
    if (request === undefined) {
      setResource({ state: "idle" });
      return undefined;
    }
    const controller = new AbortController();
    let active = true;
    setResource({ state: "loading", request });
    read(request.runId, request.artifactId, controller.signal).then(
      (value) => {
        if (!active) return;
        if (value.runId !== request.runId || value.artifactId !== request.artifactId) {
          setResource({
            state: "failed",
            request,
            message: "The archive resource response did not match the capture that was requested.",
          });
          return;
        }
        if (value.resource.state === "available" && value.resource.downloadUrl !== archivedCaptureDownloadPath(request)) {
          setResource({
            state: "failed",
            request,
            message: "The archive resource response named a different download than the capture that was requested.",
          });
          return;
        }
        setResource({ state: "loaded", request, value });
      },
      (error: unknown) => {
        if (!active) return;
        setResource({
          state: "failed",
          request,
          message: error instanceof Error ? error.message : "The archived capture resource could not be read.",
        });
      },
    );
    return () => {
      active = false;
      controller.abort();
    };
  }, [read, request]);
  if (request === undefined) return { state: "idle" };
  if (resource.state === "idle" || !sameArchivedCaptureRequest(resource.request, request)) {
    return { state: "loading", request };
  }
  return resource;
}

/** Each mounted preview owns its DOM image and only its latest decode attempt. */
export function useArchivedCaptureImage() {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const mountedImage = useRef<HTMLImageElement | null>(null);
  const attempt = useRef<{ readonly image: HTMLImageElement } | undefined>(undefined);
  const bindImage = useCallback((image: HTMLImageElement | null) => {
    mountedImage.current = image;
    attempt.current = undefined;
  }, []);
  const failImage = useCallback((image: HTMLImageElement) => {
    if (mountedImage.current !== image) return;
    attempt.current = undefined;
    setState("failed");
  }, []);
  const decodeImage = useCallback((image: HTMLImageElement) => {
    if (mountedImage.current !== image) return;
    const owner = { image };
    attempt.current = owner;
    setState("loading");
    void image.decode().then(
      () => {
        if (attempt.current !== owner) return;
        setState(image.naturalWidth > 0 && image.naturalHeight > 0 ? "ready" : "failed");
      },
      () => {
        if (attempt.current !== owner) return;
        setState("failed");
      },
    );
  }, []);
  return { state, bindImage, failImage, decodeImage };
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

/**
 * D308's confirm copy for the Archive's delete door.
 *
 * The relaunch beside it is additive — it enqueues a run and leaves the record
 * exactly as it ended — so its dialog can spend its whole body on what the
 * fresh run WOULD do. This one removes authority, and the three sentences
 * below are the three facts an operator cannot recover after pressing it:
 *
 *  1. WHAT leaves. Not "the archived record": the retained `tasks` row and
 *     every row it owns go with it, and the write ledger is one of them.
 *  2. WHAT that costs. The write ledger carries the permanent idempotency keys
 *     that stop the same live write from being submitted twice; deleting the
 *     run releases them. The sentence is conditional because the archive holds
 *     rehearsals too, and it names the WORKFLOW so the operator reads it as
 *     "UCPath" rather than as a database noun.
 *  3. That there is no undo. The tombstone records that a run was deleted; it
 *     does not hold what was deleted.
 *
 * It is model-authored rather than served: the archived detail wire carries no
 * confirm (the relaunch's does not either), and inventing a server-authored
 * confirm for one control would put this surface's two destructive-copy
 * authors in two different places.
 */
export interface ArchivedDeleteConfirm {
  readonly title: string;
  readonly description: string;
  /** The consequences, in the order an operator reads them. */
  readonly consequences: readonly string[];
  readonly confirmLabel: string;
}

export function archivedDeleteConfirm(
  detail: Pick<ArchivedRunDetailWire, "workflowLabel">,
): ArchivedDeleteConfirm {
  return Object.freeze({
    title: "Delete this archived run",
    description:
      "It removes the archived record, the retained run, and every row it owns from the database, "
      + "including its write ledger.",
    consequences: Object.freeze([
      `If this run wrote to ${detail.workflowLabel}'s systems, the permanent idempotency key that stops `
      + "the same write from being submitted twice is released with it.",
      "This is final; there is no undo.",
    ]),
    confirmLabel: "Delete",
  });
}
