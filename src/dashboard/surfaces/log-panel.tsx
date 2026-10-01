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
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ClipboardList,
  Info,
  Pause,
  Receipt,
  ScrollText,
  UserRoundSearch,
  Users,
} from "lucide-react";
import type { z } from "zod";
import { cn } from "../lib/utils.js";
import {
  BareButton,
  EmptyState,
  IconButton,
  MetaLine,
  Popover,
  PopoverContent,
  PopoverTrigger,
  StatusDot,
  Tooltip,
  dsStatusText,
  dsBorder,
  dsIcon,
  dsLayer,
  dsMotion,
  dsRadius,
  dsSize,
  dsText,
  type DsStatus,
} from "../ds/ui.js";
import type { RunDetailWireSchema } from "../../domain/dashboard/run-detail.js";
import type { ActionDescriptorWire } from "../../domain/dashboard/actions.js";
import type { CapabilityAvailabilitySchema } from "../../domain/absence.js";
import type { IdentityGatePayload } from "../app/identity-ceremony.js";
import { OutcomeActionButton, DataActions, type DashboardActionHandler } from "./actions.js";
import { AttemptHistorySection } from "./context-rail.js";
import { LogsTab, RunLivenessDot } from "./run-detail/logs.js";
import type { RunCapturesState } from "./run-captures-model.js";
import type { QueueSurfaceWire } from "./run-identity.js";
import { dsStatusOf, outcomeDsStatusOf } from "./status-model.js";
import { PANEL_TAB_LABEL, defaultTabFor, tabsFor, terminalOutcomeText, type PanelTab } from "./log-panel-model.js";
import { decisionAge } from "./run-detail/timeline-model.js";
import {
  DecisionNotice,
  GateParkDialogs,
  InlineDecision,
  useGateParkResolution,
  useSeekAnchor,
} from "./run-detail/gate-park.js";
import { InlineFailureRecord } from "./run-detail/receipt-failure.js";
import type { PanelSections } from "./run-detail/sections.js";
import { Timeline } from "./run-detail/timeline.js";

export { Timeline };
export { InlineDecision };
export { InlineFailureRecord };
export { RunLivenessDot };

export type { PanelTab };
export type { PanelSections };

type RunDetailWire = z.infer<typeof RunDetailWireSchema>;
type CapabilityAvailability = z.infer<typeof CapabilityAvailabilitySchema>;
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
// the two inline stream surfaces
// ---------------------------------------------------------------------------

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
  cancelling:
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
  run: "Opening it shows the chronological log stream and the run controls.",
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
  const clearCaptureSelection = captures?.state === "available" ? captures.select : undefined;
  // The same read spans Logs and Receipt, but a dialog belongs to the tab that
  // opened it. Moving tabs closes that short-lived visual state without
  // duplicating the capture read or reopening a preview behind the operator.
  useEffect(() => { clearCaptureSelection?.(undefined); }, [clearCaptureSelection, effectiveTab]);

  const gate = detail.gate;
  const gateOpen = gate.state === "open";
  const {
    gateActions,
    parked,
    gateTarget,
    parkTarget,
    setGateTarget,
    setParkTarget,
    onResolveGate: handleGateResolution,
    onResolvePark: handleParkResolution,
  } = useGateParkResolution({ detail, sections });
  const { setNode: setDecisionNode, inView: decisionInView, seek: seekDecision } = useSeekAnchor(gateOpen);
  const { setNode: setFailureNode, seek: seekFailure } = useSeekAnchor(
    sections.failure !== undefined,
    "nearest",
  );
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
  const {
    setNode: setParkedNode,
    inView: parkedInView,
    seek: seekParked,
  } = useSeekAnchor(parked !== undefined);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const [decisionSeek, setDecisionSeek] = useState(0);
  const [failureSeek, setFailureSeek] = useState(0);
  const [parkedSeek, setParkedSeek] = useState(0);
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
  const showOutcome = effectiveTab !== "logs" || outcome.state !== "terminal"
    || outcome.rehearsal !== true || outcome.result !== "partial";
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

      D340 keeps the shell side by side at its 1024px minimum canvas.
      The detail container therefore exists at every window size; its own
      measured width still decides how its internal content is arranged.
    */
    <div ref={regionRef} className="@container/detail flex min-h-0 min-w-0 flex-col">
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
        "@min-[868px]/detail:grid-cols-[minmax(0,1fr)]",
      )}
    >
      {detail.timeline.events.length > 0 && (
        <section
          aria-label="Run shape"
          className={cn(
            "min-w-0 shrink-0 border",
            "border-[color:var(--ds-border)] bg-[var(--ds-surface-1)]",
            dsRadius.lg,
            "@min-[868px]/detail:col-span-1 @min-[868px]/detail:col-start-1 @min-[868px]/detail:row-start-1",
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
          "ui-theme-scope @container relative flex min-h-[24rem] min-w-0 flex-col overflow-hidden border",
          "border-ui-stroke bg-ui-panel font-ui text-ui-primary",
          dsRadius.lg,
          "@min-[868px]/detail:col-start-1 @min-[868px]/detail:row-start-2 @min-[868px]/detail:min-h-0",
        )}
      >
        {/* ONE SCROLLING REGION FOR THE WHOLE PANEL BODY — see the file note. */}
        <div
          ref={scrollRef}
          className="scroll-pt-[var(--ds-panel-head-h,0px)] flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto"
        >
          <div ref={headRef} className={cn("sticky top-0 shrink-0 bg-ui-panel", dsLayer.sticky)}>
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
                "flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 border-b border-ui-stroke px-4 py-3",
              )}
            >
              <span
                className={cn(
                  "min-w-0 max-w-full text-heading text-ui-primary text-balance [overflow-wrap:break-word]",
                )}
              >
                {detail.header.title}
              </span>
              <DataActions actions={actions.filter(action => action.key !== "rerun")} target={{ runId: detail.runId, expectedVersion: detail.rowRevision }} onAction={handleAction} />
              <span className="ml-auto flex min-w-0 max-w-full items-center gap-2">
                <PanelKindInfo
                  panelKind={detail.panelKind}
                  workflowLabel={workflowLabel}
                  traceId={detail.header.traceId}
                />
                <span
                  className={cn(
                    "min-w-0 break-all font-data text-caption text-ui-muted",
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
            {showOutcome && <div
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
            </div>}

            {available.length > 1 && <div
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
                    <BareButton
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => onTab(key)}
                      className={cn(
                        "relative -mb-px inline-flex cursor-pointer items-center border-b-2 border-transparent",
                        "h-[var(--ds-h-bar)] gap-[var(--ds-space-snug)] px-[var(--ds-space-base)]",
                        dsText.ui,
                                              dsMotion.base,
                        active
                          ? "border-b-[color:var(--ds-accent)] font-semibold text-[color:var(--ds-fg)]"
                          : "text-[color:var(--ds-fg-muted)] hover:text-[color:var(--ds-fg)]",
                      )}
                    >
                      <Icon aria-hidden className={cn(dsIcon.sm, "shrink-0")} />
                      {meta.label}
                    </BareButton>
                  </Tooltip>
                );
              })}
            </div>}
          </div>

          {/* THE TAB BODY, in the same scroller as the head above it. */}
          {effectiveTab !== "logs" && sections["context-attempts"] !== undefined && <details className="border-b border-[color:var(--ds-border-subtle)] px-[var(--ds-space-cozy)] py-[var(--ds-space-snug)]"><summary className={dsText.meta}>Attempts</summary><AttemptHistorySection payload={sections["context-attempts"]} /></details>}
          {effectiveTab === "logs" && (
            <LogsTab
              actorId={actorId}
              detail={detail}
              captures={captures}
              notes={sections.logs}
              failure={sections.failure}
              parked={parked}
              identity={sections["identity-gate"]}
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


      <GateParkDialogs
        gateTarget={gateTarget}
        parkTarget={parkTarget}
        actorId={actorId}
        onCloseGate={() => setGateTarget(null)}
        onClosePark={() => setParkTarget(null)}
        onResolved={onDetailEdited}
      />
    </div>
    </div>
  );
});

export type { RunDetailWire };
