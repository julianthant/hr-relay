/**
 * Ported from legacy hr-automation@1bffbd658db34ce84a08e69484db3a40b3658d6e,
 * src/dashboard/components/dev/rebuild-demo/DemoArchive.tsx (+
 * demo-archive-wire.ts for the query/sort/section vocabulary).
 *
 * The read-only Archive and the version-bump flow (doc 03 §10.2 D80, doc 13 §5,
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
 * The demo renders several facts this wire does not carry — a dry-run flag and
 * a resolved instance per LIST row, per-attempt history, evidence tiles with
 * labels and retention dates, and the change record (what/why/commit) behind a
 * sweep. Each is recorded in `docs/findings/archive.md` rather than
 * approximated here: a plausible-but-wrong value on a record whose whole job
 * is to be trustworthy is the one thing this surface must never produce.
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
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Archive as ArchiveIcon,
  ArrowLeft,
  BadgeCheck,
  Camera,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FileClock,
  Info,
  Lock,
  RotateCw,
  TriangleAlert,
} from "lucide-react";
import { cn } from "../lib/utils.js";
import {
  Badge,
  Banner,
  BulletList,
  Button,
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
  EmptyState,
  Field,
  IconButton,
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
  Refusal,
  SearchInput,
  SectionLabel,
  Select,
  Skeleton,
  StatusPill,
  Tab,
  TabList,
  TabPanel,
  Table,
  Tabs,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TimelineSteps,
  Well,
  type DsSortDirection,
  type DsStatus,
  type DsStep,
  dsFocus,
  dsIcon,
  dsMotion,
  dsRadius,
  dsText,
  useDsEnterTransition,
} from "../ds/ui.js";
import { systemClock } from "../../domain/clock.js";
import type {
  ArchiveEntryWire,
  ArchiveIndexWire,
  ArchiveSweepWire,
  ArchivedRunDetailWire,
  VersionBumpPlanWire,
  WorkflowVersionStateWire,
} from "../../domain/dashboard/archive.js";
import type { CommandResult } from "../../domain/commands.js";
import { DashboardClientError } from "../client/errors.js";
import { useDashboardClient } from "../state/client-context.js";
import { failed, loaded, LOADING, type AsyncResource } from "../state/async-resource.js";
import { elapsedSecondsBetween, fmtClock, fmtElapsed, plural } from "./format.js";
import { dsStatusOf } from "./status.js";
import { FailureDetailBody, ReceiptEvidenceBody } from "./trust.js";

const SOURCE_SURFACE = "archive";

/** The index sentinel: `?archive=` with no run id is the ledger itself. */
export const ARCHIVE_INDEX = "";

type ArchiveView = "runs" | "versions";
type ArchiveTab = "summary" | "evidence";

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

function shortHash(value: string): string {
  return value.slice(0, 8);
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

interface ArchiveQuery {
  readonly text: string;
  readonly workflowId: string;
  readonly status: string;
  readonly sort: ArchiveSortKey;
  readonly dir: ArchiveSortDir;
}

const EMPTY_ARCHIVE_QUERY: ArchiveQuery = {
  text: "",
  workflowId: "all",
  status: "all",
  sort: "when",
  dir: "desc",
};

function queryIsFiltered(query: ArchiveQuery): boolean {
  return query.text.trim() !== "" || query.workflowId !== "all" || query.status !== "all";
}

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

function haystack(entry: ArchiveEntryWire): string {
  return [entry.title, entry.traceId, entry.workflowLabel, entry.workflowId, entry.runId]
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

interface ArchiveSection {
  readonly sweep: ArchiveSweepWire | undefined;
  readonly applicationId: string;
  readonly entries: readonly ArchiveEntryWire[];
}

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

/**
 * The sweep's NAME, as the demo's `ec v3.1 → v4.0` reads: the identities it
 * moved every prior run onto, then the version it was applied for. The demo's
 * `major`/`minor` word has no counterpart on this wire (see
 * `docs/findings/archive.md`), so the badge carries the SCOPE, which is the
 * fact D179 does record.
 */
function sweepNameLabel(sweep: ArchiveSweepWire): string {
  const identities = sweep.appliedIdentities
    .map((identity) => `${identity.workflowId} v${String(identity.descriptorVersion)}`)
    .join(", ");
  return `${identities} → ${sweep.targetVersion}`;
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

function ArchiveRow({
  entry,
  selected,
  onSelect,
}: {
  entry: ArchiveEntryWire;
  selected: boolean;
  onSelect: () => void;
}) {
  const seconds = durationSeconds(entry);
  const ended = endedInstant(entry);
  return (
    <TR interactive selected={selected} onClick={onSelect} className="cursor-pointer" data-demo-row-id={entry.runId}>
      <TD className="truncate">
        <span className="inline-flex min-w-0 items-center gap-[var(--ds-space-snug)]">
          <ArchiveStatusLead />
          <StatusPill status={dsStatusOf(entry.status)} size="sm" hideIcon />
        </span>
      </TD>
      <TD className="min-w-0">
        <span className="flex min-w-0 items-center gap-[var(--ds-space-snug)]">
          {/*
            The whole row is the click target and carries `aria-selected`; the
            name cell holds the only real button, so a screen reader gets one
            command per row rather than five.
          */}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSelect();
            }}
            className={cn("min-w-0 flex-1 truncate text-left text-[color:var(--ds-fg)]", dsFocus)}
            title={`${entry.title} · ${entry.workflowLabel} v${String(entry.archivedIdentity.descriptorVersion)} — archived because ${driftWords(entry.drift)}`}
          >
            {entry.title}
            <span className={cn(dsText.meta, dsText.nums, "text-[color:var(--ds-fg-muted)]")}>
              {" "}
              · {entry.workflowLabel} v{entry.archivedIdentity.descriptorVersion}
            </span>
          </button>
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
  collapsed,
  onToggle,
}: {
  section: ArchiveSection;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { sweep, applicationId } = section;
  const count = section.entries.length;
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  const cell = "bg-[var(--ds-surface-2)] border-b border-[color:var(--ds-border)]";
  const summary = sweep === undefined
    ? `${applicationId} — the index carries no sweep record, ${plural(count, "run")}`
    : `${sweepNameLabel(sweep)}, ${scopeWord(sweep.scope)} scope, ${plural(count, "run")}`;

  return (
    <TR interactive onClick={onToggle} className={cn("h-auto", dsMotion.fast)}>
      <TD className={cn(cell, "align-middle")}>
        <button
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
          ) : (
            <Badge tone={sweep.scope.kind === "application" ? "warning" : "neutral"}>
              {scopeWord(sweep.scope)}
            </Badge>
          )}
        </button>
      </TD>

      {/* the NAME column — what every swept run was moved off, and onto */}
      <TD className={cn(cell, "min-w-0")}>
        {sweep === undefined ? (
          <span className={cn(dsText.meta, "block min-w-0 truncate text-[color:var(--ds-danger)]")}>
            Sweep record missing
          </span>
        ) : (
          <span
            className={cn(dsText.meta, dsText.nums, "block min-w-0 truncate font-semibold text-[color:var(--ds-fg)]")}
            title={sweepNameLabel(sweep)}
          >
            {sweepNameLabel(sweep)}
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
                label={sweep === undefined ? `About ${applicationId}` : `About this bump — ${sweepNameLabel(sweep)}`}
                icon={<Info aria-hidden className={dsIcon.sm} />}
                className="shrink-0 data-[state=open]:bg-[var(--ds-surface-3)] data-[state=open]:text-[color:var(--ds-fg)]"
              />
            </PopoverTrigger>
            <PopoverContent
              title={sweep === undefined ? "Sweep record missing" : sweepNameLabel(sweep)}
              description={sweep === undefined ? undefined : `${scopeWord(sweep.scope)} scope`}
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
                    The change record doc 03 §10.2 asks for — what moved, why,
                    and the commit — is not on this wire. Naming its absence is
                    the honest arm; inventing a sentence from the ids would be
                    a second, fabricated account of a decision with one author.
                  */}
                  <p className={cn(dsText.meta, "text-[color:var(--ds-fg-faint)]")}>
                    No written change record is served with a sweep, so what moved and why is not shown here.
                  </p>
                  <MetaLine
                    items={[
                      sweep.appliedBy,
                      `plan ${shortHash(sweep.versionPlanId)}`,
                      `app ${sweep.appliedAppVersion}`,
                      fmtClock(sweep.appliedAt),
                      `${plural(sweep.archivedCount, "run")} archived`,
                    ]}
                  />
                </div>
              )}
            </PopoverContent>
          </Popover>
        </span>
      </TD>
    </TR>
  );
}

function ArchiveTable({
  sections,
  query,
  onSort,
  collapsed,
  onToggleSection,
  selectedRunId,
  onSelect,
}: {
  sections: readonly ArchiveSection[];
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

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <Table label="Archived runs, grouped by the version bump that swept them" layout="fixed" className="min-w-[720px]">
        {/*
          The measured column widths. Every one of these except the name is a
          value of known shape — a status word, a trace id, a clock, a duration
          — so they are fixed and the name takes the slack. That is what puts
          every name on the same x.
        */}
        <colgroup>
          <col style={{ width: "var(--ds-w-archive-status)" }} />
          <col />
          <col style={{ width: "var(--ds-w-archive-trace)" }} />
          <col style={{ width: "var(--ds-w-archive-when)" }} />
          <col style={{ width: "var(--ds-w-archive-duration)" }} />
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
        {sections.map((section) => (
          <TBody key={section.applicationId}>
            <SweepSectionRow
              section={section}
              collapsed={collapsed.has(section.applicationId)}
              onToggle={() => onToggleSection(section.applicationId)}
            />
            {!collapsed.has(section.applicationId)
              && section.entries.map((entry) => (
                <ArchiveRow
                  key={entry.runId}
                  entry={entry}
                  selected={entry.runId === selectedRunId}
                  onSelect={() => onSelect(entry.runId)}
                />
              ))}
          </TBody>
        ))}
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
    const seen = new Set<string>();
    for (const entry of wire.entries) seen.add(entry.status);
    return [...seen];
  }, [wire.entries]);

  const visible = useMemo(() => queryArchive(wire.entries, query), [wire.entries, query]);
  const sections = useMemo(() => groupBySweep(visible, wire.sweeps), [visible, wire.sweeps]);
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
              it is true of on every run and every day. The three sentences are
              what D179 actually guarantees — no purge DATE is served, so none
              is printed (see `docs/findings/archive.md`).
            */}
            <PopoverContent title="Retention" width="lg" align="end">
              <BulletList
                items={[
                  "An archived row is the audit copy: schema v13 aborts UPDATE and DELETE on it in SQL, not by convention.",
                  "Evidence is POINTERS — the captured bytes, the checkpoints and the ledger lines all stay exactly where they are, under their own retention.",
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
            <option key={status} value={status}>{status}</option>
          ))}
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
            title={filtered ? "Nothing in the archive matches" : "Nothing has been archived yet"}
            description={
              filtered
                ? "Every archived run was excluded by the search or one of the filters. Clearing them shows all of them again."
                : "A run reaches the archive only when its workflow's version bumps — its shape moved, so it is no longer "
                  + "comparable with what runs today. Plan a bump under Versions & bumps to see which runs a sweep would take."
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

/* ── one archived run ────────────────────────────────────────────────────── */

/**
 * Which sweep archived this run, in the DETAIL. The scope badge used to live
 * only in the list's section header and vanished the moment you opened a run.
 */
function SweepRecordCard({ sweep, applicationId }: { sweep: ArchiveSweepWire | undefined; applicationId: string }) {
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
  return (
    <Card>
      <CardBody className="flex flex-col gap-[var(--ds-space-snug)]">
        <div className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-snug)]">
          <SectionLabel>Archived by</SectionLabel>
          <Badge tone={sweep.scope.kind === "application" ? "warning" : "neutral"}>{scopeWord(sweep.scope)}</Badge>
          <span className={cn(dsText.meta, dsText.nums, "ml-auto text-[color:var(--ds-fg)]")}>
            → {sweep.targetVersion}
          </span>
        </div>
        <p className={cn(dsText.body, "text-[color:var(--ds-fg)]")}>{sweepNameLabel(sweep)}</p>
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

function ArchivedRunDetail({
  detail,
  sweep,
  busy,
  relaunched,
  onRelaunch,
  onDismiss,
}: {
  detail: ArchivedRunDetailWire;
  sweep: ArchiveSweepWire | undefined;
  busy: boolean;
  relaunched: boolean;
  onRelaunch: () => void;
  onDismiss: () => void;
}) {
  const [tab, setTab] = useState<ArchiveTab>("summary");
  useEffect(() => { setTab("summary"); }, [detail.runId]);

  const row = detail.row;
  const status: DsStatus = dsStatusOf(row.status);
  const seconds = row.endedAt.state === "present"
    ? elapsedSecondsBetween(row.startedAt, row.endedAt.value)
    : undefined;
  const testInstances = row.resolvedInstances.filter((resolved) => resolved.instance === "test");
  const evidenceCount = detail.evidence.artifactIds.length
    + detail.evidence.checkpointNodeIds.length
    + detail.evidence.writeIntentIds.length;

  /**
   * The FROZEN timeline, mapped to the design system's step vocabulary. The
   * archived detail carries the events verbatim; nothing here re-derives a
   * state from a descriptor, which is what makes the whole page renderable
   * with the workflow registry emptied.
   */
  const steps: DsStep[] = detail.detail.timeline.events.map((event) => ({
    label: event.label,
    state: event.state === "active"
      ? "current"
      : event.state === "done" || event.state === "failed" || event.state === "skipped"
        ? event.state
        : "pending",
  }));

  return (
    <Panel className="min-h-0" aria-label={`Archived run ${detail.detail.header.title}`}>
      <PanelHeader
        title={detail.detail.header.title}
        subtitle={`${detail.workflowLabel} · archived ${fmtClock(detail.archivedAt)} by ${detail.archivedBy}`}
        icon={<FileClock aria-hidden className={dsIcon.lg} />}
        meta={<StatusPill status={status} size="sm" />}
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
            title="A fresh run was enqueued on the current version"
            action={<Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>}
          >
            <span className={dsText.body}>
              It carries its own trace id, assigned at enqueue. This archived run is untouched — it is listed under
              “Relaunched as” once the archive is re-read.
            </span>
          </Banner>
        </div>
      )}

      <Tabs value={tab} onValueChange={(next) => setTab(next as ArchiveTab)} className="min-h-0 flex-1">
        <TabList label="Archived run detail">
          <Tab value="summary">Summary</Tab>
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
            <Chip label="attempt">{String(detail.detail.header.attempt)}</Chip>
            {testInstances.length > 0 && (
              <Chip tone="warning" icon={<TriangleAlert aria-hidden className={dsIcon.sm} />}>
                test instance · {testInstances.map((resolved) => resolved.system).join(", ")}
              </Chip>
            )}
            {detail.relaunch.state === "available"
              && detail.relaunch.current.descriptorVersion > detail.archivedIdentity.descriptorVersion && (
              <Chip tone="warning">shape moved · v{detail.relaunch.current.descriptorVersion}</Chip>
            )}
          </ChipRow>

          <MetaLine
            items={[
              `started ${fmtClock(row.startedAt)}`,
              row.endedAt.state === "present" ? `ended ${fmtClock(row.endedAt.value)}` : row.endedAt.reason,
              seconds === undefined ? "duration unknown" : `ran ${fmtElapsed(seconds)}`,
              `archived because ${driftWords(detail.drift)}`,
              ...row.resolvedInstances.map((resolved) => `${resolved.system} ${resolved.instance}`),
            ]}
          />

          <SweepRecordCard sweep={sweep} applicationId={detail.applicationId} />

          {detail.failure.state === "present" && (
            <Card tone="danger">
              <CardBody className="flex flex-col gap-[var(--ds-space-snug)]">
                <SectionLabel>Failure record</SectionLabel>
                <FailureDetailBody detail={detail.failure.value} />
              </CardBody>
            </Card>
          )}

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
              {steps.length === 0
                ? <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>This run recorded no steps.</p>
                : <TimelineSteps steps={steps} variant="full" label="Archived run timeline" />}
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 gap-[var(--ds-space-base)] min-[900px]:grid-cols-2">
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
                  </div>
                ) : (
                  <span className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>
                    {detail.detail.gate.state === "open"
                      ? `${detail.detail.gate.label} — opened ${fmtClock(detail.detail.gate.openedAt)} and never answered.`
                      : detail.detail.gate.reason}
                  </span>
                )}
                <MetaLine
                  items={[
                    `${plural(detail.detail.context.attempts, "attempt")}`,
                    `${plural(detail.detail.context.dataFacts, "data fact")}`,
                    `${plural(detail.detail.context.evidenceFacts, "evidence fact")}`,
                  ]}
                />
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardBody className="flex flex-col gap-[var(--ds-space-snug)]">
              <SectionLabel>Write ledger — never archived</SectionLabel>
              {detail.evidence.ledgerPartitions.length === 0 ? (
                <Well>
                  <span className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>
                    This run filed nothing, so it has no ledger line. An absent line is itself the answer to “did this
                    write?”.
                  </span>
                </Well>
              ) : (
                <Table label="Ledger lines this run filed">
                  <THead>
                    <TR>
                      <TH>System</TH>
                      <TH>Partition</TH>
                      <TH align="right">Line</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {detail.evidence.ledgerPartitions.map((line) => (
                      <TR key={`${line.system}-${line.date}-${String(line.sequence)}`}>
                        <TD>{line.system}</TD>
                        <TD numeric>{line.date}</TD>
                        <TD align="right" numeric>{line.sequence}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>

          {/* The page's whole claim rests on trusting this row. */}
          <Card>
            <CardBody className="flex flex-col gap-[var(--ds-space-snug)]">
              <SectionLabel>Snapshot provenance</SectionLabel>
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
                Pointers, not tiles. The wire archives evidence as IDS — the
                bytes, the checkpoints and the ledger lines stay where they are
                — so a thumbnail here would be a drawn stand-in for a real
                system page, which is the one thing an evidence surface may
                never do.
              */}
              <EvidencePointerGroup label="Captures" ids={detail.evidence.artifactIds} />
              <EvidencePointerGroup label="Checkpoints" ids={detail.evidence.checkpointNodeIds} />
              <EvidencePointerGroup label="Write intents" ids={detail.evidence.writeIntentIds} tone="warning" />
              <p className={cn(dsText.meta, "text-[color:var(--ds-fg-faint)]")}>
                The write ledger is never archived. What was filed in a real system stays where it was filed.
              </p>
            </>
          )}
        </TabPanel>
      </Tabs>

      <PanelFooter>
        <span className={cn(dsText.meta, "max-w-[80ch] text-[color:var(--ds-fg-muted)]")}>
          Read-only. There is no retry, cancel or edit here — the code this run executed is not the code that is loaded.
        </span>
        {detail.relaunch.state === "available" ? (
          <Button
            className="ml-auto"
            variant="primary"
            size="sm"
            loading={busy}
            icon={<RotateCw aria-hidden className={dsIcon.md} />}
            onClick={onRelaunch}
          >
            Relaunch on v{detail.relaunch.current.descriptorVersion}…
          </Button>
        ) : (
          <span className={cn(dsText.meta, "ml-auto max-w-[40ch] text-right text-[color:var(--ds-status-waiting-fg)]")}>
            {detail.relaunch.reason}
          </span>
        )}
      </PanelFooter>
    </Panel>
  );
}

function EvidencePointerGroup({
  label,
  ids,
  tone,
}: {
  label: string;
  ids: readonly string[];
  tone?: "warning";
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
      </CardBody>
    </Card>
  );
}

/* ── relaunch — it asks, it previews, and it names what already landed ───── */

function RelaunchConfirmDialog({
  detail,
  onCancel,
  onConfirm,
}: {
  detail: ArchivedRunDetailWire | undefined;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={detail !== undefined} onOpenChange={(open) => { if (!open) onCancel(); }}>
      {detail !== undefined && detail.relaunch.state === "available" && (
        <DialogContent
          size="lg"
          title={`Relaunch ${detail.detail.header.title} on v${String(detail.relaunch.current.descriptorVersion)}?`}
          description={`A fresh ${detail.workflowLabel} run from the archived input — never a resume of ${detail.detail.header.traceId}.`}
        >
          <DialogBody className="flex flex-col gap-[var(--ds-space-cozy)]">
            {(detail.evidence.writeIntentIds.length > 0 || detail.evidence.ledgerPartitions.length > 0) && (
              <Banner
                tone="danger"
                title={`This run already filed ${plural(Math.max(detail.evidence.writeIntentIds.length, detail.evidence.ledgerPartitions.length), "record")} in a real system`}
                icon={<TriangleAlert aria-hidden className={dsIcon.lg} />}
              >
                <span className="flex flex-col gap-[var(--ds-space-snug)]">
                  <span className={dsText.body}>
                    A relaunch does not know about them. If the work still stands, this files it a second time.
                  </span>
                  <Well>
                    <ul className="flex flex-col gap-[var(--ds-space-hair)]">
                      {detail.evidence.ledgerPartitions.map((line) => (
                        <li
                          key={`${line.system}-${line.date}-${String(line.sequence)}`}
                          className={cn(dsText.body, "flex min-w-0 items-baseline gap-[var(--ds-space-snug)]")}
                        >
                          <span className={cn(dsText.caps, "w-[80px] shrink-0 text-[color:var(--ds-fg-muted)]")}>
                            {line.system}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[color:var(--ds-fg)]">
                            ledger {line.date}
                          </span>
                          <span className={cn(dsText.nums, "shrink-0 text-[color:var(--ds-fg-muted)]")}>
                            line {line.sequence}
                          </span>
                        </li>
                      ))}
                      {detail.evidence.writeIntentIds.map((intentId) => (
                        <li
                          key={intentId}
                          className={cn(dsText.body, "flex min-w-0 items-baseline gap-[var(--ds-space-snug)]")}
                        >
                          <span className={cn(dsText.caps, "w-[80px] shrink-0 text-[color:var(--ds-fg-muted)]")}>
                            intent
                          </span>
                          <span className={cn(dsText.nums, "min-w-0 flex-1 truncate text-[color:var(--ds-fg)]")}>
                            {intentId}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Well>
                </span>
              </Banner>
            )}

            <Field label="What this would create">
              <Well>
                <div className="flex min-w-0 flex-col gap-[var(--ds-space-snug)]">
                  <div className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-snug)]">
                    <BadgeCheck aria-hidden className={cn(dsIcon.md, "shrink-0 text-[color:var(--ds-fg-muted)]")} />
                    <span className={cn(dsText.ui, "text-[color:var(--ds-fg)]")}>
                      1 {detail.workflowLabel} run on v{detail.relaunch.current.descriptorVersion}
                    </span>
                    <Badge tone="neutral" className="ml-auto">lands in the queue</Badge>
                  </div>
                  <MetaLine
                    items={[
                      "trace id assigned at enqueue",
                      `archived run ran v${String(detail.archivedIdentity.descriptorVersion)}`,
                      `on ${shortHash(detail.relaunch.current.contractFingerprint)}`,
                    ]}
                  />
                </div>
              </Well>
            </Field>

            <Field label="Input it replays">
              <Well>
                <span className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>
                  The archived RAW submission, replanned through today's ingress and canonical schemas inside the
                  command transaction. It is not a retry: the fresh run records no retry link, and neither side of
                  the pair is rewritten to claim one.
                </span>
              </Well>
            </Field>

            <div className="min-w-0">
              <SectionLabel className="mb-[var(--ds-space-snug)]">Decide these, rather than discover them</SectionLabel>
              <BulletList
                items={[
                  `The fresh run executes v${String(detail.relaunch.current.descriptorVersion)}, whose shape moved — its steps and its written fields are not this record's.`,
                  "Nothing here is undone. The archived row stays exactly as it ended, and this relaunch is recorded against it.",
                ]}
              />
            </div>
          </DialogBody>

          <DialogFooter meta={`Archived run ${detail.detail.header.traceId} stays exactly as it ended.`}>
            <Button variant="secondary" onClick={onCancel}>Cancel</Button>
            <Button variant="primary" icon={<RotateCw aria-hidden className={dsIcon.md} />} onClick={onConfirm}>
              Enqueue a new run
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

/* ── the version-bump flow ───────────────────────────────────────────────── */

function BumpRefusal({ result, plan }: { result: CommandResult; plan: VersionBumpPlanWire | undefined }) {
  // The hook must run before any early return; a refusal that appeared with no
  // transition after a click would read as a page change rather than as the
  // answer to that click.
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

function BlockerTable({ blockers }: { blockers: WorkflowVersionStateWire["blockers"] }) {
  return (
    <div className="overflow-x-auto">
      <Table label="Prior-version runs that are not terminal">
        <THead>
          <TR>
            <TH>Run</TH>
            <TH>State</TH>
            <TH>What has to happen</TH>
          </TR>
        </THead>
        <TBody>
          {blockers.map((blocker) => (
            <TR key={blocker.runId}>
              <TD numeric>{blocker.traceId}</TD>
              <TD>{blocker.runState}</TD>
              <TD>
                {blocker.runState === "parked-write"
                  ? "Resolve the parked write present or absent — an unresolved possible-submit is never archived."
                  : blocker.runState === "parked-gate"
                    ? "Answer the open gate, or cancel the run."
                    : "Let it finish, or cancel it."}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
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
  result,
}: {
  wire: ArchiveIndexWire;
  actorId: string;
  busy: boolean;
  onCommand: (request: unknown) => void;
  result: CommandResult | undefined;
}) {
  const openPlan = wire.plans.find((plan) => plan.state === "planned");
  const blockedWorkflows = wire.versionState.filter((state) => state.blockers.length > 0).length;
  const archivedByWorkflow = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of wire.entries) counts.set(entry.workflowId, (counts.get(entry.workflowId) ?? 0) + 1);
    return counts;
  }, [wire.entries]);

  const plan = useCallback(
    (state: WorkflowVersionStateWire) => {
      onCommand({
        commandId: crypto.randomUUID(),
        requestedAt: systemClock.now().toISOString(),
        requestedBy: actorId,
        source: SOURCE_SURFACE,
        family: "version-archive",
        type: "plan-version-bump",
        target: { scope: { kind: "workflows", workflowIds: [state.workflowId] } },
        payload: {
          targetVersion: wire.currentAppVersion,
          changeFingerprint: state.current.contractFingerprint,
        },
      });
    },
    [actorId, onCommand, wire.currentAppVersion],
  );

  const planApplication = useCallback(() => {
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
      target: { scope: { kind: "application", applicationVersion: wire.currentAppVersion } },
      payload: {
        targetVersion: wire.currentAppVersion,
        changeFingerprint: wire.versionState[0]?.current.contractFingerprint ?? "",
      },
    });
  }, [actorId, onCommand, wire.currentAppVersion, wire.versionState]);

  const apply = useCallback(() => {
    if (openPlan === undefined) return;
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
          subtitle="Every workflow's current descriptor version, the runs stamped with it, and what a bump would move."
          icon={<BadgeCheck aria-hidden className={dsIcon.lg} />}
          meta={`app ${wire.currentAppVersion}`}
        />
        <PanelBody>
          <Banner
            tone={blockedWorkflows > 0 ? "warning" : "info"}
            title={
              blockedWorkflows > 0
                ? `${plural(blockedWorkflows, "workflow")} ${blockedWorkflows === 1 ? "has" : "have"} runs that are not terminal — a bump on those is refused`
                : "Every prior-version run is terminal — a bump can proceed anywhere"
            }
            className="m-[var(--ds-space-cozy)]"
            action={
              <Button size="sm" variant="secondary" loading={busy} onClick={planApplication}>
                Dashboard update…
              </Button>
            }
          >
            <span className={dsText.body}>
              A bump moves every prior-version run out of the live surfaces into this read-only archive, and it{" "}
              <strong>cannot</strong> archive a run that is still queued, running, waiting on you or parked — the plan
              lists them by name. A dashboard update bumps the effective version of every workflow, because an old run
              may not be interpretable against new dashboard state.
            </span>
          </Banner>

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
                    <SectionLabel>{state.workflowLabel} — what a bump would refuse to bury</SectionLabel>
                    <BlockerTable blockers={state.blockers} />
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
            {openPlan !== undefined && openPlan.blockers.length > 0 && <BlockerTable blockers={openPlan.blockers} />}

            {result !== undefined && <BumpRefusal result={result} plan={openPlan} />}

            <div className="flex flex-col gap-[var(--ds-space-base)]">
              <SectionLabel>Applied bumps</SectionLabel>
              {wire.sweeps.length === 0 ? (
                <Well>
                  <span className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>
                    No bump has been applied, so nothing has been archived.
                  </span>
                </Well>
              ) : (
                wire.sweeps.map((sweep) => (
                  <Card key={sweep.applicationId}>
                    <CardBody className="flex min-w-0 flex-col gap-[var(--ds-space-tight)]">
                      <div className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-snug)]">
                        <Badge tone={sweep.scope.kind === "application" ? "warning" : "neutral"}>
                          {scopeWord(sweep.scope)}
                        </Badge>
                        <span className={cn(dsText.nums, dsText.meta, "text-[color:var(--ds-fg)]")}>
                          {sweepNameLabel(sweep)}
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
                ))
              )}
            </div>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}

/* ── the takeover ────────────────────────────────────────────────────────── */

export function ArchiveWorkspace({
  selection,
  actorId,
  onSelection,
  onClose,
}: {
  /** `""` is the ledger; anything else is an archived run id. */
  selection: string;
  actorId: string;
  onSelection: (next: string) => void;
  onClose: () => void;
}) {
  const client = useDashboardClient();
  const enter = useDsEnterTransition();
  const [view, setView] = useState<ArchiveView>("runs");
  const [index, setIndex] = useState<AsyncResource<ArchiveIndexWire>>(LOADING);
  const [detail, setDetail] = useState<AsyncResource<ArchivedRunDetailWire>>(LOADING);
  const [query, setQuery] = useState<ArchiveQuery>(EMPTY_ARCHIVE_QUERY);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CommandResult | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  /**
   * The relaunch answer is keyed to the run it came from. Clearing it on a
   * list CLICK is not enough: filtering re-selects a run without one, so a
   * result from the previous run would sit above a different run's detail
   * claiming to be about it.
   */
  const [relaunched, setRelaunched] = useState<string | undefined>(undefined);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setIndex(LOADING);
    client.archiveIndex().then(
      (value) => { if (live) setIndex(loaded(value)); },
      (error: unknown) => {
        if (!live) return;
        if (error instanceof DashboardClientError) { setIndex(failed(error)); return; }
        throw error;
      },
    );
    return () => { live = false; };
  }, [client, nonce]);

  useEffect(() => {
    if (selection === ARCHIVE_INDEX) return undefined;
    let live = true;
    setDetail(LOADING);
    client.archivedRun(selection).then(
      (value) => { if (live) setDetail(loaded(value)); },
      (error: unknown) => {
        if (!live) return;
        if (error instanceof DashboardClientError) { setDetail(failed(error)); return; }
        throw error;
      },
    );
    return () => { live = false; };
  }, [client, selection, nonce]);

  const onCommand = useCallback(
    (request: unknown) => {
      setBusy(true);
      setResult(undefined);
      client.executeCommand(request).then(
        (next) => {
          setResult(next);
          setBusy(false);
          // Any applied command changes what the ledger holds, so the index is
          // re-read rather than patched: this surface has no live stream and a
          // client-side splice would be a second projection of the archive.
          if (next.state === "applied" || next.state === "already-applied") setNonce((value) => value + 1);
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

  const relaunch = useCallback(
    (target: ArchivedRunDetailWire) => {
      setRelaunched(target.runId);
      onCommand({
        commandId: crypto.randomUUID(),
        requestedAt: systemClock.now().toISOString(),
        requestedBy: actorId,
        source: SOURCE_SURFACE,
        family: "version-archive",
        type: "relaunch-archived-run",
        target: { archivedRunId: target.runId, archiveFingerprint: target.archiveFingerprint },
      });
    },
    [actorId, onCommand],
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
        busy={busy}
        relaunched={relaunched === detail.value.runId && result?.state === "applied"}
        onRelaunch={() => setConfirming(true)}
        onDismiss={() => setRelaunched(undefined)}
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
      return <VersionsView wire={index.value} actorId={actorId} busy={busy} onCommand={onCommand} result={result} />;
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
    <Panel
      {...enter}
      aria-label="Archive"
      className={cn(
        "flex-1 data-[demo-enter=from]:translate-y-[calc(-1*var(--ds-travel-sm))]",
        "data-[demo-enter=from]:opacity-0 ds-motion-enter",
      )}
    >
      <PageHeader
        title="Archive"
        icon={<ArchiveIcon aria-hidden className={dsIcon.lg} />}
        badge={
          <Badge tone="neutral">
            <Lock aria-hidden className={dsIcon.sm} />
            read-only
          </Badge>
        }
        back={
          <Button
            size="sm"
            variant="ghost"
            icon={<ArrowLeft aria-hidden className={dsIcon.md} />}
            onClick={() => (selection === ARCHIVE_INDEX ? onClose() : onSelection(ARCHIVE_INDEX))}
          >
            {selection === ARCHIVE_INDEX ? "Back to the dashboard" : "Back to the ledger"}
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
              onClick={() => setView("runs")}
            >
              Archived runs
            </Button>
            <Button
              size="sm"
              variant={view === "versions" ? "secondary" : "ghost"}
              aria-pressed={view === "versions"}
              onClick={() => setView("versions")}
            >
              Versions & bumps
            </Button>
          </span>
        }
      />
      {body()}
      <RelaunchConfirmDialog
        detail={confirming ? loadedDetail : undefined}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          if (loadedDetail !== undefined) relaunch(loadedDetail);
        }}
      />
    </Panel>
  );
}
