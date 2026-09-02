/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/DemoLogPanel.tsx
 *
 * The run detail panel: timeline, the one-line state and its action, the tab
 * set, the log stream, and the Context rail beside it.
 *
 * TWO RULES FROM `DESIGN.md` ARE STRUCTURAL HERE AND NOTHING MAY REGRESS THEM.
 *
 * 1. **The top states, the stream explains.** A state that needs explaining
 *    gets ONE line and ONE control at the panel top; its full surface renders
 *    INLINE in the stream, at the point that produced it, where the lines above
 *    it are the argument for it. That is why the open gate is `InlineDecision`
 *    and the failure is `InlineFailureRecord` — neither is a band stacked above
 *    the stream the panel is opened to read — and why a failed run OPENS on the
 *    logs rather than putting its record behind a tab. Whatever moves into the
 *    stream keeps a persistent, undismissable route from every tab, and that
 *    route must actually travel there.
 *
 * 2. **One scrolling region, running the panel's full height.** The header, the
 *    outcome line and the tab bar are a single STICKY block INSIDE the scroller
 *    at `top: 0`, not three boxes stacked above it — a track that starts a third
 *    of the way down the panel is a segment, not a rail. `--ds-panel-head-h` is
 *    that block's measured height, published on the scroller so the stream's
 *    step headings land BELOW it and `scrollIntoView` does not park its target
 *    behind it. A sticky child must NOT carry the head's z: the head is earlier
 *    in the DOM, so an equal z makes every heading paint over the tab bar.
 *
 * WHAT 1i SERVES. `RunDetailWire` + the lazy sections. The rich failure
 * projection (cause chain, write-state sentence, remediation catalogue,
 * diagnostic bundle), evidence/captures/facsimiles, park resolution, checkpoint
 * editing, People rosters and progressive Review records are all ref operator-trust / ref data-intake-and-edit-data
 * surfaces landing in 2g/2h. This panel renders the FRAME and the served
 * identity for the failure and omits every field the wire does not carry —
 * it never invents a write state, because "nothing was written" and "we do not
 * know" are the two sentences an operator acts on most differently.
 */
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronRight,
  ClipboardList,
  CornerDownRight,
  Database,
  FileText,
  Info,
  Pause,
  Receipt,
  ScrollText,
  ShieldCheck,
  TriangleAlert,
  UserRoundSearch,
  Users,
  X,
} from "lucide-react";
import type { z } from "zod";
import { cn } from "../lib/utils.js";
import {
  Button,
  Chip,
  EmptyState,
  FloatingSurface,
  IconButton,
  MetaLine,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SearchInput,
  SectionLabel,
  Skeleton,
  StatusDot,
  Tooltip,
  dsStatusText,
  dsBorder,
  dsClip,
  dsFocus,
  dsIcon,
  dsLayer,
  dsMotion,
  dsRadius,
  dsSize,
  dsText,
  useDsEnterTransition,
  type DsStatus,
} from "../ds/ui.js";
import type {
  LogRowWire,
  RunDetailSectionResponseSchema,
  RunDetailWireSchema,
} from "../../domain/dashboard/run-detail.js";
import { timelineEventDuration } from "../../domain/dashboard/run-detail.js";
import type { ActionDescriptorWire } from "../../domain/dashboard/actions.js";
import type { IdentityGatePayload } from "../app/identity-ceremony.js";
import {
  IdentityApproveDialog,
  type IdentityApproveTarget,
} from "./identity-approve.js";
import { identityGateArm } from "./identity-approve-model.js";
import { BannerActions, OutcomeActionButton, type DashboardActionHandler } from "./actions.js";
import {
  InlineParkedWrite,
  ParkResolveDialog,
  type ParkResolveTarget,
  type ParkedWritePayload,
} from "./park-resolve.js";
import { parkResolutionArm } from "./park-resolve-model.js";
import { ContextRail, ContextRailSpine } from "./context-rail.js";
import { useContextRail, type ContextSections } from "./context-rail-model.js";
import { elapsedSecondsBetween, fmtClock, fmtElapsed, plural } from "./format.js";
import { ReceiptView, type ReceiptSectionPayload } from "./receipt.js";
import { useReceiptComparison } from "./receipt-model.js";
import { RunCaptures } from "./run-captures.js";
import type { RunCapturesState } from "./run-captures-model.js";
import { RunProvenanceBar, type QueueSurfaceWire } from "./run-identity.js";
import { FailureDetailBody, FailureRecordHead } from "./trust.js";
import { FailureAdvisoryPanel } from "./advisory.js";
import type { CapabilityAvailabilitySchema } from "../../domain/absence.js";
import { dsStatusOf, outcomeDsStatusOf } from "./status-model.js";
import { DETAIL_THREE_COLUMN_PX } from "./layout-metrics.js";
import { PANEL_TAB_LABEL, defaultTabFor, tabsFor, terminalOutcomeText, type PanelTab } from "./log-panel-model.js";
import {
  groupLogRows,
  logLedgerOf,
  logPillsOf,
  type LogLedgerFact,
  type LogLedgerSection,
  type LogRowGroup,
  logRowsOf,
  rowMatchesLogQuery,
  timelineAxisTotals,
  timelineHasOrphanGate,
  timelineSegmentUnmeasured,
  useLogPages,
  type TimelineAxisTotals,
} from "./log-panel-model.js";
import { SystemChip } from "./system-chip.js";
import type { BrowserSystemId } from "./system-chip-model.js";
import { useDashboardClient } from "../state/client-context.js";
import { DashboardClientError } from "../client/index.js";

export type { PanelTab };

type CapabilityAvailability = z.infer<typeof CapabilityAvailabilitySchema>;

type RunDetailWire = z.infer<typeof RunDetailWireSchema>;
type RunDetailSectionResponse = z.infer<typeof RunDetailSectionResponseSchema>;
type TimelineEvent = RunDetailWire["timeline"]["events"][number];
type NotePage = Extract<RunDetailSectionResponse, { section: "logs" }>["payload"];
type LogRow = LogRowWire;
type FailurePayload = Extract<RunDetailSectionResponse, { section: "failure" }>["payload"];
/**
 * The gate section's type is DEFINED one layer up, in
 * `app/identity-ceremony.ts`, and re-exported here for the surfaces that read
 * it. Defining it here instead made `app/command-dispatch.ts` import this
 * module for a type while this module imports the ceremony dialog which imports
 * the composer — a real `app -> surfaces -> app` cycle the `import-cycles`
 * ratchet counts (it walks every import declaration, type-only included).
 */
export type { IdentityGatePayload };

/* the two region thresholds live in `layout-metrics.ts` — see the note there */
/* the tab vocabulary lives in `log-panel-model.ts` — see the note there */

/** Every section the panel is handed, keyed by the wire's own section name. */
export interface PanelSections extends ContextSections {
  logs?: NotePage;
  receipt?: ReceiptSectionPayload;
  failure?: FailurePayload;
  /**
   * Ref write-safety §4.1's parked write. It has NO tab, deliberately: DESIGN.md names
   * `Write parked` a DECISION, and a decision's surface renders inline in the
   * stream at the line that produced it — the same placement the failure record
   * gets and for the same reason.
   */
  "parked-write"?: ParkedWritePayload;
  /**
   * Ref write-safety §14.4's identity-approval gate. It has no tab either, and for the
   * same reason: an open gate is a DECISION, and the decision card renders
   * inline in the stream at the line it stopped on.
   *
   * The server has projected this section — packet, options, approval shape and
   * both `resolve-gate` action descriptors — since the gate landed, and NOTHING
   * fetched it: `use-panel-sections.ts` omitted it from the wanted set and
   * `merge()` would have thrown on it (R5's escalation on the audit's
   * queue/run-action ledger row). The gate's own served controls are what
   * `InlineDecision` draws.
   */
  "identity-gate"?: IdentityGatePayload;
}

// The WORD comes from `PANEL_TAB_LABEL` in the model, which the row/panel
// catalog reads too; only the glyph is this file's own.
const TAB_META: Record<PanelTab, { label: string; icon: typeof ScrollText }> = {
  review: { label: PANEL_TAB_LABEL.review, icon: ClipboardList },
  people: { label: PANEL_TAB_LABEL.people, icon: Users },
  logs: { label: PANEL_TAB_LABEL.logs, icon: ScrollText },
  // `Receipt`, not `ReceiptText` (R5 f.9) — the demo's own glyph choice at
  // `DemoLogPanel.tsx:2176`. The two differ on screen: `ReceiptText` draws
  // ruled lines inside the slip, which at 14px reads as a second document
  // icon beside `Logs`.
  receipt: { label: PANEL_TAB_LABEL.receipt, icon: Receipt },
};

/* the tab fold lives in `log-panel-model.ts` — see the note there */

// ---------------------------------------------------------------------------
// timeline
// ---------------------------------------------------------------------------

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
  const [focusedIndex, setFocusedIndex] = useState<number | undefined>(undefined);
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
              aria-expanded={focusedIndex === index}
              aria-controls={disclosureId}
              onFocus={() => setFocusedIndex(index)}
              onBlur={() => setFocusedIndex(undefined)}
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
        <StepStrip steps={steps} gate={detail.gate} nowIso={nowIso} />
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

// ---------------------------------------------------------------------------
// the two inline stream surfaces
// ---------------------------------------------------------------------------

/**
 * THE DECISION, rendered where it happened.
 *
 * The gate banner above the tabs is gone: it drew the decision a second time
 * with the same words and the same buttons as the card already in the stream.
 * What the panel top keeps is a state and its route (the status pill, the
 * outcome line's verb, and the floating notice while the decision is out of
 * reach); the decision ITSELF is here.
 *
 * The options are the server's `resolve-gate` action descriptors at the
 * `banner` placement. An empty list draws no buttons — a gate the server has
 * not served options for is one this surface may not offer to resolve.
 */
/**
 * Exported for the D273 item 4 render pin
 * (`tests/unit/dashboard/run-detail-decision-cue.test.ts`): the age-plus-clock
 * pair is composed in JSX, so no fold can see whether the card prints both.
 */
export function InlineDecision({
  gate,
  actions,
  runId,
  onAction,
  anchorRef,
  nowIso,
}: {
  gate: Extract<RunDetailWire["gate"], { state: "open" }>;
  actions: readonly ActionDescriptorWire[];
  runId: string;
  onAction: DashboardActionHandler;
  anchorRef?: (node: HTMLElement | null) => void;
  /** The served instant (D256), so the card's age and the queue's cannot differ. */
  nowIso: string;
}) {
  return (
    <div
      ref={anchorRef}
      tabIndex={-1}
      data-panel-decision=""
      aria-label={`Decision — ${gate.label}`}
      className={cn(
        "mx-[var(--ds-space-cozy)] my-[var(--ds-space-base)] ml-5 border p-[var(--ds-space-cozy)]",
        dsRadius.lg,
        dsFocus,
        "border-[length:var(--ds-border-w-rail)]",
        "border-[color:var(--ds-status-waiting-border)] bg-[var(--ds-status-waiting-bg)]",
      )}
    >
      {/* icon 14 + gap 6 = 20px, which is exactly the hanging indent below */}
      <div className="flex items-center gap-[var(--ds-space-snug)]">
        <UserRoundSearch
          aria-hidden
          className={cn(dsIcon.md, "shrink-0 text-[color:var(--ds-status-waiting-fg)]")}
        />
        <span
          className={cn(
            dsText.ui,
            "min-w-0 truncate font-semibold text-[color:var(--ds-status-waiting-fg)]",
          )}
        >
          {gate.label}
        </span>
        {/*
          BOTH HALVES OF THE WAIT (D273 item 4, ledger 2 row B91 —
          `DemoRunIdentity`'s sibling at `DemoLogPanel.tsx:396-398`). The age is
          what decides which of two waiting runs you open first; the clock is
          what you match against everything else on screen. Printing the clock
          here while the outcome bar printed the age left neither surface
          carrying the pair, so comparing two waits meant reading two places.

          NO `opacity-85`: `--ds-status-waiting-fg` is held to 4.5:1 against the
          ladder's own surfaces (`tokens.css`), and stacking an opacity on top
          of an already-audited foreground silently spends that headroom — this
          meta line measured ~3.8:1 on the light theme's waiting card.
        */}
        <span
          className={cn(
            dsText.meta,
            dsText.nums,
            "ml-auto shrink-0 whitespace-nowrap text-[color:var(--ds-status-waiting-fg)]",
          )}
        >
          open {decisionAge(gate.openedAt, nowIso)} · since {fmtClock(gate.openedAt)}
        </span>
      </div>

      <div className="flex flex-col gap-[var(--ds-space-base)] pl-5">
        {/* Says the quiet part: this run is STOPPED, and it is stopped here. */}
        <span className={cn(dsText.meta, "mt-[var(--ds-space-tight)] text-[color:var(--ds-fg-muted)]")}>
          The run is held here. It cannot go past this step until you pick.
        </span>
        <BannerActions
          actions={actions}
          target={{ runId, expectedVersion: gate.revision }}
          onAction={onAction}
        />
      </div>
    </div>
  );
}

/**
 * THE DECISION RECORD, rendered where the decision was TAKEN (D237).
 *
 * The open card above is what a run held at a gate draws; this is what the same
 * gate leaves behind once somebody answers it. Before D237 there was nothing:
 * the wire's resolved arm was unreachable, so a settled gated run's panel went
 * silent about the one step a human performed — and "who approved this" is
 * exactly the question ref write-safety §14.6 risk 6 exists for.
 *
 * All three facts are the SERVER's, off one durable `gate_results` row: the
 * verdict through D204's declared arm table, the approver and the instant off
 * the row the kernel wrote inside the resolving transaction. This component
 * composes no sentence the wire did not supply a fact for.
 *
 * It sits in the stream at its own instant, like the failure record, because
 * that is where it happened — a settled decision hoisted to the panel top would
 * compete with the outcome bar for the same glance while saying something the
 * outcome bar cannot say.
 */
const GATE_RECORD_TONE: Record<"approved" | "rejected", string> = {
  approved:
    "border-[color:var(--ds-status-verified-done-border)] bg-[var(--ds-status-verified-done-bg)]",
  rejected:
    "border-[color:var(--ds-danger-border)] bg-[var(--ds-danger-quiet)]",
};
const GATE_RECORD_FG: Record<"approved" | "rejected", string> = {
  approved: "text-[color:var(--ds-status-verified-done-fg)]",
  rejected: "text-[color:var(--ds-danger)]",
};
const GATE_RECORD_WORD: Record<"approved" | "rejected", string> = {
  approved: "Approved",
  rejected: "Rejected",
};

function InlineGateDecisionRecord({
  gate,
  anchorRef,
}: {
  gate: Extract<RunDetailWire["gate"], { state: "resolved" }>;
  anchorRef?: (node: HTMLElement | null) => void;
}) {
  const { resolution } = gate;
  return (
    <div
      ref={anchorRef}
      tabIndex={-1}
      data-panel-gate-record=""
      aria-label={`Decision record — ${gate.label}`}
      className={cn(
        "mx-[var(--ds-space-cozy)] my-[var(--ds-space-base)] ml-5 border p-[var(--ds-space-cozy)]",
        dsRadius.lg,
        dsFocus,
        "border-[length:var(--ds-border-w-rail)]",
        GATE_RECORD_TONE[resolution],
      )}
    >
      <div className="flex items-center gap-[var(--ds-space-snug)]">
        <UserRoundSearch aria-hidden className={cn(dsIcon.md, "shrink-0", GATE_RECORD_FG[resolution])} />
        <span className={cn(dsText.ui, "min-w-0 truncate font-semibold", GATE_RECORD_FG[resolution])}>
          {gate.label}
        </span>
        {/* The card's own tint already carries the verdict's loudness, so the
            chip stays neutral for an approval and goes loud only for a refusal
            — a rejected identity is the one an operator must not read past. */}
        <Chip label="decision" tone={resolution === "approved" ? "neutral" : "danger"}>
          {GATE_RECORD_WORD[resolution]}
        </Chip>
        <span
          className={cn(
            dsText.meta,
            dsText.nums,
            "ml-auto shrink-0 whitespace-nowrap opacity-85",
            GATE_RECORD_FG[resolution],
          )}
        >
          {fmtClock(gate.resolvedAt)}
        </span>
      </div>

      <div className="flex flex-col gap-[var(--ds-space-base)] pl-5">
        {/* The whole point of the record: a name and an instant, both durable. */}
        <MetaLine items={[`${GATE_RECORD_WORD[resolution]} by ${gate.resolvedBy}`, fmtClock(gate.resolvedAt)]} />
      </div>
    </div>
  );
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
}: {
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
            <FailureDetailBody detail={failure.value} />
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

/**
 * The reminder that a decision is open while it is OUT OF REACH.
 *
 * Its coordinates are constants of THIS panel's box — `absolute`, clipped by
 * the panel, never portalled, and on the far edge from the app-level toast
 * stack. Neither surface's position may be a function of the other's presence
 * (DESIGN.md); geometry, not arbitration.
 *
 * It serves BOTH decisions, because DESIGN.md names both: an open gate and a
 * parked write. They differ only in the word, the glyph and the instant they
 * count from, so the second one is arguments to this component rather than a
 * second copy of it — two floating notices with independent geometry is exactly
 * how the "these 2 should not be affecting each other" defect gets re-derived.
 */
/**
 * The two decision tones, as LITERAL class strings.
 *
 * A token interpolated into a class name is one Tailwind cannot see — it emits
 * no rule and the notice paints nothing, which is the same class of defect as
 * the hand-rolled status span DESIGN.md bans.
 */
type DecisionTone = "waiting" | "parked";
const DECISION_TONE: Record<DecisionTone, { border: string; bg: string; fg: string }> = {
  waiting: {
    border: "border-[color:var(--ds-status-waiting-border)]",
    bg: "bg-[var(--ds-status-waiting-bg)]",
    fg: "text-[color:var(--ds-status-waiting-fg)]",
  },
  parked: {
    border: "border-[color:var(--ds-status-parked-border)]",
    bg: "bg-[var(--ds-status-parked-bg)]",
    fg: "text-[color:var(--ds-status-parked-fg)]",
  },
};

/**
 * Ported from legacy hr-automation@1bffbd65,
 * src/dashboard/components/dev/rebuild-demo/demo-data.ts:4080-4087
 * (`gateWaitSec` + `gateAge`).
 *
 * HOW LONG A DECISION HAS NEEDED YOU, as the operator reads it.
 *
 * It is not the run's total elapsed — that is the queue footer's, and it is
 * not a triage signal. It is the AGE of the thing that is waiting, which is
 * the number that decides which of two waiting runs you open first. Relative,
 * never a wall clock: `since 14:32` makes the operator do the subtraction on
 * the one figure they are meant to compare across rows.
 */
function decisionAge(openedAt: string, nowIso: string): string {
  return fmtElapsed(elapsedSecondsBetween(openedAt, nowIso));
}

function DecisionNotice({
  label,
  since,
  nowIso,
  icon,
  goLabel,
  dismissLabel,
  onGo,
  onDismiss,
  tone,
}: {
  label: string;
  /** the instant the decision started waiting on a human */
  since: string;
  /** the panel's one clock read, so every age on the surface agrees */
  nowIso: string;
  icon: ReactNode;
  goLabel: string;
  dismissLabel: string;
  onGo: () => void;
  onDismiss: () => void;
  tone: DecisionTone;
}) {
  const entering = useDsEnterTransition();
  const paint = DECISION_TONE[tone];
  return (
    <FloatingSurface
      role="status"
      className={cn(
        "absolute bottom-[var(--ds-space-cozy)] left-[var(--ds-space-cozy)] overflow-hidden",
        "w-[var(--ds-w-popover-md)] max-w-[calc(100%-2*var(--ds-space-cozy))]",
        dsLayer.sticky,
        // It ARRIVES — a reminder that blinks into the corner reads as a render
        // fault. No reduced-motion branch, on purpose: the travel and the clock
        // are both tokens, and the preference zeroes both.
        dsMotion.enter,
        "data-[demo-enter=from]:translate-y-[var(--ds-travel-md)] data-[demo-enter=from]:opacity-0",
        paint.border,
      )}
      {...entering}
    >
      <div
        className={cn("flex items-start gap-[var(--ds-space-tight)] p-[var(--ds-space-snug)]", paint.bg)}
      >
        <button
          type="button"
          onClick={onGo}
          className={cn(
            "flex min-w-0 flex-1 cursor-pointer flex-col gap-[var(--ds-space-tight)] p-[var(--ds-space-tight)] text-left",
            dsRadius.sm,
            dsFocus,
            dsMotion.fast,
            "active:translate-y-px hover:brightness-110",
          )}
        >
          <span
            className={cn(
              dsText.meta,
              dsText.flush,
              "flex min-w-0 items-center gap-[var(--ds-space-tight)] font-semibold",
              paint.fg,
            )}
          >
            {icon}
            <span className="min-w-0 truncate">{label}</span>
          </span>
          <span className={cn(dsText.micro, "flex min-w-0 items-center gap-[var(--ds-space-base)]")}>
            <span
              className={cn(
                "inline-flex min-w-0 items-center gap-[var(--ds-space-hair)] truncate font-semibold",
                paint.fg,
              )}
            >
              <CornerDownRight aria-hidden className={cn(dsIcon.sm, "shrink-0")} />
              {goLabel}
            </span>
            <span className={cn(dsText.nums, "ml-auto shrink-0 text-[color:var(--ds-fg-muted)]")}>
              {`open ${decisionAge(since, nowIso)}`}
            </span>
          </span>
        </button>
        <IconButton
          size="xs"
          label={dismissLabel}
          onClick={onDismiss}
          icon={<X aria-hidden className={dsIcon.sm} />}
        />
      </div>
    </FloatingSurface>
  );
}

/**
 * Where a pinned-in-the-stream surface is, and whether the operator can
 * currently see it. Used twice: by the decision, and by the failure record
 * beside it.
 *
 * The anchor is a CALLBACK ref because the element unmounts every time the tab
 * changes — a plain ref would hold a detached node and scroll to nothing.
 */
function useSeekAnchor(active: boolean, block: ScrollLogicalPosition = "center"): {
  setNode: (node: HTMLElement | null) => void;
  inView: boolean;
  seek: () => void;
} {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (!active || node === null) {
      setInView(false);
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      // No observer: assume the decision is NOT visible, so the notice shows.
      // Failing toward "reachable" is the only safe direction for something a
      // run is blocked on.
      setInView(false);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => setInView(entries.some((entry) => entry.isIntersecting)),
      { threshold: 0.3 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [active, node]);

  const seek = useCallback(() => {
    if (node === null) return;
    const reduced =
      typeof window !== "undefined"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ block, behavior: reduced ? "auto" : "smooth" });
    node.focus({ preventScroll: true });
  }, [node, block]);

  return { setNode, inView, seek };
}

// ---------------------------------------------------------------------------
// the stream
// ---------------------------------------------------------------------------

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
 *  - a served list renders as a native `<details>`: a count plus a clipped
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
    <details className="group min-w-0">
      <summary
        className={cn(
          "flex min-w-0 cursor-pointer list-none items-center gap-[var(--ds-space-snug)] [&::-webkit-details-marker]:hidden",
          dsRadius.xs,
          dsFocus,
        )}
      >
        <span className={cn(dsText.meta, dsText.nums, "shrink-0 text-[color:var(--ds-fg-secondary)]")}>
          {fact.items.length} {fact.items.length === 1 ? "value" : "values"}
        </span>
        <span className={cn(dsText.meta, dsClip.text, "text-[color:var(--ds-fg-muted)] group-open:hidden")}>
          {fact.items.join(" · ")}
        </span>
        <ChevronRight
          aria-hidden
          className={cn(dsIcon.sm, "shrink-0 text-[color:var(--ds-fg-muted)]", dsMotion.base, "group-open:rotate-90")}
        />
      </summary>
      <ul className="m-0 flex list-none flex-col gap-[var(--ds-space-hair)] p-0 pt-[var(--ds-space-tight)]">
        {fact.items.map((item, index) => (
          <li key={`${String(index)}:${item}`} className={cn(dsText.body, dsText.nums, "break-all text-[color:var(--ds-fg)]")}>
            {item}
          </li>
        ))}
      </ul>
    </details>
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
  if (row.kind === "note") return `${fmtClock(row.note.at)}: ${row.note.level} note: ${row.note.message}`;
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
        {note !== undefined && note.message}
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

function LogsTab({
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
              className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0"
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

// ---------------------------------------------------------------------------
// the panel
// ---------------------------------------------------------------------------

/**
 * A section this slice advertises but does not serve. The tab exists because
 * the descriptor said so; the body says which surface will fill it. This is a
 * REFUSAL of a sort — it names what is not here — not an explanation of the
 * product, so it earns its standing pixels.
 */
function UnservedTab({ tab }: { tab: PanelTab }) {
  const meta = TAB_META[tab];
  return (
    <EmptyState
      icon={<meta.icon aria-hidden className={dsIcon.lg} />}
      title={`${meta.label} is not served yet`}
      description="This run advertises the section, but the projection behind it lands with a later slice."
    />
  );
}

export interface LogPanelProps {
  detail: RunDetailWire;
  sections: PanelSections;
  /** App-owned lazy read; never part of the shared aggregate section request. */
  captures?: RunCapturesState;
  /** the run's queue surface, when the panel was opened from a row — the provenance bar's source */
  surface?: QueueSurfaceWire;
  /** every action the server served for this run; the panel filters by placement */
  actions?: readonly ActionDescriptorWire[];
  tab?: PanelTab;
  onTab: (tab: PanelTab) => void;
  onAction?: DashboardActionHandler;
  workflowLabel: string;
  currentAppVersion: string;
  /**
   * The fingerprint THIS RUN'S OWN workflow is served under today, for the
   * provenance bar's shape hazard; `undefined` when this build registers no
   * such workflow. It was the bootstrap's whole-descriptor-SET hash until
   * §9.22 item 3 — a value a one-workflow fingerprint can never equal, so the
   * hazard was structurally always on.
   */
  servedDescriptorHash: string | undefined;
  /** Who a Data-section correction is requested by (2i-C). */
  actorId: string;
  /** An applied correction bumped the run version — the owner refetches detail. */
  onDetailEdited: () => void;
  /**
   * Ref operator-trust §4.4's advisory availability, from the bootstrap wire (2i-G, D178).
   * The panel keeps its control and states the server's reason when no
   * provider is composed, rather than the affordance vanishing.
   */
  aiAdvisory: CapabilityAvailability;
  /**
   * The server's own clock, from the bootstrap document — the SAME instant the
   * queue dates its rows from. Every age on this panel is measured against it,
   * so a gate cannot report one age in the queue and another in the panel
   * beside it. See the `nowIso` note in the body for why this is a prop rather
   * than a local clock read.
   */
  servedNow: string;
}

const NOOP_ACTION: DashboardActionHandler = () => {};
/**
 * The `actions` default, hoisted OUT of the parameter list (D4).
 *
 * `actions = []` in the destructuring minted a fresh array on every
 * render of a panel called without it, which under `memo` below is a prop
 * that can never compare equal — the wrapper would then be pure overhead
 * for exactly the caller that passes the fewest props.
 */
const NO_ACTIONS: readonly ActionDescriptorWire[] = Object.freeze([]);

/**
 * Ported from legacy hr-automation@1bffbd65,
 * src/dashboard/components/dev/rebuild-demo/DemoLogPanel.tsx:121-128.
 *
 * The outcome action this panel does not draw, because it already draws what
 * that action travels to. `open-park` scrolls to the decision card — and the
 * decision card, in this same scroller, is where the two typed resolutions
 * live. The queue card keeps its `Resolve`: from out there the pill really
 * does leave for the surface that can settle the write.
 *
 * It used to name `open-gate`, carrying this exact reasoning against the other
 * key (R5 f.6). The gate is the one that must stay: from the outcome bar it is
 * the persistent, undismissable route to a decision the operator may have
 * scrolled past, which is rule 1 at the top of this file.
 */
const PANEL_OMITS_OUTCOME_ACTIONS = ["open-park"] as const;

/**
 * Ported from legacy hr-automation@1bffbd65,
 * src/dashboard/components/dev/rebuild-demo/DemoLogPanel.tsx:2186-2193
 * (`OUTCOME_TONE`).
 *
 * THE OUTCOME BAR IS TINTED, and the tint is the band's whole job: it is the
 * one line that states what the run came to, and a hairline-bordered white
 * strip states it as quietly as the tab bar under it. The demo keys its six
 * tones off a SERVED `outcome.tone`; this wire serves none (R5 f.4 → ledger),
 * so the key is the same `DsStatus` the bar's own `StatusDot` already renders
 * — which is stronger than a parallel tone field would be, because the dot and
 * the band physically cannot disagree.
 *
 * LITERAL class strings, exhaustive over the closed enum, for the same reason
 * `DECISION_TONE` above is: a token interpolated into a class name is one
 * Tailwind cannot see, so it emits no rule and the band paints nothing.
 */
const OUTCOME_TONE: Record<DsStatus, string> = {
  waiting:
    "border-[color:var(--ds-status-waiting-border)] bg-[var(--ds-status-waiting-bg)] text-[color:var(--ds-status-waiting-fg)]",
  parked:
    "border-[color:var(--ds-status-parked-border)] bg-[var(--ds-status-parked-bg)] text-[color:var(--ds-status-parked-fg)]",
  failed:
    "border-[color:var(--ds-status-failed-border)] bg-[var(--ds-status-failed-bg)] text-[color:var(--ds-status-failed-fg)]",
  verifiedDone:
    "border-[color:var(--ds-status-verified-done-border)] bg-[var(--ds-status-verified-done-bg)] text-[color:var(--ds-status-verified-done-fg)]",
  doneWarnings:
    "border-[color:var(--ds-status-done-warnings-border)] bg-[var(--ds-status-done-warnings-bg)] text-[color:var(--ds-status-done-warnings-fg)]",
  running:
    "border-[color:var(--ds-status-running-border)] bg-[var(--ds-status-running-bg)] text-[color:var(--ds-status-running-fg)]",
  queued:
    "border-[color:var(--ds-status-queued-border)] bg-[var(--ds-status-queued-bg)] text-[color:var(--ds-status-queued-fg)]",
  cancelled:
    "border-[color:var(--ds-status-cancelled-border)] bg-[var(--ds-status-cancelled-bg)] text-[color:var(--ds-status-cancelled-fg)]",
};

/**
 * The four panel kinds, in the product's own words.
 *
 * FRONTEND COPY over the SERVED closed `panelKind` enum, the same move
 * `queue.tsx:379-391` makes for the row ⓘ — the sentence is a fact about what
 * this product's panel does with a kind, not a fact about the run, so the
 * server serves the enum and the frontend owns the words. A new arm on the
 * enum fails `tsc` here rather than rendering a hole.
 *
 * It is deliberately a SECOND copy of the queue's table for now, not an import
 * from it: `queue.tsx` is owned by another region of this fidelity pass and is
 * read-only to this commit. The two fold into one home the next time both
 * files move together; until then the values here are byte-identical to
 * `queue.tsx`'s, which is what makes the fold mechanical.
 */
const PANEL_KIND_NAME: Record<RunDetailWire["panelKind"], string> = {
  run: "Run Panel",
  review: "Review Panel",
  group: "Group Panel",
  member: "Member Panel",
};

const PANEL_KIND_EXPLANATION: Record<RunDetailWire["panelKind"], string> = {
  run: "Opening it shows the log stream, every value the run read or wrote, and the receipt once it ends.",
  review: "Opening it starts the review — the scanned page beside the fields read from it, one person at a time.",
  group: "Opening it lists the people it holds, attention first, and you can open any one of them from there.",
  member: "Opening it walks the set — previous, next, and a checked mark so you keep your place in it.",
};

/**
 * Ported from legacy hr-automation@1bffbd65,
 * src/dashboard/components/dev/rebuild-demo/DemoLogPanel.tsx:778-812
 * (`PanelKindInfo`).
 *
 * THE PANEL'S OWN ⓘ — and the header's identity rule stated in one line:
 * title · ⓘ · trace, and nothing else.
 *
 * What the header keeps is IDENTITY. What is actionable about the run's STATE
 * lives one line down, on the outcome bar, where the button that acts on it
 * is — which is why the status chip and the attempt badge that used to sit
 * here are gone (R5 f.1/f.2, the operator's own "avoid redundancy").
 *
 * Same size, same slot and same behaviour as the ⓘ on every queue row, so the
 * two read as one affordance. The words are the rebuild's own vocabulary, not
 * the demo's scaffolding: the demo names its row VARIANT here, which is how
 * the demo talks about itself and not a fact about a real run.
 */
function PanelKindInfo({
  panelKind,
  workflowLabel,
  traceId,
}: {
  panelKind: RunDetailWire["panelKind"];
  workflowLabel: string;
  traceId: string;
}) {
  const panelName = PANEL_KIND_NAME[panelKind];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          size="xs"
          variant="ghost"
          label={`What kind of panel this is — ${panelName}`}
          icon={<Info aria-hidden className={dsIcon.sm} />}
          onClick={(event) => event.stopPropagation()}
          className="shrink-0 data-[state=open]:bg-[var(--ds-surface-3)] data-[state=open]:text-[color:var(--ds-fg)]"
        />
      </PopoverTrigger>
      <PopoverContent title={panelName} description={PANEL_KIND_EXPLANATION[panelKind]} side="bottom" align="end" width="md">
        <MetaLine items={[workflowLabel, traceId]} tone="faint" />
      </PopoverContent>
    </Popover>
  );
}

/**
 * D4 (Track D, ref frontend-backend-integration §7.4; audit finding P1) — the
 * run-detail panel is `memo`'d, and every prop it takes is stable or primitive
 * at the one place that renders it (`app/dashboard-app.tsx`;
 * `dashboard-memo-prop-stability` refuses an inline object, array, arrow or
 * call in any of its prop slots).
 *
 * This is the panel `memo` buys the most on, and it is only buyable because of
 * D4's OTHER half. The panel reads ONE row (`surface`), never the day's list —
 * so an SSE patch for any other run leaves every prop here identical and this
 * whole 2,000-line subtree skips. Before the patch-splice landed it could not:
 * `applyDashboardDayPatch` re-parsed the day through zod on every patch, and a
 * `parse` returns a fresh object graph, so `surface` was a new reference after
 * every patch for every run. The splice and the wrapper are one change.
 *
 * `servedNow` is the app's live instant (D256) and ticks once a second, so the
 * open panel still redraws on that tick by design.
 */
export const LogPanel = memo(function LogPanel({
  detail,
  sections,
  captures,
  surface,
  actions = NO_ACTIONS,
  tab,
  onTab,
  onAction = NOOP_ACTION,
  workflowLabel,
  currentAppVersion,
  servedDescriptorHash,
  actorId,
  onDetailEdited,
  aiAdvisory,
  servedNow,
}: LogPanelProps) {
  const available = tabsFor(detail);
  const fallback = defaultTabFor(detail);
  const effectiveTab = tab !== undefined && available.includes(tab) ? tab : fallback;
  const receipt = sections.receipt ?? {
    state: "missing" as const,
    reason: "this run advertises no receipt section",
  };
  const receiptComparisonTarget = effectiveTab === "receipt"
    && receipt.state === "available"
    && receipt.value.retryOf.state === "present"
    ? {
        runId: receipt.value.runId,
        retryOf: receipt.value.retryOf.value,
        workflowId: receipt.value.workflowId,
        currentReceiptId: receipt.value.receiptId,
      }
    : undefined;
  const receiptComparison = useReceiptComparison(receiptComparisonTarget);
  const clearCaptureSelection = captures?.state === "available" ? captures.select : undefined;
  // The same read spans Logs and Receipt, but a dialog belongs to the tab that
  // opened it. Moving tabs closes that short-lived visual state without
  // duplicating the capture read or reopening a preview behind the operator.
  useEffect(() => { clearCaptureSelection?.(undefined); }, [clearCaptureSelection, effectiveTab]);

  const gate = detail.gate;
  const gateOpen = gate.state === "open";
  const { setNode: setDecisionNode, inView: decisionInView, seek: seekDecision } = useSeekAnchor(gateOpen);
  const { setNode: setFailureNode, seek: seekFailure } = useSeekAnchor(
    sections.failure !== undefined,
    "nearest",
  );
  const parked = sections["parked-write"];
  /**
   * THE GATE'S OWN CONTROLS, off the gate's OWN section.
   *
   * They used to come from the panel's generic `actions` prop, which was fed a
   * hard-coded empty list because no generic action projection existed — so a
   * run held at an identity gate drew a decision card with no way to answer it,
   * while the server had projected both `resolve-gate` descriptors all along.
   * That prop now carries the ROW's served controls, and the gate's options
   * still do not ride it: `resolve-gate` needs the packet, the evidence digest
   * and the result schema hash, all of which live on this section and none of
   * which a queue row carries.
   * Reading them here rather than through the generic prop is also what keeps
   * the two straight: the wire refines that EVERY action on this section is a
   * `resolve-gate` at this exact run version, so nothing else can arrive in
   * this slot.
   *
   * A section in any state but `available` (missing / purged / error) yields no
   * controls — a gate this build cannot describe is one it may not offer to
   * resolve, which is `InlineDecision`'s own stated rule.
   */
  const gateSection = sections["identity-gate"];
  const gateActions = gateSection?.state === "available" ? gateSection.value.actions : [];
  const {
    setNode: setParkedNode,
    inView: parkedInView,
    seek: seekParked,
  } = useSeekAnchor(parked !== undefined);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const [decisionSeek, setDecisionSeek] = useState(0);
  const [failureSeek, setFailureSeek] = useState(0);
  const [parkedSeek, setParkedSeek] = useState(0);
  /**
   * The resolution the operator opened, held BY THE PANEL rather than by the
   * inline record: the record unmounts on a tab change and on every section
   * refetch, and a dialog that unmounts mid-answer discards what was typed.
   */
  const [parkTarget, setParkTarget] = useState<ParkResolveTarget | null>(null);
  useEffect(() => setParkTarget(null), [detail.runId]);
  /**
   * The gate resolution the operator opened, held BY THE PANEL for the same
   * reason the park one is: the inline record unmounts on a tab change and on
   * every section refetch, and a dialog that unmounts mid-answer discards the
   * candidate the operator picked or the reason they typed.
   */
  const [gateTarget, setGateTarget] = useState<IdentityApproveTarget | null>(null);
  useEffect(() => setGateTarget(null), [detail.runId]);

  useEffect(() => setNoticeDismissed(false), [detail.runId, effectiveTab]);

  // Scrolling is deferred to an effect rather than done in the click handler
  // because the anchor may not exist yet: pressing the notice from the Receipt
  // tab switches tabs first, and the decision only mounts on the next commit.
  // The dependency is the STABLE `seek` callback, never a fresh object.
  useEffect(() => {
    if (decisionSeek === 0) return;
    seekDecision();
  }, [decisionSeek, seekDecision]);
  useEffect(() => {
    if (failureSeek === 0) return;
    seekFailure();
  }, [failureSeek, seekFailure]);
  useEffect(() => {
    if (parkedSeek === 0) return;
    seekParked();
  }, [parkedSeek, seekParked]);

  const goToDecision = useCallback(() => {
    if (effectiveTab !== "logs") onTab("logs");
    setDecisionSeek((nonce) => nonce + 1);
  }, [effectiveTab, onTab]);
  const goToFailure = useCallback(() => {
    if (effectiveTab !== "logs") onTab("logs");
    setFailureSeek((nonce) => nonce + 1);
  }, [effectiveTab, onTab]);
  const goToPark = useCallback(() => {
    if (effectiveTab !== "logs") onTab("logs");
    setParkedSeek((nonce) => nonce + 1);
  }, [effectiveTab, onTab]);

  /**
   * A served resolution descriptor opens its dialog; it is never dispatched
   * from the inline record. Both resolutions settle a real HR write, so both
   * carry a `confirm` block, and the dialog is where that block is READ.
   */
  /**
   * A served `resolve-gate` descriptor opens the CEREMONY, and is never
   * dispatched from the inline record (D226).
   *
   * The generic dispatcher composes a payload from served facts alone, and two
   * of the four ceremonies need something no served fact carries: which
   * candidate the operator chose, and why they rejected. Routing the gate
   * through the confirm-only path would have offered a risky approval as one
   * click, which is ref write-safety §14.6 risk 1 manufactured by accident — so the
   * descriptor opens the dialog that can carry the answer, and nothing else.
   */
  const handleGateResolution = useCallback<DashboardActionHandler>(
    (action) => {
      if (gateSection?.state !== "available") {
        // The wire serves the controls on the SAME section as the packet, so a
        // section that is not `available` served no controls to press. Reaching
        // here means the section changed state under a surface mid-flight.
        throw new Error(
          `action ${action.key} was pressed while the identity-gate section is `
          + `${gateSection?.state ?? "absent"}; there is no packet to answer`,
        );
      }
      if (identityGateArm(action) === undefined || action.kind !== "command") {
        throw new Error(
          `the identity-gate section served ${action.key}, which names no ref write-safety §14.4 resolution`,
        );
      }
      setGateTarget({ gate: gateSection, action });
    },
    [gateSection],
  );

  const handleParkResolution = useCallback<DashboardActionHandler>(
    (action) => {
      if (parked === undefined) return;
      if (parkResolutionArm(action) === undefined || action.kind !== "command") {
        throw new Error(
          `the parked-write section served ${action.key}, which is not a ref write-safety §4.1 resolution`,
        );
      }
      setParkTarget({ parked, action });
    },
    [parked],
  );

  /**
   * The outcome bar's `Review` / `Open failure` are NAVIGATION to something in
   * this panel's own stream, so they travel there rather than posting a result
   * nobody asked for. Everything else goes straight through to the app, which
   * owns turning an action into the one command envelope.
   */
  const handleAction = useCallback<DashboardActionHandler>(
    (action, target) => {
      if (action.kind === "navigation" && action.navigate.kind === "self") {
        if (gateOpen) {
          goToDecision();
          return;
        }
        if (sections.failure !== undefined) {
          goToFailure();
          return;
        }
      }
      onAction(action, target);
    },
    [gateOpen, goToDecision, goToFailure, onAction, sections.failure],
  );

  /**
   * There is no CSS way to say "below whatever is sticky above me", so the
   * head's own height is published as a custom property on the scroller. This
   * is one element measuring its OWN child for its OWN layout.
   */
  const scrollRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const head = headRef.current;
    const scroller = scrollRef.current;
    if (head === null || scroller === null) return;
    const publish = (): void =>
      scroller.style.setProperty(
        "--ds-panel-head-h",
        `${String(Math.round(head.getBoundingClientRect().height))}px`,
      );
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(head);
    return () => observer.disconnect();
  }, [detail.runId, effectiveTab]);

  /**
   * ONE clock, shared by every age on this surface — the outcome bar's and the
   * floating notice's — and it is the SERVER'S, handed down by the composition
   * (`QueueViewState.nowIso` is the same value).
   *
   * R5 f.5 landed this as a local `systemClock.now()`, which was one read per
   * render but the WRONG read: the queue beside this panel dates its rows from
   * `boot.serverClock.now`, so the same gate could report two different ages a
   * few seconds apart depending on which surface you looked at — D124's defect
   * with the clocks swapped. The wave-end parity gate is what surfaced it, and
   * it surfaced it the way a non-deterministic value always shows up: as a
   * reference that drifts by a minute every time the lane runs
   * (`identity-review 258h 22m` → `258h 31m`), which no re-freeze can settle.
   */
  const nowIso = servedNow;

  const outcome = detail.outcome;
  const outcomeStatus =
    outcome.state === "terminal" ? outcomeDsStatusOf(outcome.result) : dsStatusOf(detail.header.status);
  const outcomeText =
    outcome.state === "terminal"
      ? terminalOutcomeText(outcome)
      : gate.state === "open"
        ? gate.label
        : outcome.reason;
  /**
   * At most ONE notice, and the gate wins.
   *
   * A run can only be parked on a write while no gate is open, so the pair is
   * mutually exclusive in practice — but two floating surfaces sharing one
   * corner is a geometry both of them would have to know about, which DESIGN.md
   * refuses outright. The precedence is stated here so it can never become an
   * arbitration between two elements later.
   */
  const noticeShown = gateOpen && !noticeDismissed && !decisionInView;
  const parkNoticeShown = !noticeShown
    && !gateOpen
    && parked !== undefined
    && !noticeDismissed
    && !parkedInView;

  /**
   * Is this region drawing three columns? Measured, not inferred (ref dashboard-surfaces §Shell).
   *
   * The CSS half of the split is the CONTAINER query on the wrapper below. This
   * is the JS half, and it exists because one decision inside the region is a
   * React one rather than a CSS one: whether the rail may render as its 34px
   * SPINE. In the stacked arrangement a spine would hide the data behind a
   * control that gives back a column that no longer exists — and which of two
   * components mounts is not something a stylesheet can decide.
   *
   * Both halves must answer identically, so this reads the CSS decision back
   * instead of re-deriving it:
   *
   * - `containerType` is the shell gate. Below 1180 the shell is one stacked
   *   column and the wrapper is NOT declared a container, so every
   *   `@…/detail:` variant is false whatever the width; `normal` here is that
   *   same fact, read from the same class.
   * - the width is the region's own, from the SAME box the query measures —
   *   the wrapper carries no padding and no border, which is what makes its
   *   border box its container-query box. `getBoundingClientRect` rather than
   *   `clientWidth` because a container query compares fractional pixels and
   *   `clientWidth` rounds, so at a fractional width the rounded value is the
   *   one that would disagree.
   */
  const regionRef = useRef<HTMLDivElement>(null);
  const [threeColumn, setThreeColumn] = useState(false);
  useLayoutEffect(() => {
    const region = regionRef.current;
    if (region === null) return;
    const publish = (): void => {
      setThreeColumn(
        window.getComputedStyle(region).containerType !== "normal"
        && region.getBoundingClientRect().width >= DETAIL_THREE_COLUMN_PX,
      );
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(region);
    return () => observer.disconnect();
  }, []);
  // Unmeasured is NOT "three columns": the first render has no layout behind
  // it, and defaulting to the spine would flash a collapsed rail over data the
  // operator never asked to hide.
  const railState = useContextRail(threeColumn);
  // The rail widens to its edit width while the Data surface is EXPANDED
  // (`--ds-w-context-rail-wide`, ref dashboard-surfaces D19(d)); the flag resets when the
  // operator switches runs so one run's edit session can never widen another's.
  const [dataExpanded, setDataExpanded] = useState(false);
  useEffect(() => setDataExpanded(false), [detail.runId]);
  /*
    `context-evidence` IS NOT HANDED TO THE RAIL (R6 f.19). The demo states the
    rail's order twice — Data · Attempts · Delegation — and moves captures to
    Receipt explicitly, because evidence QUALIFIES an outcome rather than
    feeding the live stream. The section re-homes to the Receipt tab; it sits on
    the audit's hookup ledger so it is relocated, not lost. Nothing regresses
    today: the arm is `declared-unserved` (D184) and no composition populates it.
  */
  const railSections: ContextSections = {
    ...(sections["context-data"] === undefined ? {} : { "context-data": sections["context-data"] }),
    ...(sections["context-attempts"] === undefined
      ? {}
      : { "context-attempts": sections["context-attempts"] }),
  };

  return (
    /*
      THE CONTAINER IS THE WRAPPER, AND IT CARRIES NOTHING ELSE.

      A container query cannot style its own container, so the element that
      declares `@container/detail` can never be the element whose columns
      switch — asking from the same box is a query that never matches, and it
      degrades silently to the stacked layout at every width (ref dashboard-surfaces §13.2 says
      the same thing about the explorer's `@container/graph`).

      It carries no padding and no border on purpose: the JS half above
      measures this box with `getBoundingClientRect`, so its border box has to
      BE its container-query box or the two halves can disagree.

      `min-[1180px]:` on the container DECLARATION is ref dashboard-surfaces §Shell's first
      row, and it is the one question in this file the WINDOW is the right
      instrument for — it is the shell's own breakpoint, already spelled once
      in `dashboard-app.tsx`. Below it the shell is a single stacked column, so
      the region is handed the full page width (1000px at a 1024px window)
      while having no definite height for an inner grid to fill: a three-column
      arrangement there would be wide enough and still wrong, and no width
      threshold can tell that 1000px apart from the 868px a docked 1280px
      window gives a region that IS a cell. So below 1180 there is simply no
      container named `detail`, every `@…/detail:` variant is false, and the
      arrangement is the stack the table asks for — "the rail degrades to a
      section, never to nothing."
    */
    <div ref={regionRef} className="min-[1180px]:@container/detail flex min-h-0 min-w-0 flex-col">
    <div
      className={cn(
        // Below the three-column threshold the region is a scrolling stack, so
        // the rail sits under the panel instead of squeezing it to nothing.
        //
        // `w-full` is load-bearing (D187). Without an explicit width this
        // element sized to its content — so the grid below resolved
        // `minmax(0,1fr) var(--ds-w-context-rail)` to **2px 376px**, collapsing
        // the entire run-detail panel (the failure record, the evidence
        // receipt — every trust surface) into a 2px sliver while the
        // accessibility tree still reported all of it. Every `run-*` reference
        // in the parity corpus photographed that empty column and nobody read
        // the pixels, because the a11y half agreed the content was there.
        //
        // `flex-1` rather than the former `h-full`: the wrapper's height is
        // definite only where the shell grid's row is, and a percentage height
        // against an auto row resolves to auto — which would leave the stacked
        // arrangement overflowing its box instead of scrolling inside it.
        "flex min-h-0 w-full min-w-0 flex-1 flex-col gap-[var(--ds-space-cozy)] overflow-y-auto",
        "@min-[868px]/detail:grid @min-[868px]/detail:overflow-hidden",
        "@min-[868px]/detail:grid-rows-[auto_minmax(0,1fr)]",
        railState.collapsed
          ? "@min-[868px]/detail:grid-cols-[minmax(0,1fr)_var(--ds-w-context-spine)]"
          : dataExpanded
            ? "@min-[868px]/detail:grid-cols-[minmax(0,1fr)_var(--ds-w-context-rail-wide)]"
            : "@min-[868px]/detail:grid-cols-[minmax(0,1fr)_var(--ds-w-context-rail)]",
      )}
    >
      {detail.timeline.events.length > 0 && (
        <section
          aria-label="Run shape"
          className={cn(
            "min-w-0 shrink-0 border",
            "border-[color:var(--ds-border)] bg-[var(--ds-surface-1)]",
            dsRadius.lg,
            "@min-[868px]/detail:col-span-2 @min-[868px]/detail:row-start-1",
            "@min-[1068px]/detail:col-span-1 @min-[1068px]/detail:col-start-1",
          )}
        >
          <Timeline detail={detail} nowIso={nowIso} />
        </section>
      )}

      <section
        aria-label="Run detail"
        className={cn(
          // `relative` because the DECISION NOTICE anchors to this box and must
          // NOT scroll with the body: an `absolute` child of a scroller is
          // positioned against the scrolled content, so the reminder would
          // slide away the moment the operator moved the stream.
          "@container relative flex min-h-[24rem] min-w-0 flex-col overflow-hidden border",
          "border-[color:var(--ds-border)] bg-[var(--ds-surface-1)]",
          dsRadius.lg,
          "@min-[868px]/detail:col-start-1 @min-[868px]/detail:row-start-2 @min-[868px]/detail:min-h-0",
        )}
      >
        {/* ONE SCROLLING REGION FOR THE WHOLE PANEL BODY — see the file note. */}
        <div
          ref={scrollRef}
          className="scroll-pt-[var(--ds-panel-head-h,0px)] flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto"
        >
          <div ref={headRef} className={cn("sticky top-0 shrink-0 bg-[var(--ds-surface-1)]", dsLayer.sticky)}>
            {/*
              THE HEADER CARRIES IDENTITY, AND ONLY IDENTITY: title · ⓘ · trace.

              Ported from legacy hr-automation@1bffbd65,
              `DemoLogPanel.tsx:2496-2538`, including the deletions the demo
              records there. The status chip and the `attempt N` badge that
              used to ride this line are GONE (R5 f.1/f.2). The operator's rule,
              quoted in the demo at :2510-2526: THE HEADER DOES NOT REPEAT A
              STATE THE BAND DIRECTLY BELOW IT ALREADY STATES — the outcome bar
              is a hairline away, it names the state in a sentence, it carries
              the action, and it now carries the decision's age too. The attempt
              affordance is the rail's, where switching attempts happens.

              The title never truncates to make room for the ⓘ + trace: those
              ride `ml-auto` and drop under at their natural length when the row
              is too tight.
            */}
            <div
              className={cn(
                "flex flex-wrap items-center border-b",
                dsBorder.subtle,
                "gap-x-[var(--ds-space-base)] gap-y-[var(--ds-space-tight)] px-[var(--ds-space-cozy)] py-[var(--ds-space-base)]",
              )}
            >
              <span
                className={cn(
                  dsText.title,
                  dsText.flush,
                  "min-w-0 max-w-full break-words font-semibold text-[color:var(--ds-fg)]",
                )}
              >
                {detail.header.title}
              </span>
              <span className="ml-auto flex min-w-0 max-w-full items-center gap-[var(--ds-space-base)]">
                <PanelKindInfo
                  panelKind={detail.panelKind}
                  workflowLabel={workflowLabel}
                  traceId={detail.header.traceId}
                />
                <span
                  className={cn(
                    dsText.meta,
                    dsText.nums,
                    "min-w-0 break-all text-[color:var(--ds-fg-muted)]",
                  )}
                >
                  {detail.header.traceId}
                </span>
              </span>
            </div>

            {/* The outcome line — one sentence of "so what", and, on a gated
                row, the one route to the decision that can never be dismissed.

                TINTED (R5 f.3): the band takes the status's own border/bg/fg
                triple, which is what makes it read as a statement rather than
                as another hairline strip. Same wrap rule as the identity
                header — the sentence fills; the age and the action sit beside
                it when they fit, else under at natural length. */}
            <div
              className={cn(
                "flex flex-wrap items-center border-b",
                "gap-x-[var(--ds-space-base)] gap-y-[var(--ds-space-tight)] px-[var(--ds-space-cozy)] py-[var(--ds-space-snug)]",
                OUTCOME_TONE[outcomeStatus],
              )}
            >
              {/* `StatusDot`, never a hand-rolled span: DESIGN.md admits exactly
                  two renderers for a status, and a token interpolated into a
                  class name is one Tailwind cannot see — it would emit no rule
                  and the dot would silently paint nothing. */}
              <StatusDot status={outcomeStatus} />
              <span className={cn(dsText.body, "min-w-0 max-w-full flex-1")}>{outcomeText}</span>
              <span className="ml-auto flex min-w-max items-center gap-[var(--ds-space-base)]">
                {/* HOW LONG IT HAS NEEDED YOU, and this is the only place on
                    the surface that says it now that the header chip is gone
                    (R5 f.5, ported from `DemoLogPanel.tsx:2557-2569`). It is
                    not the run's total elapsed — see `decisionAge`. It rides
                    the outcome bar rather than the header because this is the
                    band that already carries the state and its action. */}
                {gate.state === "open" && (
                  <span className={cn(dsText.meta, dsText.nums, "shrink-0 tabular-nums opacity-80")}>
                    {decisionAge(gate.openedAt, nowIso)}
                  </span>
                )}
                <OutcomeActionButton
                  actions={actions}
                  target={{ runId: detail.runId, expectedVersion: detail.rowRevision }}
                  onAction={handleAction}
                  omitKeys={PANEL_OMITS_OUTCOME_ACTIONS}
                />
              </span>
            </div>

            {/* tabs — derived from what the run ADVERTISES, never a fixed set */}
            <div
              role="tablist"
              aria-label="Run detail sections"
              className={cn(
                "flex shrink-0 items-center border-b",
                dsSize.hBar,
                dsBorder.base,
                "gap-[var(--ds-space-tight)] px-[var(--ds-space-base)]",
              )}
            >
              {available.map((key, index) => {
                const active = effectiveTab === key;
                const meta = TAB_META[key];
                const Icon = meta.icon;
                return (
                  <Tooltip key={key} content={`${meta.label} — press ${String(index + 1)}`} side="top">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => onTab(key)}
                      className={cn(
                        "relative -mb-px inline-flex cursor-pointer items-center border-b-2 border-transparent",
                        "h-[var(--ds-h-bar)] gap-[var(--ds-space-snug)] px-[var(--ds-space-base)]",
                        dsText.ui,
                        dsFocus,
                        dsMotion.base,
                        active
                          ? "border-b-[color:var(--ds-accent)] font-semibold text-[color:var(--ds-fg)]"
                          : "text-[color:var(--ds-fg-muted)] hover:text-[color:var(--ds-fg)]",
                      )}
                    >
                      <Icon aria-hidden className={cn(dsIcon.sm, "shrink-0")} />
                      {meta.label}
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          </div>

          {/* THE TAB BODY, in the same scroller as the head above it. */}
          {effectiveTab === "logs" && (
            <LogsTab
              detail={detail}
              captures={captures}
              notes={sections.logs}
              failure={sections.failure}
              parked={parked}
              gateActions={gateActions}
              onResolveGate={handleGateResolution}
              onResolvePark={handleParkResolution}
              decisionRef={setDecisionNode}
              failureRef={setFailureNode}
              parkedRef={setParkedNode}
              surface={surface}
              workflowLabel={workflowLabel}
              currentAppVersion={currentAppVersion}
              servedDescriptorHash={servedDescriptorHash}
              aiAdvisory={aiAdvisory}
              nowIso={nowIso}
            />
          )}
          {effectiveTab === "receipt" && (
            <>
            <ReceiptView
              outcome={detail.outcome}
              receipt={receipt}
              comparison={receiptComparison}
              resolvedInstances={surface?.resolvedInstances ?? []}
              /*
                Ledger 2 row D13 — `dryRun` is REQUIRED on `ReceiptView` and is
                genuinely `undefined` here when the panel is opened for a run
                outside the currently loaded day: `surface` is looked up in
                THIS day's queue surfaces (`dashboard-app.tsx`'s
                `openPanelSurface`), and a deep link across a day boundary
                finds no row there while `detail` still loads fine. That is
                "we do not know", never "not a rehearsal" — see `receipt.tsx`'s
                own doc comment for why this is not defaulted to `false`.
              */
              dryRun={surface?.dryRun}
            />
            {captures !== undefined && <RunCaptures captures={captures} />}
            </>
          )}
          {(effectiveTab === "review" || effectiveTab === "people") && <UnservedTab tab={effectiveTab} />}
        </div>

        {noticeShown && gate.state === "open" && (
          <DecisionNotice
            tone="waiting"
            label={gate.label}
            since={gate.openedAt}
            nowIso={nowIso}
            icon={<UserRoundSearch aria-hidden className={cn(dsIcon.sm, "shrink-0")} />}
            goLabel="Go to the decision"
            dismissLabel="Dismiss this reminder — the decision stays open"
            onGo={goToDecision}
            onDismiss={() => setNoticeDismissed(true)}
          />
        )}
        {/* `Pause`, not `PauseCircle` (R5 f.15) — the demo's glyph at
            `DemoLogPanel.tsx:875`, and the same one `STEP_TONE.parked` uses, so
            the notice and the step it points at draw the same mark. The ringed
            variant reads as a control at 14px, which this is not. */}
        {parkNoticeShown && parked !== undefined && (
          <DecisionNotice
            tone="parked"
            label={dsStatusText("parked")}
            since={parked.parkedAt}
            nowIso={nowIso}
            icon={<Pause aria-hidden className={cn(dsIcon.sm, "shrink-0")} />}
            goLabel="Go to the parked write"
            dismissLabel="Dismiss this reminder — the write stays parked"
            onGo={goToPark}
            onDismiss={() => setNoticeDismissed(true)}
          />
        )}
      </section>

      {railState.collapsed ? (
        <ContextRailSpine
          summary={detail.context}
          onOpen={() => railState.setOpen(true)}
          className={cn(
            "@min-[868px]/detail:col-start-2 @min-[868px]/detail:row-start-2",
            "@min-[1068px]/detail:row-start-1 @min-[1068px]/detail:row-span-2",
          )}
        />
      ) : (
        <ContextRail
          summary={detail.context}
          sections={railSections}
          /*
            COLLAPSING CLEARS THE EXPANSION (D273 item 5). The demo's one hook
            does it in `setOpen(false)` (`DemoContextRail.tsx:181-191`) and the
            reason is the same here: the rail that comes back is a NEW mount,
            and a stale expansion is a wide column behind a header reading
            `Run data`.
          */
          onClose={() => {
            railState.setOpen(false);
            setDataExpanded(false);
          }}
          actorId={actorId}
          liveStatus={surface?.status}
          dataExpanded={dataExpanded}
          onDataExpandedChange={setDataExpanded}
          onSaved={onDetailEdited}
          className={cn(
            "shrink-0",
            "@min-[868px]/detail:col-start-2 @min-[868px]/detail:row-start-2 @min-[868px]/detail:shrink",
            "@min-[1068px]/detail:row-start-1 @min-[1068px]/detail:row-span-2",
          )}
        />
      )}

      {/*
        THE RESOLUTION DIALOG, mounted at the REGION rather than beside the
        record it was opened from. It is reachable from anywhere on this
        surface, so its answer has to be visible from anywhere on it
        (DESIGN.md) — and it is keyed to the run through `parkTarget`, which is
        cleared whenever the open run changes, so a stale answer can never sit
        over a different write claiming to be about it.
      */}
      <IdentityApproveDialog
        target={gateTarget}
        actorId={actorId}
        onClose={() => setGateTarget(null)}
        onResolved={onDetailEdited}
      />
      <ParkResolveDialog
        target={parkTarget}
        actorId={actorId}
        onClose={() => setParkTarget(null)}
        onResolved={onDetailEdited}
      />
    </div>
    </div>
  );
});

export type { RunDetailWire };
