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
} from "react";
import {
  ClipboardList,
  CornerDownRight,
  FileText,
  Info,
  ReceiptText,
  ScrollText,
  TriangleAlert,
  UserRoundSearch,
  Users,
  X,
} from "lucide-react";
import type { z } from "zod";
import { cn } from "../lib/utils.js";
import {
  Badge,
  Chip,
  EmptyState,
  FloatingSurface,
  IconButton,
  MetaLine,
  SearchInput,
  SectionLabel,
  StatusDot,
  StatusPill,
  Tooltip,
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
} from "../ds/ui.js";
import type {
  RunDetailSectionResponseSchema,
  RunDetailWireSchema,
} from "../../domain/dashboard/run-detail.js";
import type { RunDetailSectionSchema } from "../../domain/dashboard/primitives.js";
import type { ActionDescriptorWire } from "../../domain/dashboard/actions.js";
import { BannerActions, OutcomeActionButton, type DashboardActionHandler } from "./actions.js";
import {
  ContextRail,
  ContextRailSpine,
  useContextRail,
  type ContextSections,
} from "./context-rail.js";
import { elapsedSecondsBetween, fmtClock, fmtElapsed, plural } from "./format.js";
import { ReceiptView, type ReceiptSectionPayload } from "./receipt.js";
import { RunProvenanceBar, type QueueSurfaceWire } from "./run-identity.js";
import { dsStatusOf, outcomeDsStatusOf } from "./status.js";

type RunDetailWire = z.infer<typeof RunDetailWireSchema>;
type RunDetailSectionResponse = z.infer<typeof RunDetailSectionResponseSchema>;
type RunDetailSection = z.infer<typeof RunDetailSectionSchema>;
type TimelineEvent = RunDetailWire["timeline"]["events"][number];
type NotePage = Extract<RunDetailSectionResponse, { section: "logs" }>["payload"];
type FailurePayload = Extract<RunDetailSectionResponse, { section: "failure" }>["payload"];

/** The tab set this slice can draw. Review and People are advertised, not assumed. */
export type PanelTab = "review" | "people" | "logs" | "receipt";

/** Every section the panel is handed, keyed by the wire's own section name. */
export interface PanelSections extends ContextSections {
  logs?: NotePage;
  receipt?: ReceiptSectionPayload;
  failure?: FailurePayload;
}

const TAB_META: Record<PanelTab, { label: string; icon: typeof ScrollText }> = {
  review: { label: "Review", icon: ClipboardList },
  people: { label: "People", icon: Users },
  logs: { label: "Logs", icon: ScrollText },
  receipt: { label: "Receipt", icon: ReceiptText },
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
};

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
                <span className={cn(dsClip.text, dsText.micro, tone.text)}>{event.label}</span>
              </div>
              <span
                aria-label={`${event.label} — ${event.state}${spanSec === undefined ? "" : `, ${fmtElapsed(spanSec)}`}`}
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
}: {
  failure: FailurePayload;
  errorNotes: readonly NotePage["notes"][number][];
  completedAt?: string;
  anchorRef?: (node: HTMLElement | null) => void;
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
          <MetaLine
            items={[
              completedAt === undefined ? false : `failed ${fmtClock(completedAt)}`,
              "the full record lands with the trust surfaces",
            ]}
          />
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
 */
function DecisionNotice({
  gate,
  onGo,
  onDismiss,
}: {
  gate: Extract<RunDetailWire["gate"], { state: "open" }>;
  onGo: () => void;
  onDismiss: () => void;
}) {
  const entering = useDsEnterTransition();
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
        "border-[color:var(--ds-status-waiting-border)]",
      )}
      {...entering}
    >
      <div
        className={cn(
          "flex items-start gap-[var(--ds-space-tight)] p-[var(--ds-space-snug)]",
          "bg-[var(--ds-status-waiting-bg)]",
        )}
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
              "flex min-w-0 items-center gap-[var(--ds-space-tight)] font-semibold text-[color:var(--ds-status-waiting-fg)]",
            )}
          >
            <UserRoundSearch aria-hidden className={cn(dsIcon.sm, "shrink-0")} />
            <span className="min-w-0 truncate">{gate.label}</span>
          </span>
          <span className={cn(dsText.micro, "flex min-w-0 items-center gap-[var(--ds-space-base)]")}>
            <span
              className={cn(
                "inline-flex min-w-0 items-center gap-[var(--ds-space-hair)] truncate font-semibold",
                "text-[color:var(--ds-status-waiting-fg)]",
              )}
            >
              <CornerDownRight aria-hidden className={cn(dsIcon.sm, "shrink-0")} />
              Go to the decision
            </span>
            <span className={cn(dsText.nums, "ml-auto shrink-0 text-[color:var(--ds-fg-muted)]")}>
              {`since ${fmtClock(gate.openedAt)}`}
            </span>
          </span>
        </button>
        <IconButton
          size="xs"
          label="Dismiss this reminder — the decision stays open"
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
  gateActions,
  onAction,
  decisionRef,
  failureRef,
  surface,
  workflowLabel,
  currentAppVersion,
  currentDescriptorHash,
}: {
  detail: RunDetailWire;
  notes: NotePage | undefined;
  failure: FailurePayload | undefined;
  gateActions: readonly ActionDescriptorWire[];
  onAction: DashboardActionHandler;
  decisionRef: (node: HTMLElement | null) => void;
  failureRef: (node: HTMLElement | null) => void;
  surface?: QueueSurfaceWire;
  workflowLabel: string;
  currentAppVersion: string;
  currentDescriptorHash: string;
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
      />
    ) : null;

  return (
    <>
      {/* NO SCROLLER OF ITS OWN. The panel body is one region, so the stream is
          plain content in it and the track beside it runs the whole panel. */}
      <div className="flex flex-1 flex-col pb-[var(--ds-space-base)] pt-[var(--ds-space-tight)]">
        {decisionAt === -1 && decision}
        {failureAt === -1 && failureRecord}
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
}

const NOOP_ACTION: DashboardActionHandler = () => {};

/**
 * The outcome action this panel does not draw, because it already draws what
 * that action travels to: the gate options are on screen in the stream, so a
 * pill that only scrolls to them is redundant.
 */
const PANEL_OMITS_OUTCOME_ACTIONS = ["open-gate"] as const;

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
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const [decisionSeek, setDecisionSeek] = useState(0);
  const [failureSeek, setFailureSeek] = useState(0);

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

  const goToDecision = useCallback(() => {
    if (effectiveTab !== "logs") onTab("logs");
    setDecisionSeek((nonce) => nonce + 1);
  }, [effectiveTab, onTab]);
  const goToFailure = useCallback(() => {
    if (effectiveTab !== "logs") onTab("logs");
    setFailureSeek((nonce) => nonce + 1);
  }, [effectiveTab, onTab]);

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

  const outcome = detail.outcome;
  const outcomeStatus =
    outcome.state === "terminal" ? outcomeDsStatusOf(outcome.result) : dsStatusOf(detail.header.status);
  const outcomeText =
    outcome.state === "terminal"
      ? `${outcome.result} · ${fmtClock(outcome.completedAt)}`
      : gate.state === "open"
        ? gate.label
        : outcome.reason;
  const noticeShown = gateOpen && !noticeDismissed && !decisionInView;

  const railState = useContextRail();
  const railSections: ContextSections = {
    ...(sections["context-data"] === undefined ? {} : { "context-data": sections["context-data"] }),
    ...(sections["context-evidence"] === undefined
      ? {}
      : { "context-evidence": sections["context-evidence"] }),
    ...(sections["context-attempts"] === undefined
      ? {}
      : { "context-attempts": sections["context-attempts"] }),
  };

  return (
    <div
      className={cn(
        // Below the three-column threshold the region is a scrolling stack, so
        // the rail sits under the panel instead of squeezing it to nothing.
        "flex min-h-0 flex-col gap-[var(--ds-space-cozy)] overflow-y-auto",
        "min-[1280px]:grid min-[1280px]:h-full min-[1280px]:overflow-hidden",
        "min-[1280px]:grid-rows-[auto_minmax(0,1fr)]",
        railState.collapsed
          ? "min-[1280px]:grid-cols-[minmax(0,1fr)_var(--ds-w-context-spine)]"
          : "min-[1280px]:grid-cols-[minmax(0,1fr)_var(--ds-w-context-rail)]",
      )}
    >
      {detail.timeline.events.length > 0 && (
        <section
          aria-label="Run shape"
          className={cn(
            "min-w-0 shrink-0 border",
            "border-[color:var(--ds-border)] bg-[var(--ds-surface-1)]",
            dsRadius.lg,
            "min-[1280px]:col-span-2 min-[1280px]:row-start-1",
            "min-[1480px]:col-span-1 min-[1480px]:col-start-1",
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
          "min-[1280px]:col-start-1 min-[1280px]:row-start-2 min-[1280px]:min-h-0",
        )}
      >
        {/* ONE SCROLLING REGION FOR THE WHOLE PANEL BODY — see the file note. */}
        <div
          ref={scrollRef}
          className="scroll-pt-[var(--ds-panel-head-h,0px)] flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto"
        >
          <div ref={headRef} className={cn("sticky top-0 shrink-0 bg-[var(--ds-surface-1)]", dsLayer.sticky)}>
            {/* identity — the title never truncates to make room for the trace */}
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
                {detail.header.attempt > 1 && (
                  <Badge tone="warning" title={`Attempt ${String(detail.header.attempt)} of this run`}>
                    attempt {detail.header.attempt}
                  </Badge>
                )}
                <StatusPill status={dsStatusOf(detail.header.status)} size="sm" />
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
                row, the one route to the decision that can never be dismissed. */}
            <div
              className={cn(
                "flex flex-wrap items-center border-b",
                dsBorder.subtle,
                "gap-x-[var(--ds-space-base)] gap-y-[var(--ds-space-tight)] px-[var(--ds-space-cozy)] py-[var(--ds-space-snug)]",
              )}
            >
              {/* `StatusDot`, never a hand-rolled span: DESIGN.md admits exactly
                  two renderers for a status, and a token interpolated into a
                  class name is one Tailwind cannot see — it would emit no rule
                  and the dot would silently paint nothing. */}
              <StatusDot status={outcomeStatus} />
              <span className={cn(dsText.body, "min-w-0 max-w-full flex-1")}>{outcomeText}</span>
              <span className="ml-auto flex min-w-max items-center gap-[var(--ds-space-base)]">
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
              gateActions={actions}
              onAction={handleAction}
              decisionRef={setDecisionNode}
              failureRef={setFailureNode}
              surface={surface}
              workflowLabel={workflowLabel}
              currentAppVersion={currentAppVersion}
              currentDescriptorHash={currentDescriptorHash}
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
            gate={gate}
            onGo={goToDecision}
            onDismiss={() => setNoticeDismissed(true)}
          />
        )}
      </section>

      {railState.collapsed ? (
        <ContextRailSpine
          summary={detail.context}
          onOpen={() => railState.setOpen(true)}
          className={cn(
            "min-[1280px]:col-start-2 min-[1280px]:row-start-2",
            "min-[1480px]:row-start-1 min-[1480px]:row-span-2",
          )}
        />
      ) : (
        <ContextRail
          summary={detail.context}
          sections={railSections}
          onClose={() => railState.setOpen(false)}
          className={cn(
            "shrink-0",
            "min-[1280px]:col-start-2 min-[1280px]:row-start-2 min-[1280px]:shrink",
            "min-[1480px]:row-start-1 min-[1480px]:row-span-2",
          )}
        />
      )}
    </div>
  );
}

export type { RunDetailWire };
