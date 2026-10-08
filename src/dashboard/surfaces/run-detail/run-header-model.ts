import { isTerminalQueueStatus, type QueueSurfaceWire } from '../../../models/dashboard/projection.js';
import { runTiming } from '../shared/status/format.js';
import { runDisplayId } from '../shared/status/run-display-model.js';
import { visualLogSteps, type LogStep } from './logs/log-feed-model.js';
import type { LogTimelineStage } from './logs/log-timeline-model.js';

export type RunHeaderContext = Readonly<{ workflow: string; displayId: string; attempt: number; reviewPending?: boolean; timing?: { text: string; title?: string } }>;

export function queueRunHeader(row: QueueSurfaceWire, workflow: string, nowIso: string): RunHeaderContext {
  return { workflow, displayId: runDisplayId(row.runId, row.traceId), attempt: row.attempt, reviewPending: row.status === 'awaiting-approval',
    timing: runTiming(row, nowIso, isTerminalQueueStatus) };
}

/** Header controls navigate to evidence; they never execute the decision. */
export function runHeaderAction(steps: readonly LogStep[], timeline: readonly LogTimelineStage[]): { label: string; stepId: string; entryId?: string } | undefined {
  const visible = visualLogSteps(steps);
  for (const step of visible) {
    const decision = step.entries.find(entry => entry.kind === 'decision' && ['review', 'parked', 'held', 'unconfirmed', 'failed'].includes(entry.decision.state));
    if (decision?.kind === 'decision') return { stepId: step.id, entryId: decision.id, label: decision.decision.state === 'failed' ? 'View failure' : decision.decision.state === 'review' ? 'Review' : 'Resolve' };
  }
  const failure = timeline.find(stage => stage.state === 'failed' && visible.some(step => step.id === stage.stepId));
  return failure?.stepId ? { label: 'View failure', stepId: failure.stepId } : undefined;
}
