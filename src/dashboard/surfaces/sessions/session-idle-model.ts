import { useEffect, useRef, useState } from 'react';
import { systemClock, type Clock } from '../../../rules/time/clock.js';
import type { SessionsViewState } from './sessions-view-model.js';
import type { SessionPreviewOperation, SessionPreviewRequest } from './session-preview-command-model.js';

export const IDLE_REFRESH_MS = 5 * 60_000;
type Deadline = { browserIds: readonly string[]; dueAt: number; attempted: boolean };
export type IdleSessionCountdown = Readonly<{ remainingMs: number; waiting: boolean }>;

/** Only idle workers with wholly ready browser sessions can be refreshed. */
export class IdleSessionSchedule {
  private deadlines = new Map<string, Deadline>();
  sync(data: SessionsViewState, now: number) {
    const eligible = data.state === 'ready' ? data.workers.filter(worker => worker.state === 'idle' && worker.browsers.length > 0 && worker.browsers.every(browser => browser.state === 'ready')) : [];
    const ids = new Set(eligible.map(worker => worker.id));
    for (const id of this.deadlines.keys()) if (!ids.has(id)) this.deadlines.delete(id);
    for (const worker of eligible) {
      const browserIds = worker.browsers.map(browser => browser.id).sort();
      if (JSON.stringify(this.deadlines.get(worker.id)?.browserIds) !== JSON.stringify(browserIds)) this.deadlines.set(worker.id, { browserIds, dueAt: now + IDLE_REFRESH_MS, attempted: false });
    }
  }
  due(now: number, blocked: (target: string) => boolean): SessionPreviewRequest[] {
    return [...this.deadlines].flatMap(([target, deadline]) => {
      if (deadline.attempted || deadline.dueAt > now || blocked(target)) return [];
      deadline.attempted = true;
      return [{ id: crypto.randomUUID(), target, action: 'refresh', browserIds: deadline.browserIds }];
    });
  }
  confirm(request: SessionPreviewRequest, now: number) {
    if (request.action !== 'refresh') return;
    const deadline = this.deadlines.get(request.target);
    if (deadline?.attempted && JSON.stringify(deadline.browserIds) === JSON.stringify(request.browserIds)) this.deadlines.set(request.target, { ...deadline, dueAt: now + IDLE_REFRESH_MS, attempted: false });
  }
  view(now: number): Readonly<Record<string, IdleSessionCountdown>> {
    return Object.fromEntries([...this.deadlines].map(([id, deadline]) => [id, { remainingMs: Math.max(0, deadline.dueAt - now), waiting: deadline.attempted }]));
  }
}

export function useIdleSessionRefresh(data: SessionsViewState, operations: Readonly<Record<string, SessionPreviewOperation>>, send: (request: SessionPreviewRequest) => Promise<void>, clock: Clock = systemClock) {
  const schedule = useRef(new IdleSessionSchedule());
  const latest = useRef({ data, operations, send });
  const [countdowns, setCountdowns] = useState<Readonly<Record<string, IdleSessionCountdown>>>({});
  useEffect(() => { latest.current = { data, operations, send }; }, [data, operations, send]);
  // Only new session data changes deadlines; callback or operation identity alone must not re-render the countdown.
  useEffect(() => { const now = clock.nowMs(); schedule.current.sync(data, now); setCountdowns(schedule.current.view(now)); }, [data, clock]);
  useEffect(() => {
    const timer = setInterval(() => {
      const now = clock.nowMs();
      schedule.current.sync(latest.current.data, now);
      for (const request of schedule.current.due(now, target => {
        const operation = latest.current.operations[target];
        return operation !== undefined && ['pending', 'checking', 'uncertain'].includes(operation.state);
      })) void latest.current.send(request);
      setCountdowns(schedule.current.view(now));
    }, 1000);
    return () => clearInterval(timer);
  }, [clock]);
  return { countdowns, confirmed: (request: SessionPreviewRequest) => { const now = clock.nowMs(); schedule.current.sync(latest.current.data, now); schedule.current.confirm(request, now); } };
}
