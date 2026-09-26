import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronRight,
  Database,
  FileText,
  Info,
  ScrollText,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import type { z } from "zod";
import { cn } from "../../lib/utils.js";
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  EmptyState,
  SearchInput,
  Skeleton,
  dsBorder,
  dsClip,
  dsFocus,
  dsIcon,
  dsMotion,
  dsRadius,
  dsText,
} from "../../ds/ui.js";
import type { ActionDescriptorWire } from "../../../domain/dashboard/actions.js";
import type { CapabilityAvailabilitySchema } from "../../../domain/absence.js";
import type { LogRowWire, NotePageSchema, RunDetailSectionResponseSchema, RunDetailWireSchema } from "../../../domain/dashboard/run-detail.js";
import type { DashboardActionHandler } from "../actions.js";
import { InlineDecision, InlineGateDecisionRecord } from "./gate-park.js";
import { InlineFailureRecord } from "./receipt-failure.js";
import { InlineParkedWrite, type ParkedWritePayload } from "../park-resolve.js";
import { fmtClock, plural } from "../format.js";
import { RunCaptures } from "../run-captures.js";
import type { RunCapturesState } from "../run-captures-model.js";
import { RunProvenanceBar, type QueueSurfaceWire } from "../run-identity.js";
import type { BrowserSystemId } from "../system-chip-model.js";
import { SystemChip } from "../system-chip.js";
import { DashboardClientError } from "../../client/index.js";
import { useDashboardClient } from "../../state/client-context.js";
import {
  groupLogRows,
  logLedgerOf,
  logPillsOf,
  logRowsOf,
  rowMatchesLogQuery,
  useLogPages,
  type LogLedgerFact,
  type LogLedgerSection,
  type LogRowGroup,
} from "./logs-model.js";

type RunDetailWire = z.infer<typeof RunDetailWireSchema>;
type RunDetailSectionResponse = z.infer<typeof RunDetailSectionResponseSchema>;
type NotePage = z.infer<typeof NotePageSchema>;
type LogRow = LogRowWire;
type FailurePayload = Extract<RunDetailSectionResponse, { section: "failure" }>['payload'];
type CapabilityAvailability = z.infer<typeof CapabilityAvailabilitySchema>;

const NOTE_TONE: Record<NotePage["notes"][number]["level"], string> = {
  info: "text-[color:var(--ds-fg-secondary)]",
  warning: "text-[color:var(--ds-status-waiting-fg)]",
  error: "text-[color:var(--ds-danger)]",
};

const NOTE_ICON: Record<NotePage["notes"][number]["level"], typeof Info> = {
  info: Info,
  warning: TriangleAlert,
  error: TriangleAlert,
};

/**
 * WHERE AN INLINE SURFACE HANGS. The demo's fixtures flagged their own dying
 * line; a served note page carries no such marker, so the anchor is the
 * server's own clock: the block lands after the last note at or before the
 * instant the gate opened / the run ended. That is an ORDERING derived from two
 * served timestamps, not a fabricated fact — and a block whose instant precedes
 * every note (or whose page is empty) still renders, at the top or the end. A
 * served record is NEVER dropped for want of a place to put it.
 */
function logRowAt(row: LogRow): string {
  return row.kind === "note" ? row.note.at : row.at;
}

function anchorIndex(rows: readonly LogRow[], at: string): number {
  let index = -1;
  for (const [position, row] of rows.entries()) {
    if (logRowAt(row) <= at) index = position;
  }
  return index;
}

/**
 * THE OBSERVED LEDGER (2026-09-01 redesign). An observed row used to render one
 * bordered chip per fact, each carrying its own direction icon, the full
 * `field · key` label and, for a served list, the raw JSON; with `attempt N`
 * and the system chip repeated on every row. Twelve facts became twelve
 * boxes and the stream stopped being readable. Now:
 *
 *  - facts are a two-column key · value grid, keys in the meta tone on a
 *    `--ds-w-chip-cell` track, values in `dsText.nums`;
 *  - the direction is stated ONCE per section — a 2px rail in the direction's
 *    border token plus a caps label in its text token — instead of an icon
 *    per fact (the parity spec reads the token colour off that label);
 *  - a nested field is a caps sub-head over keys shown without the repeated
 *    field prefix; a field that IS its single key is a plain row;
 *  - a served list renders as a Radix Collapsible: a count plus a clipped
 *    preview closed, one item per line open. The full rendered value stays
 *    on the row's `title`, exactly the string the chip used to carry, so
 *    nothing the old surface exposed is lost;
 *  - the clock and attempt sit on one meta line at the row's top, and the
 *    system chip moved up to the sticky producer heading (`groupSystemOf`).
 */
function LedgerValue({ fact }: { fact: LogLedgerFact }) {
  if (fact.items === undefined) {
    return <span className={cn(dsText.body, dsText.nums, "break-all text-[color:var(--ds-fg)]")}>{fact.value}</span>;
  }
  return (
    <Collapsible className="group min-w-0">
      <CollapsibleTrigger
        className={cn(
          "flex min-w-0 cursor-pointer items-center gap-[var(--ds-space-snug)] text-left",
          dsRadius.xs,
          dsFocus,
        )}
      >
        <span className={cn(dsText.meta, dsText.nums, "shrink-0 text-[color:var(--ds-fg-secondary)]")}>
          {fact.items.length} {fact.items.length === 1 ? "value" : "values"}
        </span>
        <span className={cn(dsText.meta, dsClip.text, "text-[color:var(--ds-fg-muted)] group-data-[state=open]:hidden")}>
          {fact.items.join(" · ")}
        </span>
        <ChevronRight
          aria-hidden
          className={cn(dsIcon.sm, "shrink-0 text-[color:var(--ds-fg-muted)]", dsMotion.base, "group-data-[state=open]:rotate-90")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent><ul className="m-0 flex list-none flex-col gap-[var(--ds-space-hair)] p-0 pt-[var(--ds-space-tight)]">
        {fact.items.map((item, index) => (
          <li key={`${String(index)}:${item}`} className={cn(dsText.body, dsText.nums, "break-all text-[color:var(--ds-fg)]")}>
            {item}
          </li>
        ))}
      </ul></CollapsibleContent>
    </Collapsible>
  );
}

function LedgerSection({ section }: { section: LogLedgerSection }) {
  const read = section.direction === "read";
  const Icon = read ? ArrowDownToLine : ArrowUpFromLine;
  return (
    <div
      className={cn(
        "grid min-w-0 items-baseline gap-x-[var(--ds-space-cozy)] gap-y-[var(--ds-space-hair)] border-l-2 pl-[var(--ds-space-cozy)]",
        "grid-cols-[minmax(0,var(--ds-w-chip-cell))_minmax(0,1fr)]",
        read ? "border-l-[color:var(--ds-read-border)]" : "border-l-[color:var(--ds-write-border)]",
      )}
    >
      <span
        className={cn(
          dsText.caps,
          "col-span-full flex items-center gap-[var(--ds-space-tight)]",
          read ? "text-[color:var(--ds-read-fg)]" : "text-[color:var(--ds-write-fg)]",
        )}
      >
        <Icon aria-hidden className={dsIcon.sm} />
        {section.direction}
      </span>
      {section.fields.map((field, fieldIndex) => (
        <Fragment key={`${field.field}:${String(fieldIndex)}`}>
          {field.nested && (
            <span className={cn(dsText.caps, "col-span-full pt-[var(--ds-space-tight)] text-[color:var(--ds-fg-muted)]")}>
              {field.field}
            </span>
          )}
          {field.facts.map((fact, factIndex) => (
            <Fragment key={`${fact.label}:${String(factIndex)}`}>
              <span
                className={cn(dsText.meta, "min-w-0 break-words text-[color:var(--ds-fg-muted)]", field.nested && "pl-[var(--ds-space-base)]")}
              >
                {fact.key}
              </span>
              <span title={`${fact.label}: ${fact.value}`} className="min-w-0">
                <LedgerValue fact={fact} />
              </span>
            </Fragment>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * The one browser system a producer group can truthfully name in its sticky
 * heading. Every observed row in a group shares its `(step, taskId)` producer
 * and the Logs query resolves a system per exact origin, so the rows agree;
 * a group whose rows disagree is a composition defect and is named, never
 * averaged. A group with no observed row, or a service origin, has none.
 */
function groupSystemOf(group: LogRowGroup): BrowserSystemId | undefined {
  const systems = new Set<BrowserSystemId | undefined>();
  for (const row of group.rows) {
    if (row.kind !== "note") systems.add(row.producer.system);
  }
  if (systems.size > 1) {
    throw new Error(`log producer group ${group.label ?? "(notes)"} names ${String(systems.size)} browser systems; a group has one producer`);
  }
  return [...systems][0];
}

function logIconOf(row: LogRow): { readonly Icon: typeof Info; readonly tone: string } {
  if (row.kind === "note") {
    return { Icon: NOTE_ICON[row.note.level], tone: NOTE_TONE[row.note.level] };
  }
  if (row.kind === "transaction-fenced") {
    return { Icon: ShieldCheck, tone: "text-[color:var(--ds-fg-muted)]" };
  }
  const directions = new Set(row.points.map((point) => point.direction));
  if (directions.size !== 1) return { Icon: Database, tone: "text-[color:var(--ds-fg-muted)]" };
  const direction = [...directions][0];
  return direction === "read"
    ? { Icon: ArrowDownToLine, tone: "text-[color:var(--ds-read-fg)]" }
    : { Icon: ArrowUpFromLine, tone: "text-[color:var(--ds-write-fg)]" };
}

function logRowLabel(row: LogRow): string {
  if (row.kind === "note") {
    const fields = (row.note.fields ?? []).map((field) => `${field.key}: ${String(field.value)}`).join("; ");
    return `${fmtClock(row.note.at)}: ${row.note.level} note: ${row.note.message}${fields ? `. ${fields}` : ""}`;
  }
  if (row.kind === "transaction-fenced") {
    return `${fmtClock(row.at)}: authority transaction fence at ${row.producer.step}, attempt ${String(row.attempt)}`;
  }
  const directions = [...new Set(row.points.map((point) => point.direction))].join(", ");
  const facts = logPillsOf(row).map((pill) => `${pill.label}: ${pill.value}`).join("; ");
  const system = row.producer.system === undefined ? "" : `, system ${row.producer.system}`;
  return `${fmtClock(row.at)}: observed at ${row.producer.step}, ${row.producer.taskId}${system}, directions ${directions}, attempt ${String(row.attempt)}. ${facts}`;
}

function LogLine({ row, dim, hit }: { row: LogRow; dim: boolean; hit: boolean }) {
  if (row.kind === "observed") {
    return (
      <div
        role="listitem"
        aria-label={logRowLabel(row)}
        className={cn(
          "flex min-w-0 flex-col gap-[var(--ds-space-tight)] px-[var(--ds-space-cozy)] py-[var(--ds-space-tight)]",
          hit && cn(dsRadius.xs, "bg-[var(--ds-info-bg)]"),
          dim && "opacity-35",
        )}
      >
        <span className={cn(dsText.meta, dsText.nums, "flex items-center gap-[var(--ds-space-base)] text-[color:var(--ds-fg-muted)]")}>
          <span>{fmtClock(row.at)}</span>
          <span>attempt {row.attempt}</span>
        </span>
        {logLedgerOf(row).map((section, index) => (
          <LedgerSection key={`${section.direction}:${String(index)}`} section={section} />
        ))}
      </div>
    );
  }
  const { Icon, tone } = logIconOf(row);
  const note = row.kind === "note" ? row.note : undefined;
  const at = row.kind === "note" ? row.note.at : row.at;
  return (
    <div
      role="listitem"
      aria-label={logRowLabel(row)}
      className={cn(
        "flex min-w-0 items-start gap-[var(--ds-space-snug)] px-[var(--ds-space-cozy)] pl-5 py-[var(--ds-space-hair)]",
        dim && "opacity-35",
      )}
    >
      <span className={cn(dsText.micro, dsText.nums, "mt-[var(--ds-space-hair)] shrink-0 text-[color:var(--ds-fg-muted)]")}>
        {fmtClock(at)}
      </span>
      <span className="mt-[var(--ds-space-hair)] w-3.5 shrink-0 text-center">
        <Icon aria-hidden className={cn(dsIcon.sm, tone)} />
      </span>
      <span className={cn(dsText.body, "min-w-0 break-words", note !== undefined && NOTE_TONE[note.level], hit && cn(dsRadius.xs, "bg-[var(--ds-info-bg)]"))}>
        {note !== undefined && <>
          {note.message}
          {(note.fields ?? []).length > 0 && <span className={cn(dsText.meta, "mt-[var(--ds-space-hair)] block text-[color:var(--ds-fg-muted)]")}>
            {note.fields?.map((field) => `${field.key}: ${String(field.value)}`).join(" · ")}
          </span>}
        </>}
        {row.kind === "transaction-fenced" && (
          <>
            <span className="text-[color:var(--ds-fg-secondary)]">Authority fence</span>
            <span className={cn(dsText.meta, dsText.nums, "ml-[var(--ds-space-base)] text-[color:var(--ds-fg-muted)]")}>attempt {row.attempt}</span>
          </>
        )}
      </span>
    </div>
  );
}

/**
 * THE LIVENESS DOT (D273 item 4, ledger 2 rows A49/B87 —
 * `DemoLogPanel.tsx:1183`). The stream above has no other cue for "lines are
 * still arriving": an idle run and a working one whose next line is a minute
 * away look identical, so the operator waits on a stream that finished.
 * `surface.status` is the LIVE day-stream status, which is what makes this a
 * liveness cue rather than a restatement of the detail fetch's last word
 * (D256).
 *
 * It was `aria-hidden` over two shades of the SAME neutral token — the running
 * mark is deliberately grey (`--ds-status-running-mark` ladder, see
 * `tokens.css`: "Running... the only status whose icon moves, and the only
 * differentiator it needs"), so an operator relying on colour alone could not
 * tell a live stream from an idle one either. The house pattern for a
 * hue-blind status cue is the one `DirectionRail` already uses beside it in
 * this bundle: keep the colour, add the MOVEMENT the running row's own dot
 * already carries (the pulse, same as the timeline's `active` mark), and
 * pair an `sr-only` word so the fact survives no colour and no motion at all.
 *
 * Exported for the F6b render pin
 * (`tests/unit/dashboard/run-detail-decision-cue.test.ts`): a colour-and-motion
 * state has no fold to see whether the component composed the matching word.
 */
export function RunLivenessDot({ status }: { status: QueueSurfaceWire["status"] }) {
  const live = status === "running";
  return (
    <span className="inline-flex shrink-0 items-center">
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          live
            ? "animate-pulse bg-[var(--ds-status-running-mark)] motion-reduce:animate-none"
            : "bg-[var(--ds-fg-faint)]",
        )}
      />
      <span className="sr-only">{live ? "live" : "idle"}</span>
    </span>
  );
}

export function LogsTab({
  detail,
  captures,
  notes,
  failure,
  parked,
  gateActions,
  onResolveGate,
  onResolvePark,
  decisionRef,
  failureRef,
  parkedRef,
  surface,
  workflowLabel,
  currentAppVersion,
  servedDescriptorHash,
  aiAdvisory,
  nowIso,
  actorId,
}: {
  detail: RunDetailWire;
  captures: RunCapturesState | undefined;
  notes: NotePage | undefined;
  failure: FailurePayload | undefined;
  parked: ParkedWritePayload | undefined;
  gateActions: readonly ActionDescriptorWire[];
  /**
   * The gate's own resolutions open the ceremony dialog (D226). They do NOT
   * ride the panel's generic action handler: two of the four ceremonies need a
   * value no served fact carries, and a generic dispatch could only compose the
   * one that does not — which is the one-click downgrade §14.6 risk 1 names.
   */
  onResolveGate: DashboardActionHandler;
  onResolvePark: DashboardActionHandler;
  decisionRef: (node: HTMLElement | null) => void;
  failureRef: (node: HTMLElement | null) => void;
  parkedRef: (node: HTMLElement | null) => void;
  surface?: QueueSurfaceWire;
  workflowLabel: string;
  currentAppVersion: string;
  servedDescriptorHash: string | undefined;
  aiAdvisory: CapabilityAvailability;
  /** The served instant (D256) — the decision card's age and the live dot. */
  nowIso: string;
  actorId: string;
}) {
  const client = useDashboardClient();
  const [query, setQuery] = useState("");
  useEffect(() => setQuery(""), [detail.runId]);

  const loadNext = useCallback(async (cursor: string): Promise<NotePage> => {
    const response = await client.runSection(detail.runId, "logs", cursor);
    if (response.section !== "logs") throw new Error(`logs pagination returned ${response.section}, not logs`);
    return response.payload;
  }, [client, detail.runId]);
  const paged = useLogPages(notes, loadNext);
  const lines = useMemo(() => logRowsOf(paged.page, "current"), [paged.page]);
  const trimmed = query.trim().toLowerCase();
  const matches = useCallback(
    (row: LogRow): boolean => rowMatchesLogQuery(row, trimmed),
    [trimmed],
  );
  const matchCount = trimmed.length > 0 ? lines.filter(matches).length : 0;
  const groups = useMemo(() => groupLogRows(lines), [lines]);
  const lineIndex = useMemo(() => new Map(lines.map((row, index) => [row.logId, index])), [lines]);

  const gate = detail.gate;
  const decisionAt = gate.state === "open" ? anchorIndex(lines, gate.openedAt) : undefined;
  // D237: the settled decision's own instant. The two gate anchors are mutually
  // exclusive by the wire's union, so they can never both draw.
  const gateRecordAt = gate.state === "resolved" ? anchorIndex(lines, gate.resolvedAt) : undefined;
  const failureAt =
    failure !== undefined && detail.outcome.state === "terminal" && detail.outcome.result === "failed"
      ? anchorIndex(lines, detail.outcome.completedAt)
      : undefined;
  // The park's own instant, off the served section — the run stopped when the
  // kernel parked it, which is not the same moment as any line in the stream.
  const parkedAt = parked === undefined ? undefined : anchorIndex(lines, parked.parkedAt);
  const errorNotes = lines.flatMap((row) => row.kind === "note" && row.note.level === "error" ? [row.note] : []);

  const decision =
    gate.state === "open" ? (
      <InlineDecision
        gate={gate}
        actions={gateActions}
        runId={detail.runId}
        onAction={onResolveGate}
        anchorRef={decisionRef}
        nowIso={nowIso}
      />
    ) : null;
  const gateRecord =
    gate.state === "resolved" ? <InlineGateDecisionRecord gate={gate} /> : null;
  const failureRecord =
    failure !== undefined && failureAt !== undefined ? (
      <InlineFailureRecord
        liveContext={{ actorId, nowIso }}
        failure={failure}
        errorNotes={errorNotes}
        {...(detail.outcome.state === "terminal" ? { completedAt: detail.outcome.completedAt } : {})}
        anchorRef={failureRef}
        runId={detail.runId}
        aiAdvisory={aiAdvisory}
      />
    ) : null;
  const parkedRecord =
    parked !== undefined ? (
      <InlineParkedWrite parked={parked} onResolve={onResolvePark} anchorRef={parkedRef} />
    ) : null;

  return (
    <>
      {/* NO SCROLLER OF ITS OWN. The panel body is one region, so the stream is
          plain content in it and the track beside it runs the whole panel. */}
      <div className="flex flex-1 flex-col pb-[var(--ds-space-base)] pt-[var(--ds-space-tight)]">
        {decisionAt === -1 && decision}
        {gateRecordAt === -1 && gateRecord}
        {failureAt === -1 && failureRecord}
        {parkedAt === -1 && parkedRecord}
        {notes === undefined ? (
          <div className="space-y-[var(--ds-space-snug)] px-[var(--ds-space-cozy)] py-[var(--ds-space-base)]" aria-label="Loading logs" aria-busy="true">
            <Skeleton className="h-[var(--ds-h-row)] w-full" />
            <Skeleton className="h-[var(--ds-h-row)] w-4/5" />
          </div>
        ) : lines.length === 0 ? (
          <EmptyState
            icon={<FileText aria-hidden className={dsIcon.lg} />}
            title="No log lines yet"
            description="Lines appear here as the run works. Nothing has been recorded for this run."
          />
        ) : trimmed.length > 0 && matchCount === 0 ? (
          <EmptyState
            icon={<ScrollText aria-hidden className={dsIcon.lg} />}
            title="No matching log lines"
            description="Try a different search."
            action={<Button variant="ghost" size="sm" onClick={() => setQuery("")}>Clear search</Button>}
          />
        ) : (
          <div role="list" aria-label="Run log lines">
            {groups.map((group, groupIndex) => {
              const groupSystem = groupSystemOf(group);
              return (
              <div key={`${group.label ?? "note"}:${String(groupIndex)}`}>
                {group.label !== undefined && (
                  <div
                    role="heading"
                    aria-level={3}
                    className={cn(
                      "sticky top-[var(--ds-panel-head-h,0px)] flex items-center gap-[var(--ds-space-snug)]",
                      "bg-[var(--ds-surface-1)] px-[var(--ds-space-cozy)] pb-[var(--ds-space-tight)] pt-[var(--ds-space-base)]",
                      dsText.meta,
                      "font-semibold text-[color:var(--ds-fg-secondary)]",
                    )}
                  >
                    <span className="min-w-0 break-words">{group.label}</span>
                    {groupSystem !== undefined && <SystemChip system={groupSystem} className="mr-0" />}
                    <span aria-hidden className="h-px min-w-0 flex-1 bg-[var(--ds-border-subtle)]" />
                  </div>
                )}
                {group.rows.map((row) => {
                  const index = lineIndex.get(row.logId);
                  if (index === undefined) throw new Error(`log row ${String(row.logId)} is absent from its own grouped sequence`);
                  const hit = matches(row);
                  const dim = trimmed.length > 0 && !hit;
                  return (
                    <div key={row.logId}>
                      <LogLine row={row} hit={hit} dim={dim} />
                      {decisionAt === index && decision}
                      {gateRecordAt === index && gateRecord}
                      {failureAt === index && failureRecord}
                      {parkedAt === index && parkedRecord}
                    </div>
                  );
                })}
              </div>
              );
            })}
          </div>
        )}
        {paged.error !== undefined && (
          <div role="alert" className={cn(dsText.meta, "px-5 py-[var(--ds-space-tight)] text-[color:var(--ds-danger)]")}>
            {paged.error instanceof DashboardClientError && paged.error.code !== undefined
              ? `${paged.error.code}: ${paged.error.message}`
              : paged.error.message}
          </div>
        )}
        {paged.page?.nextCursor.state === "present" && (
          <div className="px-5 py-[var(--ds-space-tight)]">
            <Button
              variant="ghost"
              size="sm"
              className="min-h-0 min-w-0"
              onClick={paged.loadMore}
              disabled={paged.loading}
              aria-busy={paged.loading || undefined}
            >
              {paged.loading ? "Loading more lines…" : "Load more lines"}
            </Button>
          </div>
        )}
        {captures !== undefined && <RunCaptures captures={captures} compact />}
      </div>

      {/* Pinned to the FLOOR of the same scroller, not parked below it: a
          search you have to scroll a 400-line stream to reach is a search
          nobody uses, and a bar outside the region would cut the track short. */}
      <div
        className={cn(
          "sticky bottom-0 mt-auto flex flex-wrap items-center gap-[var(--ds-space-snug)] border-t",
          dsBorder.subtle,
          "bg-[var(--ds-surface-1)] px-[var(--ds-space-cozy)] py-[var(--ds-space-snug)]",
        )}
      >
        {/*
          THE DEMO'S GEOMETRY, in the design system's control (D273 item 3,
          ledger 2 row B83 — `DemoLogPanel.tsx:1148-1157`). `w-40` is the demo's
          own width; the primitive and its `onClear` stay, because DESIGN.md's
          two-renderers rule forbids a second hand-rolled search field beside
          the one every other surface uses, and a clear affordance takes nothing
          away from the operator who never presses it.
        */}
        <SearchInput
          aria-label="Search logs"
          placeholder="Search logs…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery("")}
          className="w-40"
        />
        {trimmed.length > 0 && (
          <span className={cn(dsText.meta, dsText.nums, "text-[color:var(--ds-fg-muted)]")}>
            {plural(matchCount, "match", "matches")}
          </span>
        )}
        {surface !== undefined && (
          <span className="ml-auto inline-flex items-center gap-[var(--ds-space-snug)]">
            {/* The run's PROVENANCE sits on the bar under its own stream: the
                workflow version qualifies every line above it. */}
            <span aria-hidden className="h-[var(--ds-h-xs)] w-px shrink-0 bg-[var(--ds-border)]" />
            <RunProvenanceBar
              surface={surface}
              workflowLabel={workflowLabel}
              currentAppVersion={currentAppVersion}
              servedDescriptorHash={servedDescriptorHash}
            />
            <RunLivenessDot status={surface.status} />
          </span>
        )}
      </div>
    </>
  );
}
