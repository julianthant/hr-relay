import { Fragment, useCallback, useMemo } from "react";
import type { z } from "zod";
import type { PanelSections } from "./sections.js";
import type { ActionDescriptorWire } from "../../../models/dashboard/actions.js";
import type { CapabilityAvailabilitySchema } from "../../../rules/validation/absence.js";
import type { LogRowWire, NotePageSchema, RunDetailSectionResponseSchema, RunDetailWireSchema } from "../../../models/dashboard/run-detail.js";
import { Button } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { useDashboardClient } from "../../state/client-context.js";
import type { DashboardActionHandler } from "../actions.js";
import { InlineDecision, InlineGateDecisionRecord } from "./gate-park.js";
import { InlineFailureRecord } from "./receipt-failure.js";
import { InlineParkedWrite, type ParkedWritePayload } from "../park-resolve.js";
import { LogFeed } from "../log-feed.js";
import { retainedLogFeed } from "./log-feed-adapter.js";
import { operationGroupBreakIds } from "../operation-structure-model.js";
import { exactBundleCaptures, type RunCapturesState } from "../run-captures-model.js";
import type { QueueSurfaceWire } from "../run-identity.js";
import { logRowsOf, useLogPages } from "./logs-model.js";

type RunDetailWire = z.infer<typeof RunDetailWireSchema>;
type RunDetailSectionResponse = z.infer<typeof RunDetailSectionResponseSchema>;
type NotePage = z.infer<typeof NotePageSchema>;
type FailurePayload = Extract<RunDetailSectionResponse, { section: "failure" }>['payload'];
type CapabilityAvailability = z.infer<typeof CapabilityAvailabilitySchema>;

function anchorIndex(rows: readonly LogRowWire[], at: string): number {
  let index = -1;
  for (const [position, row] of rows.entries()) if ((row.kind === "note" ? row.note.at : row.at) <= at) index = position;
  return index;
}

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

export function LogsTab({
  detail,
  captures,
  notes,
  failure,
  parked,
  identity,
  gateActions,
  onResolveGate,
  onResolvePark,
  decisionRef,
  failureRef,
  parkedRef,
  aiAdvisory,
  nowIso,
  actorId,
}: {
  detail: RunDetailWire;
  captures: RunCapturesState | undefined;
  notes: NotePage | undefined;
  failure: FailurePayload | undefined;
  parked: ParkedWritePayload | undefined;
  identity?: PanelSections["identity-gate"];
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
  actorId: string;
}) {
  const client = useDashboardClient();
  const loadNext = useCallback(async (cursor: string): Promise<NotePage> => {
    const response = await client.runSection(detail.runId, "logs", cursor);
    if (response.section !== "logs") throw new Error(`logs pagination returned ${response.section}, not logs`);
    return response.payload;
  }, [client, detail.runId]);
  const paged = useLogPages(notes, loadNext);
  const lines = useMemo(() => logRowsOf(paged.page, "current"), [paged.page]);
  const gate = detail.gate;
  const decisionAt = gate.state === "open" ? anchorIndex(lines, gate.openedAt) : undefined;
  const gateRecordAt = gate.state === "resolved" ? anchorIndex(lines, gate.resolvedAt) : undefined;
  const failureAt = failure !== undefined && detail.outcome.state === "terminal" && detail.outcome.result === "failed" ? anchorIndex(lines, detail.outcome.completedAt) : undefined;
  const parkedAt = parked === undefined ? undefined : anchorIndex(lines, parked.parkedAt);
  const operationStructure = paged.page?.operationStructure;
  const breaks = operationGroupBreakIds(lines, [decisionAt, gateRecordAt, failureAt, parkedAt]);
  const errorNotes = lines.flatMap(row => row.kind === "note" && row.note.level === "error" ? [row.note] : []);
  const failureBundleId = failureAt !== undefined && failure?.state === "available" && failure.value.diagnosticBundle.state === "present" ? failure.value.diagnosticBundle.bundleId : undefined;
  const ordinaryCaptures = captures?.state === "available" ? captures.items.filter(item => failureBundleId === undefined || exactBundleCaptures([item], failureBundleId).length === 0) : [];
  const projected = retainedLogFeed(lines, operationStructure, ordinaryCaptures, breaks);
  const indexes = new Map<string, number>(lines.map((row, index) => [row.logId, index]));
  // Cards keep their served ordering when driver-only rows disappear from the stream.
  const cardStep = (at: number | undefined): string | undefined => {
    if (at === undefined) return undefined;
    return projected.findLast(item => indexes.get(item.lastLogId)! <= at)?.step.id;
  };
  const cards = [
    { at: decisionAt, content: gate.state === "open" ? <InlineDecision gate={gate} identity={identity} actions={gateActions} runId={detail.runId} onAction={onResolveGate} anchorRef={decisionRef} nowIso={nowIso} /> : null },
    { at: gateRecordAt, content: gate.state === "resolved" ? <InlineGateDecisionRecord gate={gate} /> : null },
    { at: failureAt, content: failure !== undefined && failureAt !== undefined ? <InlineFailureRecord liveContext={{ actorId, nowIso }} failure={failure} errorNotes={errorNotes} {...(detail.outcome.state === "terminal" ? { completedAt: detail.outcome.completedAt } : {})} anchorRef={failureRef} runId={detail.runId} aiAdvisory={aiAdvisory} captures={captures?.state === "available" ? captures.items : undefined} /> : null },
    { at: parkedAt, content: parked !== undefined ? <InlineParkedWrite key={`${parked.runId}:${parked.writeIntentId}:${String(parked.generation)}`} parked={parked} onResolve={onResolvePark} anchorRef={parkedRef} /> : null },
  ];
  return <LogFeed key={detail.runId} embedded steps={projected.map(item => item.step)} loading={notes === undefined}
    beforeContent={cards.map((card, index) => card.at !== undefined && cardStep(card.at) === undefined ? <Fragment key={index}>{card.content}</Fragment> : null)}
    afterStep={id => {
      const matched = cards.filter(card => card.at !== undefined && cardStep(card.at) === id);
      return matched.length ? <div className="col-span-2 mt-4">{matched.map((card, index) => <Fragment key={index}>{card.content}</Fragment>)}</div> : undefined;
    }}
    trailingContent={<>{paged.error !== undefined && <p role="alert" className="text-body text-ui-danger">{paged.error.message}</p>}{captures?.state === "error" && <p role="alert" className="text-body text-ui-danger">{captures.message}</p>}{paged.page?.nextCursor.state === "present" && <Button variant="ghost" size="sm" onClick={paged.loadMore} disabled={paged.loading} aria-busy={paged.loading || undefined}>{paged.loading ? "Loading more actions…" : "Load more actions"}</Button>}</>}
  />;
}
