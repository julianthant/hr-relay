/**
 * Read-only run Context rail. Data values, checkpoint coordinates and
 * provenance come from the exact selected run; attempt history comes from the
 * bounded item-history query.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Database,
  Info,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { cn } from "../lib/utils.js";
import {
  Badge,
  BulletList,
  EmptyState,
  IconButton,
  LockedValue,
  Button,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  SectionLabel,
  Separator,
  Well,
  dsIcon,
  dsText,
} from "../ds/ui.js";


import { fmtClock, plural } from "./format.js";
import { SystemChip } from "./system-chip.js";
import { logLedgerOf } from "./run-detail/logs-model.js";
import type { LogLedgerFact } from "./run-detail/logs-model.js";
import { actionsAt, type ActionDescriptorWire } from "../../domain/dashboard/actions.js";
import { ITEM_ATTEMPT_HISTORY_MAX_LIMIT,
  type ItemAttemptHistoryResponse, type ItemAttemptHistoryRun } from "../../domain/dashboard/item-attempt-history.js";
import { useDashboardClient } from "../state/client-context.js";
import { parseRoute, routeForCrossDateSearchResult, routeToSearch } from "../app/url-state.js";
import type { DashboardActionHandler, ActionTarget } from "./actions.js";
import {
  freshnessNoteOf,
  groupEntriesByStep,
  type ContextDataEntry,
  type ContextDataPayload,
  type ContextRailState,
  type ContextSectionKind,
  type ContextSectionPayload,
  type ContextSections,
  type ContextSummary,
} from "./context-rail-model.js";

export type {
  ContextDataEntry,
  ContextDataPayload,
  ContextRailState,
  ContextSectionKind,
  ContextSectionPayload,
  ContextSections,
  ContextSummary,
};

/* the rail's wire types live in `context-rail-model.ts` — see the note there */

/** The two refusal arms of the D253 fold, which are the only ones this rail draws. */

function isDataPayload(payload: ContextSectionPayload): payload is ContextDataPayload {
  return "state" in payload;
}

// ---------------------------------------------------------------------------
// open / collapsed, persisted
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// one recorded value
// ---------------------------------------------------------------------------

/**
 * ONE value the run recorded, in TWO vertical levels: label → value.
 *
 *     ▌ Selection                ← the label, quiet, its own line
 *     ▌ 🔒 matched — 1 candidate  ← the value, on its own line, full width
 *
 * WHY IT STACKS (operator, 2026-07-27: "have the step, have the sub step and
 * below that put the data extracted. not the substep and data in one line").
 * Sharing one line makes the label and the value compete for the same pixels,
 * and the value loses — and a clipped VALUE is the one thing on the row that
 * cannot be recovered from anywhere else on the surface.
 *
 * The value renders by POLICY (DESIGN.md: "you may change this" and "you may
 * not" are told apart by SHAPE): a locked row is flat text with a lock and the
 * Source values always render as read-only values.
 */
/**
 * WHEN a value was established, and by WHAT — the demo's Data-ledger axis, in
 * exactly the arms this wire now serves (W2).
 *
 * It reads `-muted` rather than `-faint`: `-faint` is the disabled/placeholder
 * step and a real observation is neither.
 *
 * A label may truncate; a recorded timestamp stays visible so the operator can
 * read when the value was observed.
 */
function ProvenanceMarks({ entry }: { entry: ContextDataEntry }) {
  const { observedAt, source, correctedAt, assertedStep } = entry;
  if (observedAt === undefined && source === undefined && correctedAt === undefined && assertedStep === undefined) {
    return null;
  }
  return (
    <>
      {/* `info`, not `warning` (R6 f.10, demo `DemoContextRail.tsx:363-371`): a
          correction is a RECORDED FACT about this value, not a hazard about it.
          Amber on this line put it in the same register as `changed` and
          `staged`, which are unsaved and unsubmitted respectively — states the
          operator must still act on. This one is settled.

          And the instant is CLOCKED, never raw ISO: an operator-facing title
          reading `2026-08-12T14:03:11.284Z` is a machine's answer to a human's
          question, and `fmtClock` was already imported two lines above. */}
      {correctedAt !== undefined && (
        <Badge
          tone="info"
          className="shrink-0"
          title={`Corrected by an operator at ${fmtClock(correctedAt)}. The run's own reading is kept beside it on the receipt.`}
        >
          corrected
        </Badge>
      )}
      {/* D307 — the operator OMITTED this value's step at start and typed the
          facts its producer rebuilt this value from. It is operator-sourced
          with no correction, so the `corrected` badge above does not cover it
          and the note below no longer holds for every operator arm: without
          this badge an asserted value would draw exactly like one a task read
          from a live system, with a clock beside it and nothing saying nobody
          looked. The step is named because it is the fact that makes the row
          checkable against the run's own start. */}
      {assertedStep !== undefined && (
        <Badge
          tone="warning"
          className="shrink-0"
          title={`No system was read for this value: the operator omitted the "${assertedStep}" step at start and typed the facts it was rebuilt from. The instant beside it is when it was asserted, not when anything was observed.`}
        >
          asserted
        </Badge>
      )}
      {/* `live` is the unmarked default — it is what most rows are, and a badge
          on every row is a badge on none. `derived` earns one because a
          computed value's clock is not a live observation of anything.

          THE `operator` ARM DRAWS NO BADGE OF ITS OWN, and that is deliberate
          rather than unhandled (R6 f.23). Until D307 an operator-sourced value
          was exactly a value carrying `correctedAt`, which the `corrected`
          badge above already says; D307 added the second operator arm — an
          ASSERTED value — and it draws its own badge above, naming the omitted
          step. Either way the word is said once.

          There is no THIRD operator arm to draw, and that is a wire invariant
          rather than an assumption this file makes on its own:
          `ContextDataSectionSchema` REFUSES an `operator` entry carrying
          neither `correctedAt` nor `assertedStep`, because such a leaf would
          arrive here unmarked with a clock beside it — a value nobody read,
          drawn exactly like one a task observed. If that refusal is ever
          relaxed, this comment is the one that has to change with it. */}
      {source === "derived" && (
        <Badge
          className="shrink-0"
          title="Computed by the run from other recorded values, not read from a system."
        >
          derived
        </Badge>
      )}
      {observedAt !== undefined && (
        <span
          title={observedAt}
          className={cn(dsText.micro, dsText.nums, "shrink-0 text-[color:var(--ds-fg-muted)]")}
        >
          {fmtClock(observedAt)}
        </span>
      )}
    </>
  );
}

const LEDGER_LABEL_CLASS = cn(
  dsText.body,
  dsText.flush,
  "min-w-0 flex-1 truncate font-medium text-[color:var(--ds-fg-secondary)]",
);

/**
 * D252 — the direction of ONE value, said twice: a colour AND an arrow.
 *
 * The colour is the point. Direction carried by a glyph alone means a ledger
 * of eight reads and one write looks like nine of the same thing, and the one
 * line that changed the world is the hardest to find; `--ds-read-*` /
 * `--ds-write-*` are the two-tone axis, and the RAIL is what makes it
 * scannable down a column. The arrow stays because colour is never the only
 * differentiator — it is the arrow that survives forced-colors and a
 * colour-blind operator, and the `sr-only` word that survives no colour at all.
 *
 * `dir === undefined` keeps the neutral rail: an entry the build cannot
 * attribute has no direction, and defaulting one to `read` would be a claim
 * that the run did not change anything.
 */
function DirectionRail({ dir }: { dir: "read" | "write" | undefined }) {
  if (dir === undefined) {
    return (
      <span
        aria-hidden
        className={cn(
          "w-[var(--ds-border-w-emphasis)] shrink-0 self-stretch rounded-[var(--ds-radius-pill)]",
          "bg-[var(--ds-border-strong)]",
        )}
      />
    );
  }
  const read = dir === "read";
  const Icon = read ? ArrowDownToLine : ArrowUpFromLine;
  return (
    <span className="flex shrink-0 gap-[var(--ds-space-tight)] self-stretch">
      <span
        aria-hidden
        className={cn(
          "w-[var(--ds-border-w-emphasis)] shrink-0 self-stretch rounded-[var(--ds-radius-pill)]",
          read ? "bg-[var(--ds-read-mark)]" : "bg-[var(--ds-write-mark)]",
        )}
      />
      {/* On the LABEL line, not centred across the pair — a glyph floating in
          the gutter between two lines belongs to neither. */}
      <Icon
        aria-hidden
        className={cn(
          dsIcon.sm,
          "mt-[var(--ds-space-hair)] shrink-0",
          read ? "text-[color:var(--ds-read-fg)]" : "text-[color:var(--ds-write-fg)]",
        )}
      />
      {/* The demo's own pair is `read` / `write` (`DemoContextRail.tsx:260`),
          and D273 item 5 ports it: `written` was a tense this ledger uses
          nowhere else, and the two words have to be the same PART OF SPEECH to
          read as one axis when a screen reader runs down the column. */}
      <span className="sr-only">{read ? "read" : "write"}</span>
    </span>
  );
}

function LedgerRow({
  label,
  dir,
  marks,
  children,
}: {
  label: string;
  /** D252 — the producing task's declared effect; absent draws neutral ink. */
  dir?: "read" | "write";
  /** the row's provenance marks, on the label line */
  marks?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-[var(--ds-space-snug)] py-[var(--ds-space-snug)]">
      {/* The rail spans BOTH lines, which is the whole reason it is a rail and
          not a dot: it binds a label to the value printed underneath it. Since
          D252 it also carries the DIRECTION — neutral ink only where the build
          cannot attribute the value. */}
      <DirectionRail dir={dir} />
      <div className="flex min-w-0 flex-1 flex-col gap-[var(--ds-space-hair)]">
        {/* The LABEL gives up width to the marks, never the other way round:
            the marks are already one word each and a truncated badge is
            unreadable, while a clipped label is still recoverable from its
            `title` and from the value under it. It claims the slack with
            `flex-1` rather than pushing the marks out with `ml-auto` — the
            demo's own shape (R6 f.15), and the one that keeps the badges
            reading as a continuation of the label instead of a right rail. */}
        <div className="flex min-w-0 items-center gap-[var(--ds-space-tight)]">
          <span title={label} className={LEDGER_LABEL_CLASS}>
            {label}
          </span>
          {marks}
        </div>
        {children}
      </div>
    </div>
  );
}

function ObservedFactValue({ fact }: { fact: LogLedgerFact }) {
  if (fact.items === undefined) {
    return <span title={fact.value} className={cn(dsText.body, dsText.nums, "break-all text-[color:var(--ds-fg)]")}>{fact.value}</span>;
  }
  return <details className="min-w-0" title={fact.value}>
    <summary className={cn(dsText.body, dsText.nums, "min-w-0 cursor-pointer text-[color:var(--ds-fg)]")}>
      {fact.items.length} {fact.items.length === 1 ? "value" : "values"}
      <span className="ml-[var(--ds-space-tight)] inline-block max-w-full truncate align-bottom text-[color:var(--ds-fg-muted)]">
        {fact.items.slice(0, 2).join(" · ")}
      </span>
    </summary>
    <ul className="m-0 list-none p-0 pt-[var(--ds-space-tight)]">
      {fact.items.map((item, index) => <li key={`${String(index)}:${item}`} className={cn(dsText.body, dsText.nums, "break-all")}>{item}</li>)}
    </ul>
  </details>;
}

function ContextSection({
  label,
  payload,
  emptyDescription,
  lockReason,
}: {
  label: string;
  payload: { entries: readonly { label: string; valueRedacted: string }[] } | undefined;
  emptyDescription: string;
  /** Why every row in this read-only section is recorded. */
  lockReason: string;
}) {
  if (payload === undefined) return null;
  return (
    <section aria-label={label} className="flex flex-col gap-[var(--ds-space-snug)]">
      <SectionLabel>{label}</SectionLabel>
      {payload.entries.length === 0 ? (
        <EmptyState
          title={`No ${label.toLowerCase()} yet`}
          description={emptyDescription}
          className="p-[var(--ds-space-cozy)]"
        />
      ) : (
        <div className="flex flex-col">
          {payload.entries.map((entry) => (
            <LedgerRow key={entry.label} label={entry.label}>
              <LockedValue value={entry.valueRedacted} reason={lockReason} />
            </LedgerRow>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// the read-only Data section
// ---------------------------------------------------------------------------


/**
 * The React key of the one group whose rows the build cannot attribute. It is
 * not a node id and must never collide with one — `groupEntriesByStep` mints at
 * most one such group, so a fixed key is exactly right.
 */
const UNATTRIBUTED_GROUP_KEY = "unattributed";

/**
 * ONE expression for the Data section's name, read by its `aria-label`, its
 * visible `SectionLabel` and the locked fallback below — so the two halves of
 * the name cannot drift apart the way the demo's did (ledger 2 C16). It is the
 * demo's own word for what the ledger holds (`DemoContextRail.tsx:592`);
 * `Data` said what KIND of thing it was, and the rail is already headed
 * `Run data`.
 */
const DATA_SECTION_LABEL = "Extracted fields";




/** The popover explains read-only provenance and rerun semantics. */
function DataSectionHead({
  expanded,
  onExpandedChange,
}: {
  expanded: boolean;
  onExpandedChange: (next: boolean) => void;
}) {
  return (
    /* THE WHOLE HEAD IS THE POPOVER'S ANCHOR, not the ⓘ button inside it. The
       button sits a truncating label's width into a 376px rail, so a surface
       anchored to it and aligned `start` ran off the rail's right edge — and
       Radix's own collision handling could not save it, because the collision
       it avoids is with the VIEWPORT, which is 1064px further right. Anchoring
       to the head and centring on it makes the constraint the one the operator
       sees: a 300px surface inside the rail's content width, with the same
       margin on both sides at every label length. */
    <Popover>
      <PopoverAnchor asChild>
        <div className="flex items-center gap-[var(--ds-space-snug)]">
          <SectionLabel className="min-w-0 truncate">{DATA_SECTION_LABEL}</SectionLabel>
          <PopoverTrigger asChild>
            <IconButton
              size="xs"
              label="About run data"
              icon={<Info aria-hidden className={dsIcon.sm} />}
              className="text-[color:var(--ds-fg-faint)] hover:text-[color:var(--ds-fg)] data-[state=open]:text-[color:var(--ds-fg)]"
            />
          </PopoverTrigger>
          {/* Expansion gives long recorded values more reading room. */}
          <IconButton
            size="sm"
            className="ml-auto"
            label={expanded ? "Narrow the data surface" : "Widen the data surface"}
            onClick={() => onExpandedChange(!expanded)}
            icon={
              expanded ? (
                <Minimize2 aria-hidden className={dsIcon.md} />
              ) : (
                <Maximize2 aria-hidden className={dsIcon.md} />
              )
            }
          />
        </div>
      </PopoverAnchor>
      <PopoverContent title="Run data" side="bottom" align="center" width="md">
        <BulletList
          items={[
            "This ledger contains every field the run recorded, grouped by the workflow step that produced it.",
            "Recorded values and their provenance are read-only.",
            "Rerun uses explicitly submitted values; it does not change this run's record.",
          ]}
        />
      </PopoverContent>
    </Popover>
  );
}

/** D334: recorded source values remain read-only; expansion changes layout only. */
function DataSection({
  payload,
  expanded,
  onExpandedChange,
  rerunAction,
  target,
  onAction,
}: {
  payload: ContextDataPayload;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  rerunAction?: ActionDescriptorWire;
  target?: ActionTarget;
  onAction?: DashboardActionHandler;
}) {
  const observations = payload.observations ?? [];
  return (
    <section aria-label={DATA_SECTION_LABEL} className="flex shrink-0 flex-col gap-[var(--ds-space-snug)]">
      <DataSectionHead expanded={expanded} onExpandedChange={onExpandedChange} />
      {payload.state === "archived" && (
        <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>Archived checkpoint values are read-only.</p>
      )}
      {payload.state !== "deleted" && observations.length > 0 && (
        <div aria-label="Observed fields" className="flex flex-col gap-[var(--ds-space-base)]">
          {observations.map((row) => (
            <Well key={row.logId} className="overflow-hidden p-0">
              <div className="flex min-w-0 items-center gap-[var(--ds-space-tight)] px-[var(--ds-space-base)] py-[var(--ds-space-tight)]">
                <SectionLabel className="min-w-0 truncate">{row.producer.step}</SectionLabel>
                {row.producer.system !== undefined && <SystemChip system={row.producer.system} className="mr-0 shrink-0" />}
              </div>
              <div className="border-t border-[color:var(--ds-recess-border)] bg-[var(--ds-surface-1)] px-[var(--ds-space-base)] py-[var(--ds-space-tight)]">
                <p className={cn(dsText.micro, dsText.nums, "m-0 mb-[var(--ds-space-tight)] text-[color:var(--ds-fg-muted)]")}>
                  {fmtClock(row.at)} · attempt {row.attempt} · {row.producer.taskId}
                </p>
                {logLedgerOf(row).map((section, sectionIndex) => (
                  <div key={`${section.direction}:${String(sectionIndex)}`} className="flex flex-col gap-[var(--ds-space-hair)]">
                    <span className={cn(dsText.caps, section.direction === "read"
                      ? "text-[color:var(--ds-read-fg)]" : "text-[color:var(--ds-write-fg)]")}>
                      {section.direction}
                    </span>
                    {section.fields.map((field, fieldIndex) => <div key={`${field.field}:${String(fieldIndex)}`}>
                      {field.nested && <span className={cn(dsText.micro, dsText.nums, "text-[color:var(--ds-fg-muted)]")}>{field.field}</span>}
                      {field.facts.map((fact, factIndex) => (
                        <LedgerRow key={`${fact.label}:${String(factIndex)}`} label={fact.key} dir={section.direction}>
                          <ObservedFactValue fact={fact} />
                        </LedgerRow>
                      ))}
                    </div>)}
                  </div>
                ))}
              </div>
            </Well>
          ))}
        </div>
      )}
      {payload.state === "deleted" ? (
        <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>This run was deleted; its recorded values are no longer available.</p>
      ) : payload.state === "unavailable" ? (
        <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{payload.reason === undefined
          ? "Checkpoint fields are unavailable because their source could not be verified."
          : "Checkpoint fields are unavailable because their " + payload.reason.replaceAll("-", " ") + "."}</p>
      ) : payload.entries.length === 0 ? (observations.length === 0 ? (
        <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
          {payload.state === "archived"
            ? "No retained checkpoint values are available for this run."
            : "No run data recorded — this run has not extracted or written any fields yet."}
        </p>
      ) : null) : <div className="flex flex-col gap-[var(--ds-space-base)]">
        {observations.length > 0 && <SectionLabel>Checkpoint fields</SectionLabel>}
        {groupEntriesByStep(payload.entries).map((group) => {
          const rows = group.rows.map(({ entry, index }, position) => (
            <div key={`${entry.label}:${String(index)}`} className={cn(
              group.origin !== undefined && "px-[var(--ds-space-base)]",
              position > 0 && "border-t border-[color:var(--ds-border-subtle)]",
            )}>
              <LedgerRow label={entry.label} {...(entry.origin === undefined ? {} : { dir: entry.origin.dir })}
                marks={<ProvenanceMarks entry={entry} />}>
                <p className="m-0"><LockedValue value={entry.valueRedacted} reason="Recorded source values are read-only." /></p>
                <span
                  title={entry.checkpoint.state === "present"
                    ? "Run " + entry.checkpoint.runId + " · checkpoint schema " + entry.checkpoint.schemaHash
                      + " · written " + entry.checkpoint.writtenAt
                    : "No value authority from another attempt is used for this coordinate."}
                  className={cn(dsText.micro, dsText.nums, "text-[color:var(--ds-fg-faint)]")}
                  data-checkpoint-coordinate=""
                >
                  {entry.checkpoint.state === "present"
                    ? "Attempt " + entry.checkpoint.attempt + " · "
                    : entry.checkpoint.state === "absent" ? "No exact-run checkpoint · " : "Checkpoint unverified · "}
                  {entry.coordinate.nodeId} / {entry.coordinate.fieldPath}
                </span>
                {freshnessNoteOf(entry) !== undefined && <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
                  {freshnessNoteOf(entry)}
                </span>}
              </LedgerRow>
            </div>
          ));
          if (group.origin === undefined) return <div className="flex flex-col" key={UNATTRIBUTED_GROUP_KEY}>{rows}</div>;
          return <Well key={group.origin.nodeId} className="overflow-hidden p-0">
            <div className="flex min-h-[var(--ds-h-sm)] min-w-0 items-center gap-[var(--ds-space-tight)] px-[var(--ds-space-base)] py-[var(--ds-space-tight)]">
              <SectionLabel className="min-w-0 truncate">{group.origin.step}</SectionLabel>
              {group.origin.system !== undefined && <SystemChip system={group.origin.system} className="mr-0 shrink-0" />}
            </div>
            <div className="border-t border-[color:var(--ds-recess-border)] bg-[var(--ds-surface-1)]">{rows}</div>
          </Well>;
        })}
      </div>}
      {payload.state === "available" && rerunAction !== undefined && target !== undefined && onAction !== undefined && (
        <Button size="sm" variant="outline" onClick={() => onAction(rerunAction, target)}>
          {rerunAction.label}
        </Button>
      )}
    </section>
  );
}

function attemptHref(entry: ItemAttemptHistoryRun): string | undefined {
  if (entry.disposition === "deleted") return undefined;
  if (entry.disposition === "archived") {
    return routeToSearch({ start: false, archive: entry.runId, archiveView: "runs" });
  }
  const currentSearch = typeof window === "undefined" ? "" : window.location.search;
  return routeToSearch(routeForCrossDateSearchResult(parseRoute(currentSearch), {
    runId: entry.runId,
    partitionDay: entry.partitionDay,
  }));
}

function attemptLabel(entry: ItemAttemptHistoryRun): string {
  if (entry.disposition === "deleted") {
    return entry.attempt === null ? "Deleted run" : "Attempt " + entry.attempt + " · deleted";
  }
  return "Attempt " + entry.attempt + (entry.disposition === "archived" ? " · archived" : "");
}

function AttemptHistorySection({
  payload,
}: {
  payload: { runId: string };
}) {
  const client = useDashboardClient();
  const [history, setHistory] = useState<ItemAttemptHistoryResponse>();
  const [entries, setEntries] = useState<readonly ItemAttemptHistoryRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [problem, setProblem] = useState<string>();
  const requestEpoch = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const epoch = ++requestEpoch.current;
    let active = true;
    setHistory(undefined);
    setEntries([]);
    setProblem(undefined);
    setLoading(true);
    setMoreLoading(false);
    void client.itemAttemptHistory(payload.runId, {
      limit: ITEM_ATTEMPT_HISTORY_MAX_LIMIT,
      signal: controller.signal,
    }).then((response) => {
      if (!active) return;
      setHistory(response);
      setEntries(response.state === "available" ? response.page.entries : []);
    }).catch(() => {
      if (active) setProblem("Attempt history could not be read.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
      controller.abort();
      if (requestEpoch.current === epoch) requestEpoch.current += 1;
    };
  }, [client, payload.runId]);

  const page = history?.state === "available" ? history.page : undefined;
  async function loadEarlier() {
    if (page?.nextCursor === null || page?.nextCursor === undefined || moreLoading) return;
    const epoch = requestEpoch.current;
    const requestedRunId = payload.runId;
    setMoreLoading(true);
    setProblem(undefined);
    try {
      const response = await client.itemAttemptHistory(payload.runId, {
        limit: page.limit,
        cursor: page.nextCursor,
      });
      if (epoch !== requestEpoch.current || requestedRunId !== payload.runId) return;
      if (response.state !== "available") {
        setHistory(response);
        setProblem("Attempt history changed before the next page could be read.");
        return;
      }
      setEntries((current) => [...current, ...response.page.entries]);
      setHistory(response);
    } catch {
      if (epoch === requestEpoch.current && requestedRunId === payload.runId) {
        setProblem("Earlier attempts could not be read.");
      }
    } finally {
      if (epoch === requestEpoch.current && requestedRunId === payload.runId) setMoreLoading(false);
    }
  }

  return (
    <section aria-label="Attempts" className="flex flex-col gap-[var(--ds-space-snug)]">
      <SectionLabel>Attempts</SectionLabel>
      {loading ? (
        <p aria-live="polite" className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>Loading attempt history…</p>
      ) : problem !== undefined ? (
        <p role="status" className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{problem}</p>
      ) : history?.state === "unavailable" ? (
        <p role="status" className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
          Attempt history unavailable: {history.reason.replaceAll("-", " ")}.
        </p>
      ) : history?.state === "stale" ? (
        <p role="status" className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
          Attempt history changed. Reopen the run to load it again.
        </p>
      ) : history?.state === "refused" ? (
        <p role="status" className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
          Attempt history could not be shown: {history.reason.replaceAll("-", " ")}.
        </p>
      ) : (
        <div className="flex flex-col">
          {entries.map((entry) => {
            const href = attemptHref(entry);
            return (
              <div key={entry.runId} className="border-b border-[color:var(--ds-border-subtle)] py-[var(--ds-space-tight)] last:border-b-0">
                {href === undefined ? (
                  <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{attemptLabel(entry)}</span>
                ) : (
                  <a
                    href={href}
                    title={entry.disposition === "live"
                      ? "Open this attempt from " + entry.partitionDay + "."
                      : "Open this archived run."}
                    className={cn(dsText.body, "text-[color:var(--ds-link)] underline underline-offset-2")}
                  >
                    {attemptLabel(entry)}
                  </a>
                )}
              </div>
            );
          })}
          {page?.nextCursor !== null && page?.nextCursor !== undefined && (
            <Button size="sm" variant="outline" disabled={moreLoading} onClick={() => void loadEarlier()}>
              {moreLoading ? "Loading…" : "Show earlier attempts"}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// the rail
// ---------------------------------------------------------------------------

export function ContextRailSpine({
  summary,
  onOpen,
  className,
}: {
  summary: ContextSummary;
  onOpen: () => void;
  className?: string;
}) {
  return (
    <aside
      aria-label="Run data, collapsed"
      className={cn(
        "flex min-h-0 flex-col items-center gap-[var(--ds-space-base)] overflow-hidden border pb-[var(--ds-space-base)]",
        "border-[color:var(--ds-border)] bg-[var(--ds-surface-1)] rounded-[var(--ds-radius-lg)]",
        className,
      )}
    >
      {/* The swap is instant — it retargets a grid column, which is a layout
          property nothing may animate, and this is a control the operator
          presses often. With no motion to carry the eye, POSITION does it: the
          expand button sits on the same baseline as the collapse button it
          replaces, so undoing the press needs no pointer travel. */}
      <span className="flex h-[var(--ds-h-bar)] shrink-0 items-center">
        <IconButton
          // The spine says what it is hiding, in the words the sections
          // themselves use (R6 f.24, following f.3a). The demo's third noun,
          // `delegation`, is dropped rather than carried across: no delegation
          // section renders here, and a spine advertising a section behind it
          // that does not exist is a control that lies about its own contents.
          label="Show run data — extracted fields and attempts"
          size="sm"
          onClick={onOpen}
          icon={<PanelRightOpen aria-hidden className={dsIcon.md} />}
        />
      </span>
      {/* A collapsed rail still says what is in it. A blank spine is a control
          the operator has to click to find out whether it was worth clicking. */}
      <span className={cn(dsText.caps, "[writing-mode:vertical-rl] text-[color:var(--ds-fg-muted)]")}>
        Run data
      </span>
      <span
        className={cn(dsText.micro, dsText.nums, "[writing-mode:vertical-rl] text-[color:var(--ds-fg-faint)]")}
      >
        {plural(summary.dataFacts, "field")}
      </span>
    </aside>
  );
}

export function ContextRail({
  sections,
  onClose,
  className,
  dataExpanded,
  onDataExpandedChange,
  actions,
  target,
  onAction,
}: {
  summary: ContextSummary;
  sections: ContextSections;
  onClose: () => void;
  className?: string;
  /**
   * D273 item 5 — ONE OWNER. The Data surface's expansion is the LAYOUT owner's
   * state, and this rail is told it rather than keeping a second copy.
   *
   * It used to be held here AND there: `LogPanel` sized the grid column from its
   * own flag while this component's header word read a `useState` of its own,
   * and collapsing the rail cleared NEITHER. Collapse an expanded rail and
   * re-open it and the column was still `--ds-w-context-rail-wide` while the
   * freshly mounted rail read `Run data` and offered `Widen` — the surface
   * describing a state it did not have. The demo cannot desync because one hook
   * owns both (`DemoContextRail.tsx:181-191`).
   */
  dataExpanded: boolean;
  onDataExpandedChange: (expanded: boolean) => void;
  /** Server-authored run controls and their exact selected-row identity. */
  actions?: readonly ActionDescriptorWire[];
  target?: ActionTarget;
  onAction?: DashboardActionHandler;
}) {
  const data = sections["context-data"];
  const attempts = sections["context-attempts"];

  const hasAttemptHistory = attempts !== undefined;
  const rerunAction = actions === undefined || target === undefined || target.runId !== data?.runId
    ? undefined
    : actionsAt(actions, "data").find((action) => action.key === "rerun"
      && action.kind === "navigation" && action.navigate.kind === "rerun"
      && action.navigate.expectedVersion === target.expectedVersion);

  return (
    <aside
      aria-label="Run data"
      className={cn(
        // A CONTAINER, so a row can decide for itself how much it can show.
        // Its width is a function of the rail's own state as much as the
        // window's, which a viewport query cannot see.
        "@container flex min-h-0 min-w-0 flex-col overflow-hidden border",
        "border-[color:var(--ds-border)] bg-[var(--ds-surface-1)] rounded-[var(--ds-radius-lg)]",
        className,
      )}
    >
      <header
        className={cn(
          "flex shrink-0 items-center gap-[var(--ds-space-snug)] border-b px-[var(--ds-space-cozy)]",
          "min-h-[var(--ds-h-bar)] border-[color:var(--ds-border)]",
        )}
      >
        <Database aria-hidden className={cn(dsIcon.md, "shrink-0 text-[color:var(--ds-fg-muted)]")} />
        {/* The header says what MODE the rail is in (R6 f.4). The state was
            already plumbed outward to size the column and never read back
            here, so the one surface that changes shape did not say so. */}
        <span className={cn(dsText.title, "min-w-0 truncate font-semibold text-[color:var(--ds-fg)]")}>
          {dataExpanded ? "Run data · expanded" : "Run data"}
        </span>
        <IconButton
          label="Hide run data"
          size="sm"
          className="ml-auto"
          onClick={onClose}
          icon={<PanelRightClose aria-hidden className={dsIcon.md} />}
        />
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-[var(--ds-space-cozy)] overflow-y-auto p-[var(--ds-space-cozy)]">
        {/**
         * ORDER: Data · Attempts · Delegation — the demo states it twice and
         * this rail now follows it (R6 f.19).
         *
         * **`Evidence` LEFT THE RAIL.** It was a rebuild-only insertion into a
         * stated order: captures are evidence that QUALIFIES an outcome, not
         * contextual input beside the live stream, so the demo moves them to
         * Receipt explicitly. It is not dropped — `context-evidence` re-homes
         * to the Receipt tab, recorded on the audit's hookup ledger. Nothing is
         * lost today either way: the arm is `declared-unserved` (D184) and no
         * composition can populate it.
         *
         * **`Delegation` is a wire gap**, not an omission — nothing in this
         * tree references a delegation link. It is on the same ledger.
         *
         * A section the run did not advertise is not drawn at all. An
         * advertised section with no entries draws its empty state, because
         * "this run recorded nothing here" and "this run cannot record here"
         * are different facts and the operator acts on them differently.
         */}
        {data !== undefined && isDataPayload(data) ? (
          <DataSection
            key={data.runId}
            payload={data}
            expanded={dataExpanded}
            onExpandedChange={onDataExpandedChange}
            rerunAction={rerunAction}
            target={target}
            onAction={onAction}
          />
        ) : (
          <ContextSection
            label={DATA_SECTION_LABEL}
            payload={data}
            emptyDescription="Values this run recorded appear here as it reads them."
            lockReason="Recorded by the run."
          />
        )}

        {/* Expanding Data hides ATTEMPTS. The expand control stays in the Data
            section's own header at the top of the rail, so undoing a press
            costs no pointer travel. */}
        {!dataExpanded && hasAttemptHistory && attempts !== undefined && (
          <>
            <Separator />
            <AttemptHistorySection key={attempts.runId} payload={attempts} />
          </>
        )}

        {/* Say why history is hidden while the wider data layout is active. */}
        {dataExpanded && hasAttemptHistory && (
          <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
            Attempts are hidden while data is expanded. Narrow the surface to bring them back.
          </p>
        )}

        {/* THE SUMMARY COUNT ROW IS GONE (R6 f.20). It was banned by the
            operator on 2026-07-27 — "remove these tags in data" — and the
            demo's own comment at `DemoContextRail.tsx:665-680` says why in the
            general case: it restated, above the list, things the list already
            shows and the eye can count. This codebase had reintroduced it at
            the rail FLOOR rather than the ledger top, reading
            `N fields · N attempts` under the very sections that print both.
            Do not reintroduce a count here. */}
      </div>
    </aside>
  );
}
