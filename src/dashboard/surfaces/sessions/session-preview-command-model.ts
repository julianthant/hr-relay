import { useIdleSessionRefresh } from './session-idle-model.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkflowCatalogEntry } from '../workflows/workflow-catalog-model.js';
import { previewSessionAdd, previewSessionControl } from './sessions-fixture.js';
import type { SessionControl, SessionsViewState } from './sessions-view-model.js';

export type SessionPreviewRequest = Readonly<{ id: string; target: string; action: SessionControl } | { id: string; target: string; action: 'refresh'; browserIds: readonly string[] } | { id: string; target: 'add'; action: 'add'; workflow: string; count: number; ordinal: number }>;
export type SessionPreviewResult = Readonly<{ id: string; state: 'confirmed' } | { id: string; state: 'refused'; message: string } | { id: string; state: 'uncertain'; message: string }>;
export type SessionPreviewOperation = Readonly<{ request: SessionPreviewRequest; state: 'pending' | 'checking' | 'confirmed' | 'refused' | 'uncertain'; message: string }>;
export interface SessionPreviewCommandPort {
  send(request: SessionPreviewRequest): Promise<SessionPreviewResult>;
  check(request: SessionPreviewRequest): Promise<SessionPreviewResult>;
}

/** Fictional acknowledgment/readback; replace the port, not the component's command lifecycle. */
export function createSessionPreviewPort(scenario: 'normal' | 'refused' | 'uncertain' = 'normal'): SessionPreviewCommandPort {
  const outcomes = new Map<string, SessionPreviewResult>();
  const wait = () => new Promise<void>(resolve => setTimeout(resolve, 600));
  return {
    async send(request) {
      await wait();
      if (outcomes.has(request.id)) throw new Error('SESSION_COMMAND_ALREADY_SUBMITTED');
      const result: SessionPreviewResult = scenario === 'refused' ? { id: request.id, state: 'refused', message: 'Worker control was refused. No change was applied.' } : { id: request.id, state: 'confirmed' };
      outcomes.set(request.id, result);
      return scenario === 'uncertain' ? { id: request.id, state: 'uncertain', message: 'Response unavailable. Check this command before another action.' } : result;
    },
    async check(request) { await wait(); return outcomes.get(request.id) ?? { id: request.id, state: 'uncertain', message: 'This command has no confirmed outcome yet.' }; },
  };
}
const label = (request: SessionPreviewRequest) => request.action === 'add' ? 'Workers added' : request.action === 'refresh' ? 'Idle sessions refreshed' : ({ pause: 'Pause', resume: 'Resume', retry: 'Retry', stop: 'Stop', remove: 'Remove' }[request.action]);

export function useSessionPreviewCommands(initial: SessionsViewState, catalog: readonly WorkflowCatalogEntry[], port: SessionPreviewCommandPort) {
  const [data, setData] = useState(initial);
  const [operations, setOperations] = useState<Readonly<Record<string, SessionPreviewOperation>>>({});
  const operationsRef = useRef<Record<string, SessionPreviewOperation>>({});
  const live = useRef(true);
  const ordinal = useRef(5);
  const idle = useRef<((request: SessionPreviewRequest) => void) | undefined>(undefined);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const retain = (operation: SessionPreviewOperation) => {
    operationsRef.current = { ...operationsRef.current, [operation.request.target]: operation };
    setOperations(operationsRef.current);
  };
  const perform = useCallback(async (request: SessionPreviewRequest, checking = false) => {
    const current = operationsRef.current[request.target];
    if (current && ['pending', 'checking'].includes(current.state) || !checking && current?.state === 'uncertain') return;
    retain({ request, state: checking ? 'checking' : 'pending', message: checking ? 'Checking command…' : `${request.action === 'add' ? 'Adding workers' : `${label(request)} requested`}…` });
    let result: SessionPreviewResult;
    try { result = await (checking ? port.check(request) : port.send(request)); }
    catch { result = { id: request.id, state: 'uncertain', message: 'Response unavailable. Check this command before another action.' }; }
    if (!live.current) return;
    if (!result || !['confirmed', 'refused', 'uncertain'].includes(result.state) || result.state !== 'confirmed' && typeof result.message !== 'string') result = { id: request.id, state: 'uncertain', message: 'The worker response was invalid. Check this command’s outcome.' };
    if (result.id !== request.id) result = { id: request.id, state: 'uncertain', message: 'The response belongs to another command. Check this command’s outcome.' };
    if (result.state === 'confirmed' && request.action !== 'refresh') setData(value => request.action === 'add'
      ? previewSessionAdd(value, catalog, request.workflow, request.count, request.ordinal)
      : previewSessionControl(value, request.target, request.action));
    if (result.state === 'confirmed' && request.action === 'refresh') idle.current?.(request);
    retain({ request, state: result.state, message: result.state === 'confirmed' ? request.action === 'add' ? 'Workers added' : `${label(request)} confirmed` : result.message });
  }, [port, catalog]);
  const keepAlive = useIdleSessionRefresh(data, operations, perform);
  idle.current = keepAlive.confirmed;
  return { data, operations, idleCountdowns: keepAlive.countdowns,
    control: (target: string, action: SessionControl) => { void perform({ id: crypto.randomUUID(), target, action }); },
    add: (workflow: string, count: number) => {
      if (!Number.isSafeInteger(count) || count < 1 || count > 20 || !catalog.some(item => item.id === workflow)) throw new Error('SESSION_ADD_INVALID');
      const current = operationsRef.current.add;
      if (current && ['pending', 'checking', 'uncertain'].includes(current.state)) return;
      const first = ordinal.current; ordinal.current += count;
      void perform({ id: crypto.randomUUID(), target: 'add', action: 'add', workflow, count, ordinal: first });
    },
    check: (target: string) => { const operation = operationsRef.current[target]; if (operation?.state === 'uncertain') void perform(operation.request, true); },
  };
}
