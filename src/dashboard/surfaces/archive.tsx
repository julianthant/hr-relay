import { observeAsyncResource } from "../state/async-resource.js";
/**
 * Ported from legacy hr-automation@1bffbd658db34ce84a08e69484db3a40b3658d6e,
 * src/dashboard/components/dev/rebuild-demo/DemoArchive.tsx (+
 * demo-archive-wire.ts for the query/sort/section vocabulary).
 *
 * The read-only Archive and the version-bump flow (ref dashboard-surfaces §10.2 D80, ref frontend-backend-integration §5,
 * D179).
 *
 * ## THESIS — a record, and the act that made it one
 *
 * Charter §25's archive is not a wastebasket and it is not a second queue. It
 * is what the dashboard KEEPS when a workflow's shape moves: every run of the
 * prior version leaves the live surfaces in one act, and what remains of it is
 * a frozen row nobody may touch. So the list is built as a **ledger of
 * sweeps**, not a flat list of runs: each applied bump is a collapsible
 * section header laid on the TABLE'S OWN `<colgroup>`, so a sweep's date sits
 * directly over the dates of the runs it swept and its count sits where their
 * durations are. The `--ds-w-archive-*` width tokens exist for exactly that
 * alignment; two grids cannot be made to agree by choosing better numbers.
 *
 * ## VIRTUALISED, NOT PAGINATED (D274 item 1)
 *
 * The operator arrives with a question — *did we ever file something for this
 * person?* — and the narrowing tool for that is the search and the three
 * filters already on the bar. Pagination would be a SECOND narrowing mechanism
 * stacked on those: it splits a set that has already been narrowed, forces a
 * decision ("is it on page 4?") that no fact on screen can answer, and breaks
 * the one motion a dense console is for. It would also have to interact with
 * the sweep sections, because a page boundary landing inside a sweep either
 * repeats its header or orphans its rows. A window keeps one continuous list,
 * keeps the section heads where they belong, and costs the same at 800 rows as
 * at 80.
 *
 * The three mechanics, and none of them is a library. `table-fixed` plus the
 * `<colgroup>` means the columns never re-measure from whatever rows happen to
 * be mounted. Two spacer `<tr>`s bracket the window instead of transforms, so
 * this stays a real table with a sticky `<thead>`. And the heads live in the
 * SAME flat item list as the runs (`flattenArchiveTable`), so a collapsed
 * sweep of 400 costs one item. `windowArchiveTable` is exact arithmetic over
 * two DECLARED row heights rather than an estimator — `--ds-h-row` and
 * `--ds-h-archive-sweep` are set on the elements and pinned against their
 * restated constants, because a spacer computed from a height the rows do not
 * actually have is a table that slides under its own scrollbar. This is the
 * archive's own window and it is NOT D9's proposed shared `ds/` primitive; it
 * claims none of it.
 *
 * ## Two views, and the list keeps its detail beside it
 *
 * `Archived runs` is a table + the selected run's stored snapshot, side by
 * side at ≥1180px — the operator arrives with a question about ONE person and
 * a full-page swap between the answer and the list is a navigation they did
 * not ask for. `Versions & bumps` is the registry and the plan/apply flow that
 * FILLS the archive; it lives here rather than in Settings because the archive
 * is the consequence of a bump.
 *
 * ## Read-only is structural, not a disabled button
 *
 * There is no retry, no cancel, no hide, no resolution and no edit on this
 * surface — not greyed out, ABSENT — because an archived run has no live
 * authority to act on. The one control is **Relaunch**, and it is not an
 * action on the archived run at all: it starts a FRESH run on the current
 * version from the archived input, which is why it asks first, previews what
 * it would create, names what the archived run already filed, and leaves the
 * archived row exactly where it was.
 *
 * ## What this surface will not invent
 *
 * Every list hazard this archive can prove is copied from the frozen row:
 * resolved instances, rehearsal state and the recorded warning set. The row
 * draws those facts directly and folds every absence union by name; it never
 * reconstructs one from a workflow id, title or current descriptor. That same
 * rule governs the detail header and relaunch cautions: a plausible value on a
 * record whose whole job is to be trustworthy is the one thing this surface
 * must never produce.
 *
 * ## The bump is on this page on purpose
 *
 * It is not a modal. A modal "Are you sure?" would be a weaker guard than what
 * is actually here — the plan IS the confirmation, and the list of
 * non-terminal runs that block it is the thing the operator has to act on, so
 * it is rendered as content rather than dismissed as an alert. **Apply stays
 * clickable while blockers exist**, because the refusal is the contract: the
 * server computes blockers inside the applying transaction and its verbatim
 * sentence is what this surface shows. A button disabled by a client-side
 * count would be the client claiming to know what only that transaction can.
 */
import {
Archive as ArchiveIcon,
ArrowLeft,
BadgeCheck,
Camera,
ChevronDown,
ChevronRight,
CircleAlert,
Download,
FileClock,
FlaskConical,
Info,
Lock,
ShieldAlert,
Trash2,
TriangleAlert,
} from "lucide-react";
import { Fragment,useCallback,useEffect,useMemo,useRef,useState,type ReactNode } from "react";
import { z } from "zod";
import type { VersionBumpChangeRecord } from "../../domain/archive/change-record.js";
import type { ResolvedLedgerLineWire } from "../../domain/archive/ledger-resolution.js";
import { EVENT_STREAM_RETENTION_DAYS,type ArchiveRetentionWire } from "../../domain/archive/retention.js";
import type { ArchivedCaptureTile,ArchivedRunAttempt,ArchivedRunSections } from "../../domain/archive/sections.js";
import { systemClock } from "../../domain/clock.js";
import type { CommandResult,VersionScope } from "../../domain/commands.js";
import type {
ArchivedCaptureResourceWire,
ArchivedRunDetailWire,
ArchiveEntryWire,
ArchiveIndexWire,
ArchiveSweepWire,
VersionBumpPlanWire,
WorkflowVersionStateWire,
} from "../../domain/dashboard/archive.js";
import { timelineEventDuration,type NoteWireSchema } from "../../domain/dashboard/run-detail.js";
import { settleCommandResult } from "../app/command-result.js";
import { DashboardClientError } from "../client/errors.js";
import {
BareButton,
Badge,
Banner,
BulletList,
Button,
ButtonLink,
Card,
CardBody,
Chip,
ChipRow,
CountBadge,
Dialog,
DialogBody,
DialogContent,
DialogFooter,
DS_STATUS_ORDER,
dsFocus,
dsIcon,
dsMotion,
dsRadius,
dsText,
EmptyState,
Field,
IconButton,
Input,
MetaLine,
PageHeader,
Panel,
PanelBody,
PanelFooter,
PanelHeader,
PanelToolbar,
Popover,
PopoverContent,
PopoverTrigger,
RadioGroup,
Refusal,
SearchInput,
SectionLabel,
Select,
Skeleton,
StatusPill,
Tab,
Table,
TabList,
TabPanel,
Tabs,
TakeoverFrame,
TBody,
TD,
Textarea,
TH,
THead,
TimelineSteps,
TR,
useDsEnterTransition,
useToasts,
Well,
type DsSortDirection,
type DsStep,
} from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { useArchiveClient as useDashboardClient } from "../state/archive-client.js";
import { LOADING,type AsyncResource } from "../state/async-resource.js";
import type { ArchiveSection } from "./archive-model.js";
import {
ARCHIVE_INDEX,
archiveBumpKind,
ARCHIVED_CAPTURE_ORIGIN_TONE,
ARCHIVED_CAPTURE_VIEWER_NOTE,
archivedCaptureFacts,
archivedDeleteConfirm,
archivedNotRunNote,
archivedOmittedStepsNote,
archivedRelaunchHeadline,
archivedRunHeading,
archivedRunTouchedTest,
archivePriorityTone,
archiveStatusLabel,
archiveSweepFacts,
archiveSweepName,
archiveSweepVersionRange,
archiveWarningChip,
archiveWorkflowCodes,
blockerResolution,
blockerStatusOf,
BUMP_KIND_LABEL,
BUMP_KIND_NOTE,
bumpResolutionColumnHead,
bumpScopeLabel,
composeBumpChangeRecord,
flattenArchiveTable,
parkedWriteBlockers,
resolveBumpKindEffect,
useArchivedCaptureImage,
useArchivedCaptureResource,
useArchiveViewport,
windowArchiveTable,
type ArchivedCaptureResourceLoad,
type ArchiveView,
type BumpRecordComposition,
} from "./archive-model.js";
import { elapsedSecondsBetween,fmtClock,fmtElapsed,fmtInstantDay,plural,shortHash } from "./format.js";
import { dsStatusOf } from "./status-model.js";
import { testInstanceSystems } from "./test-instance-hazard.js";
import {
FailureDetailBody,
FailureRecordHead,
ReceiptEvidenceBody,
type FailureDetailWire,
} from "./trust.js";

const SOURCE_SURFACE = "archive";

type ArchiveTab = "summary" | "logs" | "data" | "people" | "evidence";

/**
 * The two doors an archived record's footer opens (D179's relaunch, D308's
 * delete). Both are confirmed first and both settle into the SAME result slot,
 * so the surface has to name which one is being confirmed and which one an
 * answer belongs to.
 */
type ArchivedRunAction = "relaunch" | "delete";

/**
 * Why a run is prior-version, in the operator's words. The wire's reasons are a
 * closed set; naming them here keeps the archive from printing an enum.
 */
const DRIFT_TEXT: Record<string, string> = {
  "descriptor-version": "version bumped",
  "contract-fingerprint": "shape changed",
  "app-version": "app build changed",
  "app-version-unstamped": "app build unrecorded",
};

function driftWords(drift: readonly string[]): string {
  return drift.map((reason) => DRIFT_TEXT[reason] ?? reason).join(" · ");
}

/* ── the query ───────────────────────────────────────────────────────────── */

/**
 * THE COLUMNS THE TABLE SORTS ON — they are the columns, not a separate list
 * of "sorts". A sort menu offering an order the table has no column for is an
 * order nobody can verify, and a column the operator can see but not click is
 * a column they will try to click anyway.
 */
type ArchiveSortKey = "status" | "name" | "trace" | "when" | "duration";
type ArchiveSortDir = "asc" | "desc";

const ARCHIVE_SORT_LABEL: Record<ArchiveSortKey, string> = {
  status: "Outcome",
  name: "Name",
  trace: "Trace",
  when: "When",
  duration: "Ran for",
};

/**
 * `all` asks nothing; `prod` keeps the runs that touched NO test instance;
 * `test` keeps the runs that touched at least one. A run that resolved no
 * system at all is production by this reading, which is the fail-closed one:
 * "touched a test instance" is a claim, and an empty list does not support it.
 */
const ArchiveInstanceFilterSchema = z.enum(["all", "prod", "test"]);
type ArchiveInstanceFilter = z.infer<typeof ArchiveInstanceFilterSchema>;

interface ArchiveQuery {
  readonly text: string;
  readonly workflowId: string;
  readonly status: string;
  readonly instance: ArchiveInstanceFilter;
  readonly sort: ArchiveSortKey;
  readonly dir: ArchiveSortDir;
}

const EMPTY_ARCHIVE_QUERY: ArchiveQuery = {
  text: "",
  workflowId: "all",
  status: "all",
  instance: "all",
  sort: "when",
  dir: "desc",
};

function queryIsFiltered(query: ArchiveQuery): boolean {
  return query.text.trim() !== ""
    || query.workflowId !== "all"
    || query.status !== "all"
    || query.instance !== "all";
}

/* the test-instance predicate lives in `archive-model.ts` — see the note there */

/**
 * A run's measured duration, or an explicit absence. `endedAt` is served in
 * its own right (D124) precisely so this is real arithmetic; a row with no end
 * instant reports that it has none rather than counting from `now`.
 */
function durationSeconds(entry: ArchiveEntryWire): number | undefined {
  if (entry.endedAt.state !== "present") return undefined;
  return elapsedSecondsBetween(entry.startedAt, entry.endedAt.value);
}

function endedInstant(entry: ArchiveEntryWire): string | undefined {
  return entry.endedAt.state === "present" ? entry.endedAt.value : undefined;
}

/**
 * The row's leading identity token (ref workflow-model §1.1.1, D242).
 *
 * The demo reads `Tomás Rivera · pl v3.0` where this list read
 * `EID 10873698 · Person Lookup v1`, and the reason is width: at 800 rows a
 * full label costs the name column real space and the code costs four
 * characters. So the ROW carries the code and the row's `title` carries the
 * whole label — nothing is lost, it moves to the hover.
 *
 * A record with no frozen code falls back to its LABEL rather than to a
 * derived one. That is not a fabricated value — the label is a real name this
 * record actually holds — and the reason the code is missing travels in the
 * title, so a row reading `Separation Documents v1` beside rows reading
 * `sd v1` explains itself on hover instead of looking like a rendering bug.
 */
function workflowToken(entry: ArchiveEntryWire): string {
  return entry.workflowCode.state === "present" ? entry.workflowCode.value : entry.workflowLabel;
}

function workflowTokenTitle(entry: ArchiveEntryWire): string {
  const version = `v${String(entry.archivedIdentity.descriptorVersion)}`;
  return entry.workflowCode.state === "present"
    ? `${entry.workflowLabel} ${version}`
    : `${entry.workflowLabel} ${version} — no short code: ${entry.workflowCode.reason}`;
}

function haystack(entry: ArchiveEntryWire): string {
  return [
    entry.title,
    entry.traceId,
    entry.workflowLabel,
    // An operator who has learned `sd` types `sd`, and the label no longer
    // contains it once the row prints the code.
    entry.workflowCode.state === "present" ? entry.workflowCode.value : "",
    entry.workflowId,
    entry.runId,
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * ONE comparator per column, ascending; the direction is applied once, at the
 * end, so a column cannot come to invert only one of its two directions. An
 * absent value sorts LAST in the ascending order rather than being coerced to
 * zero — "we do not know when this ended" is not "it ended at the epoch".
 */
const COMPARATORS: Record<ArchiveSortKey, (a: ArchiveEntryWire, b: ArchiveEntryWire) => number> = {
  status: (a, b) => DS_STATUS_ORDER.indexOf(dsStatusOf(a.status)) - DS_STATUS_ORDER.indexOf(dsStatusOf(b.status)),
  name: (a, b) => a.title.localeCompare(b.title) || a.workflowLabel.localeCompare(b.workflowLabel),
  trace: (a, b) => a.traceId.localeCompare(b.traceId),
  when: (a, b) => compareOptional(endedInstant(a), endedInstant(b), (x, y) => x.localeCompare(y)),
  duration: (a, b) => compareOptional(durationSeconds(a), durationSeconds(b), (x, y) => x - y),
};

function compareOptional<T>(a: T | undefined, b: T | undefined, compare: (x: T, y: T) => number): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return compare(a, b);
}

function queryArchive(entries: readonly ArchiveEntryWire[], query: ArchiveQuery): ArchiveEntryWire[] {
  const text = query.text.trim().toLowerCase();
  const matched = entries.filter((entry) => {
    if (query.workflowId !== "all" && entry.workflowId !== query.workflowId) return false;
    if (query.status !== "all" && entry.status !== query.status) return false;
    if (query.instance !== "all" && archivedRunTouchedTest(entry) !== (query.instance === "test")) return false;
    if (text !== "" && !haystack(entry).includes(text)) return false;
    return true;
  });
  const compare = COMPARATORS[query.sort];
  // A STABLE tiebreak on the served order. Without it, sorting by a six-value
  // column reshuffles equal rows on every re-render and the row the operator
  // was reading moves under the pointer.
  const order = new Map(entries.map((entry, index) => [entry.runId, index]));
  const sorted = [...matched].sort((a, b) => {
    const primary = compare(a, b);
    return primary !== 0 ? primary : (order.get(a.runId) ?? 0) - (order.get(b.runId) ?? 0);
  });
  return query.dir === "desc" ? sorted.reverse() : sorted;
}

/* ── sweeps, as the sections of the table ────────────────────────────────── */

/**
 * Group a QUERIED list by the sweep that archived it, preserving the sort
 * inside each section. Grouping is applied AFTER the sort so the two stay
 * independent: the operator chooses an order, and the sections are the places
 * that order runs through.
 */
function groupBySweep(entries: readonly ArchiveEntryWire[], sweeps: readonly ArchiveSweepWire[]): ArchiveSection[] {
  const byId = new Map(sweeps.map((sweep) => [sweep.applicationId, sweep]));
  const sections: ArchiveSection[] = [];
  const index = new Map<string, ArchiveEntryWire[]>();
  for (const entry of entries) {
    let bucket = index.get(entry.applicationId);
    if (bucket === undefined) {
      bucket = [];
      index.set(entry.applicationId, bucket);
      sections.push({ sweep: byId.get(entry.applicationId), applicationId: entry.applicationId, entries: bucket });
    }
    bucket.push(entry);
  }
  return sections;
}

function scopeWord(scope: ArchiveSweepWire["scope"]): string {
  return scope.kind === "application" ? "app" : plural(scope.workflowIds.length, "workflow");
}

/* ── the table ───────────────────────────────────────────────────────────── */

/**
 * The status column shares a lead slot with the sweep header: a fixed-width
 * chevron well, then the pill. Empty on run rows so every Done / Cancelled
 * left edge sits on the same x as the scope badge above it.
 */
function ArchiveStatusLead({ children }: { children?: ReactNode }) {
  return (
    <span
      aria-hidden={children ? undefined : true}
      className={cn(dsIcon.sm, "inline-flex shrink-0 items-center justify-center")}
    >
      {children}
    </span>
  );
}

/** The exact warning count and first sentence copied off the frozen row. */
function ArchiveWarningCount({ warnings }: { warnings: ArchiveEntryWire["warnings"] }) {
  const chip = archiveWarningChip(warnings);
  if (chip.state === "absent") return null;
  return (
    <span
      aria-label={plural(chip.count, "warning")}
      title={chip.title}
      className={cn(
        "inline-flex h-[var(--ds-h-xs)] shrink-0 items-center gap-[var(--ds-space-tight)] rounded-[var(--ds-radius-sm)] border px-[var(--ds-space-snug)]",
        "border-[color:var(--ds-status-done-warnings-border)] bg-[var(--ds-status-done-warnings-bg)] text-[color:var(--ds-status-done-warnings-fg)]",
        dsText.meta,
        dsText.nums,
        dsText.flush,
      )}
    >
      <TriangleAlert aria-hidden className={dsIcon.sm} />
      {chip.count}
    </span>
  );
}

/** A list-row rehearsal mark: compact, but never reduced to color alone. */
function ArchiveDryRunMark() {
  return (
    <span
      title="Dry run — this rehearsal reads the systems and writes nothing."
      className={cn(
        "inline-flex h-[var(--ds-h-xs)] shrink-0 items-center gap-[var(--ds-space-tight)] rounded-[var(--ds-radius-sm)] border px-[var(--ds-space-snug)]",
        "border-[color:var(--ds-info-border)] bg-[var(--ds-info-bg)] text-[color:var(--ds-info-fg)]",
        dsText.meta,
        dsText.flush,
      )}
    >
      <FlaskConical aria-hidden className={dsIcon.sm} />
      dry run
    </span>
  );
}

function ArchiveRow({
  entry,
  selected,
  rowIndex,
  onSelect,
}: {
  entry: ArchiveEntryWire;
  selected: boolean;
  /** this row's 1-based position in the FULL flat list (finding 4) */
  rowIndex: number;
  onSelect: () => void;
}) {
  const seconds = durationSeconds(entry);
  const ended = endedInstant(entry);
  return (
    <TR
      interactive
      selected={selected}
      onClick={onSelect}
      className="cursor-pointer"
      aria-rowindex={rowIndex}
    >
      <TD className="truncate">
        <span className="inline-flex min-w-0 items-center gap-[var(--ds-space-snug)]">
          <ArchiveStatusLead />
          <StatusPill status={dsStatusOf(entry.status)} size="sm" hideIcon />
          <ArchiveWarningCount warnings={entry.warnings} />
        </span>
      </TD>
      <TD className="min-w-0">
        <span className="flex min-w-0 items-center gap-[var(--ds-space-snug)]">
          {/*
            The whole row is the click target and carries `aria-selected`; the
            name cell holds the only real button, so a screen reader gets one
            command per row rather than five.
          */}
          <BareButton
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSelect();
            }}
            className={cn("min-w-0 flex-1 truncate text-left text-[color:var(--ds-fg)]", dsFocus)}
            title={`${entry.title} · ${workflowTokenTitle(entry)} — archived because ${driftWords(entry.drift)}`}
          >
            {entry.title}
            <span className={cn(dsText.meta, dsText.nums, "text-[color:var(--ds-fg-muted)]")}>
              {" "}
              · {workflowToken(entry)} v{entry.archivedIdentity.descriptorVersion}
            </span>
          </BareButton>
          {/*
            The one hazard this wire can name on a LIST row: a run whose app
            build was never stamped (D179 reads it forward, never back-fills).
            It rides the name cell as an icon rather than a column, because a
            hazard may not scroll off.
          */}
          {entry.appVersion.state !== "present" && (
            <TriangleAlert
              aria-label="app build unrecorded"
              className={cn(dsIcon.sm, "shrink-0 text-[color:var(--ds-status-waiting-fg)]")}
            />
          )}
          {entry.dryRun && <ArchiveDryRunMark />}
          {/*
            The second hazard a LIST row can now name: this run resolved a TEST
            instance of at least one system, so whatever it reports it did, it
            did somewhere that is not production. The detail has always been
            able to say so off the frozen row; the index carries the same field
            now, because a hazard you must open a run to see is one the list is
            free to hide.
          */}
          {archivedRunTouchedTest(entry) && (
            <TriangleAlert
              aria-label={`touched a test instance of ${testInstanceSystems(entry.resolvedInstances).join(", ")}`}
              className={cn(dsIcon.sm, "shrink-0 text-[color:var(--ds-status-waiting-fg)]")}
            />
          )}
        </span>
      </TD>
      <TD numeric className="truncate text-[color:var(--ds-fg-muted)]">
        {entry.traceId}
      </TD>
      <TD numeric className="whitespace-nowrap text-[color:var(--ds-fg-muted)]">
        {ended === undefined
          ? <span title={entry.endedAt.state === "absent" ? entry.endedAt.reason : undefined}>—</span>
          : fmtClock(ended)}
      </TD>
      <TD align="right" numeric className="whitespace-nowrap text-[color:var(--ds-fg-faint)]">
        {seconds === undefined ? "—" : fmtElapsed(seconds)}
      </TD>
    </TR>
  );
}

/**
 * A SWEEP, as a collapsible section head — laid on the TABLE'S OWN COLUMNS.
 *
 * Every fact goes to the column it rhymes with: the sweep's own id lands in
 * the trace column, the version pair folds into the Name cell, when it ran
 * lands over the runs' own clocks, and how many it swept lands right-aligned
 * where their durations are. Change a `<col>` and the head follows, because it
 * has no widths of its own to keep in sync.
 *
 * When the index carries no sweep for an entry's `applicationId` the gap is
 * NAMED — that is the one case where the archive loses the reason it exists,
 * and degrading to a raw id in the slot a version pair belongs would hide it.
 */
function SweepSectionRow({
  section,
  codes,
  collapsed,
  rowIndex,
  onToggle,
}: {
  section: ArchiveSection;
  /** `workflowId@version → frozen short code`, joined off the index (AR80) */
  codes: ReadonlyMap<string, string>;
  collapsed: boolean;
  /** this row's 1-based position in the FULL flat list (finding 4) */
  rowIndex: number;
  onToggle: () => void;
}) {
  const { sweep, applicationId } = section;
  const count = section.entries.length;
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  const cell = "bg-[var(--ds-surface-2)] border-b border-[color:var(--ds-border)]";
  const kind = sweep === undefined ? undefined : archiveBumpKind(sweep.changeRecord);
  const name = sweep === undefined ? undefined : archiveSweepName(sweep, codes);
  const summary = (() => {
    if (sweep === undefined || name === undefined) {
      return `${applicationId} — the index carries no sweep record, ${plural(count, "run")}`;
    }
    const sweepKind = archiveBumpKind(sweep.changeRecord);
    return sweepKind.state === "present"
      ? `${name.text}, ${sweepKind.kind} bump — ${scopeWord(sweep.scope)} scope, ${plural(count, "run")}`
      : `${name.text}, bump kind unrecorded — ${sweepKind.reason}, ${plural(count, "run")}`;
  })();

  return (
    /*
      The head's height is DECLARED, not left to its content: the windowed
      body's spacer rows are computed from `ARCHIVE_SECTION_PX`, and a head
      that measured anything else would slide every row below it (D274 item 1).
    */
    <TR
      interactive
      onClick={onToggle}
      className={cn("h-[var(--ds-h-archive-sweep)]", dsMotion.fast)}
      aria-rowindex={rowIndex}
    >
      <TD className={cn(cell, "align-middle")}>
        <BareButton
          type="button"
          aria-expanded={!collapsed}
          onClick={(event) => {
            // the row already toggles; without this the press counts twice
            event.stopPropagation();
            onToggle();
          }}
          className={cn(
            "flex min-w-0 cursor-pointer items-center gap-[var(--ds-space-snug)] text-left",
            dsFocus,
            dsRadius.sm,
          )}
        >
          <ArchiveStatusLead>
            <Chevron aria-hidden className={cn(dsIcon.sm, "shrink-0 text-[color:var(--ds-fg-muted)]")} />
          </ArchiveStatusLead>
          <span className="sr-only">{summary}</span>
          {sweep === undefined ? (
            <span aria-hidden className={cn(dsText.meta, "text-[color:var(--ds-danger)]")}>no record</span>
          ) : kind?.state === "present" ? (
            <Badge tone={kind.tone} title={kind.label}>{kind.kind}</Badge>
          ) : (
            <span
              aria-hidden
              title={kind?.reason}
              className={cn(dsText.meta, "text-[color:var(--ds-danger)]")}
            >
              kind unrecorded
            </span>
          )}
        </BareButton>
      </TD>

      {/* the NAME column — what every swept run was moved off, and onto */}
      <TD className={cn(cell, "min-w-0")}>
        {name === undefined ? (
          <span className={cn(dsText.meta, "block min-w-0 truncate text-[color:var(--ds-danger)]")}>
            Sweep record missing
          </span>
        ) : (
          /*
            AR80/AR82 — the cell prints the FROZEN short codes (`sk v3 → 4.0.0`)
            and the hover carries a second fact, not a copy of the cell: the
            bump's scope, then the ids the codes stand in for.
          */
          <span
            className={cn(dsText.meta, dsText.nums, "block min-w-0 truncate font-semibold text-[color:var(--ds-fg)]")}
            title={name.title}
          >
            {name.text}
          </span>
        )}
      </TD>

      {/* the TRACE column — a sweep's id is an id, and it belongs where the ids are */}
      <TD numeric className={cn(cell, "truncate text-[color:var(--ds-fg-muted)]")} title={applicationId}>
        {shortHash(applicationId)}
      </TD>

      {/* the WHEN column — a sweep's date directly over the dates it swept */}
      <TD numeric className={cn(cell, "whitespace-nowrap text-[color:var(--ds-fg-muted)]")}>
        {sweep === undefined ? "" : fmtClock(sweep.appliedAt)}
      </TD>

      {/* the DURATION column — how many runs this sweep took, and the record */}
      <TD align="right" className={cn(cell, "whitespace-nowrap")}>
        <span className="inline-flex items-center gap-[var(--ds-space-tight)]">
          <CountBadge value={count} />
          <Popover>
            <PopoverTrigger asChild>
              <IconButton
                size="xs"
                onClick={(event) => event.stopPropagation()}
                label={name === undefined ? `About ${applicationId}` : `About this bump — ${name.text}`}
                icon={<Info aria-hidden className={dsIcon.sm} />}
                className="shrink-0 data-[state=open]:bg-[var(--ds-surface-3)] data-[state=open]:text-[color:var(--ds-fg)]"
              />
            </PopoverTrigger>
            <PopoverContent
              title={name === undefined ? "Sweep record missing" : name.text}
              description={kind?.state === "present" ? kind.label : undefined}
              width="lg"
              align="end"
            >
              {sweep === undefined ? (
                <p className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>
                  Swept by <span className={dsText.nums}>{applicationId}</span>, which this index does not carry. The
                  runs are intact; what is missing is why they were archived.
                </p>
              ) : (
                <div className="flex flex-col gap-[var(--ds-space-base)]">
                  <p className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>
                    {sweep.scope.kind === "application"
                      ? `Every workflow, because app ${sweep.scope.applicationVersion} shipped — an old run may not be interpretable against new dashboard state.`
                      : `${sweep.scope.workflowIds.join(", ")} — every prior-version run of ${sweep.scope.workflowIds.length === 1 ? "that workflow" : "those workflows"} left the live surfaces in one act.`}
                  </p>
                  {/*
                    Charter §25's change record: what moved and WHY, authored
                    by whoever made the change at the moment they made it. A
                    sweep applied before it was collected says so — inventing a
                    sentence from the ids would be a second, fabricated account
                    of a decision with one author.
                  */}
                  <ChangeRecordBody record={sweep.changeRecord} />
                  {/*
                    AR84 — a fold, because a popover body does not exist until
                    the popover is open and nothing rendered could pin it. Its
                    first item is the sweep's WHOLE id: the trace cell prints
                    eight characters and until now the rest lived on that
                    cell's `title` and nowhere else.
                  */}
                  <MetaLine items={archiveSweepFacts(sweep)} />
                </div>
              )}
            </PopoverContent>
          </Popover>
        </span>
      </TD>
    </TR>
  );
}

export function ArchiveTable({
  sections,
  codes,
  query,
  onSort,
  collapsed,
  onToggleSection,
  selectedRunId,
  onSelect,
}: {
  sections: readonly ArchiveSection[];
  /** `workflowId@version → frozen short code` (AR80), joined off the index */
  codes: ReadonlyMap<string, string>;
  query: ArchiveQuery;
  onSort: (key: ArchiveSortKey) => void;
  collapsed: ReadonlySet<string>;
  onToggleSection: (applicationId: string) => void;
  selectedRunId: string | undefined;
  onSelect: (runId: string) => void;
}) {
  // The head's LABEL and its sort key come from the same map, so a column
  // cannot come to be headed one thing and sort by another.
  const head = (key: ArchiveSortKey): { sort: DsSortDirection; onSort: () => void; children: ReactNode } => ({
    sort: query.sort === key ? (query.dir === "asc" ? "ascending" : "descending") : "none",
    onSort: () => onSort(key),
    children: ARCHIVE_SORT_LABEL[key],
  });

  const items = useMemo(() => flattenArchiveTable(sections, collapsed), [sections, collapsed]);
  const [scrollRef, viewport] = useArchiveViewport();
  const pane = useMemo(() => windowArchiveTable(items, viewport), [items, viewport]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
      {/*
        `rowCount` is the flat item count the window walks, not however many
        happen to be mounted right now — the whole reason a windowed body needs
        it (finding 4): a screen reader reading the DOM alone would count only
        the overscanned slice and never learn the list is 800 long.
      */}
      <Table label="Archived runs" layout="fixed" rowCount={items.length} className="min-w-[720px]">
        {/*
          The measured column widths. Every one of these except the name is a
          value of known shape — a status word, a trace id, a clock, a duration
          — so they are fixed and the name takes the slack. That is what puts
          every name on the same x.
        */}
        <colgroup>
          <col className="w-[var(--ds-w-archive-status)]" />
          <col />
          <col className="w-[var(--ds-w-archive-trace)]" />
          <col className="w-[var(--ds-w-archive-when)]" />
          <col className="w-[var(--ds-w-archive-duration)]" />
        </colgroup>
        <THead>
          <TR>
            <TH {...head("status")} />
            <TH {...head("name")} />
            <TH {...head("trace")} />
            <TH {...head("when")} />
            <TH align="right" className="whitespace-nowrap" {...head("duration")} />
          </TR>
        </THead>
        {/*
          ONE body, windowed. The sweep heads and the run rows are a single
          flat sequence (`flattenArchiveTable`), so a section header is an item
          exactly as a run is and a collapsed sweep of 400 costs one item
          rather than 400 skipped ones. The window is bracketed by two spacer
          `<tr>`s rather than by transforms, which keeps this a real table:
          native semantics, the sticky `<thead>`, and no absolutely-positioned
          rows to fight (D274 item 1).
        */}
        <TBody>
          {pane.beforePx > 0 && (
            <tr aria-hidden style={{ height: pane.beforePx }}>
              <td colSpan={5} />
            </tr>
          )}
          {items.slice(pane.firstIndex, pane.lastIndex).map((item, offset) => {
            // 1-based, over the FULL flat list — the position `rowCount` above
            // promises exists, not the position within this mounted slice.
            const rowIndex = pane.firstIndex + offset + 1;
            return item.kind === "section"
              ? (
                <SweepSectionRow
                  key={`section-${item.section.applicationId}`}
                  section={item.section}
                  codes={codes}
                  collapsed={item.collapsed}
                  rowIndex={rowIndex}
                  onToggle={() => onToggleSection(item.section.applicationId)}
                />
              )
              : (
                <ArchiveRow
                  key={item.entry.runId}
                  entry={item.entry}
                  selected={item.entry.runId === selectedRunId}
                  rowIndex={rowIndex}
                  onSelect={() => onSelect(item.entry.runId)}
                />
              );
          })}
          {pane.afterPx > 0 && (
            <tr aria-hidden style={{ height: pane.afterPx }}>
              <td colSpan={5} />
            </tr>
          )}
        </TBody>
      </Table>
    </div>
  );
}

function ArchiveListPanel({
  wire,
  query,
  onQuery,
  collapsed,
  onToggleSection,
  selectedRunId,
  onSelect,
}: {
  wire: ArchiveIndexWire;
  query: ArchiveQuery;
  onQuery: (next: ArchiveQuery) => void;
  collapsed: ReadonlySet<string>;
  onToggleSection: (applicationId: string) => void;
  selectedRunId: string | undefined;
  onSelect: (runId: string) => void;
}) {
  const workflows = useMemo(() => {
    const seen = new Map<string, string>();
    for (const entry of wire.entries) seen.set(entry.workflowId, entry.workflowLabel);
    return [...seen.entries()];
  }, [wire.entries]);

  const statuses = useMemo(() => {
    const seen = new Set<ArchiveEntryWire["status"]>();
    for (const entry of wire.entries) seen.add(entry.status);
    return [...seen];
  }, [wire.entries]);

  const visible = useMemo(() => queryArchive(wire.entries, query), [wire.entries, query]);
  const sections = useMemo(() => groupBySweep(visible, wire.sweeps), [visible, wire.sweeps]);
  /*
    Built off the WHOLE index, never off `visible`: a filter that hides the
    only run a workflow froze a code on must not change the sweep head's name
    (AR80).
  */
  const codes = useMemo(() => archiveWorkflowCodes(wire), [wire]);
  const filtered = queryIsFiltered(query);

  /**
   * The selection resolves against the VISIBLE list, not the whole archive.
   * Resolving it against the corpus left the detail pane showing a run that
   * was no longer in the list, with nothing highlighted beside it. A filter
   * that empties the list changes nothing — there is no honest run to move to.
   */
  useEffect(() => {
    if (selectedRunId === undefined || visible.length === 0) return;
    if (visible.some((entry) => entry.runId === selectedRunId)) return;
    onSelect(visible[0].runId);
  }, [onSelect, selectedRunId, visible]);

  /**
   * Pressing a column head sorts by it; pressing the ACTIVE one flips the
   * direction. Every column opens on the direction that puts its most useful
   * end first — newest and longest at the top; names and ids from A.
   */
  const toggleSort = useCallback(
    (key: ArchiveSortKey) => {
      if (query.sort === key) {
        onQuery({ ...query, dir: query.dir === "asc" ? "desc" : "asc" });
        return;
      }
      const opensDescending: ArchiveSortKey[] = ["when", "duration"];
      onQuery({ ...query, sort: key, dir: opensDescending.includes(key) ? "desc" : "asc" });
    },
    [onQuery, query],
  );

  return (
    <Panel className="min-h-0">
      <PanelHeader
        title="Archived runs"
        headingLevel={2}
        meta={`${visible.length.toLocaleString()} of ${wire.entries.length.toLocaleString()}`}
        actions={
          <Popover>
            <PopoverTrigger asChild>
              <IconButton
                size="sm"
                label="Retention"
                icon={<Info aria-hidden className={dsIcon.md} />}
                className="text-[color:var(--ds-fg-faint)] hover:text-[color:var(--ds-fg)] data-[state=open]:text-[color:var(--ds-fg)]"
              />
            </PopoverTrigger>
            {/*
              Retention is a rule of the product, not a caption under one list,
              so it lives here rather than as a paragraph pinned under the rows
              it is true of on every run and every day. These are the POLICY —
              the per-run DATES are computed server-side and rendered on each
              archived run's own provenance card, because a surface handed the
              rules is a surface free to apply them wrong.
            */}
            <PopoverContent title="Retention" width="lg" align="end">
              <BulletList
                items={[
                  "An archived row is the audit copy: schema v13 aborts UPDATE and DELETE on it in SQL, not by convention.",
                  `A run's log lines and timeline live in notes/ and spans/, which prune at ${String(EVENT_STREAM_RETENTION_DAYS)} days by file date — open a run to see the date its own partition becomes eligible.`,
                  "Evidence is POINTERS — the captured bytes and the checkpoints stay where they are and are kept until an explicit purge, which is a command and not a schedule.",
                  "The write ledger is never archived and never pruned, which is why a run here still lists what it filed.",
                ]}
              />
            </PopoverContent>
          </Popover>
        }
      />

      {/*
        ONE toolbar row. It scrolls sideways rather than wrapping, because a
        fixed-height bar that wraps silently clips its second line.
      */}
      <PanelToolbar label="Find an archived run" className="gap-[var(--ds-space-snug)] overflow-x-auto">
        <SearchInput
          aria-label="Search archived runs by title, trace id or workflow"
          placeholder="Title, trace, workflow…"
          value={query.text}
          onChange={(event) => onQuery({ ...query, text: event.target.value })}
          onClear={() => onQuery({ ...query, text: "" })}
          className="min-w-[200px] flex-1"
        />
        <Select
          aria-label="Workflow"
          value={query.workflowId}
          onChange={(event) => onQuery({ ...query, workflowId: event.target.value })}
          className="w-auto shrink-0"
        >
          <option value="all">Every workflow</option>
          {workflows.map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </Select>
        <Select
          aria-label="Final status"
          value={query.status}
          onChange={(event) => onQuery({ ...query, status: event.target.value })}
          className="w-auto shrink-0"
        >
          <option value="all">Any outcome</option>
          {statuses.map((status) => (
            <option key={status} value={status}>{archiveStatusLabel(status)}</option>
          ))}
        </Select>
        {/*
          The instance filter. Its three arms are fixed rather than derived
          from what the corpus happens to contain: "which archived runs touched
          a test instance?" is a question worth being able to ASK of an archive
          that answers none, and a control that disappears when the answer is
          empty reads as "this cannot be asked".
        */}
        <Select
          aria-label="Instance"
          value={query.instance}
          onChange={(event) => onQuery({
            ...query,
            instance: ArchiveInstanceFilterSchema.parse(event.target.value),
          })}
          className="w-auto shrink-0"
        >
          <option value="all">Any instance</option>
          <option value="prod">Production only</option>
          <option value="test">Touched a test instance</option>
        </Select>
        {filtered && (
          <Button size="sm" variant="ghost" className="shrink-0" onClick={() => onQuery(EMPTY_ARCHIVE_QUERY)}>
            Clear
          </Button>
        )}
      </PanelToolbar>

      {sections.length === 0 ? (
        <PanelBody>
          <EmptyState
            icon={<ArchiveIcon aria-hidden className={dsIcon.lg} />}
            title={filtered ? "Nothing in the archive matches" : "The archive is empty"}
            description={
              filtered
                ? "Every archived run was excluded by the search or one of the filters. Clearing them shows all of them again."
                /*
                  AR56 — the demo's sentence, verbatim, and it is TRUE of this
                  tree now: D274 made the MAJOR/minor split behavioural, so
                  "only when its workflow's MAJOR version bumps" is the rule
                  rather than a promise the code did not keep.
                */
                : "A run reaches the archive only when its workflow's MAJOR version bumps. Nothing has bumped yet."
            }
            action={
              filtered
                ? (
                  <Button size="sm" variant="secondary" onClick={() => onQuery(EMPTY_ARCHIVE_QUERY)}>
                    Clear the search and filters
                  </Button>
                )
                : undefined
            }
          />
        </PanelBody>
      ) : (
        <ArchiveTable
          sections={sections}
          codes={codes}
          query={query}
          onSort={toggleSort}
          collapsed={collapsed}
          onToggleSection={onToggleSection}
          selectedRunId={selectedRunId}
          onSelect={onSelect}
        />
      )}
    </Panel>
  );
}

/* ── retention ───────────────────────────────────────────────────────────── */

/**
 * ONE retention outlook as a sentence. The four arms read differently on
 * purpose: `permanent` and `on-request` both have no date and are not the same
 * fact, and rendering them alike would let this card tell an operator their
 * screenshots are safe forever when one command removes them. `basis` is the
 * server's own derivation and rides the `title`, so the number is checkable
 * without the surface restating a policy it could get wrong.
 */
function retentionSentence(outlook: ArchiveRetentionWire["row"]): { text: string; title: string } {
  switch (outlook.state) {
    case "scheduled":
      return { text: `purged ${fmtInstantDay(outlook.purgeAt)}`, title: outlook.basis };
    case "permanent":
      return { text: "never purged", title: outlook.basis };
    case "on-request":
      return { text: "kept until an explicit purge", title: outlook.basis };
    case "unknown":
      return { text: "purge date unknown", title: outlook.reason };
  }
}

function RetentionLines({ retention }: { retention: ArchiveRetentionWire }) {
  const rows: readonly [string, ArchiveRetentionWire["row"]][] = [
    ["this archived row", retention.row],
    ["its log lines and timeline", retention.eventStreams],
    ["its captures and checkpoints", retention.evidence],
    ["what it filed", retention.ledger],
  ];
  return (
    <dl className={cn(dsText.meta, "grid grid-cols-[auto_1fr] gap-x-[var(--ds-space-cozy)] gap-y-[var(--ds-space-tight)]")}>
      {rows.map(([label, outlook]) => {
        const sentence = retentionSentence(outlook);
        return (
          <Fragment key={label}>
            <dt className="text-[color:var(--ds-fg-faint)]">{label}</dt>
            <dd className="text-[color:var(--ds-fg-muted)]" title={sentence.title}>{sentence.text}</dd>
          </Fragment>
        );
      })}
      <dt className="text-[color:var(--ds-fg-faint)]">evidence pointers</dt>
      <dd className="text-[color:var(--ds-fg-muted)]" title={retention.pointers.basis}>
        {retention.pointers.total === 0
          ? "none named"
          : `${String(retention.pointers.retained)} of ${String(retention.pointers.total)} still retained`}
      </dd>
    </dl>
  );
}

/* ── the write ledger, resolved ──────────────────────────────────────────── */

/**
 * ONE ledger line as the Write-ledger card renders it.
 *
 * A pointer that resolved to nothing is still a ROW — struck through, naming
 * which of the four failures it is. Dropping it would shorten the list of what
 * a run filed, and that list is the one an operator reads before deciding
 * whether a relaunch would file the same thing twice.
 *
 * `Action` and `Confirmation` come back as reasoned absences today: a ledger
 * entry declares neither, and no commit contract has declared how to read them
 * out of its own proof. The dash carries the server's reason on hover rather
 * than a plausible label — an invented action on the record of what we did to
 * a real person's employment is the failure mode this program exists to stop.
 */
function LedgerLineRow({ line }: { line: ResolvedLedgerLineWire }) {
  if (line.state === "unresolved") {
    return (
      <TR>
        <TD className="text-[color:var(--ds-fg-muted)] line-through">{line.pointer.system}</TD>
        <TD colSpan={3} className="text-[color:var(--ds-status-failed-fg)]" title={line.reason}>
          {`${line.pointer.date} line ${String(line.pointer.sequence)} — ${line.failure.replace(/-/gu, " ")}`}
        </TD>
      </TR>
    );
  }
  return (
    <TR>
      <TD title={`${line.pointer.date} line ${String(line.pointer.sequence)} · ${line.idempotencyKeyDigest === "withheld-protected-input" ? "protected transaction" : line.idempotencyKeyDigest}`}>
        {line.system}
      </TD>
      <TD
        className={line.action.state === "present" ? undefined : "text-[color:var(--ds-fg-faint)]"}
        title={line.action.state === "absent" ? line.action.reason : undefined}
      >
        {line.action.state === "present" ? line.action.value : "—"}
      </TD>
      <TD
        numeric
        className={line.confirmation.state === "present" ? undefined : "text-[color:var(--ds-fg-faint)]"}
        title={line.confirmation.state === "absent" ? line.confirmation.reason : undefined}
      >
        {line.confirmation.state === "present" ? line.confirmation.value : "—"}
      </TD>
      <TD align="right">
        {line.instance === "test"
          ? <Badge tone="warning">test</Badge>
          : <span className="text-[color:var(--ds-fg-muted)]">prod</span>}
      </TD>
    </TR>
  );
}

/* ── one archived run ────────────────────────────────────────────────────── */

/**
 * THE ARCHIVED RUN'S FAILURE RECORD — the same head and the same body the live
 * record draws, so an archived failure and a live one cannot describe one run
 * two ways (unit F8c finding 1).
 *
 * It drew `FailureDetailBody` alone. The head's three facts — the run's own
 * `summary`, its `code` and its permanence — were composed in
 * `log-panel.tsx`'s JSX at unit F8b, and this card, the record's SECOND
 * consumer, silently lost every one of them: an archived failed run printed
 * its write state, its remediation and its diagnosis under a bare
 * `Failure record` label, with the sentence the run wrote about itself nowhere
 * on the page. Nothing failed and no gate could see it, because a card with no
 * head is perfectly grammatical.
 *
 * Exported so `failure-record-render.test.ts` can render the card the archive
 * actually places, on the same footing as `InlineFailureRecord`.
 */
export function ArchivedFailureCard({ failure }: { failure: FailureDetailWire }) {
  return (
    <Card tone="danger">
      <CardBody className="flex flex-col gap-[var(--ds-space-snug)]">
        <SectionLabel>Failure record</SectionLabel>
        <FailureRecordHead detail={failure} />
        <FailureDetailBody detail={failure} />
      </CardBody>
    </Card>
  );
}

/**
 * Which sweep archived this run, in the DETAIL. The scope badge used to live
 * only in the list's section header and vanished the moment you opened a run.
 */
function SweepRecordCard({
  sweep,
  applicationId,
  codes,
}: {
  sweep: ArchiveSweepWire | undefined;
  applicationId: string;
  /** `workflowId@version → frozen short code` (AR80) */
  codes: ReadonlyMap<string, string>;
}) {
  if (sweep === undefined) {
    return (
      <Banner tone="warning" title="Archived by a sweep this index does not carry">
        <span className={cn(dsText.body)}>
          This run names sweep <span className={dsText.nums}>{applicationId}</span>. The snapshot is intact and its
          digest is verifiable; what is missing is the stated reason it left the live surfaces.
        </span>
      </Banner>
    );
  }
  const kind = archiveBumpKind(sweep.changeRecord);
  const versionRange = archiveSweepVersionRange(sweep);
  // Bound once (unit F10d finding 5): a per-render recomputation for the same
  // sweep/codes pair costs nothing observable, but a caller reading the two
  // uses could believe they were free to diverge.
  const name = archiveSweepName(sweep, codes);
  return (
    <Card>
      <CardBody className="flex flex-col gap-[var(--ds-space-snug)]">
        <div className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-snug)]">
          <SectionLabel>Archived by</SectionLabel>
          {kind.state === "present" ? (
            <Badge tone={kind.tone}>{kind.label}</Badge>
          ) : (
            <Badge tone="neutral" title={kind.reason}>kind unrecorded</Badge>
          )}
          <Badge tone={sweep.scope.kind === "application" ? "warning" : "neutral"}>{scopeWord(sweep.scope)}</Badge>
          <span
            className={cn(dsText.meta, dsText.nums, "ml-auto text-[color:var(--ds-fg)]")}
            title={versionRange.state === "absent" ? versionRange.reason : undefined}
          >
            {versionRange.state === "present" ? versionRange.text : `→ ${versionRange.target}`}
          </span>
        </div>
        {/*
          The cell prints the short codes; the full identities they stand in
          for used to live ONLY on `title`, reachable by pointer and by
          nobody else (unit F10d finding 1). `aria-label` pairs the same
          fact onto the accessible name so keyboard/AT users can resolve it.
        */}
        <p className={cn(dsText.body, "text-[color:var(--ds-fg)]")} title={name.title} aria-label={name.title}>
          {name.text}
        </p>
        <ChangeRecordBody record={sweep.changeRecord} />
        <MetaLine
          items={[
            fmtClock(sweep.appliedAt),
            sweep.appliedBy,
            `plan ${shortHash(sweep.versionPlanId)}`,
            `app ${sweep.appliedAppVersion}`,
            `${plural(sweep.archivedCount, "run")} archived`,
          ]}
        />
      </CardBody>
    </Card>
  );
}

export function ArchivedRunDetail({
  detail,
  sweep,
  codes,
  busy,
  relaunched,
  refusal,
  onRelaunch: _onRelaunch,
  onDelete,
  onDismiss,
  onReadCapture,
}: {
  detail: ArchivedRunDetailWire;
  sweep: ArchiveSweepWire | undefined;
  /** `workflowId@version → frozen short code` (AR80), off the loaded index */
  codes: ReadonlyMap<string, string>;
  busy: boolean;
  relaunched: boolean;
  /**
   * The refused answer to a command THIS record's footer issued, keyed to this
   * run by its owner (D308). Before it existed a refused relaunch drew nothing
   * at all: the applied banner was the only answer the detail could give, so a
   * `schema-mismatch` — the one refusal both footer commands are built to
   * produce — left the operator's click looking like it had never happened.
   */
  refusal: CommandResult | undefined;
  onRelaunch: () => void;
  onDelete: () => void;
  onDismiss: () => void;
  onReadCapture: (runId: string, artifactId: string, signal?: AbortSignal) => Promise<ArchivedCaptureResourceWire>;
}) {
  const [tab, setTab] = useState<ArchiveTab>("summary");
  /*
    Both resets are keyed to the RUN, not to the tab: a viewer left open over
    the capture of the run the operator just navigated away from would be
    describing evidence that belongs to somebody else's record.
  */
  const [openCapture, setOpenCapture] = useState<number | undefined>(undefined);
  const captureOpener = useRef<HTMLButtonElement | null>(null);
  const captureFocusGeneration = useRef(0);
  useEffect(() => {
    captureFocusGeneration.current += 1;
    setTab("summary");
    setOpenCapture(undefined);
  }, [detail.runId]);
  const closeCapture = () => {
    const generation = ++captureFocusGeneration.current;
    const opener = captureOpener.current;
    setOpenCapture(undefined);
    requestAnimationFrame(() => {
      if (generation === captureFocusGeneration.current && opener?.isConnected) opener.focus();
    });
  };
  const { toast } = useToasts();

  /**
   * D223's frozen sections, or the sentence saying this record predates them.
   * The tabs never fetch: an archived run has nothing live to fetch against,
   * and a tab that tried would be the descriptor coupling D179 removed.
   */
  const sections = detail.sections.state === "present" ? detail.sections.value : undefined;
  const sectionsAbsence = detail.sections.state === "absent" ? detail.sections.reason : undefined;

  const exportRun = useCallback(() => {
    /*
     * EXACTLY the display-redacted `ArchivedRunDetailWire` this surface holds
     * — never a re-derivation and never a second projection. The export
     * inherits the wire's redaction posture and carries nothing more, which is
     * why D223 could ratify it without opening a new redaction surface.
     */
    const blob = new Blob([JSON.stringify(detail, undefined, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `archive-${detail.detail.header.traceId}.json`;
    /*
     * Mounted before the click and revoked on the next tick, both deliberately.
     * A detached anchor does not fire in every browser, and revoking the object
     * URL synchronously can race the download the click just started — which
     * would leave the toast below claiming a file that never arrived. A success
     * message for an act that did not happen is the failure this program bans,
     * so the two lines that make it impossible are worth the noise.
     */
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => { URL.revokeObjectURL(url); }, 0);
    toast({
      tone: "success",
      title: "Archived run exported",
      description: `archive-${detail.detail.header.traceId}.json — exactly what this page holds, nothing re-derived.`,
    });
  }, [detail, toast]);

  const row = detail.row;
  const status = dsStatusOf(row.status);
  const heading = archivedRunHeading(row);
  const seconds = row.endedAt.state === "present"
    ? elapsedSecondsBetween(row.startedAt, row.endedAt.value)
    : undefined;
  const testInstances = testInstanceSystems(row.resolvedInstances);
  const evidenceCount = detail.evidence.artifactIds.length
    + detail.evidence.checkpointNodeIds.length
    + detail.evidence.writeIntentIds.length;

  /**
   * The FROZEN timeline, mapped to the design system's step vocabulary. The
   * archived detail carries the events verbatim; nothing here re-derives a
   * state from a descriptor, which is what makes the whole page renderable
   * with the workflow registry emptied.
   */
  const omittedStepsNote = archivedOmittedStepsNote(detail.detail.omittedSteps);
  const steps: DsStep[] = detail.detail.timeline.events.map((event) => {
    /*
     * The step's OWN measured duration, read FORWARD: a record frozen before
     * the leaf existed says so rather than rendering a zero, and every other
     * absence carries the server's own reason (still running, no folded start,
     * a gate, disagreeing instants). Nothing here differences two events.
     */
    const measured = timelineEventDuration(event);
    /*
     * D307 — WHY a skipped step did not run, in the frozen wire's own words:
     * the closed vocabulary when the span recorded a reason, and the server's
     * own served sentence when it did not. Both arms draw; only a step that
     * RAN leaves the note slot empty.
     */
    const note = archivedNotRunNote(event);
    return {
      label: event.label,
      ...(note === undefined ? {} : { detail: note }),
      state: event.state === "active"
        ? "current"
        : event.state === "done" || event.state === "failed" || event.state === "skipped"
          ? event.state
          : "pending",
      trailing: measured.state === "present" ? fmtElapsed(Math.round(measured.ms / 1000)) : "—",
      trailingTitle: measured.state === "absent" ? measured.reason : undefined,
    } satisfies DsStep;
  });

  return (
    <Panel className="min-h-0" aria-label={`Archived run ${heading.title}`}>
      <PanelHeader
        title={heading.title}
        headingLevel={2}
        subtitle={heading.subtitle.state === "present"
          ? `${heading.subtitle.value} · archived ${fmtClock(detail.archivedAt)} by ${detail.archivedBy}`
          : `archived ${fmtClock(detail.archivedAt)} by ${detail.archivedBy}`}
        icon={<FileClock aria-hidden className={dsIcon.lg} />}
        meta={<StatusPill status={status} size="sm" />}
        actions={(
          <Button
            size="sm"
            variant="ghost"
            icon={<Download aria-hidden className={dsIcon.md} />}
            onClick={exportRun}
          >
            Export
          </Button>
        )}
      />

      {/*
        The command that produces this is in the panel FOOTER, which is visible
        from every tab — so its answer is mounted above the tab set rather than
        inside one of them.
      */}
      {relaunched && (
        <div className="px-[var(--ds-space-cozy)] pt-[var(--ds-space-cozy)]">
          <Banner
            tone="success"
            title={archivedRelaunchHeadline(detail)}
            action={<Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>}
          >
            <span className={dsText.body}>
              It carries its own trace id, assigned at enqueue. This archived run is untouched — it is listed under
              “Relaunched as” once the archive is re-read.
            </span>
          </Banner>
        </div>
      )}

      {/*
        The footer's refusals, drawn where its applied banner is drawn. Both
        footer commands cite `archiveFingerprint`, so `schema-mismatch` is the
        refusal this pane exists to show: the record moved under the page, and
        the operator has to re-read it before either door will open.
      */}
      {refusal !== undefined && (
        <div className="px-[var(--ds-space-cozy)] pt-[var(--ds-space-cozy)]">
          <ArchivedCommandRefusal result={refusal} onDismiss={onDismiss} />
        </div>
      )}

      <Tabs value={tab} onValueChange={(next) => setTab(next as ArchiveTab)} className="min-h-0 flex-1">
        <TabList label="Archived run detail">
          <Tab value="summary">Summary</Tab>
          <Tab value="logs" count={frozenLogCount(sections)}>Logs</Tab>
          <Tab value="data" count={frozenDataCount(sections)}>Data</Tab>
          {/*
            People exists only where the run HAS members — the demo's own rule.
            A tab that always rendered would put an empty table under a heading
            for every single-subject run, and a record with no frozen sections
            cannot answer the question at all, so it does not claim to.
          */}
          {sections?.people.state === "present" && (
            <Tab value="people" count={sections.people.value.members.length}>People</Tab>
          )}
          <Tab value="evidence" count={evidenceCount}>Evidence</Tab>
        </TabList>

        <TabPanel value="summary" className="flex flex-col gap-[var(--ds-space-cozy)] p-[var(--ds-space-cozy)]">
          {/*
            Identity. Without the version, the build and the resolved instance
            an archived rehearsal is indistinguishable from an archived filing.
          */}
          <ChipRow>
            <Chip label="version">v{detail.archivedIdentity.descriptorVersion}</Chip>
            <Chip
              label="app"
              tone={detail.appVersion.state === "present" ? "neutral" : "warning"}
              title={detail.appVersion.state === "present" ? undefined : detail.appVersion.reason}
            >
              {detail.appVersion.state === "present" ? detail.appVersion.value : "unrecorded"}
            </Chip>
            <Chip label="trace">{detail.detail.header.traceId}</Chip>
            <Chip label="by">{row.actorId}</Chip>
            <Chip label="priority" tone={archivePriorityTone(row.priority)}>{row.priority}</Chip>
            <Chip label="attempt">{String(detail.detail.header.attempt)}</Chip>
            {row.dryRun && (
              <Chip tone="info" icon={<FlaskConical aria-hidden className={dsIcon.sm} />}>
                dry run — wrote nothing
              </Chip>
            )}
            {testInstances.length > 0 && (
              <Chip tone="warning" icon={<TriangleAlert aria-hidden className={dsIcon.sm} />}>
                test instance · {testInstances.join(", ")}
              </Chip>
            )}
            {detail.relaunch.state === "available"
              && detail.relaunch.current.descriptorVersion > detail.archivedIdentity.descriptorVersion && (
              <Chip tone="warning">shape moved · v{detail.relaunch.current.descriptorVersion}</Chip>
            )}
          </ChipRow>

          <MetaLine
            items={[
              detail.workflowLabel,
              ...(detail.workflowCode.state === "present" ? [`code ${detail.workflowCode.value}`] : []),
              `started ${fmtClock(row.startedAt)}`,
              row.endedAt.state === "present" ? `ended ${fmtClock(row.endedAt.value)}` : row.endedAt.reason,
              seconds === undefined ? "duration unknown" : `ran ${fmtElapsed(seconds)}`,
              `archived because ${driftWords(detail.drift)}`,
              ...row.resolvedInstances.map((resolved) => `${resolved.system} ${resolved.instance}`),
            ]}
          />

          <SweepRecordCard sweep={sweep} applicationId={detail.applicationId} codes={codes} />

          {detail.failure.state === "present" && <ArchivedFailureCard failure={detail.failure.value} />}

          <Card>
            <CardBody className="flex flex-col gap-[var(--ds-space-snug)]">
              <div className="flex items-center gap-[var(--ds-space-snug)]">
                <SectionLabel>Receipt — stored, not re-derived</SectionLabel>
                {detail.receipt.state === "present" && (
                  <Badge
                    tone={detail.receipt.value.confidence === "verified"
                      ? "success"
                      : detail.receipt.value.confidence === "partial" ? "warning" : "neutral"}
                    className="ml-auto"
                  >
                    {detail.receipt.value.confidence}
                  </Badge>
                )}
              </div>
              {detail.receipt.state === "present" ? (
                <>
                  <MetaLine
                    items={[
                      `receipt ${shortHash(detail.receipt.value.receiptId)}`,
                      detail.receipt.value.result,
                      `generated ${fmtClock(detail.receipt.value.generatedAt)}`,
                    ]}
                  />
                  {/*
                    The SAME body the live trust surface renders — one rendering
                    path, so an archived receipt and a live one cannot describe
                    the same evidence two ways.
                  */}
                  <ReceiptEvidenceBody receipt={detail.receipt.value} />
                </>
              ) : (
                <Well>
                  <span className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>{detail.receipt.reason}</span>
                </Well>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody className="flex flex-col gap-[var(--ds-space-snug)]">
              <SectionLabel>Step timeline</SectionLabel>
              {omittedStepsNote !== undefined && (
                <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{omittedStepsNote}</p>
              )}
              {steps.length === 0
                ? <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>This run recorded no steps.</p>
                : <TimelineSteps steps={steps} variant="full" label="Archived run timeline" />}
            </CardBody>
          </Card>

          <div className="grid grid-cols-2 gap-[var(--ds-space-base)]">
            <Card>
              <CardBody grow className="flex flex-col gap-[var(--ds-space-snug)]">
                <SectionLabel>Immutable input — what a relaunch replays</SectionLabel>
                {/*
                  Withheld from the wire on purpose: the stored submission
                  exists in authority for exactly one job — replanning a
                  relaunch through TODAY's ingress and canonical schemas, inside
                  the command transaction — so shipping it to the browser would
                  widen what an archive exposes for no surface that reads it.
                */}
                <Well>
                  <span className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>
                    Held in authority, not served to this page. A relaunch replans it server-side from the archived raw
                    submission; it never replays the canonical value, which was validated by a schema that has since
                    moved.
                  </span>
                </Well>
              </CardBody>
            </Card>

            <Card>
              <CardBody grow className="flex flex-col gap-[var(--ds-space-snug)]">
                <SectionLabel>Decision</SectionLabel>
                {detail.detail.gate.state === "resolved" ? (
                  <div className="flex min-w-0 flex-col gap-[var(--ds-space-hair)]">
                    <span className="flex min-w-0 items-center gap-[var(--ds-space-snug)]">
                      <Badge tone={detail.detail.gate.resolution === "approved" ? "success" : "danger"}>
                        {detail.detail.gate.resolution}
                      </Badge>
                      <span className={cn(dsText.micro, dsText.nums, "ml-auto shrink-0 text-[color:var(--ds-fg-faint)]")}>
                        {fmtClock(detail.detail.gate.resolvedAt)}
                      </span>
                    </span>
                    <span className={cn(dsText.body, "text-[color:var(--ds-fg)]")}>{detail.detail.gate.label}</span>
                    {/* D237 — the approver. An archived decision that names an
                        instant and no human is the same silence the live panel
                        carried; the frozen wire has carried the name since the
                        arm became reachable. */}
                    <span className={cn(dsText.micro, "text-[color:var(--ds-fg-muted)]")}>
                      by {detail.detail.gate.resolvedBy}
                    </span>
                  </div>
                ) : (
                  <span className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>
                    {detail.detail.gate.state === "open"
                      ? `${detail.detail.gate.label} — opened ${fmtClock(detail.detail.gate.openedAt)} and never answered.`
                      : detail.detail.gate.reason}
                  </span>
                )}
                {/*
                  AR150 — three counts about the RUN used to sit here, under a
                  card about the GATE. Each has an owner a few hundred pixels
                  away (the Attempts card, the Data tab, the Evidence tab), and
                  each owner derives its number from the FROZEN sections while
                  `context` is the run detail's own count — two sources for one
                  fact, which is the thing this bundle bans. Where a section
                  was never frozen its owner prints the REASON, and a reason is
                  a better answer than a number the archive cannot corroborate.
                */}
              </CardBody>
            </Card>
          </div>

          {/*
            The retry's shape. `context.attempts` is a COUNT and a count cannot
            say what each attempt did — on a run that failed twice before
            settling, that is the whole story. The rows are folded off
            `(runId, attempt, spanPath)`, which is the identity the projection
            already carried.
          */}
          <Card>
            <CardBody className="flex flex-col gap-[var(--ds-space-snug)]">
              <SectionLabel>Attempts</SectionLabel>
              {sections?.attempts.state === "present" ? (
                <Table label="What each attempt of this run did">
                  <THead>
                    <TR>
                      <TH>Attempt</TH>
                      <TH>Steps</TH>
                      <TH align="right">Ran</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {sections.attempts.value.map((attempt) => (
                      <AttemptRow key={attempt.attempt} attempt={attempt} />
                    ))}
                  </TBody>
                </Table>
              ) : (
                <Well>
                  <span className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>
                    {sections?.attempts.state === "absent" ? sections.attempts.reason : sectionsAbsence}
                  </span>
                </Well>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody className="flex flex-col gap-[var(--ds-space-snug)]">
              <SectionLabel>Write ledger — never archived</SectionLabel>
              {detail.ledger.length === 0 ? (
                <Well>
                  <span className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>
                    This run filed nothing, so it has no ledger line. An absent line is itself the answer to “did this
                    write?”.
                  </span>
                </Well>
              ) : (
                /*
                  The pointers, RESOLVED against the live ledger at read time.
                  The archived record still copies nothing — it names
                  `(system, date, sequence)` and the server opens the line — so
                  the card can say what was filed without the archive ever
                  holding a copy of the audit record.
                */
                <Table label="Ledger lines this run filed">
                  <THead>
                    <TR>
                      <TH>System</TH>
                      <TH>Action</TH>
                      <TH>Confirmation</TH>
                      <TH>Instance</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {detail.ledger.map((line) => (
                      <LedgerLineRow key={`${line.pointer.system}-${line.pointer.date}-${String(line.pointer.sequence)}`} line={line} />
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>

          {/* The page's whole claim rests on trusting this row. */}
          <Card>
            <CardBody className="flex flex-col gap-[var(--ds-space-snug)]">
              <SectionLabel>Snapshot provenance &amp; retention</SectionLabel>
              <MetaLine
                items={[
                  `archived by ${detail.archivedBy}`,
                  `schema generation ${String(detail.archiveSchemaGeneration)}`,
                  `integrity ${shortHash(detail.archiveFingerprint)}`,
                  `ran under ${shortHash(detail.archivedIdentity.contractFingerprint)}`,
                ]}
              />
              <BulletList
                items={[
                  "This row, its detail, its receipt and its evidence pointers were written at archive time — nothing on this page is re-projected through the code the run executed.",
                  "The archived record is insert-only in SQL: it cannot be edited or deleted, which is what makes it the audit copy.",
                ]}
              />
              <RetentionLines retention={detail.retention} />
            </CardBody>
          </Card>

          {detail.relaunches.length > 0 && (
            <Card>
              <CardBody className="flex flex-col gap-[var(--ds-space-snug)]">
                <SectionLabel>Relaunched as</SectionLabel>
                {detail.relaunches.map((entry) => (
                  <MetaLine
                    key={entry.runId}
                    items={[
                      entry.runId,
                      `v${String(entry.relaunchedIdentity.descriptorVersion)}`,
                      entry.relaunchedBy,
                      fmtClock(entry.relaunchedAt),
                    ]}
                  />
                ))}
              </CardBody>
            </Card>
          )}
        </TabPanel>

        <TabPanel value="logs" className="flex min-h-0 flex-col gap-[var(--ds-space-base)] p-[var(--ds-space-cozy)]">
          <FrozenSection section={sections?.logs} absence={sectionsAbsence} what="log lines">
            {(page) => page.notes.length === 0 ? (
              <EmptyState
                icon={<Info aria-hidden className={dsIcon.lg} />}
                title="This run wrote no log line"
                description="The note stream was frozen at archive time and it was empty. That is the run's own record, not a gap in this one."
              />
            ) : (
              <Card>
                <CardBody className="flex flex-col gap-[var(--ds-space-hair)]">
                  {page.notes.map((note) => (
                    <FrozenLogLine key={note.noteId} note={note} />
                  ))}
                </CardBody>
              </Card>
            )}
          </FrozenSection>
        </TabPanel>

        <TabPanel value="data" className="flex min-h-0 flex-col gap-[var(--ds-space-base)] p-[var(--ds-space-cozy)]">
          <FrozenSection section={sections?.data} absence={sectionsAbsence} what="data points">
            {(data) => data.entries.length === 0 ? (
              <EmptyState
                icon={<Info aria-hidden className={dsIcon.lg} />}
                title="This run recorded no display-safe data point"
                description="Nothing was frozen because nothing was there — the run's declared details were empty."
              />
            ) : (
              <Card>
                <CardBody>
                  <Table label="Data points this run recorded">
                    <THead>
                      <TR>
                        <TH>Field</TH>
                        <TH>Value</TH>
                        <TH align="right">Observed</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {data.entries.map((entry) => (
                        <TR key={`${entry.label}-${entry.valueRedacted}`}>
                          <TD>{entry.label}</TD>
                          <TD>
                            <span className={dsText.nums}>{entry.valueRedacted}</span>
                            {entry.correctedAt !== undefined && (
                              <Badge tone="warning" className="ml-[var(--ds-space-hair)]">corrected</Badge>
                            )}
                          </TD>
                          <TD align="right">
                            {/*
                              Both halves are read forward (D133): a value whose
                              producing checkpoint carried no provenance simply
                              has no instant, and an em dash is the honest cell
                              — dating it from the archive instant would date
                              the ROW rather than the FACT.
                            */}
                            <span className={cn(dsText.meta, dsText.nums, "text-[color:var(--ds-fg-muted)]")}>
                              {entry.observedAt === undefined ? "—" : fmtClock(entry.observedAt)}
                              {entry.source !== undefined && ` · ${entry.source}`}
                            </span>
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </CardBody>
              </Card>
            )}
          </FrozenSection>
        </TabPanel>

        {sections?.people.state === "present" && (
          <TabPanel value="people" className="flex min-h-0 flex-col gap-[var(--ds-space-base)] p-[var(--ds-space-cozy)]">
            <Card>
              <CardBody>
                <Table label="Member runs this run fanned out">
                  <THead>
                    <TR>
                      <TH>Member</TH>
                      <TH align="right">Outcome</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {sections.people.value.members.map((member) => (
                      <TR key={member.runId}>
                        <TD>
                          <span className="flex min-w-0 flex-col">
                            <span className={cn(dsText.body, "truncate text-[color:var(--ds-fg)]")}>{member.label}</span>
                            <span className={cn(dsText.meta, dsText.nums, "truncate text-[color:var(--ds-fg-faint)]")}>
                              {member.runId}
                            </span>
                          </span>
                        </TD>
                        <TD align="right"><StatusPill status={dsStatusOf(member.status)} size="sm" /></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardBody>
            </Card>
            <p className={cn(dsText.meta, "text-[color:var(--ds-fg-faint)]")}>
              Frozen at archive time. Each member run was archived by the same sweep and has its own row in the list
              beside this panel.
            </p>
          </TabPanel>
        )}

        <TabPanel value="evidence" className="flex flex-col gap-[var(--ds-space-base)] p-[var(--ds-space-cozy)]">
          {evidenceCount === 0 ? (
            <EmptyState
              icon={<Camera aria-hidden className={dsIcon.lg} />}
              title="No evidence was captured"
              description="This run archived no artifact, checkpoint or write intent. There is nothing to point at."
            />
          ) : (
            <>
              {/*
                Tiles for the captures the record can DESCRIBE, pointers for the
                rest. The bytes still stay where they are — D179's "evidence is
                pointers only" is about the content, and nothing here reads it —
                but a chip carrying `9f2c…` and nothing else cannot say what the
                capture was of, when it was taken, or whether it is pinned. The
                thumbnail is a labelled placeholder at the capture's real aspect,
                never a drawn stand-in for a real system page.
              */}
              {sections?.captures.state === "present" ? (
                <Card>
                  <CardBody className="flex flex-col gap-[var(--ds-space-snug)]">
                    <div className="flex items-center gap-[var(--ds-space-snug)]">
                      <SectionLabel>Captures</SectionLabel>
                      <CountBadge value={sections.captures.value.length} className="ml-auto" />
                    </div>
                    <div className="flex flex-col gap-[var(--ds-space-snug)]">
                      {sections.captures.value.map((tile, index) => (
                        <CaptureTileRow
                          key={tile.artifactId}
                          tile={tile}
                          onOpen={(opener) => {
                            captureFocusGeneration.current += 1;
                            captureOpener.current = opener;
                            setOpenCapture(index);
                          }}
                        />
                      ))}
                    </div>
                  </CardBody>
                </Card>
              ) : (
                <EvidencePointerGroup
                  label="Captures"
                  ids={detail.evidence.artifactIds}
                  note={sections?.captures.state === "absent" ? sections.captures.reason : sectionsAbsence}
                />
              )}
              <EvidencePointerGroup label="Checkpoints" ids={detail.evidence.checkpointNodeIds} />
              <EvidencePointerGroup label="Write intents" ids={detail.evidence.writeIntentIds} tone="warning" />
              <p className={cn(dsText.meta, "text-[color:var(--ds-fg-faint)]")}>
                The write ledger is never archived. What was filed in a real system stays where it was filed.
              </p>
            </>
          )}
        </TabPanel>
      </Tabs>

      {sections?.captures.state === "present" && (
        <CaptureViewerDialog
          tiles={sections.captures.value}
          index={openCapture}
          runId={detail.runId}
          subject={detail.detail.header.traceId}
          onReadCapture={onReadCapture}
          onIndex={setOpenCapture}
          onClose={closeCapture}
        />
      )}

      <PanelFooter>
        <span className={cn(dsText.meta, "max-w-[80ch] text-[color:var(--ds-fg-muted)]")}>
          Read-only. There is no retry, cancel or edit here — the code this run executed is not the code that is loaded.
        </span>
        <span>Archive relaunch is retired.</span>
        {/*
          D308's delete, beside the relaunch and never in front of it. It is
          `dangerGhost` rather than `danger` because the footer already spends
          its one solid on the affirmative door (`primitives-core.tsx`: at most
          one primary and one danger per surface) — the solid `danger` belongs
          to the confirm, which is the press that actually removes rows.

          It carries no availability arm. The relaunch's exists because a
          retired descriptor makes a relaunch impossible and the reason is not
          otherwise discoverable; a delete needs nothing but the record on
          screen, and the kernel's own admission (a non-terminal delegated
          member) is answered by the refusal pane above rather than guessed at
          here by a second, drifting copy of that rule.
        */}
        <Button
          variant="dangerGhost"
          size="sm"
          loading={busy}
          icon={<Trash2 aria-hidden className={dsIcon.md} />}
          onClick={onDelete}
        >
          Delete…
        </Button>
      </PanelFooter>
    </Panel>
  );
}

function EvidencePointerGroup({
  label,
  ids,
  tone,
  note,
}: {
  label: string;
  ids: readonly string[];
  tone?: "warning";
  /** Why these are bare ids rather than described tiles, when they are. */
  note?: string;
}) {
  if (ids.length === 0) return null;
  return (
    <Card>
      <CardBody className="flex flex-col gap-[var(--ds-space-snug)]">
        <div className="flex items-center gap-[var(--ds-space-snug)]">
          <SectionLabel>{label}</SectionLabel>
          <CountBadge value={ids.length} className="ml-auto" />
        </div>
        <div className="flex flex-wrap gap-[var(--ds-space-hair)]">
          {ids.map((id) => <Chip key={id} tone={tone} title={id}>{id}</Chip>)}
        </div>
        {note !== undefined && (
          <span className={cn(dsText.meta, "text-[color:var(--ds-fg-faint)]")}>{note}</span>
        )}
      </CardBody>
    </Card>
  );
}

/* ── D223's frozen sections ──────────────────────────────────────────────── */

/**
 * ONE frozen log line (AR163).
 *
 * The demo's three COLUMNS, not three inline runs. A badge per line is
 * decoration on a list whose whole job is scanning, and its width follows its
 * word — so every message started at a different x. The clock and level
 * columns are fixed, which puts every message on one left edge, and the level
 * is a WORD, so the tint is a second reading and never the only one.
 *
 * It is its own component because the Logs tab panel does not exist until the
 * tab is selected, so nothing rendered from the detail could pin the row.
 */
export function FrozenLogLine({ note }: { note: z.infer<typeof NoteWireSchema> }) {
  return (
    <div className="flex min-w-0 items-baseline gap-[var(--ds-space-snug)]">
      <span className={cn(dsText.meta, dsText.nums, "w-[76px] shrink-0 text-[color:var(--ds-fg-faint)]")}>
        {fmtClock(note.at)}
      </span>
      {/*
        NOT the demo's `w-[46px]`: its level vocabulary is `info`/`warn`/`error`
        and this wire's is `info`/`warning`/`error` (AR164), so the ported
        constant was a column sized for a word this tree never prints —
        `WARNING` in caps overran it and sat on top of its own message. The
        width holds the LONGEST served level, and the column does not truncate,
        because a clipped level is exactly the fact this column exists for.
      */}
      {/*
        `dsText.meta` dropped (unit F10d finding 4): both it and `dsText.caps`
        set font-size, and the two are unlayered CSS classes (tokens.ts) whose
        cascade order is NOT the order they are composed in here — so pairing
        them let source order, not intent, decide which size the column drew
        at. `caps` alone is the level column's own size.
      */}
      <span className={cn(dsText.caps, "w-[72px] shrink-0", FROZEN_LEVEL_CLASS[note.level])}>
        {note.level}
      </span>
      <span className={cn(dsText.body, "min-w-0 flex-1 break-words text-[color:var(--ds-fg)]")}>
        {note.message}
      </span>
    </div>
  );
}

/**
 * The frozen note stream's three levels, tinted (AR163/AR164).
 *
 * The wire's enum is `info | warning | error` and there is no `read`/`write`
 * level in this tree, so the demo's five-word vocabulary is two words short
 * here by the schema and not by omission. The tint is a second reading of a
 * word that is always printed — never the only one.
 */
const FROZEN_LEVEL_CLASS = {
  info: "text-[color:var(--ds-fg-muted)]",
  warning: "text-[color:var(--ds-status-waiting-fg)]",
  error: "text-[color:var(--ds-danger)]",
} as const satisfies Record<"info" | "warning" | "error", string>;

/** The counts the tab strip prints — absent is not zero, so it prints nothing. */
function frozenLogCount(sections: ArchivedRunSections | undefined): number | undefined {
  return sections?.logs.state === "present" ? sections.logs.value.notes.length : undefined;
}
function frozenDataCount(sections: ArchivedRunSections | undefined): number | undefined {
  return sections?.data.state === "present" ? sections.data.value.entries.length : undefined;
}

/**
 * One frozen section, or the sentence saying why there is none.
 *
 * The two absences are deliberately kept apart. A section the record HOLDS but
 * that is empty is a fact about the run; a record written before D223 froze
 * sections at all is a fact about this record, and only the second one is a
 * reason to go looking somewhere else. Neither is ever rendered as a blank
 * panel — an empty tab is the one thing that reads as "the surface is broken".
 */
function FrozenSection<Payload>({
  section,
  absence,
  what,
  children,
}: {
  section: { state: "present"; value: Payload } | { state: "absent"; reason: string } | undefined;
  absence: string | undefined;
  what: string;
  children: (value: Payload) => ReactNode;
}) {
  if (section === undefined) {
    return (
      <Refusal
        title={`This record's ${what} were never frozen`}
        code="archive-sections-absent"
        outcome="Nothing is missing from the run — the payloads were never captured, and they are not reconstructible."
      >
        <p className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>
          {absence ?? `the archived record carries no frozen ${what} and states no reason, which is itself a defect`}
        </p>
      </Refusal>
    );
  }
  if (section.state === "absent") {
    return (
      <Well>
        <span className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>{section.reason}</span>
      </Well>
    );
  }
  return <>{children(section.value)}</>;
}

function AttemptRow({ attempt }: { attempt: ArchivedRunAttempt }) {
  const outcomes = attempt.outcomes.map(({ outcome, count }) => `${String(count)} ${outcome}`);
  if (attempt.unfinished > 0) outcomes.push(`${String(attempt.unfinished)} unfinished`);
  return (
    <TR>
      <TD>
        <span className={cn(dsText.body, dsText.nums, "text-[color:var(--ds-fg)]")}>#{attempt.attempt}</span>
      </TD>
      <TD>
        <span className="flex min-w-0 flex-col">
          <span className={cn(dsText.body, "text-[color:var(--ds-fg)]")}>{plural(attempt.steps, "step")}</span>
          {outcomes.length > 0 && (
            <span className={cn(dsText.meta, "truncate text-[color:var(--ds-fg-muted)]")}>{outcomes.join(" · ")}</span>
          )}
        </span>
      </TD>
      <TD align="right">
        {/*
          Both instants are absence unions on the wire and each carries its own
          reason: an attempt that folded no span at all and an attempt whose
          `span.started` never reached the fold are different facts, and the
          title is where the second one is readable.
        */}
        <span
          className={cn(dsText.meta, dsText.nums, "text-[color:var(--ds-fg-muted)]")}
          title={attempt.startedAt.state === "absent" ? attempt.startedAt.reason : undefined}
        >
          {attempt.startedAt.state === "present" ? fmtClock(attempt.startedAt.value) : "—"}
          {attempt.endedAt.state === "present" && ` → ${fmtClock(attempt.endedAt.value)}`}
        </span>
      </TD>
    </TR>
  );
}

/**
 * ONE described capture. The thumbnail is a LABELLED placeholder holding the
 * capture's real aspect ratio — never a drawn approximation of the page. The
 * archived record carries no bytes; the viewer separately verifies exact
 * retained bytes only after an operator opens this frozen capture.
 */
/**
 * The frozen description always renders. An explicit resource read then
 * verifies whether the same capture's physical bytes remain. No retention
 * deadline can call that state purged: without a durable tombstone the states
 * are only available, missing, or verification error.
 *
 * Prev/next walk the run's own captures, because an operator comparing two
 * failures should not have to close and re-aim at a tile between them.
 */
export function CaptureViewerDialog({
  tiles,
  index,
  runId,
  subject,
  onReadCapture,
  onIndex,
  onClose,
}: {
  tiles: readonly ArchivedCaptureTile[];
  index: number | undefined;
  runId: string;
  subject: string;
  onReadCapture: (runId: string, artifactId: string, signal?: AbortSignal) => Promise<ArchivedCaptureResourceWire>;
  onIndex: (next: number) => void;
  onClose: () => void;
}) {
  const tile = index === undefined ? undefined : tiles[index];
  const [viewerEpoch, setViewerEpoch] = useState(0);
  const closingViewer = useRef(false);
  const resource = useArchivedCaptureResource(runId, tile, onReadCapture, viewerEpoch);
  const imageUrl = resource.state === "loaded"
    && resource.value.resource.state === "available"
    && (tile?.mediaType === "image/png" || tile?.mediaType === "image/jpeg")
    ? resource.value.resource.downloadUrl
    : undefined;
  useEffect(() => {
    if (tile !== undefined) closingViewer.current = false;
  }, [tile]);
  const closeViewer = () => {
    if (closingViewer.current) return;
    closingViewer.current = true;
    setViewerEpoch((current) => current + 1);
    onClose();
  };
  if (index !== undefined && tile === undefined) {
    throw new Error(
      `the capture viewer was opened at index ${String(index)} of ${String(tiles.length)} archived captures`,
    );
  }
  return (
    <Dialog open={tile !== undefined} onOpenChange={(open) => { if (!open) closeViewer(); }}>
      {tile !== undefined && index !== undefined && (
        <DialogContent
          size="lg"
          title={tile.step.state === "present" ? `${tile.kind} at ${tile.step.nodeId}` : `${tile.kind} — step unrecorded`}
          description={`Archived capture ${String(index + 1)} of ${String(tiles.length)} on ${subject}.`}
        >
          <DialogBody className="flex flex-col gap-[var(--ds-space-cozy)]">
            <Well>
              <p className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>
                {ARCHIVED_CAPTURE_VIEWER_NOTE}
              </p>
            </Well>

            {imageUrl !== undefined ? (
              <ArchivedCaptureImagePreview
                key={`${runId}:${tile.artifactId}:${String(viewerEpoch)}`}
                tile={tile}
                imageUrl={imageUrl}
              />
            ) : <ArchivedCaptureResourceNotice tile={tile} resource={resource} />}

            <Field label="What this capture was">
              <dl className="flex flex-col gap-[var(--ds-space-hair)]">
                {archivedCaptureFacts(tile).map((fact) => (
                  <div
                    key={fact.label}
                    className={cn(dsText.body, "flex min-w-0 items-baseline gap-[var(--ds-space-snug)]")}
                  >
                    <dt className="w-[160px] shrink-0 text-[color:var(--ds-fg-muted)]">{fact.label}</dt>
                    {fact.state === "present" ? (
                      <dd className={cn(dsText.nums, "min-w-0 flex-1 break-words text-[color:var(--ds-fg)]")}>
                        {fact.value}
                      </dd>
                    ) : (
                      /*
                        An absent fact keeps its own reason. A dash here would
                        make "the bundle's origin named no step" look like "this
                        capture has no step", and only the second is about the
                        capture.
                      */
                      <dd className="min-w-0 flex-1 break-words text-[color:var(--ds-fg-faint)]">{fact.reason}</dd>
                    )}
                  </div>
                ))}
              </dl>
            </Field>

            {/*
              The DECLARED retention, and it says so. The record cannot observe
              whether the bytes survived, so this never claims they did or did
              not — it states what the bundle was declared to be kept for.
            */}
            <Field label="Declared retention">
              <span className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>
                {tile.retention.kind === "pinned"
                  ? `Pinned for ${tile.retention.reason} — this bundle is exempt from the ordinary purge.`
                  : `Ordinary — declared for purge after ${fmtInstantDay(tile.retention.purgeAfter)}. `
                    + "Whether the bytes are still there is not something this record can see."}
              </span>
            </Field>
          </DialogBody>
          <DialogFooter
            meta={`Captured ${fmtClock(tile.capturedAt)} · bundle ${shortHash(tile.bundleId)}`}
          >
            {/*
              `aria-disabled`, never `disabled`, at either end of the walk
              (ui-review finding F10b/1). A genuinely `disabled` button is
              pulled out of the tab order the instant it disables — which is
              exactly what used to happen to the control the operator had just
              PRESSED to reach an end, dropping keyboard focus to the dialog
              body mid-walk. Both buttons stay focusable and keyboard-operable
              at every index; the press itself is the no-op, and the muted
              look is drawn by hand since `disabled:` styling is a native
              pseudo-class this button no longer carries.
            */}
            <Button
              size="sm"
              variant="secondary"
              aria-disabled={index === 0}
              className={cn(index === 0 && "pointer-events-none opacity-45")}
              onClick={() => {
                if (index === 0) return;
                onIndex(index - 1);
              }}
            >
              Previous capture
            </Button>
            <Button
              size="sm"
              variant="secondary"
              aria-disabled={index === tiles.length - 1}
              className={cn(
                index === tiles.length - 1 && "pointer-events-none opacity-45",
              )}
              onClick={() => {
                if (index === tiles.length - 1) return;
                onIndex(index + 1);
              }}
            >
              Next capture
            </Button>
            {resource.state === "loaded" && resource.value.resource.state === "available" && (
              <ButtonLink
                size="sm"
                variant="primary"
                icon={<Download aria-hidden className={dsIcon.md} />}
                href={resource.value.resource.downloadUrl}
                download={`archive-${tile.artifactId}`}
              >
                Download
              </ButtonLink>
            )}
            <Button size="sm" variant="ghost" onClick={closeViewer}>Close</Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

/** The fixed slot includes captions/refusals, so neither can displace the frozen metadata. */
function ArchivedCapturePreviewFrame({ tile, busy, children }: {
  tile: ArchivedCaptureTile;
  busy: boolean;
  children: ReactNode;
}) {
  return (
    <figure
      aria-label="Archived capture preview"
      aria-busy={busy}
      className={cn("relative flex max-h-[56dvh] w-full shrink-0 flex-col overflow-hidden border border-[color:var(--ds-border)] bg-[color:var(--ds-surface-2)]", dsRadius.md)}
      style={tile.dimensions === undefined
        ? { height: "min(20rem, 56dvh)" }
        : { aspectRatio: `${String(tile.dimensions.width)} / ${String(tile.dimensions.height)}` }}
    >
      {children}
    </figure>
  );
}

function ArchivedCaptureResourceNotice({ tile, resource }: { tile: ArchivedCaptureTile; resource: ArchivedCaptureResourceLoad }) {
  const notice = (
    <>
      {resource.state === "loading" && <Skeleton className="h-full min-h-32 w-full" />}
      {resource.state === "failed" && (
        <Banner tone="danger" title="Capture resource could not be read">{resource.message}</Banner>
      )}
      {resource.state === "loaded" && resource.value.resource.state === "missing" && (
        <Banner tone="warning" title="Capture bytes are missing">{resource.value.resource.reason}</Banner>
      )}
      {resource.state === "loaded" && resource.value.resource.state === "error" && (
        <Banner tone="danger" title="Capture bytes could not be verified">{resource.value.resource.message}</Banner>
      )}
      {resource.state === "loaded" && resource.value.resource.state === "available" && (
        <Well>
          <p className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>
            Verified retained bytes are ready to download. This media type has no inline preview.
          </p>
        </Well>
      )}
    </>
  );
  return tile.mediaType === "image/png" || tile.mediaType === "image/jpeg" ? (
    <ArchivedCapturePreviewFrame tile={tile} busy={resource.state === "loading"}>
      <div className="absolute inset-0 overflow-auto">{notice}</div>
    </ArchivedCapturePreviewFrame>
  ) : notice;
}

/** Unmounting this preview ends its readiness, including a later return to the same URL. */
function ArchivedCaptureImagePreview({ tile, imageUrl }: { tile: ArchivedCaptureTile; imageUrl: string }) {
  const image = useArchivedCaptureImage();
  return (
    <ArchivedCapturePreviewFrame tile={tile} busy={image.state === "loading"}>
      <div className="relative min-h-0 flex-1">
        {image.state === "loading" && <Skeleton className="absolute inset-0 h-full w-full" />}
        <img
          ref={image.bindImage}
          src={imageUrl}
          loading="eager"
          width={tile.dimensions?.width}
          height={tile.dimensions?.height}
          alt={image.state === "ready" ? `Archived ${tile.kind} captured ${fmtClock(tile.capturedAt)}` : ""}
          aria-hidden={image.state === "ready" ? undefined : true}
          className={cn("absolute inset-0 h-full w-full object-contain", image.state !== "ready" && "opacity-0")}
          onError={(event) => { image.failImage(event.currentTarget); }}
          onLoad={(event) => { image.decodeImage(event.currentTarget); }}
        />
        {image.state === "failed" && (
          <div className="absolute inset-0 overflow-auto">
            <Banner tone="danger" title="Capture image could not be displayed">
              The retained image bytes were verified, but the browser could not load or decode this image.
            </Banner>
          </div>
        )}
      </div>
      <figcaption className={cn(dsText.meta, "min-h-[calc(1lh+var(--ds-space-tight)*2)] shrink-0 whitespace-normal break-words bg-[color:var(--ds-surface-2)] px-[var(--ds-space-snug)] py-[var(--ds-space-tight)] text-[color:var(--ds-fg-muted)]")}>
        {image.state === "ready" && "Verified retained bytes for this frozen archived capture."}
      </figcaption>
    </ArchivedCapturePreviewFrame>
  );
}

function CaptureTileRow({ tile, onOpen }: { tile: ArchivedCaptureTile; onOpen: (opener: HTMLButtonElement) => void }) {
  return (
    <div className="flex min-w-0 items-start gap-[var(--ds-space-snug)]">
      <span
        className={cn(
          "flex w-[96px] shrink-0 items-center justify-center border",
          dsRadius.sm,
          "border-[color:var(--ds-border)] bg-[color:var(--ds-recess-bg)]",
        )}
        style={{
          aspectRatio: tile.dimensions === undefined
            ? "4 / 3"
            : `${String(tile.dimensions.width)} / ${String(tile.dimensions.height)}`,
        }}
        aria-hidden
      >
        <Camera className={dsIcon.md} />
      </span>
      <span className="flex min-w-0 flex-col gap-[var(--ds-space-hair)]">
        {/*
          `tight`, not `hair`: the origin badge and the step id are two
          different facts and a 2px gutter read as one word in the screenshot.
        */}
        <span className="flex flex-wrap items-center gap-[var(--ds-space-tight)]">
          {/*
            AR184 — the badge's WORD and its TONE come from one fact. It used
            to print `kind` in a tone keyed off `origin`, so an ordinary
            screenshot of a failed step wore danger red and nobody could tell
            which of the two the red was about.
          */}
          <Badge tone={ARCHIVED_CAPTURE_ORIGIN_TONE[tile.origin]}>{tile.origin}</Badge>
          <span className={cn(dsText.body, "truncate text-[color:var(--ds-fg)]")}>
            {tile.step.state === "present" ? tile.step.nodeId : "step unrecorded"}
          </span>
          {tile.system.state === "present" && <Chip label="system">{tile.system.value}</Chip>}
        </span>
        <MetaLine
          items={[
            fmtClock(tile.capturedAt),
            // `kind` is a physical property of the artifact and sits with the
            // others; the badge above carries why it was taken (AR184).
            tile.kind,
            `${String(Math.max(1, Math.round(tile.byteLength / 1024)))} KB`,
            tile.sensitivity,
            tile.retention.kind === "pinned"
              ? `pinned (${tile.retention.reason})`
              : `purge after ${fmtInstantDay(tile.retention.purgeAfter)}`,
          ]}
        />
        {/*
          The two things a pointer alone could never say, kept as reasons rather
          than dropped: a capture whose step is unrecorded and one whose system
          is unrecorded are different gaps, and both are actionable.
        */}
        {(tile.step.state === "absent" || tile.system.state === "absent") && (
          <span className={cn(dsText.meta, "text-[color:var(--ds-fg-faint)]")}>
            {tile.step.state === "absent" ? tile.step.reason : tile.system.state === "absent" ? tile.system.reason : ""}
          </span>
        )}
        <span className={cn(dsText.meta, dsText.nums, "truncate text-[color:var(--ds-fg-faint)]")} title={tile.artifactId}>
          {tile.artifactId}
        </span>
      </span>
      {/*
        The tile stops being inert (D274 item 10). The label is `What it was`
        on every capture because the archive holds frozen pointer facts. The
        viewer can separately verify and display this exact capture's retained bytes.
      */}
      <Button
        size="sm"
        variant="outline"
        className="shrink-0"
        icon={<Camera aria-hidden className={dsIcon.md} />}
        onClick={(event) => { onOpen(event.currentTarget); }}
      >
        What it was
      </Button>
    </div>
  );
}

/* ── the bump's change record — charter §25, authored where the author is ── */

/**
 * WHAT moved and WHY, or the reason this bump has neither.
 *
 * Both halves render: the words are the whole point, and a bump applied before
 * the record was collected states that rather than showing an empty block — a
 * blank would read as "nobody had a reason", which is a different and worse
 * claim than "nobody was asked".
 */
function ChangeRecordBody({ record }: { record: ArchiveSweepWire["changeRecord"] }) {
  if (record.state === "absent") {
    return <p className={cn(dsText.meta, "text-[color:var(--ds-fg-faint)]")}>{record.reason}</p>;
  }
  return (
    <div className="flex min-w-0 flex-col gap-[var(--ds-space-hair)]">
      <div className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-hair)]">
        <Badge tone={record.value.kind === "major" ? "warning" : "neutral"}>{record.value.kind}</Badge>
        <span className={cn(dsText.body, "min-w-0 break-words text-[color:var(--ds-fg)]")}>{record.value.what}</span>
      </div>
      <p className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>{record.value.why}</p>
      <span className={cn(dsText.meta, dsText.nums, "text-[color:var(--ds-fg-faint)]")}>
        {record.value.commit.state === "present" ? `commit ${record.value.commit.value}` : record.value.commit.reason}
      </span>
    </div>
  );
}

/** What the operator clicked Bump on, carried into the authoring dialog. */
interface BumpAuthoring {
  /** The thing being bumped, in the operator's words, for the dialog title. */
  readonly title: string;
  readonly scope: { readonly scope: VersionScope };
  readonly changeFingerprint: string;
}

/**
 * The change record ref dashboard-surfaces §10.2 has always asked for, collected at the one
 * moment somebody can answer it.
 *
 * `what` and `why` are required because a record with neither is the state
 * this dialog exists to end — every sweep could say who applied it and when,
 * and nothing about why. `commit` is not required and does not default to a
 * blank: an application bump often has no single commit, and a fabricated hash
 * on the record that exists to be trustworthy is worse than an honest "none".
 * Leaving it empty records the reason instead.
 */
function BumpChangeRecordDialog({
  authoring,
  states,
  busy,
  onCancel,
  onConfirm,
}: {
  authoring: BumpAuthoring | undefined;
  /** the version rows THIS bump's scope covers — the facts both arms read */
  states: readonly WorkflowVersionStateWire[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (authoring: BumpAuthoring, changeRecord: VersionBumpChangeRecord) => void;
}) {
  /*
    MAJOR is the default, as the demo's is. It is the consequential arm, and a
    flow that opens on the harmless one invites the operator to accept it.
  */
  const [kind, setKind] = useState<VersionBumpChangeRecord["kind"]>("major");
  const [what, setWhat] = useState("");
  const [why, setWhy] = useState("");
  const [commit, setCommit] = useState("");
  /* the refusal a press produced, cleared by any edit that could change it */
  const [refused, setRefused] = useState<BumpRecordComposition | undefined>(undefined);
  /*
    A refusal the operator cannot SEE is the dead button VB41 argues against,
    wearing a different coat: the dialog body scrolls, and the primary sits
    below the fold from the refusal it produces. So the answer is brought to
    the press rather than left where it happened to render.
  */
  const refusalRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (refused === undefined) return;
    // `prefers-reduced-motion` is a request about MOTION, not about whether the
    // refusal reaches view — the scroll still has to happen, only without the
    // animated glide (ui-review finding F10b/3; the same gate `log-panel.tsx`'s
    // `seek` already uses).
    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    refusalRef.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [refused]);

  useEffect(() => {
    if (authoring === undefined) return;
    setKind("major");
    setWhat("");
    setWhy("");
    setCommit("");
    setRefused(undefined);
  }, [authoring]);

  const scope = bumpScopeLabel(authoring?.scope.scope ?? { kind: "workflows", workflowIds: [] });
  const effect = resolveBumpKindEffect(kind, states);
  const inFlight = effect.kind === "major" ? effect.blockers : effect.unaffected;
  const parkedWrites = parkedWriteBlockers(inFlight);

  return (
    <Dialog open={authoring !== undefined} onOpenChange={(open) => { if (!open) onCancel(); }}>
      {authoring !== undefined && (
        <DialogContent size="xl" title={`Bump ${authoring.title}`} description={`${scope.label} · ${scope.note}`}>
          <DialogBody className="flex flex-col gap-[var(--ds-space-base)]">
            {/*
              THE KIND IS THE WHOLE DESIGN (D274 item 2). It is a radio group
              rather than a select because each option's consequence is a
              paragraph, and the paragraph is the choice — a one-line <option>
              would make the operator pick between two words for the same act.
            */}
            <RadioGroup
              label="What kind of change is this?"
              name="version-bump-kind"
              value={kind}
              onValueChange={(next) => {
                setKind(next);
                // the standing refusal was about the OTHER shape of this request
                setRefused(undefined);
              }}
              options={[
                { value: "major", label: BUMP_KIND_LABEL.major, description: BUMP_KIND_NOTE.major },
                { value: "minor", label: BUMP_KIND_LABEL.minor, description: BUMP_KIND_NOTE.minor },
              ]}
            />

            {/* what this bump moves, named — the registry has the versions, the dialog had nothing */}
            {states.length > 0 && (
              <ChipRow>
                {states.map((state) => (
                  <Chip key={state.workflowId} label={state.workflowCode}>
                    {state.workflowLabel} v{state.current.descriptorVersion} → next
                  </Chip>
                ))}
              </ChipRow>
            )}

            {effect.kind === "minor" ? (
              <Banner
                tone="success"
                title="Nothing can block a minor bump, because nothing is archived"
                icon={<BadgeCheck aria-hidden className={dsIcon.lg} />}
              >
                <span className={dsText.body}>
                  {/*
                    The one sentence this arm must get right. A minor plan
                    carries no candidates and no blockers BY DEFINITION — the
                    schema refuses one that does — so this states the rule, and
                    the number beside it is labelled as what a MAJOR bump would
                    have faced rather than as a blocker count of zero.
                  */}
                  A minor bump records the new version and moves no run, so there is nothing a run could be doing that
                  would stop it.{" "}
                  {inFlight.length > 0
                    ? `${plural(inFlight.length, "run")} in flight ${inFlight.length === 1 ? "is" : "are"} unaffected and `
                      + "would have blocked a MAJOR bump on this scope."
                    : "No prior-version run is in flight either, though that would not have mattered here."}
                </span>
              </Banner>
            ) : inFlight.length > 0 ? (
              <Banner
                tone={parkedWrites > 0 ? "danger" : "warning"}
                title={`${plural(inFlight.length, "run")} must be resolved before this bump`}
                icon={<TriangleAlert aria-hidden className={dsIcon.lg} />}
              >
                <span className={dsText.body}>
                  {parkedWrites > 0
                    ? `${String(parkedWrites)} of them ${parkedWrites === 1 ? "is" : "are"} a parked write — a write `
                      + "whose outcome is unknown may never be buried in an archive. Resolve it present or absent first."
                    : "A major bump takes every prior-version run out of the live surfaces, and it will not take one "
                      + "that is still in flight."}
                </span>
              </Banner>
            ) : null}

            {inFlight.length > 0 && (
              <div className="flex flex-col gap-[var(--ds-space-snug)]">
                <SectionLabel>
                  {effect.kind === "major"
                    ? "Must be terminalized or resolved first"
                    : `Still in flight — unaffected (${String(inFlight.length)})`}
                </SectionLabel>
                <BlockerTable blockers={inFlight} kind={kind} />
              </div>
            )}

            <div className="flex flex-col gap-[var(--ds-space-snug)]">
              <SectionLabel>
                {effect.kind === "minor"
                  ? "Would be archived — nothing"
                  : effect.archivable === 0
                    ? "Would be archived — nothing"
                    : `Would be archived — ${plural(effect.archivable, "run")}`}
              </SectionLabel>
              <Well>
                <span className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>
                  {effect.kind === "minor"
                    ? "A minor bump archives no run at all. The archive is the consequence of a SHAPE change, and "
                      + "this is not one."
                    : effect.archivable === 0
                      ? "No terminal prior-version run is listed for this scope, so this bump would move the version "
                        + "and archive nothing."
                      : `${plural(effect.archivable, "terminal prior-version run")} would leave the live surfaces in `
                        + "one act. The registry serves the COUNT; the reviewed plan names every one of them by "
                        + "trace before anything is applied — nothing is archived from this dialog."}
                </span>
              </Well>
            </div>

            {/*
              The change record, two-up: `what` and `why` are the pair, and the
              labels and examples move with the KIND, because "why the shape had
              to move" and "why this is presentation only" are different
              questions and one placeholder cannot prompt both.
            */}
            <div className="grid grid-cols-1 gap-[var(--ds-space-base)] min-[720px]:grid-cols-2">
              <Field
                label="What changed"
                required
                description="Recorded beside the version, in the same store as fix records."
                /*
                  THE COUNTER AND THE CAP STAY (ledger 3 rows VB34/VB36, named
                  exceptions under D276 item 3). The demo's fields are uncapped
                  and uncounted because its submit is a mock; these two limits
                  are `VersionBumpChangeRecordSchema`'s own
                  (`change-record.ts:32,34` — `.max(200)` and `.max(1000)`), so
                  the durable store WILL refuse a longer record. Letting an
                  operator type past a limit and meet it as a refusal after the
                  press is exactly what this dialog's own "there is no force
                  arm" argument is against. `rows={3}` on the Why box is the
                  same call: a 1000-character reason in a two-row peephole is a
                  field an operator cannot re-read before sending.
                */
                hint={`${String(what.trim().length)}/200`}
              >
                <Input
                  value={what}
                  maxLength={200}
                  placeholder={kind === "major"
                    ? "the separation flow gained a Kuali read-back step"
                    : "the CRM cross-check tolerates a middle initial"}
                  onChange={(event) => {
                    setWhat(event.target.value);
                    setRefused(undefined);
                  }}
                />
              </Field>
              <Field
                label={kind === "major" ? "Why the shape had to move" : "Why this is behaviour, not shape"}
                required
                description="The record says which kind it was, and the archive's sweep header shows it."
                hint={`${String(why.trim().length)}/1000`}
              >
                <Textarea
                  rows={3}
                  value={why}
                  maxLength={1000}
                  placeholder={kind === "major"
                    ? "the old descriptor cannot express the read-back, so its runs cannot be rendered by the new one"
                    : "three subjects a week were parking on a name mismatch that was not one"}
                  onChange={(event) => {
                    setWhy(event.target.value);
                    setRefused(undefined);
                  }}
                />
              </Field>
            </div>
            <Field
              label="Commit"
              description="Optional. Left empty, the record says no commit was named rather than showing a blank."
            >
              <Input
                value={commit}
                maxLength={120}
                placeholder="9f2c41d"
                onChange={(event) => setCommit(event.target.value)}
              />
            </Field>

            {refused?.state === "incomplete" && (
              <div ref={refusalRef}>
                <Refusal
                  title="The change record is not complete"
                  code={refused.code}
                  outcome="No plan was minted. Nothing has been archived and no version has moved."
                >
                  <p className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>{refused.sentence}</p>
                </Refusal>
              </div>
            )}
          </DialogBody>
          <DialogFooter meta="There is no force arm. The refusal is the feature.">
            <Button variant="secondary" onClick={onCancel}>Cancel</Button>
            {/*
              NEVER DISABLED (ledger 3 VB41, D276 item 3). A greyed-out primary
              hides the one rule this flow exists to enforce, and an incomplete
              change record is a real refusal with a real code. What this does
              NOT do is dress a local check as a server round trip: the schema
              that refuses an empty `what` is the same schema on both sides, so
              the refusal is composed here and names the fields, which a round
              trip could not do better.
            */}
            <Button
              variant={effect.kind === "major" && effect.blockers.length > 0 ? "danger" : "primary"}
              icon={effect.kind === "major" && effect.blockers.length > 0
                ? <ShieldAlert aria-hidden className={dsIcon.md} />
                : undefined}
              loading={busy}
              onClick={() => {
                const composed = composeBumpChangeRecord({ kind, what, why, commit });
                if (composed.state === "incomplete") {
                  setRefused(composed);
                  return;
                }
                setRefused(undefined);
                onConfirm(authoring, composed.record);
              }}
            >
              Plan the bump…
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

/* ── the footer's refusals, and D308's delete ────────────────────────────── */

/**
 * The answer to a footer command that did NOT land.
 *
 * The verdict comes from D253's one fold, never re-derived from `result.state`
 * here, and the sentence is the kernel's own: `schema-mismatch` already names
 * both digests, and a paraphrase would be a second account of a refusal that
 * has exactly one author.
 */
function ArchivedCommandRefusal({ result, onDismiss }: { result: CommandResult; onDismiss: () => void }) {
  const settlement = settleCommandResult(result);
  if (settlement.kind === "applied") return null;
  return (
    <Refusal
      title="That command was refused"
      code={settlement.reason === "conflict" ? "version-conflict" : settlement.reason === "rejected" ? settlement.code : "confirmation-required"}
      outcome="Nothing was changed. This archived record is exactly as it was."
      meta={settlement.reason === "conflict" ? [`now at version ${String(settlement.currentVersion)}`] : []}
      action={<Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>}
    >
      <p className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>{settlement.message}</p>
    </Refusal>
  );
}

/**
 * D308's confirm. Its copy is `archivedDeleteConfirm`'s, so the three sentences
 * an operator cannot recover after this press have ONE author (ref
 * dashboard-surfaces §9.5.1).
 *
 * The evidence counts are the archived record's own pointers, not a fresh read:
 * they are what "every row it owns" means for THIS run, and the write-intent
 * count is the one that makes the idempotency sentence concrete rather than
 * theoretical.
 */
function DeleteConfirmDialog({
  detail,
  onCancel,
  onConfirm,
}: {
  detail: ArchivedRunDetailWire | undefined;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = detail === undefined ? undefined : archivedDeleteConfirm(detail);
  return (
    <Dialog open={detail !== undefined} onOpenChange={(open) => { if (!open) onCancel(); }}>
      {detail !== undefined && copy !== undefined && (
        <DialogContent size="lg" title={copy.title} description={copy.description}>
          <DialogBody className="flex flex-col gap-[var(--ds-space-cozy)]">
            {(detail.evidence.writeIntentIds.length > 0 || detail.ledger.length > 0) && (
              <Banner
                tone="danger"
                title={`This run filed ${plural(Math.max(detail.evidence.writeIntentIds.length, detail.ledger.length), "record")} in a real system`}
                icon={<TriangleAlert aria-hidden className={dsIcon.lg} />}
              >
                <span className={dsText.body}>
                  Those keys are what a later run checks before it submits. Once they are gone, nothing in this
                  system knows the write already happened.
                </span>
              </Banner>
            )}

            <Field label="What leaves authority">
              <Well>
                <div className="flex min-w-0 flex-col gap-[var(--ds-space-snug)]">
                  <div className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-snug)]">
                    <Trash2 aria-hidden className={cn(dsIcon.md, "shrink-0 text-[color:var(--ds-danger)]")} />
                    <span className={cn(dsText.ui, "min-w-0 truncate text-[color:var(--ds-fg)]")}>
                      {detail.detail.header.title}
                    </span>
                    <Badge tone="neutral" className="ml-auto">{detail.workflowLabel}</Badge>
                  </div>
                  <MetaLine
                    items={[
                      `trace ${detail.detail.header.traceId}`,
                      plural(detail.evidence.writeIntentIds.length, "write intent"),
                      plural(detail.ledger.length, "ledger line"),
                      plural(detail.evidence.artifactIds.length, "artifact"),
                      plural(detail.evidence.checkpointNodeIds.length, "checkpoint"),
                    ]}
                  />
                </div>
              </Well>
            </Field>

            <div className="min-w-0">
              <SectionLabel className="mb-[var(--ds-space-snug)]">Before you press it</SectionLabel>
              <BulletList items={[...copy.consequences]} />
            </div>
          </DialogBody>

          <DialogFooter meta={`Cites integrity ${shortHash(detail.archiveFingerprint)} — the exact record on this screen.`}>
            <Button variant="secondary" onClick={onCancel}>Cancel</Button>
            <Button variant="danger" icon={<Trash2 aria-hidden className={dsIcon.md} />} onClick={onConfirm}>
              {copy.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

/* ── the version-bump flow ───────────────────────────────────────────────── */

/**
 * What the applied bump MOVED, captured at DISPATCH (VB43).
 *
 * The plan leaves `plans` the moment it applies and the index is re-read, so
 * reading the count back afterwards would report a plan that no longer exists.
 * The KIND is captured for the same reason and decides one thing: whether
 * there is an archive to open at all.
 */
interface AppliedBumpFacts {
  readonly archived: number;
  /** `undefined` is a generation-1 plan, which recorded no kind */
  readonly kind: VersionBumpChangeRecord["kind"] | undefined;
}

/**
 * The same record, plus WHICH plan it is about.
 *
 * The banner draws the facts; the surface needs the identity, because the
 * index it re-reads after an apply is served STALE while that read is in
 * flight (unit F10e) — so for as long as the banner takes to be earned, the
 * wire on screen still lists the plan that earned it.
 */
interface AppliedBump extends AppliedBumpFacts {
  readonly versionPlanId: string;
}

/**
 * The bump APPLIED (VB43/VB44, AR241).
 *
 * Apply used to settle in silence: the index re-read, the plan vanished, and
 * nothing on screen said the act had happened or where its runs had gone. The
 * demo's banner says both, and its `Open the archive` is the door — offered
 * only where there is something behind it, because a minor bump archives
 * nothing (D274 item 2) and a door onto no new rows is worse than no door.
 */
export function BumpAppliedBanner({
  replayed,
  applied,
  onOpenArchive,
}: {
  /**
   * The settlement's own verdict (`settleCommandResult(result).replayed`),
   * never re-derived from `result.state` here — D253's rule that the fold is
   * the ONE place a wire's arms are read for a verdict (unit F10d finding 3).
   */
  replayed: boolean;
  /** the dispatch record's FACTS — which plan they belong to is the surface's business */
  applied: AppliedBumpFacts;
  onOpenArchive: () => void;
}) {
  const archives = applied.kind !== "minor";
  return (
    <Banner
      tone="success"
      icon={<BadgeCheck aria-hidden className={dsIcon.lg} />}
      title={replayed ? "That bump had already been applied" : "The bump was applied"}
      action={archives
        ? (
          <Button
            size="sm"
            variant="secondary"
            icon={<ArchiveIcon aria-hidden className={dsIcon.md} />}
            onClick={onOpenArchive}
          >
            Open the archive
          </Button>
        )
        : undefined}
    >
      <span className={dsText.body}>
        {archives
          ? `${plural(applied.archived, "run")} left the live surfaces for the read-only archive, grouped under the sweep this bump minted. The registry below is re-read; nothing else moved.`
          : "A minor bump records the new version and archives nothing, so every run is exactly where it was. The registry below is re-read."}
      </span>
    </Banner>
  );
}

function BumpRefusal({ result, plan }: { result: CommandResult; plan: VersionBumpPlanWire | undefined }) {
  /*
    THE ENTER TRANSITION STAYS (ledger 3 row VB50, a named exception under D275
    item 2 — "keep the shared takeover wrapper as an accessibility/motion
    convention"). The demo has no counterpart because its submit is a mock and
    its refusal is fixture-authored; this one arrives from a real dispatch, and
    D275 item 2's convention is the reason every arriving surface in this bundle
    enters the same way. It is the shared `useDsEnterTransition`, not a local
    animation, and it honours reduced motion through `ds-motion-enter`.

    The hook must run before any early return; a refusal that appeared with no
    transition after a click would read as a page change rather than as the
    answer to that click.
  */
  const enter = useDsEnterTransition();
  if (result.state !== "conflict" && result.state !== "rejected") return null;
  const code = result.state === "conflict" ? "version-conflict" : result.code;

  return (
    // The transition rides a wrapper because `Refusal` takes a closed prop set
    // — passing `data-demo-enter` to it would type-check (TS skips excess
    // checking on hyphenated JSX attributes) and then be silently dropped.
    <div
      {...enter}
      className={cn(
        "data-[demo-enter=from]:translate-y-[calc(-1*var(--ds-travel-sm))]",
        "data-[demo-enter=from]:opacity-0 ds-motion-enter",
      )}
    >
      <Refusal
        title="The bump was refused"
        code={code}
        outcome="Nothing was archived. Every prior-version run is still exactly where it was."
        meta={plan === undefined ? [] : [`plan ${shortHash(plan.versionPlanId)}`]}
      >
        {/*
          The server's sentence, verbatim. It is the only text that names every
          blocking run, and paraphrasing it here would be a second, divergent
          account of a refusal that has exactly one author.
        */}
        <p className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>{result.message}</p>
      </Refusal>
    </div>
  );
}

/**
 * The non-terminal prior-version runs, with the resolution head PARAMETERISED
 * by kind (ledger 3 VB22). Under a major bump these rows are the thing to act
 * on; under a minor one the same rows are context, and a head reading "What
 * has to happen" over runs that block nothing would be an instruction nobody
 * owes.
 */
function BlockerTable({
  blockers,
  kind,
}: {
  blockers: readonly WorkflowVersionStateWire["blockers"][number][];
  /** `undefined` is a generation-1 plan, which recorded no kind at all */
  kind: VersionBumpChangeRecord["kind"] | undefined;
}) {
  return (
    <div className="overflow-x-auto">
      <Table
        label={kind === "minor"
          ? "Prior-version runs still in flight, unaffected by this minor bump"
          : "Prior-version runs that are not terminal"}
      >
        <THead>
          <TR>
            <TH>Run</TH>
            {/*
              The demo's word, and the product's own (D276 item 3, ledger 3 row
              VB17 — `DemoVersionBump.tsx:313-316`). The cell holds a
              `StatusPill`, and every other table in this bundle that holds one
              heads the column `Status` (`day-search.tsx:116`); `State` was a
              local fork of a word the product had already settled. The demo's
              `Why` column stays absent: `WorkflowVersionStateWire.blockers[]`
              serves no `why` (VB20), and a head over nothing is worse than one.
            */}
            <TH>Status</TH>
            <TH>{bumpResolutionColumnHead(kind)}</TH>
          </TR>
        </THead>
        <TBody>
          {blockers.map((blocker) => (
            <TR key={blocker.runId}>
              <TD className="min-w-0">
                <span className="flex min-w-0 flex-col">
                  <span className={cn(dsText.ui, "truncate text-[color:var(--ds-fg)]")} title={blocker.title}>
                    {blocker.title}
                  </span>
                  <span className={cn(dsText.meta, dsText.nums, "truncate text-[color:var(--ds-fg-muted)]")}>
                    {blocker.traceId} · enqueued {fmtInstantDay(blocker.enqueuedAt)}
                  </span>
                </span>
              </TD>
              <TD><StatusPill status={blockerStatusOf(blocker.runState)} size="sm" /></TD>
              <TD>{blockerResolution(blocker.runState)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

/**
 * WHAT THE APPLY WOULD TAKE, by name (D274 item 10, ledger 3 VB25).
 *
 * The reviewed plan carries its candidates, so the operator no longer applies
 * a sweep on the strength of a count. A minor plan carries none BY DEFINITION
 * (`resolveBumpEffect`, D274) — that arm says so in words rather than drawing
 * an empty list, which would read as "we looked and found none".
 */
function ArchivableRunList({ plan }: { plan: VersionBumpPlanWire }) {
  const kind = plan.changeRecord.state === "present" ? plan.changeRecord.value.kind : undefined;
  return (
    <div className="flex flex-col gap-[var(--ds-space-snug)]">
      <SectionLabel>
        {plan.candidates.length === 0
          ? "Would be archived — nothing"
          : `Would be archived — ${plural(plan.candidates.length, "run")}`}
      </SectionLabel>
      {plan.candidates.length === 0 ? (
        <Well>
          <span className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>
            {kind === "minor"
              ? "A minor bump archives no run at all — not because none was found, but because the archive is the "
                + "consequence of a SHAPE change and this is not one."
              : kind === "major"
                ? "No terminal prior-version run was in scope when this plan was minted, so applying it moves the "
                  + "version and archives nothing."
                : "This plan predates the change record, so which kind of bump it is was never recorded — and with it, "
                  + "why it names no run."}
          </span>
        </Well>
      ) : (
        <Well className="max-h-[190px] overflow-y-auto">
          <ul className="flex flex-col gap-[var(--ds-space-hair)]">
            {plan.candidates.map((candidate) => (
              <li
                key={candidate.runId}
                className={cn(dsText.body, "flex min-w-0 items-baseline gap-[var(--ds-space-snug)]")}
              >
                <span className="min-w-0 flex-1 truncate text-[color:var(--ds-fg)]" title={candidate.title}>
                  {candidate.title}
                </span>
                <span className={cn(dsText.micro, dsText.nums, "shrink-0 text-[color:var(--ds-fg-muted)]")}>
                  {candidate.traceId} · {candidate.workflowId}
                </span>
              </li>
            ))}
          </ul>
        </Well>
      )}
    </div>
  );
}

/**
 * VERSIONS & BUMPS — the registry, and the two-step flow that fills the
 * archive. It is the demo's second view, moved out of Settings for the same
 * reason: a page called Settings should not be where you archive production
 * runs.
 */
function VersionsView({
  wire,
  actorId,
  busy,
  onCommand,
  onOpenArchive,
  result,
}: {
  wire: ArchiveIndexWire;
  actorId: string;
  busy: boolean;
  onCommand: (request: unknown) => void;
  /** the applied banner's door back to the runs view (VB44/AR241) */
  onOpenArchive: () => void;
  result: CommandResult | undefined;
}) {
  const blockedWorkflows = wire.versionState.filter((state) => state.blockers.length > 0).length;
  // Settled ONCE (unit F10d finding 3): the applied/refused fork below and
  // the applied banner's replay verdict both read this fold's answer, never
  // `result.state` directly — that is D253's rule that the fold, not a
  // second reader of the wire, decides what a command's landing means.
  const settlement = result === undefined ? undefined : settleCommandResult(result);
  /** the frozen short codes an applied sweep's name joins against (AR80) */
  const codes = useMemo(() => archiveWorkflowCodes(wire), [wire]);
  const archivedByWorkflow = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of wire.entries) counts.set(entry.workflowId, (counts.get(entry.workflowId) ?? 0) + 1);
    return counts;
  }, [wire.entries]);

  /**
   * The bump is authored, not clicked. Charter §25 records WHAT moved and WHY
   * in the same act that archives the runs, and the person clicking Bump is
   * the person who made the change — so the question is asked here rather than
   * left to whoever reads the archive six months later, who cannot answer it.
   */
  const [authoring, setAuthoring] = useState<BumpAuthoring | undefined>(undefined);
  /*
    VB43 — captured at DISPATCH, never re-read: applying removes the plan from
    the index, so after the re-read there is nothing left to count.
  */
  const [applied, setApplied] = useState<AppliedBump | undefined>(undefined);

  /*
    The plan the operator is being asked to decide about — and never the one
    they have already applied. The index is served STALE while the re-read that
    an apply triggers is in flight (unit F10e), so without this the surface
    offers `Apply the bump` directly under `The bump was applied`: a control
    contradicting the sentence above it, and a second envelope the CAS would
    answer `already-applied`. It comes back on its own, because the re-read
    that lands next no longer carries the plan at all.
  */
  const openPlan = wire.plans.find(
    (plan) => plan.state === "planned" && plan.versionPlanId !== applied?.versionPlanId,
  );

  const submitPlan = useCallback(
    (authored: BumpAuthoring, changeRecord: VersionBumpChangeRecord) => {
      setAuthoring(undefined);
      // a settled banner about the PREVIOUS bump may not stand over a new one
      setApplied(undefined);
      onCommand({
        commandId: crypto.randomUUID(),
        requestedAt: systemClock.now().toISOString(),
        requestedBy: actorId,
        source: SOURCE_SURFACE,
        family: "version-archive",
        type: "plan-version-bump",
        // An `application`-scope plan must name the RUNNING build (D179): a
        // scope nobody can verify could archive every run on the strength of a
        // typo, so the value comes from the served index, never from a field.
        target: authored.scope,
        payload: {
          targetVersion: wire.currentAppVersion,
          changeFingerprint: authored.changeFingerprint,
          changeRecord,
        },
      });
    },
    [actorId, onCommand, wire.currentAppVersion],
  );

  const plan = useCallback(
    (state: WorkflowVersionStateWire) => {
      setAuthoring({
        title: state.workflowLabel,
        scope: { scope: { kind: "workflows", workflowIds: [state.workflowId] } },
        changeFingerprint: state.current.contractFingerprint,
      });
    },
    [],
  );

  const planApplication = useCallback(() => {
    setAuthoring({
      title: `the whole dashboard (app ${wire.currentAppVersion})`,
      scope: { scope: { kind: "application", applicationVersion: wire.currentAppVersion } },
      changeFingerprint: wire.versionState[0]?.current.contractFingerprint ?? "",
    });
  }, [wire.currentAppVersion, wire.versionState]);

  const apply = useCallback(() => {
    if (openPlan === undefined) return;
    setApplied({
      versionPlanId: openPlan.versionPlanId,
      archived: openPlan.candidates.length,
      kind: openPlan.changeRecord.state === "present" ? openPlan.changeRecord.value.kind : undefined,
    });
    onCommand({
      commandId: crypto.randomUUID(),
      requestedAt: systemClock.now().toISOString(),
      requestedBy: actorId,
      source: SOURCE_SURFACE,
      family: "version-archive",
      type: "apply-version-bump",
      target: { versionPlanId: openPlan.versionPlanId, expectedVersion: openPlan.expectedVersion },
      payload: { planFingerprint: openPlan.planFingerprint },
    });
  }, [actorId, onCommand, openPlan]);

  return (
    <div className="flex min-h-0 flex-1 flex-col p-[var(--ds-space-cozy)]">
      <Panel className="min-h-0 flex-1">
        <PanelHeader
          title="Versions & bumps"
          headingLevel={2}
          subtitle="Every workflow's current descriptor version, the runs stamped with it, and the two bump arms."
          icon={<BadgeCheck aria-hidden className={dsIcon.lg} />}
          meta={`app ${wire.currentAppVersion}`}
        />
        <PanelBody>
          <Banner
            tone={blockedWorkflows > 0 ? "warning" : "info"}
            title={
              blockedWorkflows > 0
                /*
                  AR220/AR221 — the word MAJOR is back, and it is now load
                  bearing: `versionState` is kind-agnostic, and a minor bump on
                  these same workflows is refused by nothing (D274 item 2).
                */
                ? `${plural(blockedWorkflows, "workflow")} ${blockedWorkflows === 1 ? "has" : "have"} runs that are not terminal — a MAJOR bump on those is refused`
                : "Every listed run is terminal — a major bump can proceed anywhere"
            }
            className="m-[var(--ds-space-cozy)]"
            action={
              <Button size="sm" variant="secondary" loading={busy} onClick={planApplication}>
                Dashboard update…
              </Button>
            }
          >
            <span className={dsText.body}>
              A <strong>major</strong> bump moves every prior-version run out of the live surfaces into this read-only
              archive, and it <strong>cannot</strong> archive a run that is still queued, running, waiting on you or
              parked — the plan lists them by name. A <strong>minor</strong> bump records the new version and moves
              nothing: no run is archived, so no run can block it. A dashboard update bumps the effective version of
              every workflow, because an old run may not be interpretable against new dashboard state.
            </span>
          </Banner>

          <BumpChangeRecordDialog
            authoring={authoring}
            /*
              The rows THIS bump's scope covers. An application-scope bump
              names every workflow, because that is exactly what it moves.
            */
            states={authoring === undefined
              ? []
              : authoring.scope.scope.kind === "application"
                ? wire.versionState
                : wire.versionState.filter((state) =>
                  authoring.scope.scope.kind === "workflows"
                  && authoring.scope.scope.workflowIds.includes(state.workflowId))}
            busy={busy}
            onCancel={() => setAuthoring(undefined)}
            onConfirm={submitPlan}
          />

          <div className="overflow-x-auto">
            <Table label="Workflow version registry">
              <THead>
                <TR>
                  <TH>Workflow</TH>
                  <TH align="right">Version</TH>
                  <TH align="right">Archivable</TH>
                  <TH align="right">Not terminal</TH>
                  <TH align="right">Archived</TH>
                  <TH align="right">Bump</TH>
                </TR>
              </THead>
              <TBody>
                {wire.versionState.map((state) => (
                  <TR key={state.workflowId}>
                    <TD>
                      <span className="flex items-baseline gap-[var(--ds-space-snug)]">
                        <span className={cn(dsText.nums, dsText.micro, "text-[color:var(--ds-fg-muted)]")}>
                          {state.workflowCode}
                        </span>
                        <span className={cn(dsText.ui, "text-[color:var(--ds-fg)]")}>{state.workflowLabel}</span>
                        <span className={cn(dsText.nums, dsText.micro, "text-[color:var(--ds-fg-faint)]")}>
                          {shortHash(state.current.contractFingerprint)}
                        </span>
                      </span>
                    </TD>
                    <TD align="right" numeric>v{state.current.descriptorVersion}</TD>
                    <TD align="right" numeric>{state.archivable}</TD>
                    <TD align="right">
                      <CountBadge value={state.blockers.length} tone={state.blockers.length > 0 ? "warning" : "neutral"} />
                    </TD>
                    <TD align="right" numeric>{archivedByWorkflow.get(state.workflowId) ?? 0}</TD>
                    <TD align="right">
                      <Button size="sm" variant="outline" loading={busy} onClick={() => plan(state)}>
                        Bump…
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>

          <div className="flex flex-col gap-[var(--ds-space-base)] p-[var(--ds-space-cozy)]">
            {/*
              The blocker list is rendered ONCE per workflow. When a plan is
              open it belongs with the plan — that is the decision the operator
              is about to make — so the per-workflow copy stands down.
            */}
            {openPlan === undefined
              && wire.versionState
                .filter((state) => state.blockers.length > 0)
                .map((state) => (
                  <div key={state.workflowId} className="flex flex-col gap-[var(--ds-space-snug)]">
                    {/*
                      Kind-AGNOSTIC, and it says so. `versionState` is a fact
                      about the registry now, not about a bump nobody has
                      authored yet — so the head states what a MAJOR bump would
                      face rather than implying every bump would (D274 item 2).
                    */}
                    <SectionLabel>{state.workflowLabel} — what a MAJOR bump would refuse to bury</SectionLabel>
                    <BlockerTable blockers={state.blockers} kind="major" />
                  </div>
                ))}

            {openPlan !== undefined && (
              <Well>
                <div className="flex flex-col gap-[var(--ds-space-snug)]">
                  <SectionLabel>Reviewed plan</SectionLabel>
                  <MetaLine
                    items={[
                      `plan ${shortHash(openPlan.versionPlanId)}`,
                      `${String(openPlan.candidates.length)} would be archived`,
                      `${String(openPlan.blockers.length)} would block`,
                      `planned ${fmtClock(openPlan.plannedAt)} by ${openPlan.plannedBy}`,
                    ]}
                  />
                  <BulletList
                    items={[
                      "Applying archives every prior-version run in scope. It cannot be undone — the archive is the record.",
                      "A relaunch from the archive later starts a FRESH run on the current version; it never resumes one of these.",
                    ]}
                  />
                  {/*
                    The runs, by name (D274 item 10). The operator used to
                    apply a sweep against a count and discover its membership
                    afterwards, in the archive.
                  */}
                  <ArchivableRunList plan={openPlan} />
                  <div className="flex items-center gap-[var(--ds-space-snug)]">
                    <Button size="sm" variant="primary" loading={busy} onClick={apply}>
                      Apply the bump
                    </Button>
                    {openPlan.blockers.length > 0 && (
                      <span
                        className={cn(
                          dsText.meta,
                          "flex items-center gap-[var(--ds-space-hair)] text-[color:var(--ds-status-waiting-fg)]",
                        )}
                      >
                        <CircleAlert aria-hidden className={dsIcon.sm} />
                        This will be refused while those runs are not terminal.
                      </span>
                    )}
                  </div>
                </div>
              </Well>
            )}

            {/*
              OUTSIDE the well on purpose: the blocking runs are the thing the
              operator has to act on, and a recessed surface is where this
              design system puts context, not consequence.
            */}
            {openPlan !== undefined && openPlan.blockers.length > 0 && (
              <BlockerTable
                blockers={openPlan.blockers}
                kind={openPlan.changeRecord.state === "present" ? openPlan.changeRecord.value.kind : undefined}
              />
            )}

            {/*
              VB43 — apply settled in SILENCE before this: the index re-read,
              the plan vanished, and nothing said the act had happened. Both
              arms of the one fold are drawn now (D253, Track D row D3), and
              the applied arm needs the dispatch record as well as the verdict:
              without it the result belongs to some other command this surface
              issued, and a success banner about a bump nobody pressed is worse
              than no banner at all.
            */}
            {result !== undefined && settlement !== undefined && (
              settlement.kind === "applied"
                ? applied !== undefined && (
                  <BumpAppliedBanner replayed={settlement.replayed} applied={applied} onOpenArchive={onOpenArchive} />
                )
                : <BumpRefusal result={result} plan={openPlan} />
            )}

            <div className="flex flex-col gap-[var(--ds-space-base)]">
              <SectionLabel>Applied bumps</SectionLabel>
              {wire.sweeps.length === 0 ? (
                <Well>
                  <span className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>
                    No bump has been applied, so nothing has been archived.
                  </span>
                </Well>
              ) : (
                wire.sweeps.map((sweep) => {
                  // Bound once (unit F10d finding 5) and paired onto the
                  // accessible name (finding 1) — see `SweepRecordCard` above.
                  const name = archiveSweepName(sweep, codes);
                  return (
                  <Card key={sweep.applicationId}>
                    <CardBody className="flex min-w-0 flex-col gap-[var(--ds-space-tight)]">
                      <div className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-snug)]">
                        <Badge tone={sweep.scope.kind === "application" ? "warning" : "neutral"}>
                          {scopeWord(sweep.scope)}
                        </Badge>
                        <span
                          className={cn(dsText.nums, dsText.meta, "text-[color:var(--ds-fg)]")}
                          title={name.title}
                          aria-label={name.title}
                        >
                          {name.text}
                        </span>
                        <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
                          {fmtClock(sweep.appliedAt)}
                        </span>
                        <span className={cn(dsText.nums, dsText.micro, "ml-auto text-[color:var(--ds-fg-faint)]")}>
                          {shortHash(sweep.applicationId)} · {plural(sweep.archivedCount, "run")} archived
                        </span>
                      </div>
                      <MetaLine items={[sweep.appliedBy, `app ${sweep.appliedAppVersion}`, `plan ${shortHash(sweep.versionPlanId)}`]} />
                    </CardBody>
                  </Card>
                  );
                })
              )}
            </div>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}

/* ── the takeover ────────────────────────────────────────────────────────── */

export function LegacyArchiveWorkspace({
  selection,
  view,
  actorId,
  onSelection,
  onView,
  onClose,
}: {
  /** `""` is the ledger; anything else is an archived run id. */
  selection: string;
  /** The dashboard route owns which of Archive's two real views is visible. */
  view: ArchiveView;
  actorId: string;
  onSelection: (next: string) => void;
  onView: (next: ArchiveView) => void;
  onClose: () => void;
}) {
  const client = useDashboardClient();
  const [index, setIndex] = useState<AsyncResource<ArchiveIndexWire>>(LOADING);
  const [detail, setDetail] = useState<AsyncResource<ArchivedRunDetailWire>>(LOADING);
  const [query, setQuery] = useState<ArchiveQuery>(EMPTY_ARCHIVE_QUERY);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CommandResult | undefined>(undefined);
  const [confirming, setConfirming] = useState<ArchivedRunAction | undefined>(undefined);
  /**
   * The footer's answer is keyed to the run it came from AND to the door it
   * came through. Clearing it on a list CLICK is not enough: filtering
   * re-selects a run without one, so a result from the previous run would sit
   * above a different run's detail claiming to be about it. D308 added the
   * second half: two doors now share this one result slot, and a delete's
   * refusal drawn under a relaunch's applied banner would be two answers to
   * one click.
   */
  const [acted, setActed] = useState<{ runId: string; action: ArchivedRunAction } | undefined>(undefined);
  const [nonce, setNonce] = useState(0);
  const readArchiveCapture = useCallback(
    (runId: string, artifactId: string, signal?: AbortSignal) =>
      client.archivedCaptureResource(runId, artifactId, signal),
    [client],
  );

  useEffect(() => {
    // A refresh keeps the loaded index mounted, including its command feedback.
    // The first load and a failed refresh retain their distinct resource arms.
    setIndex((current) => (current.state === "loaded" ? current : LOADING));
    return observeAsyncResource(() => client.archiveIndex(), setIndex);
  }, [client, nonce]);

  useEffect(() => {
    if (selection === ARCHIVE_INDEX) return undefined;
    setDetail(LOADING);
    return observeAsyncResource(() => client.archivedRun(selection), setDetail);
  }, [client, selection, nonce]);

  const onCommand = useCallback(
    /**
     * `onApplied` runs only on the ONE fold's applied verdict, beside the
     * re-read. D308's delete needs it because the record it removes is the
     * record this pane is reading: leaving the selection where it is would
     * re-read a run that no longer exists and answer a successful delete with
     * "that archived run could not be read".
     */
    (request: unknown, onApplied?: () => void) => {
      setBusy(true);
      setResult(undefined);
      client.executeCommand(request).then(
        (next) => {
          setResult(next);
          setBusy(false);
          // Any applied command changes what the ledger holds, so the index is
          // re-read rather than patched: this surface has no live stream and a
          // client-side splice would be a second projection of the archive.
          // "Applied" is the ONE fold's verdict (D253, Track D row D3) — a
          // re-read triggered by a refused command would show the operator an
          // unchanged index as though it were the result of their click.
          if (settleCommandResult(next).kind === "applied") {
            setNonce((value) => value + 1);
            onApplied?.();
          }
        },
        (error: unknown) => {
          setBusy(false);
          if (error instanceof DashboardClientError) {
            setResult({
              state: "rejected",
              commandId: "00000000-0000-4000-8000-000000000000",
              code: "authority-unavailable",
              message: error.message,
            } as CommandResult);
            return;
          }
          throw error;
        },
      );
    },
    [client],
  );

  /**
   * D308's delete, composed exactly as the relaunch above it is — same
   * envelope, same family, and the same `archiveFingerprint` off the record
   * this pane read, which is what makes the kernel's `schema-mismatch` a real
   * check rather than a formality.
   */
  const deleteArchivedRun = useCallback(
    (target: ArchivedRunDetailWire) => {
      setActed({ runId: target.runId, action: "delete" });
      onCommand(
        {
          commandId: crypto.randomUUID(),
          requestedAt: systemClock.now().toISOString(),
          requestedBy: actorId,
          source: SOURCE_SURFACE,
          family: "version-archive",
          type: "delete-archived-run",
          target: { archivedRunId: target.runId, archiveFingerprint: target.archiveFingerprint },
        },
        // Back to the ledger, which the same applied verdict has already
        // ordered re-read — so the list the operator lands on is the one that
        // no longer holds this run.
        () => { onSelection(ARCHIVE_INDEX); },
      );
    },
    [actorId, onCommand, onSelection],
  );

  const toggleSection = useCallback((applicationId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(applicationId)) next.delete(applicationId);
      else next.add(applicationId);
      return next;
    });
  }, []);

  const loadedDetail = selection !== ARCHIVE_INDEX && detail.state === "loaded" ? detail.value : undefined;
  const loadedIndex = index.state === "loaded" ? index.value : undefined;
  const sweepOfDetail = loadedDetail === undefined
    ? undefined
    : loadedIndex?.sweeps.find((sweep) => sweep.applicationId === loadedDetail.applicationId);
  /*
    The frozen short codes a sweep name joins against (AR80). Empty until the
    index lands, which is the ruled degradation and not a guess: a sweep name
    with no code prints the workflow ID, which is a real name.
  */
  const codes = useMemo(() => {
    if (loadedIndex === undefined) return new Map<string, string>();
    return archiveWorkflowCodes(loadedIndex);
  }, [loadedIndex]);

  const detailPane = (): ReactNode => {
    if (selection === ARCHIVE_INDEX) {
      return (
        <Panel>
          <PanelBody>
            <EmptyState
              title="Nothing selected"
              description="Pick an archived run on the left to see its stored snapshot."
            />
          </PanelBody>
        </Panel>
      );
    }
    if (detail.state === "loading" || detail.state === "idle") return <Skeleton className="h-64 w-full" />;
    if (detail.state === "failed") {
      return (
        <Refusal title="That archived run could not be read" code="archive-read-failed" outcome="Nothing was changed.">
          <p className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>{detail.error.message}</p>
        </Refusal>
      );
    }
    return (
      <ArchivedRunDetail
        detail={detail.value}
        sweep={sweepOfDetail}
        codes={codes}
        busy={busy}
        relaunched={
          acted?.runId === detail.value.runId
          && acted.action === "relaunch"
          && result !== undefined
          && settleCommandResult(result).kind === "applied"
        }
        refusal={
          acted?.runId === detail.value.runId
          && result !== undefined
          && settleCommandResult(result).kind !== "applied"
            ? result
            : undefined
        }
        onRelaunch={() => setConfirming("relaunch")}
        onDelete={() => setConfirming("delete")}
        onDismiss={() => { setActed(undefined); setResult(undefined); }}
        onReadCapture={readArchiveCapture}
      />
    );
  };

  const body = (): ReactNode => {
    if (index.state === "loading" || index.state === "idle") {
      return <div className="p-[var(--ds-space-cozy)]"><Skeleton className="h-64 w-full" /></div>;
    }
    if (index.state === "failed") {
      return (
        <div className="p-[var(--ds-space-cozy)]">
          <Refusal title="The archive could not be read" code="archive-read-failed" outcome="Nothing was changed.">
            <p className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>{index.error.message}</p>
          </Refusal>
        </div>
      );
    }
    if (view === "versions") {
      return (
        <VersionsView
          wire={index.value}
          actorId={actorId}
          busy={busy}
          onCommand={onCommand}
          onOpenArchive={() => {
            // The door names runs a fresh sweep just minted — a standing
            // filter from an earlier visit to the ledger could hide every one
            // of them (unit F10d finding 2), so entering through the door
            // clears it rather than opening onto a filtered-empty ledger.
            setQuery(EMPTY_ARCHIVE_QUERY);
            onView("runs");
          }}
          result={result}
        />
      );
    }
    return (
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-[var(--ds-space-base)] p-[var(--ds-space-cozy)] min-[1180px]:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
        <ArchiveListPanel
          wire={index.value}
          query={query}
          onQuery={setQuery}
          collapsed={collapsed}
          onToggleSection={toggleSection}
          selectedRunId={selection === ARCHIVE_INDEX ? undefined : selection}
          onSelect={onSelection}
        />
        {detailPane()}
      </div>
    );
  };

  return (
    /* UF-AR-3. `TakeoverFrame`'s JSDoc owns the why — geometry, arrival and
       focus, decided once for all four takeovers. This surface's demo
       container: `// ported from legacy 1ec1d870
       src/dashboard/components/dev/rebuild-demo/RebuildDemo.tsx:658-665`
       (`DemoArchivePage`, a bare `flex min-h-0 flex-1 flex-col` div). */
    <TakeoverFrame label="Archive">
      <PageHeader
        title="Archive"
        icon={<ArchiveIcon aria-hidden className={dsIcon.md} />}
        badge={
          <Badge tone="neutral">
            <Lock aria-hidden className={dsIcon.sm} />
            read-only
          </Badge>
        }
        back={
          <Button
            size="toolbar"
            variant="secondary"
            icon={<ArrowLeft aria-hidden className={dsIcon.md} />}
            onClick={() => (selection === ARCHIVE_INDEX ? onClose() : onSelection(ARCHIVE_INDEX))}
          >
            {/* AR4, D275 item 7 — one label. The detail is a PANE beside the
                list, not a page over it, so the button never went anywhere else. */}
            Back to the dashboard
          </Button>
        }
        actions={
          <span
            role="group"
            aria-label="Archive view"
            className="inline-flex items-center gap-[var(--ds-space-hair)] rounded-[var(--ds-radius-md)] border border-[color:var(--ds-recess-border)] bg-[var(--ds-recess-bg)] p-[var(--ds-space-hair)]"
          >
            <Button
              size="sm"
              variant={view === "runs" ? "secondary" : "ghost"}
              aria-pressed={view === "runs"}
              onClick={() => onView("runs")}
            >
              Archived runs
            </Button>
            <Button
              size="sm"
              variant={view === "versions" ? "secondary" : "ghost"}
              aria-pressed={view === "versions"}
              onClick={() => onView("versions")}
            >
              Versions & bumps
            </Button>
          </span>
        }
      />
      {body()}
      <DeleteConfirmDialog
        detail={confirming === "delete" ? loadedDetail : undefined}
        onCancel={() => setConfirming(undefined)}
        onConfirm={() => {
          setConfirming(undefined);
          if (loadedDetail !== undefined) deleteArchivedRun(loadedDetail);
        }}
      />
    </TakeoverFrame>
  );
}

export { SavedArchiveWorkspace as ArchiveWorkspace } from "./archive-report.js";
