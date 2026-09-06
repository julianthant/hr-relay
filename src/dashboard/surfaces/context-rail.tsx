/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/DemoContextRail.tsx
 *
 * The Context rail — the permanent home of a run's DATA, beside the stream
 * rather than behind a tab (ref frontend-backend-integration §3.3: "Data lives in the Context rail").
 *
 * WHAT THE WIRE SERVES, AND WHAT IT STILL DOES NOT. The demo's ledger drew four
 * axes this surface could not: DIRECTION (the `--ds-read-*` / `--ds-write-*`
 * pair), the originating system, the observation clock, and an editable/locked
 * policy with dirty/corrected/refreshed/staged/unconfirmed badges. Two of the
 * four have since arrived and two have NOT, and the difference between them is
 * the whole rule this comment exists to hold:
 *
 *  - **The edit policy** is served (2i-C): `edit` carries editable/locked with
 *    the real reason and any pending correction, and the row renders by SHAPE.
 *  - **The observation clock and the fact's own source** are served (W2): each
 *    entry may carry `observedAt`, `source` and `correctedAt`, projected from
 *    the producing checkpoint's `FactProvenance` row — the SAME record
 *    `editableEntryOf` was already reading and discarding. `corrected` is
 *    drawn from `correctedAt`; `derived` from `source`; a `live` read is the
 *    unmarked default, because a badge on every row is a badge on none.
 *  - **DIRECTION, the STEP and the SYSTEM are served (D252)**, and the
 *    sentence they replace is worth keeping because it was half right. It read
 *    "nothing durable says whether a recorded field was read or written", which
 *    is TRUE of the checkpoint row and FALSE of the descriptor that produced
 *    it: the node that recorded a value declares a task contract, and that
 *    contract's `effect` is ref task-contract's own word for what it does to the world.
 *    So `dir` is a DECLARATION, not the guess the old comment refused — and a
 *    guess is still refused, which is why an entry with no field identity
 *    draws no arrow rather than a defaulted `read`. `system` comes from the
 *    store that implements the task; a headless store owns none, and the chip
 *    is then absent rather than labelled "internal".
 *  - **The reuse bound is served (D252)** where it can BITE: an entry's own
 *    freshness limit, the override policy, and the write nodes the value can
 *    reach. A bound that reaches no write refuses nothing (the executor's own
 *    walk skips it), so no sentence is printed for one.
 *  - **The demo's `refreshed` badge is still absent** — it means "this changed
 *    on the server since you looked" and needs the superseded reading beside
 *    the current one. This wire carries one value per entry, so there is
 *    nothing to compare. The demo's `staged` / `unconfirmed` badges are absent
 *    for a structural reason, not a wire gap: a `prepare` contract is
 *    `checkpoint: "in-memory-only"` so a staged value never becomes the
 *    checkpoint a ledger row is read from, and an unconfirmed write is a
 *    `parked-write` run whose transaction node has no checkpoint at all — its
 *    honest surface is ref write-safety §4.1's park section, which serves it.
 *
 * An absent axis draws NOTHING — never a placeholder, never a dash, and never
 * a plausible default.
 *
 * What survives is the ratified SHAPE: the stacked label-over-value row bound
 * by a rail (the rail is what makes an eight-row ledger read as eight things
 * and not sixteen — that job is layout first, so an unattributable row still
 * gets its rail, in neutral ink), the section order, the collapse affordance
 * and its persisted preference, and the spine that still says what it is
 * hiding.
 *
 * Values arrive redacted BY THE SERVER. `valueRedacted` renders verbatim: this
 * surface never re-derives, re-formats or unmasks one.
 */
import { type ReactNode } from "react";
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


import {
} from "../app/command-result.js";
import { fmtClock, plural } from "./format.js";
import { SystemChip } from "./system-chip.js";
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
  type EditPolicy,
} from "./context-rail-model.js";

export type {
  ContextDataEntry,
  ContextDataPayload,
  ContextRailState,
  ContextSectionKind,
  ContextSectionPayload,
  ContextSections,
  ContextSummary,
  EditPolicy,
};

/* the rail's wire types live in `context-rail-model.ts` — see the note there */

/** The two refusal arms of the D253 fold, which are the only ones this rail draws. */

function isDataPayload(payload: ContextSectionPayload): payload is ContextDataPayload {
  return "editing" in payload;
}

// ---------------------------------------------------------------------------
// open / collapsed, persisted
// ---------------------------------------------------------------------------

/* the rail's open state, and the edit policy, live in `context-rail-model.ts` — see the note there */

/** Parse an operator draft back into the RECORDED scalar's own type. */


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
 * REAL reason, an editable row is a `ValueField` box the operator types into.
 */
/**
 * WHEN a value was established, and by WHAT — the demo's Data-ledger axis, in
 * exactly the arms this wire now serves (W2).
 *
 * It reads `-muted` rather than `-faint`: `-faint` is the disabled/placeholder
 * step and a real observation is neither.
 *
 * THE DEMO'S `@min-[26rem]:` FOLD DOES NOT PORT, and that is a decision rather
 * than an omission. There, the clock was the THIRD thing competing for the
 * sub-step line — a direction arrow and a `SystemChip` sat ahead of it — so it
 * was rightly the first to give way at 376px and the first back when the rail
 * widened to 520px to edit in. Neither of those two is served by this wire, so
 * the line has room the demo's did not, and a threshold carried across
 * unexamined would hide the clock at EVERY width the product ever draws the
 * rail at (it is 376 at rest and 520 only mid-edit) — which is a field served,
 * projected and never seen. The LABEL gives way instead: it truncates, and it
 * is recoverable from its own `title` and from the value printed under it,
 * while a clipped clock is unreadable.
 *
 * The badges do not give way at all. `corrected` says a human overrode what the
 * run read, and a hazard is never disclosed behind a width.
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
  fieldId,
  marks,
  children,
}: {
  label: string;
  /** D252 — the producing task's declared effect; absent draws neutral ink. */
  dir?: "read" | "write";
  /**
   * The id of the input this row's label names, when the row has one.
   *
   * A REAL `htmlFor` pairing, which the one-line row could not have had (R6
   * f.14, demo `DemoContextRail.tsx:328-352`): the label sat beside the input
   * rather than above it, so it was written as an `aria-label` and the visible
   * text was associated with nothing. Stacked, the label IS the field's label
   * — which also makes it a click target that focuses the input, one more
   * thing saying "this line takes typing".
   *
   * It replaces a `useId` that was minted on every row and referenced by
   * NOTHING: an id nobody points at is a pairing that does not exist.
   */
  fieldId?: string;
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
          {fieldId === undefined ? (
            <span title={label} className={LEDGER_LABEL_CLASS}>
              {label}
            </span>
          ) : (
            <label htmlFor={fieldId} title={label} className={cn(LEDGER_LABEL_CLASS, "cursor-text")}>
              {label}
            </label>
          )}
          {marks}
        </div>
        {children}
      </div>
    </div>
  );
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
  /** Why every row in THIS section is uneditable — shown on each lock. */
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
// the Data section — the merged Data / Edit Data surface (ref dashboard-surfaces §1.1(c))
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



/** What the operator would be editing FROM: the pending correction if one is staged, else the recorded value. */




/**
 * THE ⓘ IS WHERE THE EXPLAINING GOES.
 *
 * Ported from legacy hr-automation@1bffbd65,
 * `DemoContextRail.tsx:600-638` (R6 f.3b). Sentences that are true of every run
 * in the product and are facts about NONE of them used to be printed on this
 * surface at all times; they are one press away now and the surface is back to
 * being a ledger.
 *
 * TWO OF THE DEMO'S BULLETS DO NOT PORT, and their absence is named rather
 * than papered over. The freshness sentence ("reusing reads older than N
 * minutes takes a reason") and the whole `KeyValueList` above it
 * (`Generation` · `Captured` · `Accepted age`) all read the CHECKPOINT'S OWN
 * provenance, and `ContextDataSectionSchema` carries no `capturedAt`,
 * `maxAgeMin` or consuming node — they ride the batched wire row on the
 * audit's hookup ledger with the rest of the freshness surface (R6 f.7). A
 * bullet stating a limit this wire cannot name would be inventing the number.
 */
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
}: {
  payload: ContextDataPayload;
  actorId: string;
  liveStatus: string | undefined;
  /** The rail has more room to read long recorded values. */
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onSaved: () => void;
  /** Seed the ledger from an earlier run of this workflow — unserved, see the dock. */
  onLoadPriorRun?: () => void;
  /** Start a fresh run from the values on screen — unserved, see the dock. */
  onStartCustomRun?: () => void;
}) {
  return (
    <section aria-label={DATA_SECTION_LABEL} className="flex shrink-0 flex-col gap-[var(--ds-space-snug)]">
      <DataSectionHead expanded={expanded} onExpandedChange={onExpandedChange} />
      {payload.entries.length === 0 ? (
        <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
          No run data recorded — this run has not extracted or written any fields yet.
        </p>
      ) : <div className="flex flex-col gap-[var(--ds-space-base)]">
        {groupEntriesByStep(payload.entries).map((group) => {
          const rows = group.rows.map(({ entry, index }, position) => (
            <div key={`${entry.label}:${String(index)}`} className={cn(
              group.origin !== undefined && "px-[var(--ds-space-base)]",
              position > 0 && "border-t border-[color:var(--ds-border-subtle)]",
            )}>
              <LedgerRow label={entry.label} {...(entry.origin === undefined ? {} : { dir: entry.origin.dir })}
                marks={<ProvenanceMarks entry={entry} />}>
                <p className="m-0"><LockedValue value={entry.valueRedacted} reason="Recorded source values are read-only." /></p>
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
  summary,
  sections,
  onClose,
  className,
  actorId,
  liveStatus,
  dataExpanded,
  onDataExpandedChange,
  onSaved,
}: {
  summary: ContextSummary;
  sections: ContextSections;
  onClose: () => void;
  className?: string;
  /** Who a correction is requested by; commands refuse without one. */
  actorId: string;
  /** The run's LIVE queue status off the day stream — the D19 staleness signal. */
  liveStatus: string | undefined;
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
  /** An applied save bumped the run version — the owner refetches detail + sections. */
  onSaved: () => void;
}) {
  const data = sections["context-data"];
  const attempts = sections["context-attempts"];

  /**
   * `RunSelector` renders nothing below two attempts, so the HEADING is gated
   * on the same fact rather than on the component returning null — a labelled
   * section with nothing under it reads as a failed render (R6 f.18, demo
   * `DemoContextRail.tsx:1111-1114`).
   */
  const hasAttempts = summary.attempts > 1;

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
            actorId={actorId}
            liveStatus={liveStatus}
            expanded={dataExpanded}
            onExpandedChange={onDataExpandedChange}
            onSaved={onSaved}
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
        {!dataExpanded && attempts !== undefined && hasAttempts && (
          <>
            <Separator />
            {/* AN ON-RECORD DEVIATION: the demo puts a `RunSelector` here — a
                control that CHANGES WHICH ATTEMPT YOU ARE READING. This wire
                serves the attempts section as labelled values, so the rail
                renders them as a locked ledger until the selector's wire lands.
                The `>1` gate above is the demo's, and it applies either way. */}
            <ContextSection
              label="Attempts"
              payload={attempts}
              emptyDescription="Every attempt of this run appears here."
              lockReason="Attempts are history; history is never edited."
            />
          </>
        )}

        {/* R6 f.26 — the hidden section says it is hidden and how to get it
            back. A section that vanishes on a press the operator made for a
            different reason reads as a rendering fault.

            It is gated on `hasAttempts` as well as on the expansion, which the
            demo's own line is not: the demo names two sections and this rail
            draws one, so an ungated sentence would report hiding a section
            that was never there on the majority of runs. Same reason the spine
            label drops `delegation`. */}
        {dataExpanded && hasAttempts && (
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
