import type { WorkerCommandDispatch, WorkerControlAction } from "../app/worker-command-dispatch.js";
import { browserHealthLabel, useSessionControl, workerControlRefusal } from "../app/session-control-model.js";
import {
AlertTriangle,
Check,
ChevronDown,
ChevronUp,
CircleDashed,
CircleHelp,
Eye,
Minus,
Plus,
RotateCw,
UsersRound,
X
} from "lucide-react";
import { useCallback,useEffect,useMemo,useState } from "react";
import type { CommandSettlement } from "../app/command-result.js";
import { type SubscriptionState } from "../client/subscription.js";
import { Banner,Button,Dialog,DialogBody,DialogContent,DialogFooter,Field,IconButton,MetaLine,Popover,PopoverContent,PopoverTrigger,Select,dsBorder,dsFocus,dsIcon,dsMotion,dsRadius,dsSize,dsSurface,dsText } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { appVersionTag,elapsedSecondsBetween,fmtAppVersion,fmtElapsed,plural } from "./format.js";
import { ALWAYS_TALLIED,SESSION_POOL_MAX_WORKERS,WORKER_STATE_ORDER,WORKER_STOP_REASON_LABEL,WORKER_TONE,WORKER_TIMELINE_TONE,buildSessionPanelView,canStopWorker,capacityChip,connectionTone,planPoolIntent,poolSlotIsUnmet,sessionPoolGroupFor,workerBrowserView,workerDirectiveNote,workerElapsedSeconds,workerTimelineView,type PoolPlanIntent,type SessionPoolGroup,type SessionPoolMemberSlot,type WorkerBrowserSlot,type WorkerCardWire,type WorkerPoolWire,type WorkerSessionMembership,type WorkerState } from "./session-panel-model.js";
import { statusCount,workflowStatusCounts,type QueueSurfaceWire,type WorkflowBootstrapPrimitive,type WorkflowCountWire } from "./shell-model.js";
import { SYSTEM_LABEL } from "./system-chip-model.js";


/** Compact, observed browser status with an anchored detail and control route. */
function BrowserTile({
  browser,
  nowIso,
  control,
  refusal,
  workerId,
  selected,
  onSelectedChange,
}: {
  browser: WorkerCardWire["browsers"][number];
  nowIso: string;
  control?: (type: WorkerControlAction, sessionId: string) => void;
  refusal?: string;
  workerId: string;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
}) {
  const health = browserHealthLabel(browser);
  const authenticated = health === "Authenticated";
  const failed = health === "Failed";
  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col border",
        "gap-[var(--ds-space-hair)] px-[var(--ds-space-base)] py-[var(--ds-space-base)]",
        dsRadius.md,
        authenticated ? "border-[color:var(--ds-success-border)] bg-[var(--ds-success-bg)]" :
          failed ? "border-[color:var(--ds-danger-border)] bg-[var(--ds-danger-quiet)]" :
            "border-[color:var(--ds-border-subtle)] bg-transparent",
      )}
    >
      <span className="flex min-w-0 items-center gap-[var(--ds-space-tight)]">
        {authenticated ? <Check aria-hidden className={cn(dsIcon.sm, "shrink-0 text-[color:var(--ds-success-fg)]")} /> :
          failed ? <AlertTriangle aria-hidden className={cn(dsIcon.sm, "shrink-0 text-[color:var(--ds-danger)]")} /> :
            <CircleDashed aria-hidden className={cn(dsIcon.sm, "shrink-0 text-[color:var(--ds-fg-muted)]")} />}
        <span className={cn(dsText.ui, "min-w-0 flex-1 truncate font-semibold text-[color:var(--ds-fg)]")}>{SYSTEM_LABEL[browser.system]}</span>
        {control !== undefined && <IconButton
          size="xs"
          label={`Reopen ${SYSTEM_LABEL[browser.system]}`}
          icon={<RotateCw aria-hidden className={dsIcon.sm} />}
          title={refusal ?? "Close and reopen this exact session"}
          disabled={refusal !== undefined}
          onClick={() => control("reopen-browser", browser.sessionId)}
          className="shrink-0"
        />}
        <Popover open={selected} onOpenChange={onSelectedChange}>
          <PopoverTrigger asChild>
            <IconButton
              size="xs"
              label={`Show ${SYSTEM_LABEL[browser.system]} browser details and controls`}
              icon={<CircleHelp aria-hidden className={dsIcon.sm} />}
              className="shrink-0"
            />
          </PopoverTrigger>
          <PopoverContent title={`${SYSTEM_LABEL[browser.system]} browser session`} width="md" align="start">
            <BrowserDetails browser={browser} nowIso={nowIso} workerId={workerId} {...(control === undefined ? {} : { control, refusal })} />
          </PopoverContent>
        </Popover>
      </span>
      <span className={cn(dsText.micro, "truncate font-semibold uppercase", authenticated ? "text-[color:var(--ds-success-fg)]" : failed ? "text-[color:var(--ds-danger)]" : "text-[color:var(--ds-fg-muted)]")}>{health}</span>
    </div>
  );
}


/** Exact-session facts and commands in the browser tile's anchored overlay. */
function BrowserDetails({
  browser,
  nowIso,
  control,
  refusal,
  workerId,
}: {
  browser: WorkerCardWire["browsers"][number];
  nowIso: string;
  control?: (type: WorkerControlAction, sessionId: string) => void;
  refusal?: string;
  workerId: string;
}) {
  const facts = [
    { label: "Session ID", value: String(browser.sessionId) },
    { label: "Browser status", value: browserHealthLabel(browser) },
    ...(browser.observation?.state === "present" ? [
      { label: "Observed at", value: browser.observation.observedAt },
      { label: "Instance", value: browser.observation.instance ?? "Not recorded" },
      { label: "Browser mode", value: browser.observation.browserMode },
      { label: "Configuration", value: browser.observation.configFingerprint },
    ] : []),
    { label: "Open for", value: fmtElapsed(elapsedSecondsBetween(browser.openedAt, nowIso)) },
  ];
  return (
    <div className="min-w-0">
      <dl className="grid min-w-0 gap-[var(--ds-space-hair)]">
        {facts.map(({ label, value }) => <div key={label} className={cn(dsText.micro, "flex min-w-0 gap-[var(--ds-space-base)]")}>
          <dt className="shrink-0 text-[color:var(--ds-fg-muted)]">{label}</dt>
          <dd className={cn(dsText.nums, "min-w-0 break-all text-[color:var(--ds-fg)]")}>{value}</dd>
        </div>)}
      </dl>
      {control !== undefined && <div className="mt-[var(--ds-space-tight)] flex flex-wrap gap-[var(--ds-space-tight)]">
        <Button size="sm" variant="outline" data-session-worker={workerId} aria-label={`Refresh ${SYSTEM_LABEL[browser.system]}`} title={refusal ?? "Reset this session and verify authentication"} disabled={refusal !== undefined} onClick={() => control("refresh-browser", browser.sessionId)}>Refresh</Button>
      </div>}
    </div>
  );
}


/** A descriptor-required browser before this worker has opened its session. */
function RequiredBrowserTile({
  system,
}: {
  system: Extract<WorkerBrowserSlot, { readonly state: "required" }>["system"];
}) {
  return (
    <div
      role="group"
      aria-label={`${SYSTEM_LABEL[system]} browser requirement, opens when needed`}
      className={cn(
        "flex w-full min-w-0 flex-col border border-dashed",
        "gap-[var(--ds-space-hair)] px-[var(--ds-space-base)] py-[var(--ds-space-base)]",
        dsRadius.md,
        "border-[color:var(--ds-border-subtle)] bg-transparent text-[color:var(--ds-fg-faint)]",
      )}
    >
      <span className={cn(dsText.ui, "flex min-w-0 items-center gap-[var(--ds-space-tight)]")}>
        <CircleDashed aria-hidden className={cn(dsIcon.sm, "shrink-0")} />
        <span className="min-w-0 flex-1 truncate font-semibold">{SYSTEM_LABEL[system]}</span>
      </span>
      <span className={cn(dsText.micro, "truncate opacity-80")}>Opens when needed</span>
    </div>
  );
}


/** Dots reflect the claimed run's queue pipeline; an unclaimed worker has no steps to draw. */
function WorkerTimeline({ timeline }: { timeline: ReturnType<typeof workerTimelineView> }) {
  const steps = timeline.state === "present" ? timeline.steps : [];
  const current = steps.find((step) => step.state === "active")
    ?? [...steps].reverse().find((step) => step.state !== "pending");
  return (
    <div className="mt-auto flex min-w-0 flex-col gap-[var(--ds-space-base)] border-t pt-[var(--ds-space-base)] border-[color:var(--ds-border-subtle)]">
      {steps.length > 0 ? (
        <div role="group" aria-label={`Run timeline: ${steps.map((step) => `${step.label} ${step.state}`).join(", ")}`} className="relative flex items-center justify-between">
          <span aria-hidden className="absolute inset-x-0 border-t border-[color:var(--ds-border-subtle)]" />
          {steps.map((step) => <span
            key={step.id}
            aria-hidden
            title={`${step.label} — ${step.state}`}
            className={cn("relative size-2.5 rounded-full border-2", WORKER_TIMELINE_TONE[step.state])}
          />)}
        </div>
      ) : <span aria-hidden className="border-t border-[color:var(--ds-border-subtle)]" />}
      <span className={cn(dsText.meta, "min-w-0 truncate text-right text-[color:var(--ds-fg-muted)]")} title={timeline.state === "absent" ? timeline.reason : current?.label}>
        {timeline.state === "absent" ? timeline.reason : current === undefined ? "Waiting for first step" : `${current.label} · ${current.state}`}
      </span>
    </div>
  );
}


/** Keyboard/touch route from a dense clipped value to every served character. */
interface AuthorityDetailsOwnership {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly surfaceRef: (node: HTMLDivElement | null) => void;
}


function AuthorityDetails({
  label,
  title,
  facts,
  touchAlign = "center",
  compact = false,
  ownership,
}: {
  label: string;
  title: string;
  /**
   * `kind` decides the TYPESETTING, and it is not cosmetic. The default is an
   * identifier: monospaced, and `break-all` so a 40-character id with no word
   * boundary wraps instead of overflowing. Applied to a SENTENCE those two
   * rules break words mid-syllable — `this i / ndex` — which is the popover
   * clipping the value in a different way than the truncation it exists to
   * undo. A fact whose value is prose says so.
   */
  facts: readonly Readonly<{ label: string; value: string; kind?: "id" | "prose" }>[];
  touchAlign?: "center" | "up" | "down";
  compact?: boolean;
  ownership?: AuthorityDetailsOwnership;
}) {
  return (
    <Popover {...(ownership === undefined ? {} : { open: ownership.open, onOpenChange: ownership.onOpenChange })}>
      <PopoverTrigger asChild>
        <IconButton
          size="xs"
          label={label}
          icon={compact ? <Eye aria-hidden className={dsIcon.sm} /> : (
            <span
              aria-hidden
              className={cn(
                "inline-flex size-[var(--ds-h-xs)] translate-x-3 items-center justify-center",
                dsRadius.md,
                "group-hover:bg-[var(--ds-surface-3)]",
                touchAlign === "up" && "translate-y-3",
                touchAlign === "down" && "-translate-y-3",
              )}
            >
              <Eye className={dsIcon.sm} />
            </span>
          )}
          data-authority-touch-target={compact ? undefined : "44"}
          className={compact ? "shrink-0" : cn(
            "group relative z-10 size-11 -ml-6 rounded-none hover:bg-transparent active:translate-y-0",
            touchAlign === "up" ? "-mt-6 mb-0" : touchAlign === "down" ? "mt-0 -mb-6" : "-my-3",
          )}
        />
      </PopoverTrigger>
      <PopoverContent title={title} width="lg" align="start" surfaceRef={ownership?.surfaceRef}>
        <dl className="flex min-w-0 flex-col gap-[var(--ds-space-base)]">
          {facts.map((fact) => (
            <div key={fact.label} className="min-w-0">
              <dt className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{fact.label}</dt>
              <dd
                className={cn(
                  dsText.body,
                  "select-text text-[color:var(--ds-fg)]",
                  fact.kind === "prose" ? "break-words" : cn(dsText.nums, "break-all"),
                )}
              >
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}


/**
 * The current worker's session membership, as identity-popover facts. An
 * unassigned worker has no run and therefore no session row to describe, so it
 * contributes nothing; the other three arms each keep the server's own words.
 */
function workerSessionFacts(
  membership: WorkerSessionMembership,
): readonly Readonly<{ label: string; value: string; kind?: "id" | "prose" }>[] {
  if (membership.state === "unassigned") return [];
  if (membership.state === "present") {
    return [
      { label: "Session ID", value: String(membership.sessionId) },
      { label: "Session member", value: membership.row.title, kind: "prose" },
    ];
  }
  if (membership.state === "absent") {
    return [{ label: "Session", value: `No session recorded — ${membership.reason}`, kind: "prose" }];
  }
  return [{ label: "Session", value: `Queue row not served for run ${String(membership.runId)}`, kind: "prose" }];
}


/** One served worker lease. Identity stays available; unserved steps stay empty. */
function WorkerCard({
  card,
  workflowLabel,
  queued,
  nowIso,
  membership,
  timeline,
  onStop,
  workerCommands,
}: {
  workerCommands?: WorkerCommandDispatch;
  card: WorkerCardWire;
  workflowLabel: string;
  queued: number;
  nowIso: string;
  membership: WorkerSessionMembership;
  timeline: ReturnType<typeof workerTimelineView>;
  onStop?: (card: WorkerCardWire) => void;
}) {
  const control = useSessionControl(card, workerCommands);
  const refusal = control.busy ? "Command unresolved." : workerControlRefusal(card);
  const browserRefusal = control.busy ? "Command unresolved." : workerControlRefusal(card, true);
  const controlReason = browserRefusal ?? refusal;
  const tone = WORKER_TONE[card.state];
  const directive = workerDirectiveNote(card);
  const elapsed = workerElapsedSeconds(card, nowIso);
  const browserView = workerBrowserView(card);
  const [selectedBrowserSystem, setSelectedBrowserSystem] = useState<WorkerCardWire["browsers"][number]["system"]>();

  /*
   * A daemon that DIED is a different object: no tiles, no clock, nothing to
   * stop. Ported from `DemoShell.tsx:1545-1569` — its own comment is the
   * reason it stays on screen at all: *keep it visible so the failure is
   * learned.* The word underneath is the lease's recorded reason, so "crashed"
   * and "you stopped it" can never render the same. The replacement spawn D271
   * grants a retained member lives in the Add workers dialog (D305), which is
   * the one door through which a worker is ever started.
   */
  if (card.state === "failed") {
    return (
      <article
        ref={control.cardElement}
        tabIndex={-1}
        title={`Worker ${String(card.workerId)}`}
        className={cn(
          "flex shrink-0 flex-col border",
          "w-[var(--ds-w-session-card)] gap-[var(--ds-space-tight)] p-[var(--ds-space-base)]",
          dsRadius.lg,
          "border-[color:var(--ds-danger-border)] bg-[var(--ds-danger-quiet)]",
        )}
      >
        <div className="flex items-center gap-[var(--ds-space-base)]">
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--ds-danger)]" />
          <span className={cn(dsText.ui, "min-w-0 flex-1 truncate font-semibold text-[color:var(--ds-fg)]")}>
            {workflowLabel}
          </span>
          <WorkerIdentityDetails
            label={`Show full worker identity for ${workflowLabel}`}
            workerId={String(card.workerId)}
            facts={[{ label: "Workflow", value: workflowLabel }]}
          />
          <span className={cn(dsText.caps, "shrink-0 text-[color:var(--ds-danger)]")}>{tone.label}</span>
        </div>
        <p className={cn(dsText.meta, "text-[color:var(--ds-danger)] opacity-85")}>
          {card.stopReason === undefined ? "" : WORKER_STOP_REASON_LABEL[card.stopReason]}
        </p>
      </article>
    );
  }

  return (
    <article
      ref={control.cardElement}
      tabIndex={-1}
      title={`Worker ${String(card.workerId)}`}
      className={cn(
        "flex shrink-0 flex-col border-2",
        "w-[var(--ds-w-session-card)] gap-[var(--ds-space-base)] p-[var(--ds-space-base)]",
        dsRadius.xl,
        dsSurface.card,
        dsBorder.loud,
      )}
    >
      <div className="flex min-w-0 flex-col gap-[var(--ds-space-hair)]">
        <div className="flex min-w-0 items-center justify-between gap-[var(--ds-space-tight)]">
          <div className="flex min-w-0 items-center gap-[var(--ds-space-tight)]">
            <UsersRound aria-hidden className={cn(dsIcon.md, "shrink-0 text-[color:var(--ds-fg-muted)]")} />
            <span className={cn(dsText.section, "min-w-0 truncate font-semibold text-[color:var(--ds-fg)]")}>{workflowLabel}</span>
          </div>
          <div className="flex shrink-0 gap-[var(--ds-space-hair)]">
            {workerCommands !== undefined && <Button size="sm" variant="ghost" disabled={refusal !== undefined} title={refusal} onClick={() => control.invoke(card.directive === "pause" ? "resume-worker" : "pause-worker")}>{card.directive === "pause" ? "Resume" : "Pause"}</Button>}
            <Button
              size="sm"
              variant="outline"
              icon={<X aria-hidden className={dsIcon.sm} />}
              className="border-[color:var(--ds-danger-border)] text-[color:var(--ds-danger)]"
              disabled={workerCommands === undefined ? onStop === undefined || !canStopWorker(card) : refusal !== undefined}
              title={canStopWorker(card)
                ? `Stop worker ${String(card.workerId)} after its current item (lease version ${String(card.leaseVersion)})`
                : `Worker ${String(card.workerId)} is already ${card.directive === "stop" ? "stopping" : "settled"}`}
              onClick={() => workerCommands === undefined ? onStop?.(card) : control.invoke("stop-worker")}
            >
              Stop
            </Button>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-[var(--ds-space-tight)]">
          <span className={cn(dsText.meta, dsText.nums, "min-w-0 flex-1 truncate text-[color:var(--ds-fg-muted)]")} title={`${tone.label} — ${card.currentRun.state === "present" ? String(card.currentRun.traceId) : card.currentRun.reason}`}>
            <span className={tone.text}>{tone.label.toLowerCase()}</span>
            {" — "}{card.currentRun.state === "present" ? String(card.currentRun.traceId) : card.currentRun.reason}
          </span>
          <AuthorityDetails
            label={`Show worker details for ${workflowLabel}`}
            title="Worker details"
            facts={[
              { label: "Worker ID", value: String(card.workerId) },
              { label: "Workflow", value: workflowLabel, kind: "prose" as const },
              ...(queued > 0 ? [{ label: "Queued in workflow", value: String(queued) }] : []),
              ...(card.currentRun.state === "present"
                ? [
                  { label: "Run ID", value: String(card.currentRun.runId) },
                  { label: "Trace ID", value: String(card.currentRun.traceId) },
                ]
                : [{ label: "Current run", value: card.currentRun.reason, kind: "prose" as const }]),
              ...workerSessionFacts(membership),
              { label: "Ownership", value: card.controls?.ownership.state === "owned" ? "Owned by this dashboard" : card.controls?.ownership.reason ?? "Not available" },
              { label: "Directive", value: card.directive },
              ...(card.controls?.basis.state === "present" ? [
                { label: "Worker lifetime", value: String(card.controls.basis.value.leaseGeneration) },
                { label: "Control revision", value: String(card.controls.basis.value.controlRevision) },
              ] : []),
              ...(card.controls?.operation === undefined ? [] : [
                { label: "Command ID", value: card.controls.operation.commandId },
                { label: "Command outcome", value: card.controls.operation.state },
                { label: "Outcome at", value: card.controls.operation.at },
              ]),
            ]}
            compact
          />
          <span className={cn(dsText.meta, dsText.nums, dsSurface.recess, dsRadius.md, "shrink-0 px-[var(--ds-space-base)] py-[var(--ds-space-hair)] text-right text-[color:var(--ds-fg-muted)]")}>
            {elapsed > 0 ? fmtElapsed(elapsed) : "—"}
          </span>
        </div>
      </div>

      {directive !== undefined && <span className={cn(dsText.micro, capacityChip(true))}>{directive}</span>}
      {browserView.unavailableReason !== undefined && <MetaLine items={[`Browser requirements unavailable — ${browserView.unavailableReason}`]} />}
      {browserView.slots.length > 0 && (
        <div className="grid grid-cols-2 gap-[var(--ds-space-tight)]">
          {browserView.slots.map((slot) => slot.state === "open" ? (
            <BrowserTile
              key={`open:${slot.browser.system}`}
              browser={slot.browser}
              nowIso={nowIso}
              workerId={String(card.workerId)}
              selected={selectedBrowserSystem === slot.browser.system}
              onSelectedChange={(selected) => setSelectedBrowserSystem((current) => {
                if (selected) return slot.browser.system;
                return current === slot.browser.system ? undefined : current;
              })}
              {...(workerCommands === undefined ? {} : { control: control.invoke, refusal: browserRefusal })}
            />
          ) : <RequiredBrowserTile key={`required:${slot.system}`} system={slot.system} />)}
        </div>
      )}
      {workerCommands !== undefined && control.message !== undefined && <div role="status" className={cn(dsText.micro, "text-[color:var(--ds-status-waiting-fg)]")}>{control.message}{control.retry !== undefined && <Button size="sm" variant="ghost" onClick={control.retry}>Check outcome</Button>}</div>}
      {workerCommands !== undefined && controlReason !== undefined && <span className={cn(dsText.micro, "text-[color:var(--ds-fg-muted)]")}>{controlReason}</span>}
      <WorkerTimeline timeline={timeline} />
    </article>
  );
}


/**
 * A DECLARED pool index the wire serves no LIVE worker for (D271's visibly
 * unmet declaration), drawn as one row of the Add workers dialog's roster.
 *
 * It was a dashed card in the drawer. The demo's strip holds SESSIONS, and an
 * index nobody is running is not a session (D305) — so the fact moved to the
 * two places it is acted on: the bar's chip counts every unmet index, and this
 * row, in the dialog that starts workers, carries the replacement spawn. It
 * does NOT say "crashed" or "never started": this wire carries worker leases,
 * and no lease for an index means authority has no card for it. Which of those
 * two happened is a supervisor fact this projection does not serve, and the
 * row may not pick one. A retained card that DID end says why, and this row
 * repeats that recorded reason beside the spawn that replaces it.
 */
export function UnmetMemberRow({
  slot,
  spawn,
}: {
  slot: SessionPoolMemberSlot;
  spawn: { readonly title: string; readonly pending: boolean; readonly onSpawn: () => void };
}) {
  const retained = slot.membership.state === "retained" ? slot.membership.card : undefined;
  return (
    <li
      data-pool-unmet-member={slot.workerId}
      className={cn(
        "flex min-w-0 items-center border-b last:border-b-0",
        dsBorder.subtle,
        "gap-[var(--ds-space-base)] px-[var(--ds-space-base)] py-[var(--ds-space-tight)]",
        dsText.meta,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          retained === undefined ? "border border-[color:var(--ds-border)]" : WORKER_TONE[retained.state].dot,
        )}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-[var(--ds-space-hair)]">
        <span className="flex min-w-0 items-baseline gap-[var(--ds-space-tight)]">
          <span className="shrink-0 font-medium text-[color:var(--ds-fg)]">Member {slot.poolIndex}</span>
          {/* THE ID IS THE CONFIRMATION, so it may not be clipped: `break-all`
              because a worker id has no word boundary the browser would find. */}
          <span className={cn(dsText.nums, "min-w-0 break-all text-[color:var(--ds-fg-muted)]")}>{slot.workerId}</span>
        </span>
        <span className="text-[color:var(--ds-fg-muted)]">
          {retained === undefined
            ? "No worker lease served for this pool index"
            : `${WORKER_TONE[retained.state].label}${
              retained.stopReason === undefined ? "" : ` — ${WORKER_STOP_REASON_LABEL[retained.stopReason]}`
            }`}
        </span>
      </span>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0"
        disabled={spawn.pending}
        title={spawn.title}
        onClick={spawn.onSpawn}
      >
        Spawn worker {slot.poolIndex}
      </Button>
    </li>
  );
}


/**
 * The worker id, on the ONE keyboard- and touch-reachable route this panel
 * already uses for a clipped identity (`AuthorityDetails`).
 *
 * Every card in this drawer carried its worker id on the article's `title`
 * attribute and nowhere else, and the header label that stands in for it is
 * `truncate` — so a pool member reads `Member 2`, an unindexed worker reads a
 * clipped id, and the full string was reachable by hovering a mouse and by
 * nothing else. This is the shared route for the two cards whose HEADER holds
 * it (the unmet slot and the retained failed card, both of which have a
 * `flex-1` label for the target to hang off); the live card's is on its
 * subline, where the run identity already was.
 */
function WorkerIdentityDetails({
  label,
  workerId,
  facts,
}: {
  label: string;
  workerId: string;
  facts?: readonly Readonly<{ label: string; value: string; kind?: "id" | "prose" }>[];
}) {
  return (
    <AuthorityDetails
      label={label}
      title="Worker identity"
      facts={[{ label: "Worker ID", value: workerId }, ...(facts ?? [])]}
    />
  );
}



/**
 * What happened to the last pool command issued for ONE workflow, held against
 * the CAS basis it was issued with: when the served pool version moves, the
 * note is about a basis nobody is looking at any more and stops being drawn.
 */
type PoolControlOutcome = Readonly<{
  basis: number;
  action: string;
  state:
    | Readonly<{ kind: "pending" }>
    | Readonly<{ kind: "applied"; replayed: boolean }>
    | Readonly<{ kind: "refused"; settlement: Extract<CommandSettlement, { kind: "refused" }> }>
    /**
     * The post threw. NOT "nothing was recorded": the envelope was already on
     * the wire, so a failed fetch may have failed after the kernel wrote the
     * pool row and started the process (unit F2d's correction, and the rule
     * `commandFailureToast` states for the toast route). The panel names the
     * uncertainty and points at what resolves it — which for a pool command is
     * the pool's own version and roster, not a run receipt.
     */
    | Readonly<{ kind: "unknown"; message: string }>;
}>;


/**
 * The answer to a pool command, drawn where it was issued.
 *
 * BOTH refusal arms are drawn, each in the server's own words (D253): a
 * `conflict` carries the version the pool actually holds — the one number that
 * says what to do about it — and a `rejected` carries the kernel's sentence and
 * its code. Neither arm re-posts anything. A conflict means the pool moved
 * under the count the operator was reading, so the next decision is theirs to
 * make against the refreshed roster; a control that retried here would be
 * planning a number nobody chose.
 */
export function PoolOutcomeNotice({ outcome }: { outcome: PoolControlOutcome }) {
  /*
    BOTH quiet arms are a LIVE REGION. A refusal is a `Banner`, which announces
    itself; `pending` and `applied` were plain text appearing in a band the
    operator is not looking at — the two arms that say a worker process is being
    started or stopped, silent to a screen reader. `role="status"` is the polite
    one on purpose: it must not interrupt, and the arm that MUST be heard
    immediately (a refusal, a result the tab never got) is already `alert`-toned
    chrome. The region is the same element across the pending → applied
    transition, so the settlement is announced as a CHANGE inside a region that
    was already there, not only as an insertion.
  */
  if (outcome.state.kind === "pending") {
    return (
      <span role="status" className="px-[var(--ds-space-tight)]">
        <MetaLine items={[outcome.action, "sending — the supervisor answers when the process effect has settled"]} />
      </span>
    );
  }
  if (outcome.state.kind === "applied") {
    return (
      <span role="status" className="px-[var(--ds-space-tight)]">
        <MetaLine items={[outcome.action, outcome.state.replayed ? "already recorded (replay)" : "recorded"]} />
      </span>
    );
  }
  if (outcome.state.kind === "unknown") {
    return (
      <Banner tone="danger" title="Result unknown — re-read the pool">
        <span className="flex flex-col gap-[var(--ds-space-tight)]">
          <span>
            {outcome.state.message} This command may already have been recorded and its process effect may
            already have run: read the pool version and the members below before sending it again.
          </span>
          <MetaLine items={[outcome.action, "the answer never reached this tab"]} />
        </span>
      </Banner>
    );
  }
  const { settlement } = outcome.state;
  return (
    <Banner tone="danger" title="Nothing was recorded">
      <span className="flex flex-col gap-[var(--ds-space-tight)]">
        <span>{settlement.message}</span>
        <MetaLine
          items={[
            outcome.action,
            settlement.reason === "conflict"
              ? `pool version ${String(settlement.currentVersion)}`
              : `code ${settlement.reason === "rejected" ? settlement.code : "confirmation-required"}`,
          ]}
        />
      </span>
    </Banner>
  );
}



/**
 * ADD WORKERS — workflow + count. The demo's own door, ported from legacy
 * hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc, `DemoShell.tsx:1683-1823`
 * (`AddWorkersDialog`), and given D271's contract as its body (D305).
 *
 * The demo's dialog is the shape ref execution-and-sessions names — *`+ Add
 * workers` chooses a workflow and a count* — and it is where the panel's pool
 * controls live now, instead of a band per workflow in the drawer. Two things
 * the demo's mock could skip are real here, and both are D271's:
 *
 * - **The count is a PLAN, not a start.** `plan-worker-count` declares N
 *   against the pool's served CAS version, and the kernel derives which members
 *   that stops — canonical indices `N+1..MAX`, whose running ones must each be
 *   covered by a bounded graceful stop. The dialog names exactly that list from
 *   the same derivation (`planPoolIntent`) and the operator confirms THAT list;
 *   nothing here selects a member by idleness. The cap is three (D271), so the
 *   demo's twenty-step counter is a three-step one.
 * - **A member is started by an explicit `spawn-worker`.** The roster under the
 *   count lists every declared index with no LIVE worker — never started, or
 *   ended with its recorded reason — each with its own spawn. A plan that
 *   raises the count therefore shows its new indices here on the next
 *   snapshot, which is the two-step D271 ratified and never a client-side
 *   chain of commands against a version the server has not served yet.
 *
 * The answer to a command is drawn in the dialog it was issued from, against
 * the CAS basis it was issued with (`PoolOutcomeNotice`): once the served pool
 * version moves past it, the note is about a basis nobody is looking at.
 */
function AddWorkersDialog({
  open,
  onOpenChange,
  workflows,
  workerCards,
  workerPools,
  outcomes,
  onPlan,
  onSpawn,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflows: readonly WorkflowBootstrapPrimitive[];
  workerCards: readonly WorkerCardWire[];
  workerPools: readonly WorkerPoolWire[];
  outcomes: Readonly<Record<string, PoolControlOutcome>>;
  onPlan: (group: SessionPoolGroup, intent: Extract<PoolPlanIntent, { kind: "ready" }>) => void;
  onSpawn: (group: SessionPoolGroup, member: Readonly<{ workerId: string; poolIndex: number }>) => void;
}) {
  const first = workflows[0];
  const [chosenWorkflowId, setChosenWorkflowId] = useState<string | undefined>(undefined);
  const [count, setCount] = useState(1);
  // A fresh open is a fresh ask (the demo's own rule): the count resets, and
  // an outcome from an earlier basis is already dropped by the panel.
  useEffect(() => {
    if (!open) return;
    setCount(1);
  }, [open]);

  // A workflow the bootstrap no longer lists cannot be planned; the selection
  // falls back to the first served one rather than posting for a ghost.
  const workflowId = chosenWorkflowId !== undefined && workflows.some((workflow) => String(workflow.id) === chosenWorkflowId)
    ? chosenWorkflowId
    : first === undefined ? undefined : String(first.id);
  const workflow = workflows.find((entry) => String(entry.id) === workflowId);
  const group = useMemo(
    () => (workflowId === undefined ? undefined : sessionPoolGroupFor(workflowId, workerCards, workerPools)),
    [workflowId, workerCards, workerPools],
  );
  const intent = group === undefined ? undefined : planPoolIntent(group, count);
  const stopping = intent !== undefined && intent.kind === "ready"
    ? intent.excess.filter((member) => member.running)
    : [];
  const unmet = group === undefined ? [] : group.slots.filter(poolSlotIsUnmet);
  const outcome = group === undefined ? undefined : outcomes[group.workflowId];
  const pending = outcome?.state.kind === "pending";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" title="Add workers" description="Start parallel executors for one workflow">
        <DialogBody>
          {workflow === undefined || group === undefined ? (
            <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
              No workflow is registered, so there is nothing to plan a pool for.
            </span>
          ) : (
            <div className="flex flex-col gap-[var(--ds-space-loose)]">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-[var(--ds-space-base)]">
                <Field label="Workflow">
                  <Select value={String(workflow.id)} onChange={(event) => setChosenWorkflowId(event.target.value)}>
                    {workflows.map((entry) => (
                      <option key={String(entry.id)} value={String(entry.id)}>
                        {entry.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                {/* THE COUNT IS THE ASK. A stepper, not a repeat press.
                    It is NOT wrapped in `Field`: `Field` labels one form control
                    through its context, and this is a group of three. Its label
                    row mirrors `Field`'s exactly — same type class, same gap — so
                    the two controls sit on one baseline. */}
                <div role="group" aria-label="How many workers to plan" className="flex min-w-0 flex-col gap-[var(--ds-space-tight)]">
                  <span className={cn(dsText.meta, "font-medium text-[color:var(--ds-fg-secondary)]")}>Workers</span>
                  <span className="flex items-center gap-[var(--ds-space-tight)]">
                    <IconButton
                      size="md"
                      label="One fewer worker"
                      disabled={count <= 1}
                      onClick={() => setCount((value) => Math.max(1, value - 1))}
                      icon={<Minus aria-hidden className={dsIcon.md} />}
                    />
                    <span
                      aria-live="polite"
                      className={cn(dsText.section, dsText.nums, "w-8 text-center font-semibold text-[color:var(--ds-fg)]")}
                    >
                      {count}
                    </span>
                    <IconButton
                      size="md"
                      label="One more worker"
                      disabled={count >= SESSION_POOL_MAX_WORKERS}
                      onClick={() => setCount((value) => Math.min(SESSION_POOL_MAX_WORKERS, value + 1))}
                      icon={<Plus aria-hidden className={dsIcon.md} />}
                    />
                  </span>
                </div>
              </div>

              {/*
                The declaration and the leases, side by side and never folded
                into one number: `desiredWorkers` is what an operator asked for
                and the cards are what authority holds. A pool with no row says
                so — reading a missing row as "one worker" would invent an
                intent nobody recorded. Supervisor ownership (supervised, or
                externally running after a restart, D271) is NOT served by the
                day projection, so no control here is withheld on it; the
                server's refusal by name stays the authority.
              */}
              <MetaLine
                items={[
                  group.facts.state === "declared"
                    ? `${String(group.facts.desiredWorkers)} declared`
                    : "no pool declaration",
                  `${String(group.facts.activeWorkers)} active`,
                  `pool version ${String(group.expectedVersion)}`,
                  `cap ${String(SESSION_POOL_MAX_WORKERS)}`,
                ]}
              />

              {intent !== undefined && intent.kind === "refused" && (
                <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{intent.reason}</span>
              )}
              {intent !== undefined && intent.kind === "ready" && (
                <span className="flex flex-col gap-[var(--ds-space-tight)]">
                  {intent.excess.length === 0 ? (
                    <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
                      No member is above this count; nothing is stopped.
                    </span>
                  ) : (
                    <>
                      <span className={cn(dsText.meta, "text-[color:var(--ds-fg-secondary)]")}>
                        {stopping.length > 0
                          ? "This plan stops these members, each after its current item settles:"
                          : "These indices are above the count. None is running, so this plan stops nothing:"}
                      </span>
                      {/*
                        THE IDS ARE THE CONFIRMATION, so none of them may be
                        clipped: `break-all` because a worker id has no word
                        boundary the browser would find.
                      */}
                      <ul className={cn(dsText.meta, "flex flex-col gap-[var(--ds-space-hair)]")}>
                        {intent.excess.map((member) => (
                          <li key={member.workerId} className={cn(dsText.nums, "flex items-baseline gap-[var(--ds-space-tight)]")}>
                            <span className="min-w-0 break-all text-[color:var(--ds-fg)]">{member.workerId}</span>
                            <span className="shrink-0 text-[color:var(--ds-fg-muted)]">
                              {member.running ? "running — graceful stop" : "no running worker served"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </span>
              )}

              {/* D271's visibly unmet declaration, and its replacement spawn. */}
              {unmet.length > 0 && (
                <div className="flex flex-col gap-[var(--ds-space-snug)]">
                  <span className={cn(dsText.ui, "font-semibold text-[color:var(--ds-fg)]")}>
                    {plural(unmet.length, "declared member")} not running
                  </span>
                  <ul
                    aria-label={`Declared members of ${workflow.label} with no running worker`}
                    className={cn("flex flex-col overflow-hidden border", dsRadius.md, dsBorder.base)}
                  >
                    {unmet.map((slot) => (
                      <UnmetMemberRow
                        key={slot.workerId}
                        slot={slot}
                        spawn={{
                          title: `Spawn ${slot.workerId} against pool version ${String(group.expectedVersion)}`,
                          pending,
                          onSpawn: () => onSpawn(group, { workerId: slot.workerId, poolIndex: slot.poolIndex }),
                        }}
                      />
                    ))}
                  </ul>
                </div>
              )}

              {outcome !== undefined && outcome.basis === group.expectedVersion && (
                <PoolOutcomeNotice outcome={outcome} />
              )}
            </div>
          )}
        </DialogBody>
        <DialogFooter meta={group === undefined ? undefined : `${group.workflowId} · pool version ${String(group.expectedVersion)}`}>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {/*
            The button says what the press DOES, and a stop is only in the
            sentence when a member is actually running: "Stop 0 members" names
            an act that does not happen, and a danger tone for a plan that
            stops nothing spends the alarm where there is no hazard. A refused
            intent leaves the verb on screen, disabled, with its reason above:
            a control that vanishes reads as a control that was never there.
          */}
          <Button
            variant={stopping.length > 0 ? "danger" : "primary"}
            disabled={group === undefined || intent === undefined || intent.kind !== "ready" || pending}
            title={group === undefined
              ? "No workflow to plan"
              : `Plan ${plural(count, "worker")} for ${workflow?.label ?? group.workflowId} against pool version `
                + `${String(group.expectedVersion)}`}
            onClick={() => {
              if (group === undefined || intent === undefined || intent.kind !== "ready") return;
              onPlan(group, intent);
            }}
          >
            {stopping.length > 0
              ? `Stop ${plural(stopping.length, "member")} and plan ${plural(count, "worker")}`
              : `Plan ${plural(count, "worker")}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


/**
 * The Session Panel — the bar that is mounted under every view, and the drawer
 * of worker cards behind it. Ported from legacy
 * hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc, `DemoShell.tsx:1825-1957`
 * (`DemoSessionPanel`), and restored to that shape by D305: the drawer is ONE
 * strip of cards, one per served worker across every workflow, and the pool
 * controls live behind the bar's `+`.
 *
 * The APP's version is stated ONCE here, for the whole dashboard: every run on
 * screen is being served by this build, so one statement in the one bar that is
 * always mounted says it for all of them. A run that RAN under a different
 * version carries its own, which is a fact about the run and stays on the run.
 */
export function SessionPanel({
  open: controlledOpen, onOpenChange,
  workerCards,
  queueSurfaces,
  workerPools,
  workflows,
  counts,
  nowIso,
  connection,
  appVersion,
  onStopWorker,
  workerCommands,
  onPlanWorkerCount,
  onSpawnWorker,
}: {
  open?: boolean;
  onOpenChange?: React.Dispatch<React.SetStateAction<boolean>>;
  workerCards: readonly WorkerCardWire[];
  queueSurfaces: readonly QueueSurfaceWire[];
  workerPools: readonly WorkerPoolWire[];
  /**
   * The bootstrap's own workflow list — the SAME vocabulary the Workflow Panel
   * and the Run Modal draw from. The card names a workflow by joining this
   * list rather than by a second served label: two labels for one workflow is
   * how the panel and the card come to disagree about what a worker is running.
   */
  workflows: readonly WorkflowBootstrapPrimitive[];
  /** D81's one fold — the queued chip's number, never a pass over the rows. */
  counts: readonly WorkflowCountWire[];
  nowIso: string;
  connection: SubscriptionState;
  appVersion: string;
  onStopWorker?: (card: WorkerCardWire) => void;
  workerCommands?: WorkerCommandDispatch;
  /**
   * D271's two pool controls. Both RETURN the folded settlement rather than
   * reporting it themselves: a CAS refusal is about the pool version this
   * panel was drawn from, so it is drawn in the dialog it was issued from. A
   * rejected promise means the post never reached the kernel — a different
   * fact, kept distinguishable from a refusal the server sent.
   */
  onPlanWorkerCount?: (
    plan: Readonly<{ workflowId: string; desiredWorkers: number; expectedVersion: number }>,
  ) => Promise<CommandSettlement>;
  onSpawnWorker?: (
    member: Readonly<{ workflowId: string; workerId: string; expectedVersion: number }>,
  ) => Promise<CommandSettlement>;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const [addOpen, setAddOpen] = useState(false);
  const [outcomes, setOutcomes] = useState<Readonly<Record<string, PoolControlOutcome>>>({});
  const sessionPanelView = useMemo(
    () => buildSessionPanelView(queueSurfaces, workerCards, workerPools),
    [queueSurfaces, workerCards, workerPools],
  );
  const tallies = useMemo(() => {
    const byState = new Map<WorkerState, number>();
    for (const card of workerCards) byState.set(card.state, (byState.get(card.state) ?? 0) + 1);
    return WORKER_STATE_ORDER.map((state) => ({ state, count: byState.get(state) ?? 0 })).filter(
      (tally) => tally.count > 0 || ALWAYS_TALLIED.includes(tally.state),
    );
  }, [workerCards]);
  /**
   * WHICH workers, not only how many — the demo's chip carries the naming
   * `title` (`DemoShell.tsx:1887`) because a count with no names cannot be
   * acted on. Since D248 the sentence can be the demo's own: the card names its
   * WORKFLOW and the lease says how it ended, so the title reads
   * `Separations · crashed` rather than a worker id and a state word.
   */
  const attention = useMemo(
    () => workerCards.filter((card) => card.state === "failed"),
    [workerCards],
  );
  /**
   * D271's visibly unmet declaration, on the bar: every declared index with no
   * live worker, across every pool. The demo's second chip is "N waiting on a
   * lease", which this platform has no producer for (every worker owns its
   * browser sessions); this is the one standing capacity fact the wire DOES
   * carry, in the same chip, with the ids on its title and the spawn behind `+`.
   */
  const unmet = useMemo(
    () => sessionPanelView.poolGroups.flatMap((group) => group.slots.filter(poolSlotIsUnmet)),
    [sessionPanelView.poolGroups],
  );
  /**
   * The workflow's label, joined ONCE for every card. A workflow the bootstrap
   * does not list falls back to its own id — the honest stand-in, and the only
   * one available: inventing a display name for an unregistered workflow would
   * name it something no descriptor declares.
   */
  const workflowLabels = useMemo(
    () => new Map(workflows.map((workflow) => [String(workflow.id), workflow.label])),
    [workflows],
  );
  const labelOf = useCallback(
    (card: WorkerCardWire): string => workflowLabels.get(String(card.workflowId)) ?? String(card.workflowId),
    [workflowLabels],
  );
  const link = connectionTone(connection);

  /**
   * The membership join is computed ONCE for the whole panel (it is a pass over
   * the served queue rows per card), and the strip reads it by worker id — the
   * card list must not become a second place that joins runs to cards.
   */
  const membershipByWorkerId = useMemo(
    () => new Map(sessionPanelView.workers.map(({ card, membership }) => [String(card.workerId), membership])),
    [sessionPanelView.workers],
  );
  const membershipOf = useCallback(
    (card: WorkerCardWire): WorkerSessionMembership => {
      const membership = membershipByWorkerId.get(String(card.workerId));
      // The map is built from the SAME card list the strip is drawn from, so
      // a miss is a broken fold, not a state to render around.
      if (membership === undefined) {
        throw new Error(`worker ${String(card.workerId)} is drawn on the Session Panel with no folded membership`);
      }
      return membership;
    },
    [membershipByWorkerId],
  );

  /**
   * One pool command, from press to answer. The outcome is recorded against the
   * CAS basis it was issued with, so it stops being drawn as soon as the served
   * pool version moves past it — a refusal about a version nobody is looking at
   * any more is noise, and a success that outlived its basis would be a claim
   * about the roster now on screen.
   */
  const trackPoolCommand = useCallback(
    (
      workflowId: string,
      basis: number,
      action: string,
      post: () => Promise<CommandSettlement>,
    ): void => {
      setOutcomes((current) => ({ ...current, [workflowId]: { basis, action, state: { kind: "pending" } } }));
      post().then(
        (settlement) => {
          setOutcomes((current) => ({
            ...current,
            [workflowId]: {
              basis,
              action,
              state: settlement.kind === "applied"
                ? { kind: "applied", replayed: settlement.replayed }
                : { kind: "refused", settlement },
            },
          }));
        },
        (caught: unknown) => {
          setOutcomes((current) => ({
            ...current,
            [workflowId]: {
              basis,
              action,
              state: { kind: "unknown", message: caught instanceof Error ? caught.message : String(caught) },
            },
          }));
        },
      );
    },
    [],
  );

  return (
    <section aria-label="Session Panel" className={cn("shrink-0 border-t", dsBorder.base, dsSurface.card)}>
      <div className={cn("flex items-center", dsSize.hBar, "gap-[var(--ds-space-base)] px-[var(--ds-shell-inset)]")}>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className={cn(
            "flex min-w-0 flex-1 cursor-pointer items-center overflow-hidden text-left",
            "h-[var(--ds-h-md)] gap-[var(--ds-space-cozy)] px-[var(--ds-space-tight)]",
            dsRadius.md,
            dsFocus,
            dsMotion.fast,
            "hover:bg-[var(--ds-surface-3)]",
          )}
        >
          {open ? (
            <ChevronDown aria-hidden className={cn(dsIcon.md, "shrink-0 text-[color:var(--ds-fg-muted)]")} />
          ) : (
            <ChevronUp aria-hidden className={cn(dsIcon.md, "shrink-0 text-[color:var(--ds-fg-muted)]")} />
          )}
          <span className={cn(dsText.ui, "shrink-0 font-semibold text-[color:var(--ds-fg)]")}>Sessions</span>
          <span className={cn(dsText.meta, "flex shrink-0 items-center gap-[var(--ds-space-cozy)] text-[color:var(--ds-fg-muted)]")}>
            {tallies.map((tally) => (
              <span
                key={tally.state}
                className={cn(
                  "inline-flex items-center gap-[var(--ds-space-tight)]",
                  // Only `failed` takes ink, and only when there is one: the
                  // demo tints the whole segment rather than the dot alone,
                  // because a 6px red dot beside muted grey words is colour
                  // doing the work on its own. Every other state stays muted —
                  // a bar where five of six tallies are coloured is a bar where
                  // none of them is.
                  tally.state === "failed" && tally.count > 0 && WORKER_TONE.failed.text,
                )}
              >
                <span aria-hidden className={cn("size-1.5 rounded-full", WORKER_TONE[tally.state].dot)} />
                {tally.count} {WORKER_TONE[tally.state].label.toLowerCase()}
              </span>
            ))}
          </span>
          {unmet.length > 0 && (
            <span title={unmet.map((slot) => slot.workerId).join(" · ")} className={capacityChip(true)}>
              <CircleDashed aria-hidden className={cn(dsIcon.sm, "shrink-0")} />
              {unmet.length} declared members not running
            </span>
          )}
          {/* Renders only when the count is above zero — honest absence. Since
              D248 it CAN fire: a worker whose lease settled `crashed` or
              `lease-expired` is a `failed` card, which is the state this chip
              was built for and could never receive. */}
          {attention.length > 0 && (
            <span
              title={attention
                .map((card) => `${labelOf(card)} · ${
                  card.stopReason === undefined ? "failed" : WORKER_STOP_REASON_LABEL[card.stopReason]
                }`)
                .join(" · ")}
              className={capacityChip(true)}
            >
              <AlertTriangle aria-hidden className={cn(dsIcon.sm, "shrink-0")} />
              {/* The demo's STABLE plural (D272 item 4, ledger row A122). This
                  read `1 worker need attention` at a count of one, because
                  `plural` agrees the noun and the sentence's verb is fixed —
                  the demo's chip never inflects either, so the two always
                  agree. */}
              {attention.length} workers need attention
            </span>
          )}
        </button>
        <span className="flex shrink-0 items-center gap-[var(--ds-space-snug)]">
          {/* N AT ONCE, never one at a time. The dialog owns the count and the
              per-member answer; this is only its door (the demo's `+`,
              `DemoShell.tsx:1903-1910`, D305). */}
          <IconButton
            size="sm"
            label="Add workers"
            title="Start parallel executors — pick a workflow and how many"
            aria-haspopup="dialog"
            onClick={() => setAddOpen(true)}
            icon={<Plus aria-hidden className={dsIcon.md} />}
          />
          {/* The full sentence, ported from legacy
              hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
              `DemoShell.tsx:1919-1924` (R7-11). The rebuild IMPLEMENTS D179's
              archive semantics and had dropped the only place the operator is
              ever told them: what a MAJOR bump does to prior-version runs is
              not derivable from a version string, and the tooltip on that
              string is where the demo puts it. */}
          {/* D272 item 4 (ledger row A126): the tag and the sentence beside it
              print the SAME two components. The bootstrap serves a semver, and
              a third digit under a tooltip that explains exactly two is a claim
              the operator cannot check. */}
          <span
            title={`App ${fmtAppVersion(appVersion)} — MAJOR moves when a dashboard change reaches some or all workflows (prior-version runs archive); MINOR when it reaches none. A run that RAN under a different version carries its own, which is a fact about the run and stays on the run.`}
            className={cn(dsText.meta, dsText.nums, "shrink-0 text-[color:var(--ds-fg-muted)]")}
          >
            {appVersionTag(appVersion)}
          </span>
          <span aria-hidden className="h-[var(--ds-h-xs)] w-px shrink-0 bg-[var(--ds-border)]" />
          {/* The subscription, named. This is the live / reconnecting state the
              Phase-1 exit has to show. */}
          <span
            role="status"
            title={link.detail}
            className={cn(dsText.meta, "inline-flex items-center gap-[var(--ds-space-tight)]", link.text)}
          >
            <span aria-hidden className={cn("size-1.5 rounded-full", link.dot)} />
            {link.label}
          </span>
        </span>
      </div>

      {open && (
        <div
          data-session-strip
          className={cn(
            // items-stretch: every card is as tall as the tallest. This
            // OVERRIDES an earlier "a card is as tall as what it knows" — true
            // of one card, wrong of the row, because five intrinsic heights
            // made the strip read as ragged debris and put every footer on its
            // own baseline, so `Stop` was in five places and the elapsed clocks
            // could not be compared down a column. Uniform height is what makes
            // the row scannable; the empty space inside a quiet card is left
            // empty (see the footer note in `WorkerCard`) rather than filled.
            "flex items-stretch overflow-x-auto border-t",
            dsBorder.subtle,
            "gap-[var(--ds-space-base)] px-[var(--ds-shell-inset)] py-[var(--ds-space-cozy)]",
          )}
        >
          {workerCards.length === 0 ? (
            // Nothing running is a STATE, not an absent element (ref
            // dashboard-surfaces §9.9): it says so, and names the one door.
            <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
              No worker is running. Add workers starts one.
            </span>
          ) : workerCards.map((card) => (
            <WorkerCard
              key={String(card.workerId)}
              card={card}
              workflowLabel={labelOf(card)}
              queued={statusCount(workflowStatusCounts(counts, String(card.workflowId)), "queued")}
              nowIso={nowIso}
              membership={membershipOf(card)}
              timeline={workerTimelineView(card, queueSurfaces)}
              {...(onStopWorker === undefined ? {} : { onStop: onStopWorker })}
              {...(workerCommands === undefined ? {} : { workerCommands })}
            />
          ))}
        </div>
      )}

      <AddWorkersDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        workflows={workflows}
        workerCards={workerCards}
        workerPools={workerPools}
        outcomes={outcomes}
        onPlan={(group, intent) => {
          const plan = onPlanWorkerCount;
          if (plan === undefined) return;
          trackPoolCommand(
            group.workflowId,
            intent.expectedVersion,
            `Plan ${String(intent.desiredWorkers)} workers`,
            () => plan({
              workflowId: group.workflowId,
              desiredWorkers: intent.desiredWorkers,
              expectedVersion: intent.expectedVersion,
            }),
          );
        }}
        onSpawn={(group, member) => {
          const spawn = onSpawnWorker;
          if (spawn === undefined) return;
          trackPoolCommand(
            group.workflowId,
            group.expectedVersion,
            `Spawn ${member.workerId}`,
            () => spawn({
              workflowId: group.workflowId,
              workerId: member.workerId,
              expectedVersion: group.expectedVersion,
            }),
          );
        }}
      />
    </section>
  );
}
