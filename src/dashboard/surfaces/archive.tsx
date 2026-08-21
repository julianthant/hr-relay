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
 * The demo renders a few facts this wire still does not carry — a dry-run flag
 * and a resolved instance per LIST row, and a short workflow code. Each is
 * recorded in the findings ledger rather than approximated here: a
 * plausible-but-wrong value on a record whose whole job is to be trustworthy
 * is the one thing this surface must never produce. What HAS landed since that
 * sentence was written is D223's five tabs off the frozen sections, the
 * described capture tiles, the per-attempt history, Export, and charter §25's
 * change record — the last of which is authored in the bump dialog, because
 * the only person who can say why a version moved is the one moving it.
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
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { z } from "zod";
import {
  Archive as ArchiveIcon,
  ArrowLeft,
  BadgeCheck,
  Camera,
  ChevronDown,
  Download,
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
  Textarea,
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
  useToasts,
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
import { EVENT_STREAM_RETENTION_DAYS, type ArchiveRetentionWire } from "../../domain/archive/retention.js";
import { timelineEventDuration } from "../../domain/dashboard/run-detail.js";
import type { ResolvedLedgerLineWire } from "../../domain/archive/ledger-resolution.js";
import {
  VersionBumpChangeRecordSchema,
  type VersionBumpChangeRecord,
} from "../../domain/archive/change-record.js";
import type { ArchivedCaptureTile, ArchivedRunAttempt, ArchivedRunSections } from "../../domain/archive/sections.js";
import type { CommandResult, VersionScope } from "../../domain/commands.js";
import { DashboardClientError } from "../client/errors.js";
import { useDashboardClient } from "../state/client-context.js";
import { failed, loaded, LOADING, type AsyncResource } from "../state/async-resource.js";
import { elapsedSecondsBetween, fmtClock, fmtElapsed, fmtInstantDay, plural, shortHash } from "./format.js";
import { testInstanceSystems } from "./test-instance-hazard.js";
import { dsStatusOf } from "./status-model.js";
import { FailureDetailBody, ReceiptEvidenceBody } from "./trust.js";
import { ARCHIVE_INDEX, archivedRunTouchedTest } from "./archive-model.js";
import { settleCommandResult } from "../app/command-result.js";

const SOURCE_SURFACE = "archive";

type ArchiveView = "runs" | "versions";
type ArchiveTab = "summary" | "logs" | "data" | "people" | "evidence";

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
            title={`${entry.title} · ${workflowTokenTitle(entry)} — archived because ${driftWords(entry.drift)}`}
          >
            {entry.title}
            <span className={cn(dsText.meta, dsText.nums, "text-[color:var(--ds-fg-muted)]")}>
              {" "}
              · {workflowToken(entry)} v{entry.archivedIdentity.descriptorVersion}
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
                    Charter §25's change record: what moved and WHY, authored
                    by whoever made the change at the moment they made it. A
                    sweep applied before it was collected says so — inventing a
                    sentence from the ids would be a second, fabricated account
                    of a decision with one author.
                  */}
                  <ChangeRecordBody record={sweep.changeRecord} />
                  <MetaLine
                    items={[
                      sweep.appliedBy,
                      `plan ${shortHash(sweep.versionPlanId)}`,
                      `app ${sweep.appliedAppVersion}`,
                      fmtClock(sweep.appliedAt),
                      `${plural(sweep.archivedCount, "run")} archived`,
                      sweep.fromVersions.length === 0
                        ? "archived nothing, so no from-version"
                        : `v${sweep.fromVersions.join(", v")} → ${sweep.targetVersion}`,
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
            <option key={status} value={status}>{status}</option>
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
      <TD title={`${line.pointer.date} line ${String(line.pointer.sequence)} · ${line.idempotencyKey}`}>
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
      title: `archive-${detail.detail.header.traceId}.json`,
      description: "Exactly what this page holds — the display-redacted archived record, nothing re-derived.",
    });
  }, [detail, toast]);

  const row = detail.row;
  const status: DsStatus = dsStatusOf(row.status);
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
  const steps: DsStep[] = detail.detail.timeline.events.map((event) => {
    /*
     * The step's OWN measured duration, read FORWARD: a record frozen before
     * the leaf existed says so rather than rendering a zero, and every other
     * absence carries the server's own reason (still running, no folded start,
     * a gate, disagreeing instants). Nothing here differences two events.
     */
    const measured = timelineEventDuration(event);
    return {
      label: event.label,
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
    <Panel className="min-h-0" aria-label={`Archived run ${detail.detail.header.title}`}>
      <PanelHeader
        title={detail.detail.header.title}
        subtitle={detail.workflowCode.state === "present"
          ? `${detail.workflowLabel} · code ${detail.workflowCode.value} · archived ${fmtClock(detail.archivedAt)} by ${detail.archivedBy}`
          : `${detail.workflowLabel} · archived ${fmtClock(detail.archivedAt)} by ${detail.archivedBy}`}
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
            <Chip label="attempt">{String(detail.detail.header.attempt)}</Chip>
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
                      <TH align="right">Instance</TH>
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
                    <div key={note.noteId} className="flex min-w-0 items-baseline gap-[var(--ds-space-snug)]">
                      <span className={cn(dsText.meta, dsText.nums, "shrink-0 text-[color:var(--ds-fg-faint)]")}>
                        {fmtClock(note.at)}
                      </span>
                      <Badge tone={FROZEN_LEVEL_TONE[note.level]}>{note.level}</Badge>
                      <span className={cn(dsText.body, "min-w-0 break-words text-[color:var(--ds-fg)]")}>
                        {note.message}
                      </span>
                    </div>
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
                      {sections.captures.value.map((tile) => <CaptureTileRow key={tile.artifactId} tile={tile} />)}
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

const FROZEN_LEVEL_TONE = {
  info: "neutral",
  warning: "warning",
  error: "danger",
} as const satisfies Record<"info" | "warning" | "error", "neutral" | "warning" | "danger">;

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
 * capture's real aspect ratio — never a drawn approximation of the page, which
 * is the one thing an evidence surface may not produce. The archived record
 * carries no bytes and this surface reads none.
 */
function CaptureTileRow({ tile }: { tile: ArchivedCaptureTile }) {
  return (
    <div className="flex min-w-0 items-start gap-[var(--ds-space-snug)]">
      <span
        className={cn(
          "flex w-[96px] shrink-0 items-center justify-center border",
          dsRadius.sm,
          "border-[color:var(--ds-border)] bg-[color:var(--ds-bg-inset)]",
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
        <span className="flex flex-wrap items-center gap-[var(--ds-space-hair)]">
          <Badge tone={tile.origin === "operator-request" ? "neutral" : "danger"}>{tile.kind}</Badge>
          <span className={cn(dsText.body, "truncate text-[color:var(--ds-fg)]")}>
            {tile.step.state === "present" ? tile.step.nodeId : "step unrecorded"}
          </span>
          {tile.system.state === "present" && <Chip label="system">{tile.system.value}</Chip>}
        </span>
        <MetaLine
          items={[
            fmtClock(tile.capturedAt),
            tile.origin,
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
  busy,
  onCancel,
  onConfirm,
}: {
  authoring: BumpAuthoring | undefined;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (authoring: BumpAuthoring, changeRecord: VersionBumpChangeRecord) => void;
}) {
  const [kind, setKind] = useState<"major" | "minor">("minor");
  const [what, setWhat] = useState("");
  const [why, setWhy] = useState("");
  const [commit, setCommit] = useState("");

  useEffect(() => {
    if (authoring === undefined) return;
    setKind("minor");
    setWhat("");
    setWhy("");
    setCommit("");
  }, [authoring]);

  const trimmedCommit = commit.trim();
  const composed = authoring === undefined
    ? undefined
    : VersionBumpChangeRecordSchema.safeParse({
      kind,
      what: what.trim(),
      why: why.trim(),
      commit: trimmedCommit === ""
        ? { state: "absent", reason: "the operator recorded no commit for this bump" }
        : { state: "present", value: trimmedCommit },
    });

  return (
    <Dialog open={authoring !== undefined} onOpenChange={(open) => { if (!open) onCancel(); }}>
      {authoring !== undefined && (
        <DialogContent
          size="lg"
          title={`Bump ${authoring.title}`}
          description="Every prior-version run leaves the live surfaces in one act. What moved, and why, is recorded with it — that is the question the archive exists to answer later."
        >
          <DialogBody className="flex flex-col gap-[var(--ds-space-base)]">
            <Field label="Kind" description="MAJOR is a shape change; MINOR is behaviour inside the same shape.">
              <Select value={kind} onChange={(event) => setKind(event.target.value === "major" ? "major" : "minor")}>
                <option value="minor">minor — behaviour changed</option>
                <option value="major">major — the shape changed</option>
              </Select>
            </Field>
            <Field label="What moved" required hint={`${String(what.trim().length)}/200`}>
              <Input
                value={what}
                maxLength={200}
                placeholder="the CRM cross-check tolerates a middle initial"
                onChange={(event) => setWhat(event.target.value)}
              />
            </Field>
            <Field
              label="Why"
              required
              description="The half nobody can reconstruct from a diff."
              hint={`${String(why.trim().length)}/1000`}
            >
              <Textarea
                rows={3}
                value={why}
                maxLength={1000}
                placeholder="three subjects a week were parking on a name mismatch that was not one"
                onChange={(event) => setWhy(event.target.value)}
              />
            </Field>
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
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              disabled={composed === undefined || !composed.success}
              onClick={() => {
                if (composed?.success === true) onConfirm(authoring, composed.data);
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
            {(detail.evidence.writeIntentIds.length > 0 || detail.ledger.length > 0) && (
              <Banner
                tone="danger"
                title={`This run already filed ${plural(Math.max(detail.evidence.writeIntentIds.length, detail.ledger.length), "record")} in a real system`}
                icon={<TriangleAlert aria-hidden className={dsIcon.lg} />}
              >
                <span className="flex flex-col gap-[var(--ds-space-snug)]">
                  <span className={dsText.body}>
                    A relaunch does not know about them. If the work still stands, this files it a second time.
                  </span>
                  <Well>
                    <ul className="flex flex-col gap-[var(--ds-space-hair)]">
                      {/*
                        The SAME resolved rows the Write-ledger card renders, so
                        the danger banner and the evidence tab can never name
                        different transactions. A pointer that did not resolve
                        still appears: "we cannot read what this filed" is a
                        stronger reason to hesitate than a short list.
                      */}
                      {detail.ledger.map((line) => (
                        <li
                          key={`${line.pointer.system}-${line.pointer.date}-${String(line.pointer.sequence)}`}
                          className={cn(dsText.body, "flex min-w-0 items-baseline gap-[var(--ds-space-snug)]")}
                        >
                          <span className={cn(dsText.caps, "w-[80px] shrink-0 text-[color:var(--ds-fg-muted)]")}>
                            {line.pointer.system}
                          </span>
                          <span
                            className="min-w-0 flex-1 truncate text-[color:var(--ds-fg)]"
                            title={line.state === "unresolved" ? line.reason : line.idempotencyKey}
                          >
                            {line.state === "resolved"
                              ? line.idempotencyKey
                              : `ledger ${line.pointer.date} — ${line.failure.replace(/-/gu, " ")}`}
                          </span>
                          <span className={cn(dsText.nums, "shrink-0 text-[color:var(--ds-fg-muted)]")}>
                            line {line.pointer.sequence}
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

  /**
   * The bump is authored, not clicked. Charter §25 records WHAT moved and WHY
   * in the same act that archives the runs, and the person clicking Bump is
   * the person who made the change — so the question is asked here rather than
   * left to whoever reads the archive six months later, who cannot answer it.
   */
  const [authoring, setAuthoring] = useState<BumpAuthoring | undefined>(undefined);

  const submitPlan = useCallback(
    (authored: BumpAuthoring, changeRecord: VersionBumpChangeRecord) => {
      setAuthoring(undefined);
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

          <BumpChangeRecordDialog
            authoring={authoring}
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
          // "Applied" is the ONE fold's verdict (D253, Track D row D3) — a
          // re-read triggered by a refused command would show the operator an
          // unchanged index as though it were the result of their click.
          if (settleCommandResult(next).kind === "applied") setNonce((value) => value + 1);
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
        relaunched={
          relaunched === detail.value.runId
          && result !== undefined
          && settleCommandResult(result).kind === "applied"
        }
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
