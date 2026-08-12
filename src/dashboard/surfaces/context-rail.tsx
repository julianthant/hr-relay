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
import { Database, PanelRightClose, PanelRightOpen } from "lucide-react";
import type { z } from "zod";
import { systemClock } from "../../domain/clock.js";
import { readEnumPreference, writePreference } from "../lib/preference-storage.js";
import { cn } from "../lib/utils.js";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  IconButton,
  Input,
  LockedValue,
  SectionLabel,
  Separator,
  ValueField,
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
 * The clock is the least load-bearing thing on the row, so it is the FIRST to
 * fold away in the resting 376px rail and the first to return when the rail
 * widens to edit in — the demo's own `@min-[26rem]:` rule, on the rail's own
 * container. It reads `-muted` rather than `-faint`: `-faint` is the
 * disabled/placeholder step and a real observation is neither.
 *
 * The badges do NOT fold. `corrected` says a human overrode what the run read,
 * and a hazard is never disclosed behind a width.
 */
function ProvenanceMarks({ entry }: { entry: ContextDataEntry }) {
  const { observedAt, source, correctedAt } = entry;
  if (observedAt === undefined && source === undefined && correctedAt === undefined) return null;
  return (
    <>
      {correctedAt !== undefined && (
        <Badge
          tone="warning"
          className="shrink-0"
          title={`Corrected by an operator at ${correctedAt}. The run's own reading is kept beside it on the receipt.`}
        >
          corrected
        </Badge>
      )}
      {/* `live` is the unmarked default — it is what most rows are, and a badge
          on every row is a badge on none. `derived` earns one because a
          computed value's clock is not a live observation of anything. */}
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
          className={cn(
            dsText.micro,
            dsText.nums,
            "hidden shrink-0 text-[color:var(--ds-fg-muted)] @min-[26rem]:inline",
          )}
        >
          {fmtClock(observedAt)}
        </span>
      )}
    </>
  );
}

function LedgerRow({
  label,
  marks,
  children,
}: {
  label: string;
  /** the row's provenance marks, right-aligned on the label line */
  marks?: ReactNode;
  children: ReactNode;
}) {
  const labelId = useId();
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
            `title` and from the value under it. */}
        <span className="flex min-w-0 items-center gap-[var(--ds-space-snug)]">
          <span
            id={labelId}
            title={label}
            className={cn(
              dsText.body,
              dsText.flush,
              "min-w-0 truncate font-medium text-[color:var(--ds-fg-secondary)]",
            )}
          >
            {label}
          </span>
          {marks !== undefined && (
            <span className="ml-auto flex shrink-0 items-center gap-[var(--ds-space-tight)]">
              {marks}
            </span>
          )}
        </span>
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
 * Reads are editable in place; the section enters EDITING on the first focus
 * of a value box (the rail widens, the reason + Save footer appears) and
 * leaves it on Cancel or an applied save. A save is one `run/edit-checkpoint`
 * command: field patches CASed on the version this payload was served with —
 * the kernel re-validates everything; this surface only says why a save is
 * not possible BEFORE it is attempted.
 */
function DataSection({
  payload,
  actorId,
  liveStatus,
  onEditingChange,
  onSaved,
}: {
  payload: ContextDataPayload;
  actorId: string;
  liveStatus: string | undefined;
  onEditingChange: (editing: boolean) => void;
  onSaved: () => void;
}) {
  const client = useDashboardClient();
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    onEditingChange(editing);
  }, [editing, onEditingChange]);

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

  const enterEditing = (): void => {
    setEditing(true);
  };
  const cancel = (): void => {
    setEditing(false);
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
      setEditing(false);
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
    <section aria-label="Data" className="flex flex-col gap-[var(--ds-space-snug)]">
      <SectionLabel>Data</SectionLabel>
      {payload.entries.length === 0 ? (
        <EmptyState
          title="No data yet"
          description="Values this run recorded appear here as it reads them."
          className="p-[var(--ds-space-cozy)]"
        />
      ) : (
        <div className="flex flex-col">
          {policies.map(({ entry, policy }, index) => (
            <LedgerRow
              key={`${entry.label}:${String(index)}`}
              label={entry.label}
              marks={<ProvenanceMarks entry={entry} />}
            >
              {policy.kind === "locked" ? (
                <LockedValue value={entry.valueRedacted} reason={policy.reason} />
              ) : (
                <>
                  {/* Focus is what ENTERS editing: the reason + Save footer and
                      the widened rail appear before the first keystroke, not
                      after it. React's onFocus bubbles, so the wrapper hears
                      the input's focus without ValueField growing a prop. */}
                  <span className="flex min-w-0 flex-col" onFocus={enterEditing}>
                    <ValueField
                      ariaLabel={`${entry.label} — recorded value`}
                      value={draftTextOf(drafts, policy)}
                      dirty={dirty.some(({ policy: dirtyPolicy }) => fieldKeyOf(dirtyPolicy) === fieldKeyOf(policy))}
                      onChange={(next) => {
                        setDrafts((current) => ({ ...current, [fieldKeyOf(policy)]: next }));
                      }}
                    />
                  </span>
                  {policy.pending !== undefined && (
                    <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
                      Corrected {policy.pending.correctedAt} — applies when the run resumes; the run
                      recorded {String(policy.recorded)}.
                    </span>
                  )}
                </>
              )}
            </LedgerRow>
          ))}
        </div>
      )}

      {editing && (
        <div className="flex flex-col gap-[var(--ds-space-base)]">
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
          <Field
            label="Why is this correct?"
            hint="Recorded as the correction's provenance"
          >
            <Input
              value={reason}
              placeholder="e.g. CRM shows 2026-07-15; the read mis-parsed the date"
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <div className="flex items-center gap-[var(--ds-space-base)]">
            <Button
              size="sm"
              disabled={saving || saveBlocked !== undefined}
              onClick={save}
              aria-label="Save corrections"
            >
              {saving ? "Saving…" : `Save ${plural(dirty.length, "correction")}`}
            </Button>
            <Button size="sm" variant="ghost" onClick={cancel} aria-label="Discard corrections">
              Cancel
            </Button>
          </div>
          {saveBlocked !== undefined && liveLock === undefined && (
            <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
              {saveBlocked}
            </span>
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
          label="Show run data — recorded fields and attempts"
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
  onDataEditingChange,
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
  /** The layout owner widens the rail while the Data section is being edited. */
  onDataEditingChange: (editing: boolean) => void;
  /** An applied save bumped the run version — the owner refetches detail + sections. */
  onSaved: () => void;
}) {
  const data = sections["context-data"];
  const evidence = sections["context-evidence"];
  const attempts = sections["context-attempts"];

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
        <span className={cn(dsText.title, "min-w-0 truncate font-semibold text-[color:var(--ds-fg)]")}>
          Run data
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
         * ORDER: Data · Evidence · Attempts. Captures live in Receipt — they
         * are evidence that qualifies the outcome, not contextual input beside
         * the live stream — and provenance is the Log Panel's bottom bar,
         * beside the stream its version qualifies.
         *
         * A section the run did not advertise is not drawn at all. An advertised
         * section with no entries draws its empty state, because "this run
         * recorded nothing here" and "this run cannot record here" are
         * different facts and the operator acts on them differently.
         */}
        {data !== undefined && isDataPayload(data) ? (
          <DataSection
            key={data.runId}
            payload={data}
            actorId={actorId}
            liveStatus={liveStatus}
            onEditingChange={onDataEditingChange}
            onSaved={onSaved}
          />
        ) : (
          <ContextSection
            label="Data"
            payload={data}
            emptyDescription="Values this run recorded appear here as it reads them."
            lockReason="Recorded by the run."
          />
        )}
        {evidence !== undefined && (
          <>
            <Separator />
            <ContextSection
              label="Evidence"
              payload={evidence}
              emptyDescription="Evidence this run captured appears here."
              lockReason="Evidence is captured, never edited."
            />
          </>
        )}
        {attempts !== undefined && (
          <>
            <Separator />
            <ContextSection
              label="Attempts"
              payload={attempts}
              emptyDescription="Every attempt of this run appears here."
              lockReason="Attempts are history; history is never edited."
            />
          </>
        )}
        <Separator />
        <span className={cn(dsText.meta, dsText.nums, "text-[color:var(--ds-fg-muted)]")}>
          {plural(summary.dataFacts, "field")} · {plural(summary.attempts, "attempt")}
        </span>
      </div>
    </aside>
  );
}
