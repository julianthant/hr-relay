/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/DemoContextRail.tsx
 *
 * The Context rail — the permanent home of a run's DATA, beside the stream
 * rather than behind a tab (doc 13 §3.3: "Data lives in the Context rail").
 *
 * WHAT THE 1i WIRE SERVES, and what that costs this surface. A context section
 * is `{ runId, entries: [{ label, valueRedacted }] }` — a label and an
 * already-redacted string, and nothing else. The demo's ledger drew four more
 * axes on every row: DIRECTION (the `--ds-read-*` / `--ds-write-*` pair), the
 * originating system, the observation clock, and an editable/locked policy with
 * dirty/corrected/refreshed/staged/unconfirmed badges. None of them is on this
 * wire, so none of them is drawn — a direction arrow this surface guessed would
 * be a claim about whether a run CHANGED the world, which is the most expensive
 * thing in this product to get wrong.
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
import { useCallback, useEffect, useId, useState } from "react";
import { Database, PanelRightClose, PanelRightOpen } from "lucide-react";
import type { z } from "zod";
import { cn } from "../lib/utils.js";
import {
  EmptyState,
  IconButton,
  LockedValue,
  SectionLabel,
  Separator,
  dsIcon,
  dsText,
} from "../ds/ui.js";
import type {
  ContextSummaryWireSchema,
  RunDetailSectionResponseSchema,
} from "../../domain/dashboard/run-detail.js";
import { plural } from "./format.js";

type RunDetailSectionResponse = z.infer<typeof RunDetailSectionResponseSchema>;
export type ContextSummary = z.infer<typeof ContextSummaryWireSchema>;

/** The three context sections this rail renders, exactly as the wire names them. */
export type ContextSectionKind = "context-data" | "context-evidence" | "context-attempts";
export type ContextSectionPayload = Extract<
  RunDetailSectionResponse,
  { section: ContextSectionKind }
>["payload"];

/** What the rail is handed: whichever context sections the run advertised. */
export type ContextSections = Partial<Record<ContextSectionKind, ContextSectionPayload>>;

// ---------------------------------------------------------------------------
// open / collapsed, persisted
// ---------------------------------------------------------------------------

const RAIL_STORAGE_KEY = "hrauto-rebuild.context-rail";

function readStoredRailOpen(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(RAIL_STORAGE_KEY) !== "closed";
  } catch {
    // A blocked localStorage (private mode, storage off) is a real browser
    // state, not a failed read: it means there is no stored preference, which
    // is the documented default — open.
    return true;
  }
}

/**
 * The three-column threshold, as a matchMedia the LAYOUT also uses. It is here
 * in JS as well as in the class names for one reason: collapsing is a
 * three-column affordance. Below the threshold the region is a scrolling stack,
 * and a collapsed spine there would hide the data behind a control that gives
 * back 34px of a column that no longer exists — so the stored preference is
 * simply not applied at that width.
 */
const THREE_COLUMN_QUERY = "(min-width: 1280px)";

function useThreeColumnRegion(): boolean {
  const [wide, setWide] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia(THREE_COLUMN_QUERY).matches,
  );
  useEffect(() => {
    const query = window.matchMedia(THREE_COLUMN_QUERY);
    const onChange = (): void => setWide(query.matches);
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return wide;
}

export interface ContextRailState {
  open: boolean;
  collapsed: boolean;
  setOpen: (open: boolean) => void;
}

export function useContextRail(): ContextRailState {
  const [open, setOpenState] = useState(readStoredRailOpen);
  const wide = useThreeColumnRegion();
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    try {
      window.localStorage.setItem(RAIL_STORAGE_KEY, next ? "open" : "closed");
    } catch {
      // An unwritable store loses the preference for next time. That is not a
      // reason to refuse the operator this one.
    }
  }, []);
  return { open, collapsed: !open && wide, setOpen };
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
 * The value is `LockedValue`, which is the honest shape here: nothing in 1i can
 * correct a context entry (checkpoint editing is doc 06's, deferred to 2h), and
 * DESIGN.md's rule is that "you may change this" and "you may not" are told
 * apart by SHAPE — flat text with a lock, never a field-looking box the
 * operator can click into and discover does nothing.
 */
function LedgerRow({ label, value }: { label: string; value: string }) {
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
        <LockedValue
          value={value}
          reason="Recorded by the run. Correcting a recorded value is not part of this slice."
        />
      </div>
    </div>
  );
}

function ContextSection({
  label,
  payload,
  emptyDescription,
}: {
  label: string;
  payload: ContextSectionPayload | undefined;
  emptyDescription: string;
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
            <LedgerRow key={entry.label} label={entry.label} value={entry.valueRedacted} />
          ))}
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
}: {
  summary: ContextSummary;
  sections: ContextSections;
  onClose: () => void;
  className?: string;
}) {
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
        <ContextSection
          label="Data"
          payload={sections["context-data"]}
          emptyDescription="Values this run recorded appear here as it reads them."
        />
        {evidence !== undefined && (
          <>
            <Separator />
            <ContextSection
              label="Evidence"
              payload={evidence}
              emptyDescription="Evidence this run captured appears here."
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
