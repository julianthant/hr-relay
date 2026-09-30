import { OperationEvidenceFrame } from "../operation-evidence-frame.js";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CornerDownRight, UserRoundSearch, X } from "lucide-react";
import type { z } from "zod";
import { cn } from "../../lib/utils.js";
import {
  BareButton,
  IconButton,
  Chip,
  MetaLine,
  KeyValueList,
  FloatingSurface,
  dsFocus,
  dsIcon,
  dsLayer,
  dsMotion,
  dsRadius,
  dsText,
  useDsEnterTransition,
} from "../../ds/ui.js";
import { BannerActions, type DashboardActionHandler } from "../actions.js";
import { IdentityApproveDialog, IdentityGateEvidence, type IdentityApproveTarget } from "../identity-approve.js";
import { identityGateArm } from "../identity-approve-model.js";
import { ParkResolveDialog, type ParkResolveTarget, type ParkedWritePayload } from "../park-resolve.js";
import { parkResolutionArm } from "../park-resolve-model.js";
import type { PanelSections } from "./sections.js";
import type { ActionDescriptorWire } from "../../../domain/dashboard/actions.js";
import type { RunDetailWireSchema } from "../../../domain/dashboard/run-detail.js";
import { fmtClock, fmtActionClock } from "../format.js";
import { decisionAge } from "./timeline-model.js";

type RunDetailWire = z.infer<typeof RunDetailWireSchema>;

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
  identity,
  actions,
  runId,
  onAction,
  anchorRef,
  nowIso,
}: {
  gate: Extract<RunDetailWire["gate"], { state: "open" }>;
  identity?: PanelSections["identity-gate"];
  actions: readonly ActionDescriptorWire[];
  runId: string;
  onAction: DashboardActionHandler;
  anchorRef?: (node: HTMLElement | null) => void;
  /** The served instant (D256), so the card's age and the queue's cannot differ. */
  nowIso: string;
}) {
  return (
    <OperationEvidenceFrame
      ref={anchorRef}
      tabIndex={-1}
      data-panel-decision=""
      role="group"
      aria-label={`Decision — ${gate.label}`}
      className={cn("mx-[var(--ds-space-cozy)] my-[var(--ds-space-base)]", dsFocus)}
      heading={<div className="operation-decision-heading">
        <UserRoundSearch
          aria-hidden
          className={cn(dsIcon.md, "shrink-0 text-[color:var(--ds-status-waiting-fg)]")}
        />
        <span
          className={cn(
            dsText.ui,
            "operation-decision-label font-semibold text-[color:var(--ds-status-waiting-fg)]",
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
      </div>}
      footer={actions.length > 0 ? <><span className={dsText.meta}>Awaiting explicit confirmation</span><BannerActions actions={actions} target={{ runId, expectedVersion: gate.revision }} onAction={onAction} /></> : undefined}
    >


      <div className="flex flex-col gap-[var(--ds-space-base)]">
        {/* Says the quiet part: this run is STOPPED, and it is stopped here. */}
        <span className={cn(dsText.meta, "mt-[var(--ds-space-tight)] text-[color:var(--ds-fg-muted)]")}>
          {identity?.state === "available" ? "Identity confirmation required. The run is held here." : "The run is held here. Resolution evidence is not available."}
        </span>
        {identity?.state === "available" && <IdentityGateEvidence gate={identity.value} />}
        {identity?.state !== "available" && <KeyValueList items={[{ key: "Resolution evidence", value: identity === undefined ? "Not yet served" : "Unavailable" }]} />}
        {identity !== undefined && identity.state !== "available" && <details className={cn("operation-evidence-disclosure", dsText.meta)}><summary>Why resolution is unavailable</summary><p>{"reason" in identity ? identity.reason : identity.message}</p></details>}
      </div>
    </OperationEvidenceFrame>
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
const GATE_RECORD_FG: Record<"approved" | "rejected", string> = {
  approved: "text-[color:var(--ds-status-verified-done-fg)]",
  rejected: "text-[color:var(--ds-danger)]",
};
const GATE_RECORD_WORD: Record<"approved" | "rejected", string> = {
  approved: "Approved",
  rejected: "Rejected",
};

export function InlineGateDecisionRecord({
  gate,
  anchorRef,
}: {
  gate: Extract<RunDetailWire["gate"], { state: "resolved" }>;
  anchorRef?: (node: HTMLElement | null) => void;
}) {
  const { resolution } = gate;
  return (
    <OperationEvidenceFrame ref={anchorRef} tabIndex={-1} data-panel-gate-record=""
      aria-label={`Decision record — ${gate.label}`} className={cn("mx-[var(--ds-space-cozy)] my-[var(--ds-space-base)]", dsFocus)}
      heading={<div className="flex items-center gap-[var(--ds-space-snug)]">
        <UserRoundSearch aria-hidden className={cn(dsIcon.md, GATE_RECORD_FG[resolution])} />
        <span className={cn(dsText.ui, "min-w-0 font-semibold")}>{gate.label}</span>
        <Chip label="decision" tone={resolution === "approved" ? "neutral" : "danger"}>{GATE_RECORD_WORD[resolution]}</Chip>
        <time title={gate.resolvedAt} className={cn(dsText.meta, dsText.nums, "ml-auto shrink-0")}>{fmtActionClock(gate.resolvedAt)}</time>
      </div>}
    >
      <details><summary className={dsText.meta}>Decision audit</summary><MetaLine items={[gate.resolvedBy, gate.resolvedAt]} /></details>
    </OperationEvidenceFrame>
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

export function DecisionNotice({
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
        <BareButton
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
        </BareButton>
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
export function useSeekAnchor(active: boolean, block: ScrollLogicalPosition = "center"): {
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

export function useGateParkResolution(input: Readonly<{
  detail: RunDetailWire;
  sections: PanelSections;
}>): Readonly<{
  gateSection: PanelSections["identity-gate"];
  gateActions: readonly ActionDescriptorWire[];
  parked: ParkedWritePayload | undefined;
  gateTarget: IdentityApproveTarget | null;
  parkTarget: ParkResolveTarget | null;
  setGateTarget: (target: IdentityApproveTarget | null) => void;
  setParkTarget: (target: ParkResolveTarget | null) => void;
  onResolveGate: DashboardActionHandler;
  onResolvePark: DashboardActionHandler;
}> {
  const gateSection = input.sections["identity-gate"];
  const gateActions = gateSection?.state === "available" ? gateSection.value.actions : [];
  const parked = input.sections["parked-write"];
  const [gateTarget, setGateTarget] = useState<IdentityApproveTarget | null>(null);
  const [parkTarget, setParkTarget] = useState<ParkResolveTarget | null>(null);
  useEffect(() => {
    setGateTarget(null);
    setParkTarget(null);
  }, [input.detail.runId]);

  const onResolveGate = useCallback<DashboardActionHandler>((action) => {
    if (gateSection?.state !== "available") {
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
  }, [gateSection]);

  const onResolvePark = useCallback<DashboardActionHandler>((action) => {
    if (parked === undefined) return;
    if (parkResolutionArm(action) === undefined || action.kind !== "command") {
      throw new Error(
        `the parked-write section served ${action.key}, which is not a ref write-safety §4.1 resolution`,
      );
    }
    setParkTarget({ parked, action });
  }, [parked]);

  return {
    gateSection,
    gateActions,
    parked,
    gateTarget,
    parkTarget,
    setGateTarget,
    setParkTarget,
    onResolveGate,
    onResolvePark,
  };
}

export function GateParkDialogs({
  gateTarget,
  parkTarget,
  actorId,
  onCloseGate,
  onClosePark,
  onResolved,
}: Readonly<{
  gateTarget: IdentityApproveTarget | null;
  parkTarget: ParkResolveTarget | null;
  actorId: string;
  onCloseGate: () => void;
  onClosePark: () => void;
  onResolved: () => void;
}>) {
  return (
    <>
      <IdentityApproveDialog target={gateTarget} actorId={actorId} onClose={onCloseGate} onResolved={onResolved} />
      <ParkResolveDialog target={parkTarget} actorId={actorId} onClose={onClosePark} onResolved={onResolved} />
    </>
  );
}
