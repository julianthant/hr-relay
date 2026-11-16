import { useEffect, useRef, useState } from 'react';
import { systemClock, type Clock } from '../../../rules/time/clock.js';
import { sessionWorkerAuthorityKey, sessionWorkerLifetimeKey, type SessionsViewState } from './sessions-view-model.js';
import type { SessionPreviewOperation, SessionPreviewRequest } from './session-preview-command-model.js';

export const IDLE_REFRESH_MS = 5 * 60_000;
type Deadline = { browserIds: readonly string[]; authorityKey?: string; lifetimeKey?: string; dueAt: number; attempted: boolean; requestId?: string; nativeCommandIds?: readonly string[] };
export type IdleSessionCountdown = Readonly<{ remainingMs: number; waiting: boolean }>;

/** Only idle workers with wholly ready browser sessions can be refreshed. */
export class IdleSessionSchedule {
  private deadlines = new Map<string, Deadline>();
  sync(data: SessionsViewState, now: number, operations: Readonly<Record<string, SessionPreviewOperation>> = {}) {
    const eligible = data.state === 'ready' ? data.workers.filter(worker => worker.state === 'idle' && (worker.authority === undefined
      ? worker.browsers.length > 0 && worker.browsers.every(browser => browser.state === 'ready')
      : worker.authority.browsers.length > 0 && worker.authority.browsers.every(browser => browser.observation?.state === "present" && browser.observation.health === "authenticated")
        && worker.authority.controls?.basis.state === 'present')) : [];
    const ids = new Set(eligible.map(worker => worker.id));
    for (const id of this.deadlines.keys()) if (!ids.has(id)) this.deadlines.delete(id);
    for (const worker of eligible) {
      const browserIds = (worker.authority?.browsers.map(browser => browser.sessionId) ?? worker.browsers.map(browser => browser.id)).sort();
      const authorityKey = worker.authority === undefined ? undefined : sessionWorkerAuthorityKey(worker.authority);
      const lifetimeKey = worker.authority === undefined ? JSON.stringify(browserIds) : sessionWorkerLifetimeKey(worker.authority);
      const operation = operations[worker.id];
      if (operation !== undefined && operation.request.action !== "refresh" && ["pending", "checking", "uncertain"].includes(operation.state)) { this.deadlines.delete(worker.id); continue; }
      const prior = this.deadlines.get(worker.id);
      // The refresh itself moves the member version, so only a new lifetime or browser set ends the wait for its result.
      if (prior?.attempted && prior.lifetimeKey === lifetimeKey && operation !== undefined && operation.request.id === prior.requestId) continue;
      if (operation?.request.action === "refresh" && ["pending", "checking", "uncertain", "refused"].includes(operation.state)) { this.deadlines.delete(worker.id); continue; }
      if (JSON.stringify(prior?.browserIds) !== JSON.stringify(browserIds) || prior?.authorityKey !== authorityKey) this.deadlines.set(worker.id, { browserIds, authorityKey, lifetimeKey, dueAt: now + IDLE_REFRESH_MS, attempted: false });
    }
  }
  due(now: number, blocked: (target: string) => boolean): SessionPreviewRequest[] {
    return [...this.deadlines].flatMap(([target, deadline]) => {
      if (deadline.attempted || deadline.dueAt > now || blocked(target)) return [];
      deadline.attempted = true;
      deadline.requestId = crypto.randomUUID();
      deadline.nativeCommandIds = deadline.browserIds.map((_, index) => index === 0 ? deadline.requestId! : crypto.randomUUID());
      return [{ id: deadline.requestId, nativeCommandIds: deadline.nativeCommandIds, authorityKey: deadline.authorityKey, target, action: 'refresh', browserIds: deadline.browserIds }];
    });
  }
  confirm(request: SessionPreviewRequest, now: number, data?: SessionsViewState) {
    if (request.action !== 'refresh') return;
    const deadline = this.deadlines.get(request.target);
    if (deadline?.attempted && deadline.requestId === request.id && deadline.authorityKey === request.authorityKey && JSON.stringify(deadline.browserIds) === JSON.stringify(request.browserIds)) {
      const worker = data?.state === "ready" ? data.workers.find(worker => worker.id === request.target) : undefined;
      if (worker !== undefined) {
        const browserIds = (worker.authority?.browsers.map(browser => browser.sessionId) ?? worker.browsers.map(browser => browser.id)).sort();
        const ready = worker.authority === undefined ? worker.browsers.every(browser => browser.state === "ready")
          : worker.authority.browsers.every(browser => browser.observation?.state === "present" && browser.observation.health === "authenticated");
        if (worker.state !== "idle" || JSON.stringify(browserIds) !== JSON.stringify(request.browserIds) || !ready
          || worker.authority !== undefined && sessionWorkerLifetimeKey(worker.authority) !== deadline.lifetimeKey) return;
      }
      this.deadlines.set(request.target, { ...deadline, ...(worker?.authority === undefined ? {} : { authorityKey: sessionWorkerAuthorityKey(worker.authority) }), dueAt: now + IDLE_REFRESH_MS, attempted: false });
    }
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
  const operationKey = JSON.stringify(Object.entries(operations).map(([target, operation]) => [target, operation.request.id, operation.request.action, operation.state]));
  useEffect(() => { const now = clock.nowMs(); schedule.current.sync(data, now, latest.current.operations); setCountdowns(schedule.current.view(now)); }, [data, operationKey, clock]);
  useEffect(() => {
    const timer = setInterval(() => {
      const now = clock.nowMs();
      schedule.current.sync(latest.current.data, now, latest.current.operations);
      for (const request of schedule.current.due(now, target => {
        const operation = latest.current.operations[target];
        return operation !== undefined && ['pending', 'checking', 'uncertain', 'refused'].includes(operation.state);
      })) void latest.current.send(request);
      setCountdowns(schedule.current.view(now));
    }, 1000);
    return () => clearInterval(timer);
  }, [clock]);
  return { countdowns, confirmed: (request: SessionPreviewRequest, readback?: SessionsViewState) => { const now = clock.nowMs(); schedule.current.confirm(request, now, readback ?? latest.current.data); } };
}
