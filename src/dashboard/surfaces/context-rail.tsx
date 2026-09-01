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
import { useId, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Database,
  History,
  Info,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Play,
  RotateCcw,
  Save,
} from "lucide-react";
import { systemClock } from "../../domain/clock.js";
import { cn } from "../lib/utils.js";
import {
  Badge,
  Banner,
  BulletList,
  Button,
  EmptyState,
  Field,
  IconButton,
  Input,
  LockedValue,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  Refusal,
  SectionLabel,
  Separator,
  ValueField,
  Well,
  dsIcon,
  dsText,
  useToasts,
} from "../ds/ui.js";


import {
  commandFailureToast,
  settleCommandResult,
  type CommandSettlement,
} from "../app/command-result.js";
import { useDashboardClient } from "../state/client-context.js";
import { fmtClock, plural } from "./format.js";
import { SystemChip } from "./system-chip.js";
import {
  checkpointRefusalCopy,
  editPolicyFor,
  freshnessNoteOf,
  groupEntriesByStep,
  liveLockReasonOf,
  type ContextDataEntry,
  type ContextDataPayload,
  type ContextRailState,
  type ContextSectionKind,
  type ContextSectionPayload,
  type ContextSections,
  type ContextSummary,
  type EditPolicy,
  type EditableScalar,
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
export type RefusedSettlement = Extract<CommandSettlement, { kind: "refused" }>;

function isDataPayload(payload: ContextSectionPayload): payload is ContextDataPayload {
  return "editing" in payload;
}

// ---------------------------------------------------------------------------
// open / collapsed, persisted
// ---------------------------------------------------------------------------

/* the rail's open state, and the edit policy, live in `context-rail-model.ts` — see the note there */

/** Parse an operator draft back into the RECORDED scalar's own type. */
function parseDraft(
  label: string,
  text: string,
  recorded: EditableScalar,
): { ok: true; value: EditableScalar } | { ok: false; problem: string } {
  if (typeof recorded === "number") {
    const numeric = Number(text.trim());
    if (!Number.isFinite(numeric) || text.trim().length === 0) {
      return { ok: false, problem: `${label}: "${text}" is not a number` };
    }
    return { ok: true, value: numeric };
  }
  if (typeof recorded === "boolean") {
    const normalized = text.trim().toLowerCase();
    if (normalized === "true") return { ok: true, value: true };
    if (normalized === "false") return { ok: true, value: false };
    return { ok: false, problem: `${label}: "${text}" must be true or false` };
  }
  return { ok: true, value: text };
}

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
  const { observedAt, source, correctedAt } = entry;
  if (observedAt === undefined && source === undefined && correctedAt === undefined) return null;
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
      {/* `live` is the unmarked default — it is what most rows are, and a badge
          on every row is a badge on none. `derived` earns one because a
          computed value's clock is not a live observation of anything.

          THE `operator` ARM DRAWS NOTHING, and that is deliberate rather than
          unhandled (R6 f.23). A value whose source is the operator is exactly a
          value that carries `correctedAt`, so it already has the `corrected`
          badge above — a second badge saying the same thing in a different word
          is the redundancy this pass is removing everywhere else. */}
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

const FIELD_KEY_SEPARATOR = "\u0000";

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

function fieldKeyOf(policy: { nodeId: string; fieldPath: string }): string {
  return `${policy.nodeId}${FIELD_KEY_SEPARATOR}${policy.fieldPath}`;
}

/** What the operator would be editing FROM: the pending correction if one is staged, else the recorded value. */
function baseTextOf(policy: Extract<EditPolicy, { kind: "editable" }>): string {
  return policy.pending === undefined ? String(policy.recorded) : String(policy.pending.value);
}

function draftTextOf(
  drafts: Readonly<Record<string, string>>,
  policy: Extract<EditPolicy, { kind: "editable" }>,
): string {
  const draft = drafts[fieldKeyOf(policy)];
  return draft === undefined ? baseTextOf(policy) : draft;
}

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
          {/* The expand affordance, not a modal: the resting rail is tight for
              typing a date into, so the surface takes the room it needs AND
              GIVES IT BACK. The second half is the one that did not exist. */}
          <IconButton
            size="sm"
            className="ml-auto"
            label={expanded ? "Narrow the data surface" : "Widen the data surface to edit"}
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
            // The grouping half of this sentence was dropped while the ledger
            // was flat, and D252 made it true again — so the bullet had come to
            // UNDERSTATE its own surface (D273 item 5, ledger 2 C21). It is the
            // demo's wording, restored now that the fact behind it is served.
            "This ledger contains every field the run recorded, grouped by the workflow step that produced it.",
            "Reads are correctable in place. Writes are shown and never edited — they are the record of what happened.",
            // The demo's other arm ("saving continues THIS run") belongs to a
            // save that releases a parked run. `run/edit-checkpoint` never
            // does: it records a correction that applies when the run next
            // resumes, so only this sentence is true here.
            "Saving records a correction on this run. Nothing runs.",
            "A correction takes a reason, and the reason becomes the field's operator provenance on the receipt.",
          ]}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * A REFUSED SAVE (D273 item 6, ledger 2 C55/C57).
 *
 * It used to be one uncoded red `<span>` carrying `settlement.problem` — R6 f.6
 * flattened every non-applied outcome into it and D253 then routed the CAS
 * `conflict` into the same line, so both refusals read as one sentence with no
 * code, no statement of what was not done, and nothing at all saying the
 * operator's work survived. It does survive: `save()` keeps every draft on both
 * refusal arms, and this is what says so.
 *
 * TWO ARMS, split on whether the server named a CODE, which is the wire's own
 * shape (`rejected` carries one, `conflict` never does) and
 * `refused-notice.tsx`'s ratified reading (D273 item 10). The coded arm is the
 * `Refusal` primitive, whose whole reason for existing is that slot; the uncoded
 * arm is a plain danger `Banner` that says in as many words that there is
 * nothing to quote, rather than inventing a code to fill it.
 *
 * NO NESTED `role="alert"`: `Banner tone="danger"` — which `Refusal` is built on
 * — already carries one, and a second would make the same sentence announce
 * twice and every `getByRole("alert")` on this surface ambiguous.
 *
 * WHAT IS STILL NOT DRAWN: the demo's per-FIELD re-offer against the fresh
 * checkpoint (the `yours` / `server now` chips and its two exits). That is a
 * change to what `executeEditCheckpoint` RETURNS, not a wire projection
 * (ledger 2 C56), so the conflict arm names the moved version and stops.
 */
/* EXPORTED so the render test can reach it. A `surfaces/*.tsx` module may
   export components and nothing else, and this is one — the alternative was
   pinning a Banner's markup through a mounted client, a toast provider and a
   dispatched command, which pins four things to assert one. */
export function CheckpointRefusal({
  refusal,
  onDismiss,
}: {
  refusal: { readonly settlement: RefusedSettlement; readonly heldEdits: number } | null;
  onDismiss: () => void;
}) {
  if (refusal === null) return null;
  const { settlement, heldEdits } = refusal;
  const copy = checkpointRefusalCopy(settlement.reason, heldEdits);
  const dismiss = (
    <Button size="sm" variant="secondary" onClick={onDismiss}>
      Dismiss
    </Button>
  );
  if (settlement.reason === "rejected") {
    return (
      <Refusal
        title={copy.title}
        code={settlement.code}
        meta={[copy.held]}
        outcome={copy.outcome}
        action={dismiss}
      >
        {settlement.message}
      </Refusal>
    );
  }
  return (
    <Banner tone="danger" title={copy.title} action={dismiss}>
      {/* TWO BLOCKS, not one run-on line: a `conflict` message does not end in a
          period, so interpolating the product's sentence straight after it reads
          as one broken sentence (D273 item 10's own finding, which this surface
          would otherwise have inherited). */}
      <span className="flex flex-col gap-[var(--ds-space-tight)]">
        <span>{settlement.problem}</span>
        <span>{`${copy.heldSentence} The save was refused, so ${copy.outcome}. ${copy.uncoded}`}</span>
      </span>
    </Banner>
  );
}

/**
 * Reads are editable in place; the section enters EDITING on the first focus
 * of a value box (the reason + Save footer appears) and leaves it on Cancel or
 * an applied save. A save is one `run/edit-checkpoint` command: field patches
 * CASed on the version this payload was served with — the kernel re-validates
 * everything; this surface only says why a save is not possible BEFORE it is
 * attempted.
 *
 * WIDENING IS ITS OWN DECISION (R6 f.3c). The rail used to widen as a side
 * effect of focusing a value and had no way back — the operator could reach
 * the wide surface but not leave it. `expanded` is now an explicit
 * Widen/Narrow control in this section's own header, at the top of the rail so
 * undoing a press costs no pointer travel, and entering editing still raises
 * it (ref dashboard-surfaces D19(d): the resting rail is tight to type a date into).
 */
function DataSection({
  payload,
  actorId,
  liveStatus,
  expanded,
  onExpandedChange,
  onSaved,
  onLoadPriorRun,
  onStartCustomRun,
}: {
  payload: ContextDataPayload;
  actorId: string;
  liveStatus: string | undefined;
  /** the rail has been widened to be edited in */
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onSaved: () => void;
  /** Seed the ledger from an earlier run of this workflow — unserved, see the dock. */
  onLoadPriorRun?: () => void;
  /** Start a fresh run from the values on screen — unserved, see the dock. */
  onStartCustomRun?: () => void;
}) {
  const client = useDashboardClient();
  const { toast } = useToasts();
  const fieldIdBase = useId();
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  /**
   * A CLIENT-side refusal to compose the patch — a draft that will not parse
   * back into the recorded scalar's own type. Nothing left this tab, so it is
   * not a refusal and it carries no code; it is a validation message about a
   * field, and it stays a plain alert beside the fields it names.
   */
  const [problem, setProblem] = useState<string | null>(null);
  /**
   * THE SERVER's refusal, held with the count of drafts it did not write
   * (D273 item 6, ledger 2 C55/C57). The count is captured at DISPATCH rather
   * than read off `dirty` at render: the operator may keep typing while the
   * command is in flight, and "your 3 edits are still here" has to be a fact
   * about the save that was refused, not about the box as it stands now.
   */
  const [refusal, setRefusal] = useState<
    { readonly settlement: RefusedSettlement; readonly heldEdits: number } | null
  >(null);
  /**
   * Dismissing the refusal unmounts `CheckpointRefusal` — Dismiss button
   * included — so a keyboard operator's focus would otherwise fall off the
   * document entirely and land on `body` (the restoreFocus pattern
   * `ds/primitives-overlay.tsx`'s toast toggle already uses, one surface on;
   * see `src/dashboard/CLAUDE.md`'s 2026-08-26 F5b lesson on the same defect
   * in the Run Modal). The Save control is always mounted, whatever the
   * refusal state, so the target exists before the unmount and the focus
   * move can happen synchronously in the same handler that clears it.
   */
  const saveButtonRef = useRef<HTMLButtonElement>(null);

  const liveLock = liveLockReasonOf(liveStatus);
  const policies = payload.entries.map((entry) => ({
    entry,
    policy: editPolicyFor(entry, payload.editing, liveLock),
  }));

  const dirty = policies.flatMap(({ entry, policy }) => {
    if (policy.kind !== "editable") return [];
    const draft = drafts[fieldKeyOf(policy)];
    if (draft === undefined || draft === baseTextOf(policy)) return [];
    return [{ entry, policy, draft }];
  });

  // Ref dashboard-surfaces D19(d): the resting rail is tight to type a date into, so the first
  // focus raises the wide surface. The Narrow control gives it back — which is
  // the half that did not exist (R6 f.3c).
  const enterEditing = (): void => {
    onExpandedChange(true);
  };
  const resetEdits = (): void => {
    setDrafts({});
    setReason("");
    setProblem(null);
    // The refusal was ABOUT the drafts that are being thrown away, so it goes
    // with them: a banner counting edits that no longer exist is the stale
    // settlement D272 item 9's review found on the run modal, one surface on.
    setRefusal(null);
  };

  const save = (): void => {
    const patches: { nodeId: string; fieldPath: string; value: EditableScalar; correctedAt: string; reason: string }[] = [];
    for (const { entry, policy, draft } of dirty) {
      const parsed = parseDraft(entry.label, draft, policy.recorded);
      if (!parsed.ok) {
        setProblem(parsed.problem);
        return;
      }
      patches.push({
        nodeId: policy.nodeId,
        fieldPath: policy.fieldPath,
        value: parsed.value,
        correctedAt: systemClock.now().toISOString(),
        reason,
      });
    }
    if (patches.length === 0 || payload.editing.state !== "editable") return;
    // The number of drafts THIS dispatch is carrying. Captured here because the
    // refusal's own sentence is about them, and `dirty` moves under a keystroke.
    const heldEdits = patches.length;
    setSaving(true);
    setProblem(null);
    setRefusal(null);
    client.executeCommand({
      commandId: crypto.randomUUID(),
      requestedAt: systemClock.now().toISOString(),
      requestedBy: actorId,
      source: "context-rail",
      family: "run",
      type: "edit-checkpoint",
      target: { runId: payload.runId, expectedVersion: payload.editing.expectedVersion },
      payload: { patches },
    }).then((result) => {
      setSaving(false);
      // D253 — BOTH refusal arms, through the one exhaustive fold. Branching on
      // `rejected` alone let a CAS `conflict` fall through to the success path
      // below: the editor closed, the drafts were discarded and the rail
      // reported a correction saved that the kernel had refused. The drafts
      // stay on a refusal so the operator can retry after reopening the run.
      const settlement = settleCommandResult(result);
      if (settlement.kind === "refused") {
        setRefusal({ settlement, heldEdits });
        /* AND A TOAST (D273 item 6, ledger 2 C57). It is not a second copy of
           the banner: the banner is the standing record, at the top of a ledger
           the operator may have scrolled well past, and the press that produced
           it happened in the dock at the BOTTOM of that ledger. The toast is
           what reaches the eye that is still on the button — and it is the
           courtesy notice, not the record: it auto-dismisses on its own, while
           the standing banner (`Refusal` for `rejected`, `Banner tone="danger"`
           for `conflict` — both `role="alert"`, CheckpointRefusal's own comment
           above) is the half a human dismisses, on EITHER arm.
           `ds/primitives-overlay.tsx`'s toast ties its live-region role straight
           to tone — `role="alert"` for `danger`, `role="status"` otherwise — so
           a `danger` toast here would announce the same sentence the banner just
           announced a SECOND time, and the two survive as near-duplicates on
           screen. `warning` is the register the `conflict` arm already used for
           an unrelated reason (D253: "a kernel rejection is a rule they have to
           read"); it also happens to be `role="status"`, so it is reused on
           BOTH arms to keep the toast polite and let the banner alone own the
           assertive announcement. */
        const copy = checkpointRefusalCopy(settlement.reason, heldEdits);
        toast({
          tone: "warning",
          title: copy.title,
          description: `${copy.heldSentence} ${settlement.message}`,
        });
        return;
      }
      onExpandedChange(false);
      setDrafts({});
      setReason("");
      onSaved();
    }, (caught: unknown) => {
      setSaving(false);
      /* A THROW IS NOT A REFUSAL, and this is the one place that mattered. The
         envelope is already on the wire, so `problem` printing the raw error
         beside the drafts left the operator with a red line and no statement of
         what may or may not have landed — and the honest answer is that this
         side cannot know (D272 item 9's review, `commandFailureToast`). */
      toast(commandFailureToast({ stage: "after-dispatch", caught }));
    });
  };

  const saveBlocked = liveLock !== undefined
    ? liveLock
    : dirty.length === 0
      ? "Change a value to save a correction."
      : reason.trim().length === 0
        ? "A correction needs a reason — it becomes the field's operator provenance."
        : undefined;

  return (
    /* THE SECTION'S ACCESSIBLE NAME IS ITS VISIBLE ONE, and that is a RECORDED
       divergence from the demo rather than drift (D273 item 5, ledger 2 C16;
       the row is in `src/dashboard/CLAUDE.md`'s ruled-deviations table). The
       demo's section is `aria-label="Data"` under a visible `Extracted fields`
       (`DemoContextRail.tsx:590-592`) — a mismatch it inherited when its own
       visible label changed and its region name did not. Porting it would put
       two different names on one region and undo the rule this bundle ratified
       three weeks ago: one expression to both halves so they cannot drift
       (WCAG 2.5.3, `intake.tsx`'s review checkbox). The exactness this costs is
       one string nobody sees; the fidelity it keeps is the whole point of the
       word change R6 f.3a made. */
    <section aria-label={DATA_SECTION_LABEL} className="flex shrink-0 flex-col gap-[var(--ds-space-snug)]">
      {/* THE SECTION HEAD — label · ⓘ · Widen (R6 f.3a/3b/3c). `Extracted
          fields` is the demo's own word for what this ledger holds
          (`DemoContextRail.tsx:589`); `Data` said what kind of thing it was,
          not what is in it, and the rail is already headed `Run data`. */}
      <DataSectionHead expanded={expanded} onExpandedChange={onExpandedChange} />

      {payload.entries.length === 0 ? (
        /* A plain sentence, not an `EmptyState` card (R6 f.17,
           `DemoContextRail.tsx:659-663`). An illustrated empty card inside a
           376px rail is a second surface inside a section; the ledger's own
           absence is one line long. */
        <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
          No run data recorded — this run has not extracted or written any fields yet.
        </p>
      ) : (
        <>
          {/* THE SUMMARY CHIP ROW IS GONE — deliberately, and nothing replaced
              it (demo `DemoContextRail.tsx:665-680`, operator 2026-07-27:
              "remove these tags in data"). See the rail floor below for where
              this codebase had put it back. */}
          {/* LEVEL 1 — the STEP that recorded the values under it (R6 f.1,
              D252). It is what makes an eight-row ledger read as "three things
              this run did", and it is only drawn where the build can name the
              step: the unattributed group has no heading rather than a made-up
              one. */}
          {/* THE GROUP'S OWN CHROME (D273 item 5, ledger 2 C51). R6 f.1 named
              "Well + recessed caps band + divided rows" in ONE breath and D252
              delivered the LEVELS and none of it, so the hierarchy the operator
              asked to see before reading any copy was carried by a caps label
              alone — a heading floating over rows it had no visible claim on.

              The demo's argument (`DemoContextRail.tsx:762-803`) is that a step
              is "a recessed band over ONE continuous ledger, not a floating
              heading over unrelated controls". So: the band takes the Well's
              recessed fill, the body takes the rail's own `--ds-surface-1` back
              (which is why this reads as one banded ledger rather than as a
              card — there is one line around the group and no second plane
              inside it), and the rows are divided by the subtle hairline. The
              gap BETWEEN groups is `base` and the gap under a band is nothing:
              more space above a heading than below it is what makes the heading
              belong to the rows that follow it. */}
          <div className="flex flex-col gap-[var(--ds-space-base)]">
            {groupEntriesByStep(payload.entries).map((group) => {
              const rows = group.rows.map(({ entry, index }, position) => {
                const policy = policies[index]?.policy;
                if (policy === undefined) return null;
                const fieldId = `${fieldIdBase}-${String(index)}`;
                const isDirty = policy.kind === "editable"
                  && dirty.some(({ policy: dirtyPolicy }) => fieldKeyOf(dirtyPolicy) === fieldKeyOf(policy));
                const freshness = freshnessNoteOf(entry);
                return (
                  <div
                    key={`${entry.label}:${String(index)}`}
                    className={cn(
                      // The row's inset is the BAND's inset, so the label lines
                      // up under the step that recorded it. An unattributed
                      // group draws no band, so it takes no inset either.
                      group.origin !== undefined && "px-[var(--ds-space-base)]",
                      position > 0 && "border-t border-[color:var(--ds-border-subtle)]",
                    )}
                  >
                  <LedgerRow
                    label={entry.label}
                    {...(entry.origin === undefined ? {} : { dir: entry.origin.dir })}
                    {...(policy.kind === "editable" ? { fieldId } : {})}
                    marks={
                      <>
                        {/* A WORD, not just the amber fill on the field below it
                            (R6 f.2) — the fill is the fast signal and the word is
                            the one that survives a colour-blind operator or a
                            forced-colors mode. */}
                        {isDirty && (
                          <Badge
                            tone="warning"
                            className="shrink-0"
                            title="You changed this value. It is not saved yet."
                          >
                            changed
                          </Badge>
                        )}
                        <ProvenanceMarks entry={entry} />
                      </>
                    }
                  >
                    {policy.kind === "locked" ? (
                      <LockedValue value={entry.valueRedacted} reason={policy.reason} />
                    ) : (
                      <>
                        {/* Focus is what raises the wide surface: the rail widens
                            before the first keystroke, not after it. React's
                            onFocus bubbles, so the wrapper hears the input's
                            focus without ValueField growing a prop. */}
                        <span className="flex min-w-0 flex-col" onFocus={enterEditing}>
                          <ValueField
                            id={fieldId}
                            value={draftTextOf(drafts, policy)}
                            dirty={isDirty}
                            onChange={(next) => {
                              setDrafts((current) => ({ ...current, [fieldKeyOf(policy)]: next }));
                            }}
                          />
                        </span>
                        {policy.pending !== undefined && (
                          <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
                            {/* CLOCKED, never the raw instant (R6 f.22) — this is
                                a sentence an operator reads. */}
                            Corrected {fmtClock(policy.pending.correctedAt)} — applies when the run
                            resumes; the run recorded {String(policy.recorded)}.
                          </span>
                        )}
                      </>
                    )}
                    {/* D252 — the REUSE bound, under the value it bounds. It
                        appears only where the executor's own walk would enforce
                        it: a finite limit whose facts reach a write. */}
                    {freshness !== undefined && (
                      <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
                        {freshness}
                      </span>
                    )}
                  </LedgerRow>
                  </div>
                );
              });
              /* THE UNATTRIBUTED GROUP TAKES NO WELL AND NO BAND (D252's own
                 rule, one level on). The chrome ENCODES the step — that is the
                 whole reason it is there — so a group that HAS no step has
                 nothing to encode, and drawing it an empty band would be the
                 made-up heading in a quieter form. Its rows keep the dividers,
                 because those separate values rather than name a producer. */
              if (group.origin === undefined) {
                return <div className="flex flex-col" key={UNATTRIBUTED_GROUP_KEY}>{rows}</div>;
              }
              return (
                <Well key={group.origin.nodeId} className="overflow-hidden p-0">
                  <div
                    className={cn(
                      "flex min-h-[var(--ds-h-sm)] min-w-0 items-center gap-[var(--ds-space-tight)]",
                      "px-[var(--ds-space-base)] py-[var(--ds-space-tight)]",
                    )}
                  >
                    <SectionLabel className="min-w-0 truncate">{group.origin.step}</SectionLabel>
                    {/* The system chip rides the BAND, not each row (D252) —
                        every value a step recorded came from the same place,
                        and repeating it per row is the redundancy this rail
                        keeps removing. */}
                    {group.origin.system !== undefined && (
                      <SystemChip system={group.origin.system} className="mr-0 shrink-0" />
                    )}
                  </div>
                  <div className="border-t border-[color:var(--ds-recess-border)] bg-[var(--ds-surface-1)]">
                    {rows}
                  </div>
                </Well>
              );
            })}
          </div>

          {/* A draft that will not parse. It never left this tab, so it is a
              validation message about a field rather than a refusal, and it
              keeps the plain alert it has always had. */}
          {problem !== null && (
            <span role="alert" className={cn(dsText.meta, "text-[color:var(--ds-danger)]")}>
              {problem}
            </span>
          )}

          <CheckpointRefusal
            refusal={refusal}
            onDismiss={() => {
              // Focus BEFORE the clear: `setRefusal(null)` unmounts the
              // Dismiss button underneath the operator's focus in the same
              // tick, and a focus move issued after that state update would
              // be racing React's own re-render rather than preceding it.
              saveButtonRef.current?.focus();
              setRefusal(null);
            }}
          />
          {/*
            THE LIVE LOCK IS A STANDING STATE, NOT AN ALERT — and the wave-end
            parity gate is what proved the difference matters.

            R6 lifted these two lines out of the old `editing` gate so the
            reason is on screen before the operator reaches for a field. That
            was right for `problem` above, which is `null` until a save is
            refused, and wrong for this one: `liveLockReasonOf` is a fact about
            the RUN, true from the moment the panel opens, so `role="alert"`
            shouted it assertively on page load for every terminal or claimed
            run. `dual-adapter.spec.ts` caught it as a role the fixture adapter
            rendered and the seeded adapter did not — the seeded backend serves
            no context-data entries, so it never reaches this branch at all.

            It keeps `aria-live`, because the lock CAN arrive mid-session: the
            day stream moves the row's status while the panel is open, and a
            rail that silently goes read-only under the operator's hands is the
            thing D19 exists to prevent. Polite, not assertive — nothing here
            interrupts, and the same sentence is on every row's own lock.
          */}
          {liveLock !== undefined && (
            <span aria-live="polite" className={cn(dsText.meta, "text-[color:var(--ds-danger)]")}>
              {liveLock}
            </span>
          )}

          {/* THE REASON IS AN ON-RECORD DEVIATION FROM THE DEMO (R6 f.21), and
              the record is the schema: `CheckpointPatchSchema.reason` is
              `z.string().min(1)` (`src/domain/workflow/checkpoint.ts:257`), so
              every patch this dock can send carries one and the kernel refuses
              a patch without it. The demo captures no reason because its save
              is a mock. Provenance beats demo-exactness: a correction whose
              justification the operator never typed would have to be
              fabricated at the wire, which is the one thing this tree forbids.
              It sits ABOVE the dock rather than inside it — the dock is four
              commands on one grid, and a text input is not a command. */}
          {dirty.length > 0 && (
            <Field label="Why is this correct?" hint="Recorded as the correction's provenance">
              <Input
                value={reason}
                placeholder="e.g. CRM shows 2026-07-15; the read mis-parsed the date"
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
          )}

          {/*
            THE ACTION DOCK — ported from legacy hr-automation@1bffbd65,
            `DemoContextRail.tsx:822-930` (R6 f.5).

            ONE GRID, TWO ROWS, TWO COLUMNS — and every edge is a column. It was
            a flat Save/Cancel pair here: two treatments, two widths, sharing
            neither a left nor a right edge, sitting where the dock belongs.

            So: `grid-cols-2`, every button `w-full`. Column one is a left edge,
            column two is a right edge, and the cells are the same size whatever
            the labels say. Reading order is the house order — the quiet,
            undoable arm first, the commit arm last — so the eye ends on the
            verb. ONE CONTROL FAMILY: peers are `secondary` and exactly one is
            `primary`.

            THE STATE LINE lives in the dock's own quiet meta slot: row zero,
            spanning both columns, `aria-live` so a screen reader hears the
            count change without the focus moving.

            `Load prior run` and `Start custom run` render ONLY when their
            handlers are passed, and nothing passes them yet: the prior-runs
            list and the custom-run descriptor are on the audit's hookup ledger.
            Their absence is VISIBLE — two cells rather than four — which is the
            honest rendering; a disabled button that can never enable is a
            promise the wire cannot keep.
          */}
          <Well className="flex flex-col gap-[var(--ds-space-snug)] p-[var(--ds-space-snug)]">
            <div className="grid grid-cols-2 gap-[var(--ds-space-snug)]">
              <p
                aria-live="polite"
                className={cn(dsText.meta, "col-span-2 text-[color:var(--ds-fg-muted)]")}
              >
                {/* The demo's third arm — "Loaded the values from run #N" — is
                    reachable only through `Load prior run`, which has no wire.
                    It is not written here as an unreachable branch. */}
                {dirty.length > 0
                  ? `${plural(dirty.length, "value")} changed, not saved yet.`
                  : "No unsaved changes."}
              </p>
              {onLoadPriorRun !== undefined && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  icon={<History aria-hidden className={dsIcon.sm} />}
                  onClick={onLoadPriorRun}
                >
                  Load prior run
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                className="w-full"
                icon={<RotateCcw aria-hidden className={dsIcon.sm} />}
                disabled={dirty.length === 0}
                onClick={resetEdits}
              >
                Reset edits
              </Button>
              <Button
                ref={saveButtonRef}
                size="sm"
                // ONE CONTROL FAMILY: the dock's peers are `secondary` and
                // exactly one of them is `primary`. On this surface the commit
                // arm is that one — the demo lets the SERVER choose between
                // save and start-custom-run, and only one of the two exists
                // here.
                variant="primary"
                icon={<Save aria-hidden className={dsIcon.sm} />}
                // A lone commit arm takes the RIGHT-HAND cell, never the left:
                // the primary's place on this surface is the bottom right
                // corner, and a grid that lets it slide to column one when its
                // partner is absent has moved the one control the operator aims
                // at without saying so.
                className={cn("w-full", onStartCustomRun === undefined && "col-start-2")}
                disabled={saving || saveBlocked !== undefined}
                // NO `title` (D273 item 6, ledger 2 C70). The blocked reason was
                // on this tooltip AND in the sentence under the dock, which is
                // the exact duplicate D272 items 8–9 removed from the Run Modal:
                // "a `title` is not a second rendering of a fact, it is a second
                // READING of it", so the same sentence was announced twice. The
                // VISIBLE half is the one that survives, because it is the half
                // reachable without a pointer — a reason that lives only on a
                // `title` is a fact the product does not have.
                onClick={save}
              >
                {/* `Saving…` HAS NO DEMO COUNTERPART AND STAYS (D273 item 6,
                    ledger 2 C71 — recorded in `src/dashboard/CLAUDE.md`'s ruled
                    deviations table). The demo's save is a synchronous mock; this
                    one is a real `run/edit-checkpoint` round trip, and a control
                    that looks identical while a command is in flight invites the
                    second press that D272's own after-dispatch lesson is about.
                    The label IS the pending state rather than a spinner beside
                    it, so the fact reaches a screen reader on the control's own
                    accessible name and not through decoration. */}
                {saving ? "Saving…" : `Save ${plural(dirty.length, "correction")}`}
              </Button>
              {onStartCustomRun !== undefined && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  icon={<Play aria-hidden className={dsIcon.sm} />}
                  onClick={onStartCustomRun}
                >
                  Start custom run
                </Button>
              )}
            </div>
          </Well>
          {/* WHY THE COMMIT ARM IS DISABLED, printed exactly ONCE. It is gated
              on `liveLock === undefined` because the live lock has its own
              `aria-live` line above and `saveBlocked` would repeat it verbatim —
              the two branches together mean the reason is on screen in every
              blocked state and in no state twice. It is the primary's `title`
              that went (C70), not this. */}
          {saveBlocked !== undefined && liveLock === undefined && (
            <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
              {saveBlocked}
            </span>
          )}
        </>
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
          {dataExpanded ? "Run data · editing" : "Run data"}
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
            Attempts are hidden while you edit — narrow the surface to bring them back.
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
