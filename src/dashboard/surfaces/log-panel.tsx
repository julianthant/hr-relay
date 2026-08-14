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
 * editing, People rosters and progressive Review records are all doc 12 / doc 06
 * surfaces landing in 2g/2h. This panel renders the FRAME and the served
 * identity for the failure and omits every field the wire does not carry —
 * it never invents a write state, because "nothing was written" and "we do not
 * know" are the two sentences an operator acts on most differently.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ClipboardList,
  CornerDownRight,
  FileText,
  Info,
  Pause,
  Receipt,
  ScrollText,
  TriangleAlert,
  UserRoundSearch,
  Users,
  X,
} from "lucide-react";
import type { z } from "zod";
import { systemClock } from "../../domain/clock.js";
import { cn } from "../lib/utils.js";
import {
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
  RunDetailSectionResponseSchema,
  RunDetailWireSchema,
} from "../../domain/dashboard/run-detail.js";
import type { RunDetailSectionSchema } from "../../domain/dashboard/primitives.js";
import type { ActionDescriptorWire } from "../../domain/dashboard/actions.js";
import { BannerActions, OutcomeActionButton, type DashboardActionHandler } from "./actions.js";
import {
  InlineParkedWrite,
  ParkResolveDialog,
  parkResolutionArm,
  type ParkResolveTarget,
  type ParkedWritePayload,
} from "./park-resolve.js";
import {
  ContextRail,
  ContextRailSpine,
  useContextRail,
  type ContextSections,
} from "./context-rail.js";
import { elapsedSecondsBetween, fmtClock, fmtElapsed, plural } from "./format.js";
import { ReceiptView, type ReceiptSectionPayload } from "./receipt.js";
import { RunProvenanceBar, type QueueSurfaceWire } from "./run-identity.js";
import { FailureDetailBody } from "./trust.js";
import { FailureAdvisoryPanel } from "./advisory.js";
import type { CapabilityAvailabilitySchema } from "../../domain/absence.js";
import { dsStatusOf, outcomeDsStatusOf } from "./status.js";

type CapabilityAvailability = z.infer<typeof CapabilityAvailabilitySchema>;

type RunDetailWire = z.infer<typeof RunDetailWireSchema>;
type RunDetailSectionResponse = z.infer<typeof RunDetailSectionResponseSchema>;
type RunDetailSection = z.infer<typeof RunDetailSectionSchema>;
type TimelineEvent = RunDetailWire["timeline"]["events"][number];
type NotePage = Extract<RunDetailSectionResponse, { section: "logs" }>["payload"];
type FailurePayload = Extract<RunDetailSectionResponse, { section: "failure" }>["payload"];

/**
 * THE DETAIL REGION'S TWO BREAKPOINTS, IN COLUMN PIXELS (doc 03 §Shell).
 *
 * > "A consequence worth pinning: inside the detail region, a layout switch
 * > keys on the COLUMN, not the window."
 *
 * The region used to switch on `min-[1280px]:` / `min-[1480px]:`, which is the
 * WINDOW — and the window is the one measurement that does not describe this
 * box. The shell spends `--ds-w-side-panel` (376px) on the queue plus three
 * `--ds-shell-inset` gaps (12px each) before this column starts, and the
 * workflow panel takes 200px more whenever it is docked as a sidebar. So the
 * same 1280px window hands this region 868px with the panel floating and 668px
 * with it docked — and a viewport query fires at the wrong moment in both
 * directions. Measured, on the fixture corpus, before the change:
 *
 * | window | floating | sidebar | old centre, docked |
 * |---|---|---|---|
 * | 1280 | 868 | 668 | **280px** — three columns forced into a two-column box |
 * | 1480 | 1068 | 868 | shape split beside a 480px centre |
 *
 * Both numbers are the OLD window thresholds translated through that constant
 * 412px of shell, so the rendered arrangement at the default (floating) panel
 * mode is unchanged at every reference viewport: 1280 − 412 = 868, and
 * 1480 − 412 = 1068.
 *
 * These are the JS half of the split. The CSS half is the literal
 * `@min-[868px]/detail:` / `@min-[1068px]/detail:` in this file's class
 * strings, because Tailwind cannot see through an identifier — and
 * `tests/unit/dashboard/detail-region-breakpoints.test.ts` pins the two halves
 * to each other, since a threshold that drifts between them is a region whose
 * component choice and column arrangement disagree.
 */
export const DETAIL_THREE_COLUMN_PX = 868;
export const DETAIL_SHAPE_BESIDE_PX = 1068;

/** The tab set this slice can draw. Review and People are advertised, not assumed. */
export type PanelTab = "review" | "people" | "logs" | "receipt";

/** Every section the panel is handed, keyed by the wire's own section name. */
export interface PanelSections extends ContextSections {
  logs?: NotePage;
  receipt?: ReceiptSectionPayload;
  failure?: FailurePayload;
  /**
   * Doc 09 §4.1's parked write. It has NO tab, deliberately: DESIGN.md names
   * `Write parked` a DECISION, and a decision's surface renders inline in the
   * stream at the line that produced it — the same placement the failure record
   * gets and for the same reason.
   */
  "parked-write"?: ParkedWritePayload;
}

const TAB_META: Record<PanelTab, { label: string; icon: typeof ScrollText }> = {
  review: { label: "Review", icon: ClipboardList },
  people: { label: "People", icon: Users },
  logs: { label: "Logs", icon: ScrollText },
  // `Receipt`, not `ReceiptText` (R5 f.9) — the demo's own glyph choice at
  // `DemoLogPanel.tsx:2176`. The two differ on screen: `ReceiptText` draws
  // ruled lines inside the slip, which at 14px reads as a second document
  // icon beside `Logs`.
  receipt: { label: "Receipt", icon: Receipt },
};

/**
 * The tabs are SERVED, never fixed at four and never decided from a workflow.
 * `availableSections` is the descriptor's own answer, and the ORDER is doc 13
 * §3.3's fixed composition: `Review · Logs · Receipt` / `People · Logs ·
 * Receipt` / `Logs · Receipt`. A section the wire does not advertise draws no
 * tab — a dead tab that opens an empty panel is worse than an absent one.
 */
const TAB_ORDER: readonly PanelTab[] = ["review", "people", "logs", "receipt"];

export function tabsFor(detail: RunDetailWire): PanelTab[] {
  const advertised = new Set<RunDetailSection>(detail.availableSections);
  return TAB_ORDER.filter((tab) => advertised.has(tab));
}

/**
 * A failed run opens on the LOGS, ahead of every other default: its record now
 * lives in the stream at the line it died on, and moving the record off the
 * panel top must never put it behind a tab. Otherwise a run that has finished
 * opens on its receipt — the answer — and a run still working opens on its
 * stream.
 */
export function defaultTabFor(detail: RunDetailWire): PanelTab {
  const available = tabsFor(detail);
  const pick = (...preferred: PanelTab[]): PanelTab =>
    preferred.find((tab) => available.includes(tab)) ?? available[0] ?? "logs";
  if (detail.outcome.state === "terminal" && detail.outcome.result === "failed") return pick("logs");
  if (detail.outcome.state === "terminal") return pick("receipt", "logs");
  return pick("logs", "receipt");
}

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

/** The one sentence a skipped step is allowed to say about itself. */
const NOT_RUN_PHRASE: Record<"condition-false" | "branch-not-selected", string> = {
  "condition-false": "its condition was false",
  "branch-not-selected": "its branch was not selected",
};

function timelineEventLabel(event: TimelineEvent, spanSec: number | undefined): string {
  const duration = spanSec === undefined ? "" : `, ${fmtElapsed(spanSec)}`;
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
 * Durations are the gaps between the server's OWN instants (doc 13 §4: elapsed
 * time between server timestamps is display-only). The panel never invents a
 * duration for an event with nothing after it.
 */
function Timeline({ detail }: { detail: RunDetailWire }) {
  const events = detail.timeline.events;
  if (events.length === 0) return null;

  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const totalSec = elapsedSecondsBetween(first.at, last.at);

  return (
    <div className="px-[var(--ds-space-cozy)] py-[var(--ds-space-base)]">
      <div className="flex items-stretch gap-[var(--ds-space-hair)]">
        {ordered.map((event, index) => {
          const tone = EVENT_TONE[event.state];
          const next = ordered[index + 1];
          const spanSec = next === undefined ? undefined : elapsedSecondsBetween(event.at, next.at);
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
              <span
                aria-label={timelineEventLabel(event, spanSec)}
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
                <span className={cn(dsClip.text, dsText.micro, dsText.nums, "text-[color:var(--ds-fg-muted)]")}>
                  {spanSec === undefined ? fmtClock(event.at) : fmtElapsed(spanSec)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* axis — when it started, and how long the run's own events span. */}
      <div
        className={cn(
          "mt-[var(--ds-space-snug)] flex items-baseline gap-[var(--ds-space-base)] border-t pt-[var(--ds-space-tight)]",
          dsBorder.subtle,
          dsText.micro,
          dsText.nums,
          "text-[color:var(--ds-fg-muted)]",
        )}
      >
        <span>{fmtClock(first.at)}</span>
        <span aria-hidden className="h-px flex-1 bg-[var(--ds-border)]" />
        <span>{fmtElapsed(totalSec)} elapsed</span>
      </div>
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
function InlineDecision({
  gate,
  actions,
  runId,
  onAction,
  anchorRef,
}: {
  gate: Extract<RunDetailWire["gate"], { state: "open" }>;
  actions: readonly ActionDescriptorWire[];
  runId: string;
  onAction: DashboardActionHandler;
  anchorRef?: (node: HTMLElement | null) => void;
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
        <span
          className={cn(
            dsText.meta,
            dsText.nums,
            "ml-auto shrink-0 whitespace-nowrap opacity-85 text-[color:var(--ds-status-waiting-fg)]",
          )}
        >
          since {fmtClock(gate.openedAt)}
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
 * THE FAILURE RECORD, rendered where the run died.
 *
 * 1i serves the record's IDENTITY (`{ runId, failureId }`) and the facts around
 * it — the terminal outcome, the timeline's failed event, and the error-level
 * notes in the stream. The doc 12 projection that turns that id into a summary,
 * a code, a write state and a remediation ladder is 2g. So this renders the
 * frame, names the record, and shows what the run's OWN stream said — and it
 * does not print a write-state sentence, because the difference between "wrote
 * nothing" and "we never read back" is the whole reason that sentence exists.
 */
function InlineFailureRecord({
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
  /** Doc 12 §4.4's advisory availability, off the bootstrap wire (D178). */
  aiAdvisory: CapabilityAvailability;
}) {
  return (
    <div
      ref={anchorRef}
      tabIndex={-1}
      data-panel-failure-record=""
      aria-label="Failure record"
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
      <div className="flex flex-wrap items-center gap-[var(--ds-space-snug)]">
        <TriangleAlert aria-hidden className={cn(dsIcon.md, "shrink-0 text-[color:var(--ds-danger)]")} />
        <span className={cn(dsText.ui, "font-semibold text-[color:var(--ds-danger)]")}>
          This run failed
        </span>
        {failure.state === "available" && (
          <Chip label="record" tone="danger">
            {failure.value.failureId}
          </Chip>
        )}
      </div>

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
function anchorIndex(notes: readonly NotePage["notes"][number][], at: string): number {
  let index = -1;
  for (const [position, note] of notes.entries()) {
    if (note.at <= at) index = position;
  }
  return index;
}

function LogsTab({
  detail,
  notes,
  failure,
  parked,
  gateActions,
  onAction,
  onResolvePark,
  decisionRef,
  failureRef,
  parkedRef,
  surface,
  workflowLabel,
  currentAppVersion,
  currentDescriptorHash,
  aiAdvisory,
}: {
  detail: RunDetailWire;
  notes: NotePage | undefined;
  failure: FailurePayload | undefined;
  parked: ParkedWritePayload | undefined;
  gateActions: readonly ActionDescriptorWire[];
  onAction: DashboardActionHandler;
  onResolvePark: DashboardActionHandler;
  decisionRef: (node: HTMLElement | null) => void;
  failureRef: (node: HTMLElement | null) => void;
  parkedRef: (node: HTMLElement | null) => void;
  surface?: QueueSurfaceWire;
  workflowLabel: string;
  currentAppVersion: string;
  currentDescriptorHash: string;
  aiAdvisory: CapabilityAvailability;
}) {
  const [query, setQuery] = useState("");
  useEffect(() => setQuery(""), [detail.runId]);

  const lines = useMemo(() => [...(notes?.notes ?? [])].sort((a, b) => a.sequence - b.sequence), [notes]);
  const trimmed = query.trim().toLowerCase();
  const matches = useCallback(
    (note: NotePage["notes"][number]): boolean =>
      trimmed.length > 0 && note.message.toLowerCase().includes(trimmed),
    [trimmed],
  );
  const matchCount = trimmed.length > 0 ? lines.filter(matches).length : 0;

  const gate = detail.gate;
  const decisionAt = gate.state === "open" ? anchorIndex(lines, gate.openedAt) : undefined;
  const failureAt =
    failure !== undefined && detail.outcome.state === "terminal" && detail.outcome.result === "failed"
      ? anchorIndex(lines, detail.outcome.completedAt)
      : undefined;
  // The park's own instant, off the served section — the run stopped when the
  // kernel parked it, which is not the same moment as any line in the stream.
  const parkedAt = parked === undefined ? undefined : anchorIndex(lines, parked.parkedAt);
  const errorNotes = lines.filter((note) => note.level === "error");

  const decision =
    gate.state === "open" ? (
      <InlineDecision
        gate={gate}
        actions={gateActions}
        runId={detail.runId}
        onAction={onAction}
        anchorRef={decisionRef}
      />
    ) : null;
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
        {failureAt === -1 && failureRecord}
        {parkedAt === -1 && parkedRecord}
        {lines.length === 0 ? (
          <EmptyState
            icon={<FileText aria-hidden className={dsIcon.lg} />}
            title="No log lines yet"
            description="Lines appear here as the run works. Nothing has been recorded for this run."
          />
        ) : (
          lines.map((note, index) => {
            const Icon = NOTE_ICON[note.level];
            const hit = matches(note);
            const dim = trimmed.length > 0 && !hit;
            return (
              <div key={note.noteId}>
                <div
                  className={cn(
                    "flex items-start gap-[var(--ds-space-snug)] px-[var(--ds-space-cozy)] pl-5 py-[var(--ds-space-hair)]",
                    dim && "opacity-35",
                  )}
                >
                  <span
                    className={cn(
                      dsText.micro,
                      dsText.nums,
                      "mt-[var(--ds-space-hair)] shrink-0 text-[color:var(--ds-fg-muted)]",
                    )}
                  >
                    {fmtClock(note.at)}
                  </span>
                  <span className="mt-[var(--ds-space-hair)] w-3.5 shrink-0 text-center">
                    <Icon aria-hidden className={cn(dsIcon.sm, NOTE_TONE[note.level])} />
                  </span>
                  <span
                    className={cn(
                      dsText.body,
                      "min-w-0 break-words",
                      NOTE_TONE[note.level],
                      hit && cn(dsRadius.xs, "bg-[var(--ds-info-bg)]"),
                    )}
                  >
                    {note.message}
                  </span>
                </div>
                {decisionAt === index && decision}
                {failureAt === index && failureRecord}
                {parkedAt === index && parkedRecord}
              </div>
            );
          })
        )}
        {notes?.nextCursor.state === "present" && (
          <span
            className={cn(
              dsText.meta,
              "px-5 py-[var(--ds-space-tight)] text-[color:var(--ds-fg-muted)]",
            )}
          >
            More lines follow.
          </span>
        )}
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
        <SearchInput
          aria-label="Search logs"
          placeholder="Search logs…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery("")}
          className="w-48"
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
              currentDescriptorHash={currentDescriptorHash}
            />
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
  /** the run's queue surface, when the panel was opened from a row — the provenance bar's source */
  surface?: QueueSurfaceWire;
  /** every action the server served for this run; the panel filters by placement */
  actions?: readonly ActionDescriptorWire[];
  tab?: PanelTab;
  onTab: (tab: PanelTab) => void;
  onAction?: DashboardActionHandler;
  workflowLabel: string;
  currentAppVersion: string;
  currentDescriptorHash: string;
  /** Who a Data-section correction is requested by (2i-C). */
  actorId: string;
  /** An applied correction bumped the run version — the owner refetches detail. */
  onDetailEdited: () => void;
  /**
   * Doc 12 §4.4's advisory availability, from the bootstrap wire (2i-G, D178).
   * The panel keeps its control and states the server's reason when no
   * provider is composed, rather than the affordance vanishing.
   */
  aiAdvisory: CapabilityAvailability;
}

const NOOP_ACTION: DashboardActionHandler = () => {};

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

export function LogPanel({
  detail,
  sections,
  surface,
  actions = [],
  tab,
  onTab,
  onAction = NOOP_ACTION,
  workflowLabel,
  currentAppVersion,
  currentDescriptorHash,
  actorId,
  onDetailEdited,
  aiAdvisory,
}: LogPanelProps) {
  const available = tabsFor(detail);
  const fallback = defaultTabFor(detail);
  const effectiveTab = tab !== undefined && available.includes(tab) ? tab : fallback;

  const gate = detail.gate;
  const gateOpen = gate.state === "open";
  const { setNode: setDecisionNode, inView: decisionInView, seek: seekDecision } = useSeekAnchor(gateOpen);
  const { setNode: setFailureNode, seek: seekFailure } = useSeekAnchor(
    sections.failure !== undefined,
    "nearest",
  );
  const parked = sections["parked-write"];
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
  const handleParkResolution = useCallback<DashboardActionHandler>(
    (action) => {
      if (parked === undefined) return;
      if (parkResolutionArm(action) === undefined || action.kind !== "command") {
        throw new Error(
          `the parked-write section served ${action.key}, which is not a doc 09 §4.1 resolution`,
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
   * ONE clock read per render, shared by every age on this surface — the
   * outcome bar's and the floating notice's. Two reads would let the same
   * decision report two different ages a second apart, which is the class of
   * defect the shared fold key exists to prevent elsewhere in this file.
   */
  const nowIso = systemClock.now().toISOString();

  const outcome = detail.outcome;
  const outcomeStatus =
    outcome.state === "terminal" ? outcomeDsStatusOf(outcome.result) : dsStatusOf(detail.header.status);
  const outcomeText =
    outcome.state === "terminal"
      ? `${outcome.result} · ${fmtClock(outcome.completedAt)}`
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
   * Is this region drawing three columns? Measured, not inferred (doc 03 §Shell).
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
  // (`--ds-w-context-rail-wide`, doc 03 D19(d)); the flag resets when the
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
      degrades silently to the stacked layout at every width (doc 03 §13.2 says
      the same thing about the explorer's `@container/graph`).

      It carries no padding and no border on purpose: the JS half above
      measures this box with `getBoundingClientRect`, so its border box has to
      BE its container-query box or the two halves can disagree.

      `min-[1180px]:` on the container DECLARATION is doc 03 §Shell's first
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
          <Timeline detail={detail} />
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
              notes={sections.logs}
              failure={sections.failure}
              parked={parked}
              gateActions={actions}
              onAction={handleAction}
              onResolvePark={handleParkResolution}
              decisionRef={setDecisionNode}
              failureRef={setFailureNode}
              parkedRef={setParkedNode}
              surface={surface}
              workflowLabel={workflowLabel}
              currentAppVersion={currentAppVersion}
              currentDescriptorHash={currentDescriptorHash}
              aiAdvisory={aiAdvisory}
            />
          )}
          {effectiveTab === "receipt" && (
            <ReceiptView
              outcome={detail.outcome}
              receipt={
                sections.receipt ?? {
                  state: "missing",
                  reason: "this run advertises no receipt section",
                }
              }
              resolvedInstances={surface?.resolvedInstances ?? []}
            />
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
          onClose={() => railState.setOpen(false)}
          actorId={actorId}
          liveStatus={surface?.status}
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
      <ParkResolveDialog
        target={parkTarget}
        actorId={actorId}
        onClose={() => setParkTarget(null)}
        onResolved={onDetailEdited}
      />
    </div>
    </div>
  );
}

export type { RunDetailWire };
