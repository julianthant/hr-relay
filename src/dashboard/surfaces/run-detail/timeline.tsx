import { useId, useState } from "react";
import { z } from "zod";
import { cn } from "../../lib/utils.js";
import { dsBorder, dsClip, dsFocus, dsMotion, dsRadius, dsText } from "../../ds/ui.js";
import { fmtClock, fmtElapsed } from "../format.js";
import { timelineEventDuration, RunDetailWireSchema } from "../../../domain/dashboard/run-detail.js";
import {
  decisionAge, timelineAxisTotals, timelineHasOrphanGate, timelineSegmentUnmeasured,
  type TimelineAxisTotals,
} from "./timeline-model.js";

type RunDetailWire = z.infer<typeof RunDetailWireSchema>;
type TimelineEvent = RunDetailWire["timeline"]["events"][number];

const EVENT_TONE: Record<TimelineEvent["state"], { dot: string; bar: string; text: string }> = {
  pending: {
    dot: "bg-[var(--ds-fg-faint)]",
    bar: "border border-[color:var(--ds-border-strong)] bg-transparent",
    text: "text-[color:var(--ds-fg-muted)]",
  },
  active: {
    dot: "bg-[var(--ds-status-running-mark)]",
    bar: "bg-[var(--ds-status-running-mark)]",
    text: "text-[color:var(--ds-status-running-fg)]",
  },
  done: {
    dot: "bg-[var(--ds-status-verified-done-mark)]",
    bar: "bg-[var(--ds-status-verified-done-mark)]",
    text: "text-[color:var(--ds-status-verified-done-fg)]",
  },
  failed: {
    dot: "bg-[var(--ds-status-failed-mark)]",
    bar: "bg-[var(--ds-status-failed-mark)]",
    text: "text-[color:var(--ds-status-failed-fg)]",
  },
  blocked: {
    dot: "bg-[var(--ds-status-waiting-mark)]",
    bar: "bg-[var(--ds-status-waiting-mark)]",
    text: "text-[color:var(--ds-status-waiting-fg)]",
  },
  cancelled: {
    dot: "bg-[var(--ds-status-cancelled-mark)]",
    bar: "bg-[var(--ds-status-cancelled-mark)]",
    text: "text-[color:var(--ds-status-cancelled-fg)]",
  },
  /**
   * SKIPPED is not cancelled and must not read as it. `Cancelled` is a solid
   * bar in the cancelled hue because somebody stopped the run; a step whose
   * condition was false was never started at all, so it draws a HOLLOW ring
   * and an outlined bar — the "nothing happened here" shape — in the faint
   * foreground, and its accessible name says `skipped` plus the reason. Hue is
   * never the distinguisher: shape and word are.
   */
  skipped: {
    dot: "border border-[color:var(--ds-border-strong)] bg-transparent",
    bar: "border border-dashed border-[color:var(--ds-border-strong)] bg-transparent",
    text: "text-[color:var(--ds-fg-faint)]",
  },
};

/**
 * D259 — REPLAYED draws neither `done`'s solid bar nor `pending`'s empty one.
 *
 * The step's fact is settled, so it takes the verified-done hue; nothing
 * happened in THIS run, so it keeps the hollow ring and outlined bar — the
 * "nothing happened here" shape `skipped` uses — and the word beneath the bar
 * says `replayed` where a measured step prints its duration. Hue is never the
 * distinguisher: shape and word are.
 */
const STEP_TONE: Record<TimelineStep["state"], { dot: string; bar: string; text: string }> = {
  ...EVENT_TONE,
  replayed: {
    dot: "border border-[color:var(--ds-status-verified-done-mark)] bg-transparent",
    bar: "border border-[color:var(--ds-status-verified-done-mark)] bg-transparent",
    text: "text-[color:var(--ds-fg-muted)]",
  },
};

/** The one sentence a skipped step is allowed to say about itself. */
const NOT_RUN_PHRASE: Record<"condition-false" | "branch-not-selected" | "operator-asserted" | "step-omitted", string> = {
  "condition-false": "its condition was false",
  "branch-not-selected": "its branch was not selected",
  "operator-asserted": "the operator asserted its facts at start",
  "step-omitted": "its step was omitted at start",
};

function timelineEventLabel(event: TimelineEvent): string {
  const measured = timelineEventDuration(event);
  const duration = measured.state === "present" ? `, took ${fmtElapsed(Math.round(measured.ms / 1000))}` : "";
  if (event.state !== "skipped") return `${event.label} — ${event.state}${duration}`;
  // A skipped step reports WHY it did not run, or says plainly that the reason
  // was not recorded. It never borrows a plausible one.
  const why = event.notRun.state === "present"
    ? NOT_RUN_PHRASE[event.notRun.reason]
    : "no reason was recorded";
  return `${event.label} — skipped, did not run: ${why}`;
}

/**
 * The persistent, equal-width timeline.
 *
 * THREE SHAPES, and the third is a shape rather than an absence: OUTLINED not
 * reached yet · SOLID done or being worked on · HATCHED the run is stopped
 * here, on you. A blocked run used to draw dashed hairlines that read as one
 * rule across the panel — so the surface that exists to say what a run WILL do
 * said nothing until it started.
 *
 * Each step's duration is the executor's OWN span measurement, served per
 * event — `span.ended` minus `span.started` for the same `(attempt, spanPath)`
 * identity. It used to be the gap to the NEXT event, which is a real number
 * about the wrong thing: it measures the space BETWEEN steps, so a worker that
 * sat idle after a 2-second read reported the read as slow, and the last event
 * had no duration at all because nothing followed it. A step the server could
 * not measure prints its own clock instant instead and says why on hover; the
 * panel still never invents one.
 */
type TimelineStep = NonNullable<RunDetailWire["timeline"]["steps"]>[number];
type TimelineStepMember = TimelineStep["members"][number];

/** The one sentence a replayed member is allowed to say about where it came from. */
function replaySourceText(source: NonNullable<TimelineStepMember["replayedFrom"]>): string {
  const execution = source.claimGeneration === undefined ? "" : `, execution ${String(source.claimGeneration)}`;
  return `attempt ${String(source.attempt)}${execution}`;
}

function stepAriaLabel(step: TimelineStep, openedAt?: string): string {
  if (step.state === "blocked" && openedAt !== undefined) {
    return `${step.label} — waiting on you since ${fmtClock(openedAt)}`;
  }
  if (step.state === "replayed") {
    // Never "took 0s": a replay emits no span, so nothing measured it, and the
    // run did not do this work — it read what an earlier attempt recorded.
    const sources = step.members
      .map((member) => member.replayedFrom)
      .filter((source): source is NonNullable<TimelineStepMember["replayedFrom"]> => source !== undefined)
      .map(replaySourceText);
    return `${step.label} — replayed from ${[...new Set(sources)].join(" and ")}; this run recorded no execution of its own`;
  }
  const duration = step.durationSec === undefined ? "" : `, took ${fmtElapsed(step.durationSec)}`;
  const executions = step.executions === undefined ? "" : `, a step in it ran ${String(step.executions)} times`;
  return `${step.label} — ${step.state}${duration}${executions}`;
}

/**
 * THE ORPHAN WAIT, drawn as the segment it has nowhere else to be.
 *
 * D273 item 2 (ledger 2 row B57; `DemoLogPanel.tsx:687-705`). Neither strip may
 * let an open gate vanish because no segment happened to carry the `blocked`
 * state, so both end with this one when `timelineHasOrphanGate` says the wait
 * is homeless. On a run whose shape DOES line up, it never renders.
 */
function OrphanGateSegment({ openedAt, nowIso }: { openedAt: string; nowIso: string }) {
  return (
    <div className="min-w-0 flex-1 basis-0">
      <div className="flex min-w-0 items-center gap-[var(--ds-space-tight)]">
        <span
          aria-hidden
          className="size-1.5 shrink-0 animate-pulse rounded-full bg-[var(--ds-status-waiting-mark)] motion-reduce:animate-none"
        />
        <span className={cn(dsClip.text, dsText.micro, "text-[color:var(--ds-status-waiting-fg)]")}>
          Waiting on you
        </span>
      </div>
      {/* The bar is decoration here and says so: this segment has no disclosure
          to trigger, and both of its facts — the word above and the age below —
          are already in the accessible tree as text. */}
      <span
        aria-hidden
        className={cn(
          "mt-[var(--ds-space-tight)] block w-full",
          "h-[var(--ds-h-timeline-bar)]",
          dsRadius.xs,
          "bg-[repeating-linear-gradient(45deg,var(--ds-status-waiting-mark)_0_4px,transparent_4px_8px)] opacity-70",
        )}
      />
      <span
        className={cn(
          dsClip.text,
          dsText.micro,
          dsText.nums,
          "mt-[var(--ds-space-hair)] block text-[color:var(--ds-status-waiting-fg)]",
        )}
      >
        {decisionAge(openedAt, nowIso)}
      </span>
    </div>
  );
}

/**
 * D225 — the CATEGORICAL strip. One segment per descriptor-declared category,
 * never one per raw execution: the composed separations run drew eighteen
 * truncated stubs before this, and a gate resume's re-executions drew twice.
 * The category holding the open gate renders HATCHED with "since <clock>"
 * beneath it — a wait is a state of a step, not a step of its own — and a
 * category whose member re-ran carries the ×N marker instead of a duplicate
 * segment. Hovering (or focusing) a segment discloses the member nodes with
 * their own states and durations, so the grouping hides nothing.
 */
function StepStrip({
  steps,
  gate,
  nowIso,
}: {
  steps: readonly TimelineStep[];
  gate: RunDetailWire["gate"];
  nowIso: string;
}) {
  const openedAt = gate.state === "open" ? gate.openedAt : undefined;
  const orphanGate = timelineHasOrphanGate(steps.map((step) => step.state), gate);
  const total = steps.length + (orphanGate ? 1 : 0);
  const stripId = useId();
  /**
   * The disclosure opens on CSS (`group-hover`/`group-focus-within`), so
   * nothing else in this component reads this value — it exists solely to
   * keep `aria-expanded` truthful for the channel a screen reader actually
   * has: keyboard focus. `onFocus`/`onBlur` are the same event pair
   * `group-focus-within` itself keys on, so the attribute and the visible
   * card open and close together for a keyboard user.
   */
  const [focusedStep, setFocusedStep] = useState<string | undefined>(undefined);
  return (
    <div className="flex items-stretch gap-[var(--ds-space-hair)]">
      {steps.map((step, index) => {
        const tone = STEP_TONE[step.state];
        const blocked = step.state === "blocked";
        const skipped = step.state === "skipped";
        const replayed = step.state === "replayed";
        const unmeasured = timelineSegmentUnmeasured(step.state, step.durationSec);
        // The card is 240px wide in a segment that may be 60px wide, so it
        // anchors to whichever edge keeps it on screen — counted over the WHOLE
        // strip, orphan segment included, or the last real step misjudges its
        // own distance from the right edge.
        const anchorRight = total > 2 && index >= total - 2;
        const disclosureId = `${stripId}-step-${String(index)}-card`;
        return (
          <div key={step.label} className="group relative min-w-0 flex-1 basis-0">
            <div className="flex min-w-0 items-center gap-[var(--ds-space-tight)]">
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  tone.dot,
                  (step.state === "active" || blocked) && "animate-pulse motion-reduce:animate-none",
                )}
              />
              <span className={cn(dsClip.text, dsText.micro, tone.text, skipped && "line-through decoration-1")}>
                {step.label}
              </span>
            </div>
            {/*
              A BUTTON, because the member disclosure below it opens on
              `group-focus-within` and a group with no focusable child can only
              be opened with a pointer (D273 item 2, ledger 2 row B41 — the
              demo's own element at `DemoLogPanel.tsx:574-619`). `aria-label` on
              the bare `<span>` this replaces named nothing at all: a generic
              element with no role takes no accessible name.

              A hover tint, and deliberately NO press dip: this segment is a
              disclosure trigger, not a command. Without the tint nobody
              discovers the detail card; with a dip it would promise a commit
              that never happens.

              `aria-expanded`/`aria-controls` name the relationship a sighted
              mouse user reads for free from the card appearing beside the
              segment it belongs to (F6b unit): without them, a screen reader
              user tabbing the strip hears "button" with no way to tell this
              one discloses something, or which element it discloses.
            */}
            <button
              type="button"
              aria-label={stepAriaLabel(step, openedAt)}
              aria-expanded={focusedStep === step.label}
              aria-controls={disclosureId}
              onFocus={() => setFocusedStep(step.label)}
              onBlur={() => setFocusedStep(undefined)}
              className={cn(
                "mt-[var(--ds-space-tight)] block w-full",
                "h-[var(--ds-h-timeline-bar)]",
                dsRadius.xs,
                dsFocus,
                dsMotion.base,
                "hover:brightness-125",
                blocked
                  ? "bg-[repeating-linear-gradient(45deg,var(--ds-status-waiting-mark)_0_4px,transparent_4px_8px)] opacity-70"
                  : tone.bar,
                // The demo dims a segment it could not measure (B44) — so an
                // unmeasured step reads as unmeasured, not as one whose number
                // happens to be missing.
                unmeasured && "opacity-70",
              )}
            />
            <div className="mt-[var(--ds-space-hair)] flex min-w-0 items-baseline gap-[var(--ds-space-tight)]">
              <span
                className={cn(
                  dsClip.text,
                  dsText.micro,
                  dsText.nums,
                  blocked ? "text-[color:var(--ds-status-waiting-fg)]" : "text-[color:var(--ds-fg-muted)]",
                )}
              >
                {blocked && openedAt !== undefined
                  ? `since ${fmtClock(openedAt)}`
                  : replayed
                    ? "replayed"
                    : step.durationSec !== undefined
                      ? fmtElapsed(step.durationSec)
                      : ""}
              </span>
              {step.executions !== undefined && (
                <span className={cn(dsText.micro, dsText.nums, "shrink-0 font-bold text-[color:var(--ds-status-waiting-fg)]")}>
                  ×{step.executions}
                </span>
              )}
            </div>
            {/* member disclosure — the grouping must hide nothing */}
            <div
              id={disclosureId}
              className={cn(
                "absolute top-full z-50 mt-1 hidden w-60 border p-2.5 text-left shadow-lg group-hover:block group-focus-within:block",
                dsRadius.lg,
                dsBorder.subtle,
                // The floating-surface plane, not a page plane: `--ds-bg-raised`
                // was never a token, so this card painted NOTHING and the strip
                // and the row beneath it read straight through the text.
                "bg-[var(--ds-surface-overlay)]",
                anchorRight ? "right-0" : "left-0",
              )}
            >
              <span className={cn(dsText.micro, "font-semibold text-[color:var(--ds-fg)]")}>{step.label}</span>
              {/*
                THE STATE, named in a word (D273 item 2, ledger 2 row B50 —
                `DemoLogPanel.tsx:644-647`). The strip carries it as a hue and a
                shape only, and a card that discloses the members without saying
                what the category itself is makes the reader infer the one fact
                the card exists to settle.
              */}
              <span className={cn(dsText.micro, "mt-0.5 flex items-baseline justify-between gap-2")}>
                <span className="text-[color:var(--ds-fg-muted)]">Status</span>
                <span className={cn(dsText.nums, "shrink-0", tone.text)}>{step.state}</span>
              </span>
              <ul className="mt-1 flex flex-col gap-0.5">
                {step.members.map((member) => (
                  <li key={member.label} className={cn(dsText.micro, "flex items-baseline justify-between gap-2 text-[color:var(--ds-fg-muted)]")}>
                    <span className={cn(dsClip.text)}>{member.label}</span>
                    <span className={cn(dsText.nums, "shrink-0", STEP_TONE[member.state].text)}>
                      {member.state}
                      {member.durationSec !== undefined ? ` · ${fmtElapsed(member.durationSec)}` : ""}
                      {member.replayedFrom === undefined ? "" : ` · ${replaySourceText(member.replayedFrom)}`}
                      {/* D307 — an operator-asserted member and a step-omitted
                          one both fold to `skipped`, and they are opposite
                          facts: one produced the value this run consumed, the
                          other produced nothing. The served reason says which. */}
                      {member.notRunReason === undefined ? "" : ` · ${NOT_RUN_PHRASE[member.notRunReason]}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        );
      })}

      {/*
        THE ORPHAN CASE, and only that (D273 item 2, ledger 2 row B57 —
        `DemoLogPanel.tsx:687-705`). A run that is gated but whose categories
        record no `blocked` state has no bar for the wait to ride, and a wait
        that silently disappears because the shape did not line up is the one
        thing this timeline may not do. `gate.openedAt` is served, so dropping
        the segment would lose a fact the surface is holding.
      */}
      {orphanGate && gate.state === "open" && (
        <OrphanGateSegment openedAt={gate.openedAt} nowIso={nowIso} />
      )}
    </div>
  );
}

/**
 * THE AXIS — when it started, and where the time went (D273 item 2, ledger 2
 * rows B60/B61; `DemoLogPanel.tsx:711-717`).
 *
 * With equal-width segments this line is where duration lives, so it names BOTH
 * halves rather than one total. It used to print the first→last event SPAN
 * under the word `elapsed`, which is a real number about the wrong thing: a run
 * parked for an hour after four seconds of work reported an hour.
 *
 * A half with nothing behind it does not print. There is no "0s working" for a
 * run nothing measured and no "waiting on you" for a run nobody is waiting on.
 */
function TimelineAxis({
  startAt,
  totals,
}: {
  startAt: string;
  totals: TimelineAxisTotals;
}) {
  const working = totals.workingSec === undefined ? undefined : `${fmtElapsed(totals.workingSec)} working`;
  const waiting = totals.waitingSec === undefined ? undefined : `${fmtElapsed(totals.waitingSec)} waiting on you`;
  const measure = [working, waiting].filter((half): half is string => half !== undefined).join(" · ");
  return (
    <div
      className={cn(
        "mt-[var(--ds-space-snug)] flex items-baseline gap-[var(--ds-space-base)] border-t pt-[var(--ds-space-tight)]",
        dsBorder.subtle,
        dsText.micro,
        dsText.nums,
        "text-[color:var(--ds-fg-muted)]",
      )}
    >
      <span>{fmtClock(startAt)}</span>
      <span aria-hidden className="h-px flex-1 bg-[var(--ds-border)]" />
      {measure.length > 0 && (
        <span className={totals.waitingSec === undefined ? undefined : "text-[color:var(--ds-status-waiting-fg)]"}>
          {measure}
        </span>
      )}
    </div>
  );
}

/**
 * Exported so the D273 item 2 ports are pinned by a RENDER rather than only by
 * a screenshot (`tests/unit/dashboard/run-detail-timeline-render.test.ts`).
 * Four of the ruled facts — the segment being a focusable `<button>`, the
 * disclosure's `Status` row, the orphan wait's own segment, and the axis's two
 * halves — are decisions about MARKUP, and the folds beneath them cannot see
 * whether the component actually consumed one.
 */
export function Timeline({ detail, nowIso }: { detail: RunDetailWire; nowIso: string }) {
  const events = detail.timeline.events;
  const steps = detail.timeline.steps;
  const categorical = steps !== undefined && steps.length > 0;
  if (!categorical && events.length === 0) return null;

  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const first = ordered[0];

  if (categorical) {
    return (
      <div className="px-[var(--ds-space-cozy)] py-[var(--ds-space-base)]">
        <StepStrip key={detail.runId} steps={steps} gate={detail.gate} nowIso={nowIso} />
        {first !== undefined && (
          <TimelineAxis
            startAt={first.at}
            totals={timelineAxisTotals(steps.map((step) => step.durationSec), detail.gate, nowIso)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="px-[var(--ds-space-cozy)] py-[var(--ds-space-base)]">
      <div className="flex items-stretch gap-[var(--ds-space-hair)]">
        {ordered.map((event) => {
          const tone = EVENT_TONE[event.state];
          const measured = timelineEventDuration(event);
          const blocked = event.state === "blocked";
          const skipped = event.state === "skipped";
          return (
            <div key={event.noteId} className="group relative min-w-0 flex-1 basis-0">
              <div className="flex min-w-0 items-center gap-[var(--ds-space-tight)]">
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    tone.dot,
                    (event.state === "active" || blocked) && "animate-pulse motion-reduce:animate-none",
                  )}
                />
                <span className={cn(dsClip.text, dsText.micro, tone.text, skipped && "line-through decoration-1")}>
                  {event.label}
                </span>
              </div>
              {/*
                `role="img"` so the label computes at all: a generic `<span>`
                with no role takes no accessible name from `aria-label`
                (HTML-AAM), the same defect the categorical strip's segment had
                before it became a `<button>` (see `StepStrip` above). This bar
                is decoration only — nothing here discloses on hover or focus —
                so a role that says "this is one labelled graphic" is the
                correct fix, not a control role.
              */}
              <span
                role="img"
                aria-label={timelineEventLabel(event)}
                className={cn(
                  "mt-[var(--ds-space-tight)] block w-full",
                  "h-[var(--ds-h-timeline-bar)]",
                  dsRadius.xs,
                  blocked
                    ? "bg-[repeating-linear-gradient(45deg,var(--ds-status-waiting-mark)_0_4px,transparent_4px_8px)] opacity-70"
                    : tone.bar,
                )}
              />
              <div className="mt-[var(--ds-space-hair)] flex min-w-0 items-baseline gap-[var(--ds-space-tight)]">
                <span
                  className={cn(dsClip.text, dsText.micro, dsText.nums, "text-[color:var(--ds-fg-muted)]")}
                  title={measured.state === "absent" ? measured.reason : undefined}
                >
                  {measured.state === "present" ? fmtElapsed(Math.round(measured.ms / 1000)) : fmtClock(event.at)}
                </span>
              </div>
            </div>
          );
        })}

        {/* The read-forward strip loses a homeless wait exactly as easily. */}
        {timelineHasOrphanGate(ordered.map((event) => event.state), detail.gate) &&
          detail.gate.state === "open" && (
            <OrphanGateSegment openedAt={detail.gate.openedAt} nowIso={nowIso} />
          )}
      </div>

      {first !== undefined && (
        <TimelineAxis
          startAt={first.at}
          totals={timelineAxisTotals(
            ordered.map((event) => {
              const measured = timelineEventDuration(event);
              return measured.state === "present" ? Math.round(measured.ms / 1000) : undefined;
            }),
            detail.gate,
            nowIso,
          )}
        />
      )}
    </div>
  );
}
