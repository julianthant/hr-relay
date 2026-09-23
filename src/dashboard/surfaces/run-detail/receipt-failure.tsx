import { TriangleAlert } from "lucide-react";
import type { ComponentProps } from "react";
import type { z } from "zod";
import { cn } from "../../lib/utils.js";
import {
  FailureDetailBody,
  FailureRecordHead,
} from "../trust.js";
import { FailureAdvisoryPanel } from "../advisory.js";
import { fmtClock } from "../format.js";
import { dsFocus, dsIcon, dsRadius, dsText, MetaLine, SectionLabel } from "../../ds/ui.js";
import type { RunDetailSectionResponseSchema, NotePageSchema } from "../../../domain/dashboard/run-detail.js";
import type { CapabilityAvailabilitySchema } from "../../../domain/absence.js";
import type { LiveFailureContext } from "../trust-model.js";
import { ReceiptView } from "../receipt.js";

type RunDetailSectionResponse = z.infer<typeof RunDetailSectionResponseSchema>;
type NotePage = z.infer<typeof NotePageSchema>;
export type FailurePayload = Extract<RunDetailSectionResponse, { section: "failure" }>['payload'];
type CapabilityAvailability = z.infer<typeof CapabilityAvailabilitySchema>;

export function ReceiptTab(props: ComponentProps<typeof ReceiptView>) {
  return <ReceiptView {...props} />;
}

/**
 * THE FAILURE RECORD, rendered where the run died.
 *
 * 1i served the record's IDENTITY (`{ runId, failureId }`) and the facts around
 * it — the terminal outcome, the timeline's failed event, and the error-level
 * notes in the stream. The ref operator-trust projection that turns that id
 * into a summary, a code, a write state and a remediation ladder landed at
 * 2g/2i-A, so this component owns the FRAME and the HEAD and `FailureDetailBody`
 * (`trust.tsx`) owns everything the projection serves.
 *
 * The head is the run's own `summary`, its `code` and its permanence (D273
 * item 8) — never a category the surface authored, except in the one arm where
 * no record was served and "this run failed" is the whole of what is known.
 *
 * THE READING ORDER BELOW IS THE RULE, not a layout (ref dashboard-surfaces D18):
 * what this run left behind, then what is safe to retry, then — behind
 * `Show the diagnostic record` — why. The first two never sit behind the
 * disclosure, because the difference between "wrote nothing" and "we never read
 * back" is the whole reason that sentence exists, and a fact an operator has to
 * press for cannot decide whether they press retry.
 */
/**
 * Exported for the D273 item 8 head pin
 * (`tests/unit/dashboard/failure-record-render.test.ts`), on the same footing
 * as `InlineDecision` above: the head's three facts — the run's own `summary`,
 * its `code` and its permanence — are composed in JSX from three places, so no
 * fold can see whether the record leads with the served sentence or with a
 * category the surface authored.
 */
export function InlineFailureRecord({
  failure,
  errorNotes,
  completedAt,
  anchorRef,
  runId,
  aiAdvisory,
  liveContext,
}: {
  liveContext?: LiveFailureContext;
  failure: FailurePayload;
  errorNotes: readonly NotePage["notes"][number][];
  completedAt?: string;
  anchorRef?: (node: HTMLElement | null) => void;
  runId: string;
  /** Ref operator-trust §4.4's advisory availability, off the bootstrap wire (D178). */
  aiAdvisory: CapabilityAvailability;
}) {
  return (
    <div
      ref={anchorRef}
      tabIndex={-1}
      data-panel-failure-record=""
      /*
        `role="group"` is what makes the name below EXIST (unit F8c finding 3).
        HTML-AAM computes no accessible name for a generic element, so an
        `aria-label` on a bare `<div>` names nothing — this bundle's own dated
        lesson (`src/dashboard/CLAUDE.md`, 2026-08-26, the timeline segment),
        one surface later. This container is focusable on purpose: the outcome
        bar's `Open failure` lands on it, and a landing that announces nothing
        is the fact the record exists to carry, lost at the moment of arrival.
      */
      role="group"
      /*
        The record's own sentence names it (E2/E4). When the record is not
        served there is no sentence to name it with, and the bare label is the
        honest one — the arms below say what happened to the record itself.
      */
      aria-label={
        failure.state === "available" ? `Failure record — ${failure.value.summary}` : "Failure record"
      }
      className={cn(
        // same geometry as the inline decision: indented to the stream's
        // hanging indent, a rail in its own tone, and loud where it sits
        "mx-[var(--ds-space-cozy)] my-[var(--ds-space-base)] ml-5 border p-[var(--ds-space-cozy)]",
        dsRadius.lg,
        dsFocus,
        "border-[length:var(--ds-border-w-rail)]",
        "border-[color:var(--ds-danger-border)] bg-[var(--ds-danger-quiet)]",
      )}
    >
      {/*
        THE HEAD SAYS THE FACT (D273 item 8, ledger 2 E4/E5/E6 — legacy
        hr-automation@c9e6aaf3aa8978a776f72205b71a96a988773b43,
        DemoFailure.tsx:180-188). It used to say the CATEGORY — the constant
        `This run failed`, which the status pill, the outcome bar and the danger
        tint had all already said — while the run's own served `summary` waited
        a line below in body copy. The category arm survives for the record the
        wire could NOT serve, where "this run failed" is the whole of what is
        known.

        `code` and permanence ride the head for the same reason: permanence is
        the reading that tells the operator not to press retry, and it was
        drawing as a bare `transient` word with no opposite arm at all.

        The SERVED head moved to `trust.tsx` (unit F8c finding 1) because the
        archive's failure card is its second consumer and was drawing the body
        with no head above it at all. Only this arm forks — a record the
        projection refused exists nowhere else, and it must NOT borrow the
        served head's chips: an unserved record dressed as a served one is the
        fail-loud rule inverted into display.
      */}
      {failure.state === "available" ? (
        <FailureRecordHead detail={failure.value} />
      ) : (
        <div className="flex flex-wrap items-center gap-[var(--ds-space-snug)]">
          <TriangleAlert aria-hidden className={cn(dsIcon.md, "shrink-0 text-[color:var(--ds-danger)]")} />
          <span className={cn(dsText.ui, "min-w-0 break-words font-semibold text-[color:var(--ds-danger)]")}>
            This run failed
          </span>
        </div>
      )}

      <div className="mt-[var(--ds-space-base)] flex flex-col gap-[var(--ds-space-base)] pl-5">
        {failure.state === "available" ? (
          <>
            {completedAt !== undefined && <MetaLine items={[`failed ${fmtClock(completedAt)}`]} />}
            <FailureDetailBody detail={failure.value} liveContext={liveContext} />
            {/* Below the record's own remediation, never above it: the record
                is the evidence and the advisory is a reading of it (D178). */}
            <FailureAdvisoryPanel runId={runId} availability={aiAdvisory} />
          </>
        ) : failure.state === "error" ? (
          <MetaLine items={[failure.code, failure.message]} />
        ) : (
          <MetaLine items={[failure.reason]} />
        )}

        {errorNotes.length > 0 && (
          <section className="flex flex-col gap-[var(--ds-space-snug)]">
            <SectionLabel>What the run said</SectionLabel>
            <div className="flex flex-col gap-[var(--ds-space-tight)]">
              {errorNotes.map((note) => (
                <span key={note.noteId} className="flex items-baseline gap-[var(--ds-space-snug)]">
                  <span
                    className={cn(dsText.meta, dsText.nums, "shrink-0 text-[color:var(--ds-fg-muted)]")}
                  >
                    {fmtClock(note.at)}
                  </span>
                  <span className={cn(dsText.body, "min-w-0 break-words text-[color:var(--ds-danger)]")}>
                    {note.message}
                  </span>
                </span>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// the stream
// ---------------------------------------------------------------------------
