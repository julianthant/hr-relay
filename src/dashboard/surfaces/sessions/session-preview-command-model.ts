import type { DashboardClient } from '../../client/index.js';
import type { DashboardDayState } from '../../state/use-dashboard-day.js';
import type { DashboardDayWire } from '../../../models/dashboard/projection.js';
import { CommandRequestSchema, type CommandRequest } from '../../../rules/commands/commands.js';
import { canonicalJsonStringify } from '../../../rules/validation/canonical-json.js';
import { CommandExecutor, type CommandExecutionScope, type CommandExecutionOptions, type CommandOutcome } from '../../app/commands/command-executor.js';
import { createErrorCatalogFailure, formatErrorCatalogFailure } from '../../../models/failures/error-catalog.js';
import { sessionsFromDay } from './sessions-view-model.js';
import { useIdleSessionRefresh } from './session-idle-model.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToasts } from '../../ds/ui.js';
import type { WorkflowCatalogEntry } from '../workflows/workflow-catalog-model.js';
import { sessionWorkerAuthorityKey, type SessionControl, type SessionsViewState } from './sessions-view-model.js';

export type SessionPreviewRequest = Readonly<{ id: string; target: string; action: SessionControl; authorityKey?: string } | { id: string; target: string; action: 'refresh'; browserIds: readonly string[]; nativeCommandIds?: readonly string[]; authorityKey?: string } | { id: string; target: 'add'; action: 'add'; workflow: string; count: number; ordinal: number }>;
export type SessionPreviewResult = Readonly<{ data?: SessionsViewState } & ({ id: string; state: 'confirmed' } | { id: string; state: 'refused'; message: string } | { id: string; state: 'uncertain'; message: string })>;
export type SessionPreviewOperation = Readonly<{ request: SessionPreviewRequest; state: 'pending' | 'checking' | 'confirmed' | 'refused' | 'uncertain'; message: string; diagnostic?: unknown }>;
export interface SessionPreviewCommandPort {
  send(request: SessionPreviewRequest): Promise<SessionPreviewResult>;
  check(request: SessionPreviewRequest): Promise<SessionPreviewResult>;
  /** Member controls the shared executor still holds in flight or uncertain for this scope, so a remounted panel keeps them locked and checkable. */
  retained?(): readonly SessionPreviewOperation[];
  /** The operation once its in-flight attempt settles; undefined when the attempt is gone or belongs to another scope. */
  afterSettled?(request: SessionPreviewRequest): Promise<SessionPreviewOperation | undefined>;
}

export interface SessionCommandBinding {
  readonly client: DashboardClient;
  readonly executor: CommandExecutor;
  readonly scope: CommandExecutionScope;
  readonly dayState: DashboardDayState;
  readonly day: string;
  readonly nowIso: string;
}
type NativeAttempt = { readonly body: string; readonly actor: string; readonly client: DashboardClient; readonly authority: object;
  readonly commands: CommandRequest[]; readonly expected: number; snapshot?: DashboardDayWire; cause?: unknown };
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const commandFeedback = (code: "COMMAND_REFUSED" | "COMMAND_OUTCOME_UNCERTAIN" | "COMMAND_READBACK_MISMATCH" | "COMMAND_RESULT_IDENTITY_MISMATCH" | "DASHBOARD_AUTHORITY_REPLACED") => formatErrorCatalogFailure(createErrorCatalogFailure(code, {})).text;

/** A worker command is confirmed once the served day shows its effect; the member fence makes each effect observable. */
export function sessionCommandEffect(day: DashboardDayWire, request: CommandRequest): boolean {
  if (request.family !== "worker-browser" || day.workerAuthority.state !== "present") return false;
  if (request.type === "plan-worker-count") {
    const pool = day.workerPools.find(pool => pool.workflowId === request.target.workflowId);
    return pool !== undefined && pool.version > request.target.expectedVersion && pool.desiredWorkers === request.payload.desiredWorkers
      && day.workerAuthority.members.filter(member => member.workflow === request.target.workflowId).length === request.payload.desiredWorkers;
  }
  if (request.type === "check-parked-write") return false;
  const card = day.workerCards.find(card => card.workerId === (request.type === "spawn-worker" ? request.payload.workerId : request.target.workerId));
  const lifetimeId = card?.controls?.basis.state === "present" ? card.controls.basis.value.lifetimeId : null;
  switch (request.type) {
    case "remove-worker": return card === undefined;
    case "spawn-worker": return lifetimeId !== null;
    case "retry-worker": case "stop-worker": return lifetimeId !== null && lifetimeId !== request.target.lifetimeId;
    case "pause-worker": return card?.directive === "pause";
    case "resume-worker": return card?.directive === "run";
    case "refresh-browser": case "reopen-browser": return lifetimeId === request.target.lifetimeId;
  }
}

export function createSessionPreviewPort(current: () => Readonly<{ binding?: SessionCommandBinding; catalog: readonly WorkflowCatalogEntry[] }>): SessionPreviewCommandPort {
  const attempts = new Map<string, NativeAttempt>();
  const requireBinding = () => {
    const binding = current().binding;
    if (binding === undefined) throw new Error("SESSION_AUTHORITY_UNAVAILABLE");
    return binding;
  };
  const retainedOperation = (binding: SessionCommandBinding, retained: ReturnType<CommandExecutor["retainedAttempts"]>[number], settled = false): SessionPreviewOperation | undefined => {
    const command = retained.request;
    const open = retained.state === "pending" || retained.outcome?.kind === "uncertain";
    if (!open && !settled || "targets" in command || command.family !== "worker-browser"
      || !["pause-worker", "resume-worker", "retry-worker", "stop-worker", "remove-worker"].includes(command.type) || !("workerId" in command.target)
      || retained.scope.actorId !== binding.scope.actorId || retained.scope.client !== binding.scope.client || retained.scope.authority !== binding.scope.authority) return undefined;
    const request: SessionPreviewRequest = { id: command.commandId, target: command.target.workerId, action: command.type.replace(/-worker$/u, "") as SessionControl };
    if (!attempts.has(request.id)) attempts.set(request.id, { body: JSON.stringify(request), actor: binding.scope.actorId, client: binding.client, authority: binding.scope.authority, commands: [command], expected: 1 });
    const outcome = retained.outcome;
    if (retained.state === "pending" || outcome === undefined) return { request, state: "pending", message: `${label(request)} requested…` };
    if (outcome.kind === "confirmed") return { request, state: "confirmed", message: `${label(request)} confirmed` };
    return { request, state: outcome.kind === "uncertain" ? "uncertain" : "refused", message: outcome.feedback.text };
  };
  const valid = (attempt: NativeAttempt, binding: SessionCommandBinding) => {
    const next = requireBinding();
    return attempt.actor === binding.scope.actorId && attempt.client === binding.client && attempt.authority === binding.scope.authority
      && next.scope === binding.scope && next.client === binding.client;
  };
  const read = async (attempt: NativeAttempt, binding: SessionCommandBinding) => {
    const day = await binding.client.dashboardDay(binding.day);
    if (!valid(attempt, binding)) throw new Error("SESSION_AUTHORITY_REPLACED");
    attempt.snapshot = day;
    return day;
  };
  const options = (attempt: NativeAttempt, binding: SessionCommandBinding): CommandExecutionOptions => ({ scope: binding.scope,
    readback: async (command, reply) => {
      const day = await read(attempt, binding);
      const matched = "state" in reply && (reply.state === "applied" || reply.state === "already-applied") && sessionCommandEffect(day, command);
      return { state: matched ? "matched" : "mismatch", evidence: day };
    },
  });
  const envelope = (id: string, binding: SessionCommandBinding) => ({ commandId: id, family: "worker-browser", requestedAt: binding.nowIso, requestedBy: binding.scope.actorId, source: "dashboard-sessions" });
  const cardFor = (day: DashboardDayWire, request: SessionPreviewRequest) => {
    if (day.workerAuthority.state !== "present") throw new Error("SESSION_AUTHORITY_UNAVAILABLE");
    const card = day.workerCards.find(card => card.workerId === request.target);
    if (card === undefined || card.controls?.basis.state !== "present"
      || request.action !== "add" && request.authorityKey !== undefined && sessionWorkerAuthorityKey(card) !== request.authorityKey) throw new Error("SESSION_MEMBER_CHANGED");
    return card;
  };
  const result = (request: SessionPreviewRequest, attempt: NativeAttempt, outcome?: CommandOutcome): SessionPreviewResult => {
    const all = attempt.commands.length === attempt.expected && attempt.snapshot !== undefined
      && (outcome === undefined || outcome.kind === "confirmed") && attempt.commands.every(command => sessionCommandEffect(attempt.snapshot!, command));
    const data = attempt.snapshot === undefined ? undefined : sessionsFromDay(attempt.snapshot, current().catalog, requireBinding().nowIso);
    return all ? { id: request.id, state: "confirmed", data } : { id: request.id,
      state: attempt.commands.length === 1 && (outcome?.kind === "refused" || outcome?.kind === "conflict" || outcome?.kind === "confirmation-required" || outcome?.kind === "failed") ? "refused" : "uncertain",
      message: outcome !== undefined && outcome.kind !== "confirmed" ? outcome.feedback.text : commandFeedback("COMMAND_OUTCOME_UNCERTAIN"), data };
  };
  return {
    retained() {
      const binding = current().binding;
      return binding === undefined ? [] : binding.executor.retainedAttempts().flatMap(retained => retainedOperation(binding, retained) ?? []);
    },
    async afterSettled(request) {
      const binding = requireBinding();
      await binding.executor.whenSettled(request.id);
      const retained = requireBinding().executor.retainedAttempts().find(attempt => attempt.request.commandId === request.id);
      return retained === undefined ? undefined : retainedOperation(requireBinding(), retained, true);
    },
    async send(request) {
      if (attempts.has(request.id)) throw new Error("SESSION_COMMAND_ALREADY_SUBMITTED");
      const binding = requireBinding();
      if (binding.dayState.day.state !== "loaded") return { id: request.id, state: "refused", message: commandFeedback("COMMAND_REFUSED") };
      const day = binding.dayState.day.value;
      if (day.workerAuthority.state !== "present") return { id: request.id, state: "refused", message: commandFeedback("COMMAND_REFUSED") };
      const attempt: NativeAttempt = { body: JSON.stringify(request), actor: binding.scope.actorId, client: binding.client, authority: binding.scope.authority, commands: [], expected: request.action === "refresh" ? request.browserIds.length : 1 };
      attempts.set(request.id, attempt);
      const dispatch = async (raw: unknown) => {
        if (!valid(attempt, binding)) throw new Error("SESSION_AUTHORITY_REPLACED");
        const command = CommandRequestSchema.parse(raw);
        attempt.commands.push(command);
        return binding.executor.execute(command, options(attempt, binding));
      };
      try {
        if (request.action === "add") {
          // shortcut: partial Add survives mounted reconnects only; full-page recovery needs durable compound identity and explicit continuation.
          if (!Number.isSafeInteger(request.count) || request.count < 1 || !current().catalog.some(flow => flow.id === request.workflow)) throw new Error("SESSION_ADD_INVALID");
          const pool = day.workerPools.find(pool => pool.workflowId === request.workflow);
          const before = day.workerAuthority.members.filter(member => member.workflow === request.workflow).length;
          if (pool === undefined && before !== 0 || pool !== undefined && pool.desiredWorkers !== before || !Number.isSafeInteger((pool?.desiredWorkers ?? 0) + request.count)) throw new Error("SESSION_POOL_UNAVAILABLE");
          // The plan starts every new member itself; a member that fails to start shows on its card.
          return result(request, attempt, await dispatch({ ...envelope(request.id, binding), type: "plan-worker-count", target: { workflowId: request.workflow, expectedVersion: pool?.version ?? 0 }, payload: { desiredWorkers: (pool?.desiredWorkers ?? 0) + request.count } }));
        }
        const card = cardFor(day, request);
        const basis = card.controls!.basis;
        if (basis.state !== "present") throw new Error("SESSION_BASIS_UNAVAILABLE");
        if (request.action === "refresh") {
          const lifetimeId = basis.value.lifetimeId;
          if (lifetimeId === null) throw new Error("SESSION_MEMBER_CHANGED");
          if (card.state !== "idle" || !same(request.browserIds, card.browsers.map(browser => browser.sessionId).sort()) || !card.browsers.every(browser => browser.observation?.state === "present" && browser.observation.health === "authenticated")) throw new Error("SESSION_REFRESH_CHANGED");
          for (const [index, browserSessionId] of request.browserIds.entries()) {
            const latest = index === 0 ? day : attempt.snapshot!;
            const next = latest.workerCards.find(next => next.workerId === card.workerId);
            if (next === undefined || !same(next.member, card.member) || next.controls?.basis.state !== "present" || next.controls.basis.value.lifetimeId !== lifetimeId || next.state !== "idle" || !same(next.browsers.map(browser => browser.sessionId).sort(), request.browserIds)) return result(request, attempt);
            const outcome = await dispatch({ ...envelope(request.nativeCommandIds?.[index] ?? (index === 0 ? request.id : crypto.randomUUID()), binding), type: "refresh-browser", target: { workerId: card.workerId, lifetimeId, expectedVersion: next.controls.basis.value.version, browserSessionId } });
            if (outcome.kind !== "confirmed") return result(request, attempt, outcome);
          }
          return result(request, attempt);
        }
        const target = { workerId: card.workerId, workflowId: card.workflowId, lifetimeId: basis.value.lifetimeId, expectedVersion: basis.value.version };
        return result(request, attempt, await dispatch({ ...envelope(request.id, binding), type: `${request.action}-worker`, target }));
      } catch (cause) {
        attempt.cause = cause;
        return { id: request.id, state: attempt.commands.length === 0 ? "refused" : "uncertain", message: commandFeedback(attempt.commands.length === 0 ? "COMMAND_REFUSED" : "COMMAND_OUTCOME_UNCERTAIN") };
      }
    },
    async check(request) {
      const binding = requireBinding();
      const attempt = attempts.get(request.id);
      if (attempt === undefined || attempt.body !== JSON.stringify(request) || !valid(attempt, binding)) return { id: request.id, state: "uncertain", message: commandFeedback("COMMAND_OUTCOME_UNCERTAIN") };
      try {
        for (const command of attempt.commands) {
          const retained = binding.executor.retainedAttempts().find(attempt => attempt.request.commandId === command.commandId);
          if (retained === undefined) continue;
          if (retained.scope.actorId !== binding.scope.actorId || retained.scope.client !== binding.scope.client || retained.scope.authority !== binding.scope.authority) return { id: request.id, state: "uncertain", message: commandFeedback("COMMAND_OUTCOME_UNCERTAIN") };
          // The audited outcome, read without resending; a command with no audit stays unproved.
          const checked = retained.outcome?.kind === "uncertain";
          const settled = !checked ? retained.outcome : await binding.executor.check(command.commandId, { ...options(attempt, binding), observe: async sent => {
            const record = await binding.client.workerCommandResult(sent.commandId);
            return record.state === "recorded" && canonicalJsonStringify(record.request) === canonicalJsonStringify(sent) ? record.result : undefined;
          } });
          if (settled?.kind === "refused" && settled.reason === undefined) return { id: request.id, state: "refused", message: settled.feedback.text };
          if (settled?.kind !== "confirmed") return { id: request.id, state: "uncertain", message: checked && settled !== undefined ? settled.feedback.text : commandFeedback("COMMAND_OUTCOME_UNCERTAIN") };
        }
        await read(attempt, binding);
        if (!valid(attempt, binding)) return { id: request.id, state: "uncertain", message: commandFeedback("COMMAND_OUTCOME_UNCERTAIN") };
        return result(request, attempt);
      } catch (cause) {
        attempt.cause = cause;
        return { id: request.id, state: "uncertain", message: commandFeedback("COMMAND_OUTCOME_UNCERTAIN") };
      }
    },
  };
}

const label = (request: SessionPreviewRequest) => request.action === 'add' ? 'Workers added' : request.action === 'refresh' ? 'Idle sessions refreshed' : ({ pause: 'Pause', resume: 'Resume', retry: 'Retry', stop: 'Stop', remove: 'Remove' }[request.action]);

export function useSessionPreviewCommands(initial: SessionsViewState, catalog: readonly WorkflowCatalogEntry[], port: SessionPreviewCommandPort, source?: Readonly<{ snapshot: object; scope: object; actorId: string; onRefused?: (problem: string) => void }>) {
  const sourceKey = source?.snapshot ?? port;
  const [readback, setReadback] = useState<{ key: object; data: SessionsViewState }>(() => ({ key: sourceKey, data: initial }));
  const data = readback.key === sourceKey ? readback.data : initial;
  const epoch = useRef<object>({});
  const identity = useRef(source?.scope ?? port);
  if (identity.current !== (source?.scope ?? port)) { identity.current = source?.scope ?? port; epoch.current = {}; }
  const latestSource = useRef(sourceKey); latestSource.current = sourceKey;
  const [operations, setOperations] = useState<Readonly<Record<string, SessionPreviewOperation>>>(() => Object.fromEntries((port.retained?.() ?? []).map(operation => [operation.request.target, operation])));
  const operationsRef = useRef<Record<string, SessionPreviewOperation>>(operations);
  const onRefused = useRef(source?.onRefused); onRefused.current = source?.onRefused;
  const reconciling = useRef(new Set<string>());
  const live = useRef(true);
  const ordinal = useRef(5);
  const idle = useRef<((request: SessionPreviewRequest, data?: SessionsViewState) => void) | undefined>(undefined);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const retain = useCallback((operation: SessionPreviewOperation) => {
    operationsRef.current = { ...operationsRef.current, [operation.request.target]: operation };
    setOperations(operationsRef.current);
  }, []);
  // A control another mount sent is still in flight: follow it to its settled outcome instead of resending.
  useEffect(() => {
    for (const operation of Object.values(operationsRef.current)) {
      if (operation.state !== 'pending') continue;
      void port.afterSettled?.(operation.request).then(next => {
        if (!live.current || operationsRef.current[operation.request.target]?.request.id !== operation.request.id) return;
        retain(next ?? { request: operation.request, state: 'uncertain', message: commandFeedback('COMMAND_OUTCOME_UNCERTAIN') });
      }, (diagnostic: unknown) => {
        if (live.current) retain({ request: operation.request, state: 'uncertain', diagnostic, message: commandFeedback('COMMAND_OUTCOME_UNCERTAIN') });
      });
    }
  }, [port, retain]);
  // Each served-day change re-reads an uncertain control's audited outcome; only a proven outcome releases it, and a refusal toasts once.
  useEffect(() => {
    for (const operation of Object.values(operationsRef.current)) {
      const { request } = operation;
      if (operation.state !== 'uncertain' || reconciling.current.has(request.id)) continue;
      const attemptEpoch = epoch.current;
      reconciling.current.add(request.id);
      void port.check(request).then(result => {
        if (!live.current || attemptEpoch !== epoch.current || result.id !== request.id || result.state === 'uncertain' || operationsRef.current[request.target] !== operation) return;
        const next = { ...operationsRef.current }; delete next[request.target];
        operationsRef.current = next; setOperations(next);
        if (result.state === 'refused') onRefused.current?.(request.action === 'retry' ? "Couldn't restart this worker." : result.message);
      }, () => undefined).finally(() => { reconciling.current.delete(request.id); });
    }
  }, [sourceKey, port]);
    const perform = useCallback(async (request: SessionPreviewRequest, checking = false) => {
    const current = operationsRef.current[request.target];
    if (checking && reconciling.current.has(request.id)) return;
    if (current && ['pending', 'checking'].includes(current.state) || !checking && current?.state === 'uncertain') return;
    retain({ request, state: checking ? 'checking' : 'pending', message: checking ? 'Checking command…' : `${request.action === 'add' ? 'Adding workers' : `${label(request)} requested`}…` });
    const attemptEpoch = epoch.current;
    const snapshot = latestSource.current;
    let result: SessionPreviewResult;
    let diagnostic: unknown;
    try { result = await (checking ? port.check(request) : port.send(request)); }
    catch (cause) { diagnostic = cause; result = { id: request.id, state: 'uncertain', message: commandFeedback('COMMAND_OUTCOME_UNCERTAIN') }; }
    if (!live.current) return;
    if (attemptEpoch !== epoch.current) { diagnostic ??= result; result = { id: request.id, state: 'uncertain', message: commandFeedback('DASHBOARD_AUTHORITY_REPLACED') }; }
    if (!result || !['confirmed', 'refused', 'uncertain'].includes(result.state) || result.state !== 'confirmed' && typeof result.message !== 'string') { diagnostic ??= result; result = { id: request.id, state: 'uncertain', message: commandFeedback('COMMAND_READBACK_MISMATCH') }; }
    if (result.id !== request.id) { diagnostic ??= result; result = { id: request.id, state: 'uncertain', message: commandFeedback('COMMAND_RESULT_IDENTITY_MISMATCH') }; }
    if (result.data !== undefined && snapshot === latestSource.current && attemptEpoch === epoch.current) setReadback({ key: snapshot, data: result.data });
    if (result.state === 'confirmed' && request.action === 'refresh') idle.current?.(request, result.data);
    retain({ request, state: result.state, ...(diagnostic === undefined ? {} : { diagnostic }), message: result.state === 'confirmed' ? request.action === 'add' ? 'Workers added' : `${label(request)} confirmed` : result.message });
  }, [port, retain]);
  const keepAlive = useIdleSessionRefresh(data, operations, perform);
  idle.current = keepAlive.confirmed;
  return { data, operations, idleCountdowns: keepAlive.countdowns,
    control: (target: string, action: SessionControl) => { const worker = data.state === 'ready' ? data.workers.find(item => item.id === target) : undefined; void perform({ id: crypto.randomUUID(), target, action, ...(worker?.authority === undefined ? {} : { authorityKey: sessionWorkerAuthorityKey(worker.authority) }) }); },
    add: (workflow: string, count: number) => {
      if (!Number.isSafeInteger(count) || count < 1 || !catalog.some(item => item.id === workflow)) throw new Error('SESSION_ADD_INVALID');
      const current = operationsRef.current.add;
      if (current && ['pending', 'checking', 'uncertain'].includes(current.state)) return;
      const first = ordinal.current; ordinal.current += count;
      void perform({ id: crypto.randomUUID(), target: 'add', action: 'add', workflow, count, ordinal: first });
    },
    check: (target: string) => { const operation = operationsRef.current[target]; if (operation?.state === 'uncertain') void perform(operation.request, true); },
  };
}

export function useSessionAddFeedback(operation?: SessionPreviewOperation) {
  const { toast, dismiss } = useToasts();
  useEffect(() => {
    if (operation?.state === 'pending') {
      const id = toast({ tone: 'info', title: operation.message, duration: 0 });
      return () => dismiss(id);
    }
    if (operation?.state === 'confirmed') toast({ tone: 'success', title: operation.message });
  }, [operation, toast, dismiss]);
}
