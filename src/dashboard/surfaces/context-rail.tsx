/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/DemoContextRail.tsx
 *
 * The Context rail — the permanent home of a run's DATA, beside the stream
 * rather than behind a tab (doc 13 §3.3: "Data lives in the Context rail").
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
 *  - **DIRECTION is still absent.** Nothing durable says whether a recorded
 *    field was read or written, and a direction arrow this surface guessed
 *    would be a claim about whether a run CHANGED the world — the most
 *    expensive thing in this product to get wrong. It stays undrawn.
 *  - **The originating system is still absent**, and so is the demo's
 *    `refreshed` badge, which means "this changed on the server since you
 *    looked" and needs the superseded reading beside the current one. This
 *    wire carries one value per entry, so there is nothing to compare.
 *
 * An absent axis draws NOTHING — never a placeholder, never a dash, and never
 * a plausible default.
 *
 * What survives is the ratified SHAPE: the stacked label-over-value row bound
 * by a rail (the rail is what makes an eight-row ledger read as eight things
 * and not sixteen — that job is layout, not direction, so it stays in the
 * neutral ink), the section order, the collapse affordance and its persisted
 * preference, and the spine that still says what it is hiding.
 *
 * Values arrive redacted BY THE SERVER. `valueRedacted` renders verbatim: this
 * surface never re-derives, re-formats or unmasks one.
 */
import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import {
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
import type { z } from "zod";
import { systemClock } from "../../domain/clock.js";
import { readEnumPreference, writePreference } from "../lib/preference-storage.js";
import { cn } from "../lib/utils.js";
import {
  Badge,
  BulletList,
  Button,
  EmptyState,
  Field,
  IconButton,
  Input,
  LockedValue,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SectionLabel,
  Separator,
  ValueField,
  Well,
  dsIcon,
  dsText,
} from "../ds/ui.js";
import type {
  ContextSummaryWireSchema,
  RunDetailSectionResponseSchema,
} from "../../domain/dashboard/run-detail.js";
import { useDashboardClient } from "../state/client-context.js";
import { fmtClock, plural } from "./format.js";

type RunDetailSectionResponse = z.infer<typeof RunDetailSectionResponseSchema>;
export type ContextSummary = z.infer<typeof ContextSummaryWireSchema>;

/** The three context sections this rail renders, exactly as the wire names them. */
export type ContextSectionKind = "context-data" | "context-evidence" | "context-attempts";
export type ContextSectionPayload = Extract<
  RunDetailSectionResponse,
  { section: ContextSectionKind }
>["payload"];

/** The Data section's own payload — the one that carries the edit policy (2i-C). */
export type ContextDataPayload = Extract<
  RunDetailSectionResponse,
  { section: "context-data" }
>["payload"];
export type ContextDataEntry = ContextDataPayload["entries"][number];

function isDataPayload(payload: ContextSectionPayload): payload is ContextDataPayload {
  return "editing" in payload;
}

/** What the rail is handed: whichever context sections the run advertised. */
export type ContextSections = Partial<Record<ContextSectionKind, ContextSectionPayload>>;

// ---------------------------------------------------------------------------
// open / collapsed, persisted
// ---------------------------------------------------------------------------

const RAIL_STORAGE_KEY = "hrauto-rebuild.context-rail";

/** The documented default for a rail nobody has expressed a preference about. */
const RAIL_DEFAULT: RailPreference = "open";

type RailPreference = "open" | "closed";

const RAIL_PREFERENCES: readonly RailPreference[] = ["open", "closed"];

function readStoredRailOpen(): boolean {
  // `readEnumPreference` keeps "nothing stored", "storage refused" and "stored
  // something we do not recognise" apart internally and lands all three on the
  // named default above — rather than a catch block inventing `true`.
  return readEnumPreference(RAIL_STORAGE_KEY, RAIL_PREFERENCES, RAIL_DEFAULT) === "open";
}

export interface ContextRailState {
  open: boolean;
  collapsed: boolean;
  setOpen: (open: boolean) => void;
}

/**
 * `threeColumn` is the REGION's own answer, handed down by the layout owner —
 * it was a `matchMedia("(min-width: 1280px)")` here, and that was the window.
 *
 * Collapsing is a three-column affordance: below the threshold the region is a
 * scrolling stack, and a spine there would hide the data behind a control that
 * gives back 34px of a column that no longer exists — so the stored preference
 * is simply not applied. The threshold that decides it has to be the same one
 * the columns switch on, and that one is now the COLUMN's width (doc 03
 * §Shell), which only the element that owns the box can measure. Asking the
 * window from here reintroduced the exact disagreement: with the workflow
 * panel docked at a 1280px window this hook said "three columns" while the
 * region had 668px and was drawing a stack.
 */
export function useContextRail(threeColumn: boolean): ContextRailState {
  const [open, setOpenState] = useState(readStoredRailOpen);
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    // The write's outcome is returned, not thrown away: an unwritable store
    // loses the preference for next time, which is not a reason to refuse the
    // operator this one — but it is a distinguishable outcome, not a silence.
    void writePreference(RAIL_STORAGE_KEY, next ? "open" : "closed");
  }, []);
  return { open, collapsed: !open && threeColumn, setOpen };
}

// ---------------------------------------------------------------------------
// the edit policy (doc 03 D19, doc 06 §6 — 2i-C)
// ---------------------------------------------------------------------------

type EditableScalar = string | number | boolean;

export type EditPolicy =
  | {
    kind: "editable";
    nodeId: string;
    fieldPath: string;
    recorded: EditableScalar;
    pending: { value: EditableScalar; correctedAt: string } | undefined;
  }
  | { kind: "locked"; reason: string };

/**
 * Doc 03 D19's unlock rule, with the reason ALWAYS shown: a row is editable
 * only when its own field policy, the run-level policy the server computed at
 * fetch, and the LIVE stream all agree — and whichever one disagrees supplies
 * the exact sentence the operator reads on the lock. The most specific reason
 * wins: a field's own lock explains that field; the run-level and live locks
 * apply to every row alike.
 */
export function editPolicyFor(
  entry: ContextDataEntry,
  editing: ContextDataPayload["editing"],
  liveLockReason: string | undefined,
): EditPolicy {
  if (entry.edit.state === "locked") return { kind: "locked", reason: entry.edit.reason };
  if (editing.state === "locked") return { kind: "locked", reason: editing.reason };
  if (liveLockReason !== undefined) return { kind: "locked", reason: liveLockReason };
  return {
    kind: "editable",
    nodeId: entry.edit.nodeId,
    fieldPath: entry.edit.fieldPath,
    recorded: entry.edit.value,
    pending: entry.edit.pendingCorrection.state === "pending"
      ? {
        value: entry.edit.pendingCorrection.value,
        correctedAt: entry.edit.pendingCorrection.correctedAt,
      }
      : undefined,
  };
}

/**
 * The doc 03 D19 staleness signal, read off the live day stream: the section
 * was served editable at fetch, and the queue row's status is the one live
 * fact that says the run has since been claimed or settled. The kernel's CAS
 * is the authority either way — this exists so the operator learns BEFORE
 * pressing Save, not from the rejection.
 */
export function liveLockReasonOf(liveStatus: string | undefined): string | undefined {
  if (liveStatus === undefined) return undefined;
  if (liveStatus === "queued" || liveStatus === "awaiting-approval") return undefined;
  return `The run is now ${liveStatus} — it moved while this data was open, so these values may be `
    + "stale. Reopen the run to edit.";
}

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

function LedgerRow({
  label,
  fieldId,
  marks,
  children,
}: {
  label: string;
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
          not a dot: it binds a label to the value printed underneath it. It is
          NEUTRAL ink — the read/write pair colours a direction, and this wire
          does not carry one. */}
      <span
        aria-hidden
        className={cn(
          "w-[var(--ds-border-w-emphasis)] shrink-0 self-stretch rounded-[var(--ds-radius-pill)]",
          "bg-[var(--ds-border-strong)]",
        )}
      />
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
// the Data section — the merged Data / Edit Data surface (doc 03 §1.1(c))
// ---------------------------------------------------------------------------

const FIELD_KEY_SEPARATOR = "\u0000";

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
function AboutRunData() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          size="xs"
          label="About run data"
          icon={<Info aria-hidden className={dsIcon.sm} />}
          className="text-[color:var(--ds-fg-faint)] hover:text-[color:var(--ds-fg)] data-[state=open]:text-[color:var(--ds-fg)]"
        />
      </PopoverTrigger>
      <PopoverContent title="Run data" side="bottom" align="start" width="lg">
        <BulletList
          items={[
            "This ledger contains every field the run recorded.",
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
 * it (doc 03 D19(d): the resting rail is tight to type a date into).
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
  const fieldIdBase = useId();
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

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

  // Doc 03 D19(d): the resting rail is tight to type a date into, so the first
  // focus raises the wide surface. The Narrow control gives it back — which is
  // the half that did not exist (R6 f.3c).
  const enterEditing = (): void => {
    onExpandedChange(true);
  };
  const resetEdits = (): void => {
    setDrafts({});
    setReason("");
    setProblem(null);
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
    setSaving(true);
    setProblem(null);
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
      if (result.state === "rejected") {
        // The kernel's own sentence, verbatim — it names what moved and what
        // to do; drafts stay so the operator can retry after reloading.
        setProblem(result.message);
        return;
      }
      onExpandedChange(false);
      setDrafts({});
      setReason("");
      onSaved();
    }, (caught: unknown) => {
      setSaving(false);
      setProblem(caught instanceof Error ? caught.message : String(caught));
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
    <section aria-label="Extracted fields" className="flex shrink-0 flex-col gap-[var(--ds-space-snug)]">
      {/* THE SECTION HEAD — label · ⓘ · Widen (R6 f.3a/3b/3c). `Extracted
          fields` is the demo's own word for what this ledger holds
          (`DemoContextRail.tsx:589`); `Data` said what kind of thing it was,
          not what is in it, and the rail is already headed `Run data`. */}
      <div className="flex items-center gap-[var(--ds-space-snug)]">
        <SectionLabel className="min-w-0 truncate">Extracted fields</SectionLabel>
        <AboutRunData />
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
          <div className="flex flex-col">
            {policies.map(({ entry, policy }, index) => {
              const fieldId = `${fieldIdBase}-${String(index)}`;
              const isDirty = policy.kind === "editable"
                && dirty.some(({ policy: dirtyPolicy }) => fieldKeyOf(dirtyPolicy) === fieldKeyOf(policy));
              return (
                <LedgerRow
                  key={`${entry.label}:${String(index)}`}
                  label={entry.label}
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
                </LedgerRow>
              );
            })}
          </div>

          {problem !== null && (
            <span role="alert" className={cn(dsText.meta, "text-[color:var(--ds-danger)]")}>
              {problem}
            </span>
          )}
          {liveLock !== undefined && (
            <span role="alert" className={cn(dsText.meta, "text-[color:var(--ds-danger)]")}>
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
                title={saveBlocked}
                onClick={save}
              >
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
  /** The layout owner widens the rail while the Data surface is expanded. */
  onDataExpandedChange: (expanded: boolean) => void;
  /** An applied save bumped the run version — the owner refetches detail + sections. */
  onSaved: () => void;
}) {
  const data = sections["context-data"];
  const attempts = sections["context-attempts"];

  /**
   * The Data surface has been widened to be edited in — the rail's own state,
   * because two things read it: this component's header word and the layout
   * owner's column width. It resets whenever the run changes, which the
   * `key={data.runId}` on `DataSection` cannot do for a flag held out here.
   */
  const [dataExpanded, setDataExpanded] = useState(false);
  const runId = data !== undefined && isDataPayload(data) ? data.runId : undefined;
  useEffect(() => setDataExpanded(false), [runId]);
  const setExpanded = useCallback((next: boolean) => {
    setDataExpanded(next);
    onDataExpandedChange(next);
  }, [onDataExpandedChange]);

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
            onExpandedChange={setExpanded}
            onSaved={onSaved}
          />
        ) : (
          <ContextSection
            label="Extracted fields"
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
