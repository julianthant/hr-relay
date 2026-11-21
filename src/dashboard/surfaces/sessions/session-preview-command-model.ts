import type { DashboardClient } from '../../client/index.js';
import { attemptUnresolved, commandAttemptView } from '../../app/commands/command-outcome.js';
import type { DashboardDayState } from '../../state/use-dashboard-day.js';
import type { DashboardDayWire } from '../../../models/dashboard/projection.js';
import { CommandRequestSchema, CommandResultSchema, type CommandRequest, type DashboardCommandRequest } from '../../../rules/commands/commands.js';
import { canonicalJsonStringify } from '../../../rules/validation/canonical-json.js';
import { CommandExecutor, type CommandExecutionScope, type CommandExecutionOptions, type CommandOutcome } from '../../app/commands/command-executor.js';
import { createErrorCatalogFailure, formatErrorCatalogFailure, type ErrorCatalogCode } from '../../../models/failures/error-catalog.js';
import { sessionsFromDay } from './sessions-view-model.js';
import { useIdleSessionRefresh } from './session-idle-model.js';
import { readBack, withDeadline } from '../../app/commands/command-readback.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToasts } from '../../ds/ui.js';
import type { WorkflowCatalogEntry } from '../workflows/workflow-catalog-model.js';
import { sessionWorkerAuthorityKey, type SessionControl, type SessionsViewState } from './sessions-view-model.js';

export type SessionPreviewRequest = Readonly<{ id: string; target: string; action: SessionControl; authorityKey?: string } | { id: string; target: string; action: 'refresh'; browserIds: readonly string[]; nativeCommandIds?: readonly string[]; authorityKey?: string } | { id: string; target: 'add'; action: 'add'; workflow: string; count: number; ordinal: number }>;
export type SessionPreviewResult = Readonly<{ data?: SessionsViewState } & ({ id: string; state: 'confirmed' } | { id: string; state: 'refused' | 'uncertain'; message: string; code?: ErrorCatalogCode })>;
export type SessionPreviewOperation = Readonly<{ request: SessionPreviewRequest; state: 'pending' | 'confirmed' | 'refused'; message: string; code?: ErrorCatalogCode }>;
export interface SessionPreviewCommandPort {
  send(request: SessionPreviewRequest): Promise<SessionPreviewResult>;
  check(request: SessionPreviewRequest): Promise<SessionPreviewResult>;
  /** Member controls the shared executor still holds in flight or unsettled for this scope, so a remounted panel keeps them locked until they settle. */
  retained?(): readonly SessionPreviewOperation[];
  /** The operation once its in-flight attempt settles; undefined when the attempt is gone or belongs to another scope. */
  afterSettled?(request: SessionPreviewRequest): Promise<SessionPreviewOperation | undefined>;
  /** Frees the controls a read-back could not prove, once any check still in flight has ended, so the next click reaches Relay. */
  abandon?(request: SessionPreviewRequest): Promise<void>;
}

export interface SessionCommandBinding {
  readonly client: DashboardClient;
  readonly executor: CommandExecutor;
  readonly scope: CommandExecutionScope;
  readonly dayState: DashboardDayState;
  readonly day: string;
  readonly nowIso: string;
  /** The selected workflow; switching it clears every pending control. */
  readonly workflowId?: string;
}
type NativeAttempt = { readonly body: string; readonly actor: string; readonly client: DashboardClient; readonly authority: object;
  readonly commands: CommandRequest[]; readonly expected: number; snapshot?: DashboardDayWire; cause?: unknown };
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
// Relay stamps its own requestedAt, requestedBy and source on admission; the audit still proves this command when everything else matches.
const intent = ({ requestedAt: _at, requestedBy: _by, source: _source, ...rest }: DashboardCommandRequest) => canonicalJsonStringify(rest);
const sameIntent = (recorded: DashboardCommandRequest, sent: DashboardCommandRequest) => intent(recorded) === intent(sent);
const commandFeedback = (code: "COMMAND_REFUSED") => formatErrorCatalogFailure(createErrorCatalogFailure(code, {})).text;

/** A worker command is confirmed once the served day shows its effect; the member fence makes each effect observable. */
export function sessionCommandEffect(day: DashboardDayWire, request: DashboardCommandRequest): boolean {
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
    case "remove-worker": return !day.workerAuthority.members.some(member => member.workerId === request.target.workerId);
    case "spawn-worker": return lifetimeId !== null;
    case "retry-worker": case "stop-worker": return lifetimeId !== null && lifetimeId !== request.target.lifetimeId;
    case "pause-worker": return card?.directive === "pause";
    case "resume-worker": return card?.directive === "run";
    case "refresh-browser": case "reopen-browser": return lifetimeId === request.target.lifetimeId;
  }
}

export function createSessionPreviewPort(current: () => Readonly<{ binding?: SessionCommandBinding; catalog: readonly WorkflowCatalogEntry[] }>): SessionPreviewCommandPort {
  const attempts = new Map<string, NativeAttempt>();
  // An attempt keeps the day it read only until it settles; a later check reads again.
  const release = (attempt: NativeAttempt) => { attempt.snapshot = undefined; };
  const requireBinding = () => {
    const binding = current().binding;
    if (binding === undefined) throw new Error("SESSION_AUTHORITY_UNAVAILABLE");
    return binding;
  };
  const retainedOperation = (binding: SessionCommandBinding, retained: ReturnType<CommandExecutor["retainedAttempts"]>[number], settled = false): SessionPreviewOperation | undefined => {
    const command = retained.request;
    const open = attemptUnresolved(retained);
    if (!open && !settled || "targets" in command || command.family !== "worker-browser"
      || !["pause-worker", "resume-worker", "retry-worker", "stop-worker", "remove-worker"].includes(command.type) || !("workerId" in command.target)
      || retained.scope.actorId !== binding.scope.actorId || retained.scope.client !== binding.scope.client || retained.scope.authority !== binding.scope.authority) return undefined;
    const request: SessionPreviewRequest = { id: command.commandId, target: command.target.workerId, action: command.type.replace(/-worker$/u, "") as SessionControl };
    if (!attempts.has(request.id)) attempts.set(request.id, { body: JSON.stringify(request), actor: binding.scope.actorId, client: binding.client, authority: binding.scope.authority, commands: [command], expected: 1 });
    const outcome = retained.outcome;
    if (outcome?.kind === "confirmed") return { request, state: "confirmed", message: `${label(request)} confirmed` };
    // An unknown outcome stays pending until the panel reads it back.
    if (retained.state === "pending" || outcome === undefined || commandAttemptView(outcome).view === "unknown") return { request, state: "pending", message: `${label(request)} requested…` };
    return { request, state: "refused", message: outcome.feedback.text, code: outcome.feedback.code };
  };
  const valid = (attempt: NativeAttempt, binding: SessionCommandBinding) => {
    const next = requireBinding();
    return attempt.actor === binding.scope.actorId && attempt.client === binding.client && attempt.authority === binding.scope.authority
      && next.scope === binding.scope && next.client === binding.client;
  };
  const read = async (attempt: NativeAttempt, binding: SessionCommandBinding) => {
    // Every Sessions read ends at a deadline, so a stalled Day or audit read leaves an unknown the panel can settle.
    const day = await withDeadline(binding.client.dashboardDay(binding.day));
    if (!valid(attempt, binding)) throw new Error("SESSION_AUTHORITY_REPLACED");
    attempt.snapshot = day;
    return day;
  };
  const options = (attempt: NativeAttempt, binding: SessionCommandBinding): CommandExecutionOptions => ({ scope: binding.scope,
    readback: async (command, reply) => {
      const day = await read(attempt, binding);
      const matched = "state" in reply && (reply.state === "applied" || reply.state === "already-applied") && sessionCommandEffect(day, command);
      return { state: matched ? "matched" : "mismatch", evidence: day.day };
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
    const snapshot = attempt.snapshot;
    const all = attempt.commands.length === attempt.expected && snapshot !== undefined
      && (outcome === undefined || outcome.kind === "confirmed") && attempt.commands.every(command => sessionCommandEffect(snapshot, command));
    const data = snapshot === undefined ? undefined : sessionsFromDay(snapshot, current().catalog, requireBinding().nowIso);
    return all ? { id: request.id, state: "confirmed", data } : { id: request.id,
      state: attempt.commands.length === 1 && outcome !== undefined && outcome.kind !== "confirmed" && commandAttemptView(outcome).view !== "unknown" ? "refused" : "uncertain",
      code: outcome !== undefined && outcome.kind !== "confirmed" ? outcome.feedback.code : undefined,
      message: outcome !== undefined && outcome.kind !== "confirmed" ? outcome.feedback.text : FAILED[request.action], data };
  };
  const port: SessionPreviewCommandPort = {
    async abandon(request) {
      const binding = current().binding;
      for (const command of attempts.get(request.id)?.commands ?? []) {
        await binding?.executor.whenSettled(command.commandId);
        binding?.executor.resolve(command.commandId, false, binding.scope);
      }
    },
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
            const latestDay = index === 0 ? day : attempt.snapshot;
            const next = latestDay?.workerCards.find(next => next.workerId === card.workerId);
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
        return { id: request.id, state: attempt.commands.length === 0 ? "refused" : "uncertain", message: attempt.commands.length === 0 ? commandFeedback("COMMAND_REFUSED") : FAILED[request.action] };
      } finally { release(attempt); }
    },
    async check(request) {
      const binding = requireBinding();
      const attempt = attempts.get(request.id);
      if (attempt === undefined || attempt.body !== JSON.stringify(request) || !valid(attempt, binding)) return { id: request.id, state: "uncertain", message: FAILED[request.action] };
      try {
        for (const command of attempt.commands) {
          const retained = binding.executor.retainedAttempts().find(attempt => attempt.request.commandId === command.commandId);
          if (retained === undefined) continue;
          if (retained.scope.actorId !== binding.scope.actorId || retained.scope.client !== binding.scope.client || retained.scope.authority !== binding.scope.authority) return { id: request.id, state: "uncertain", message: FAILED[request.action] };
          // The audited outcome, read without resending; a missing or foreign audit leaves the command unproved, whatever the workers show.
          const checked = retained.outcome !== undefined && commandAttemptView(retained.outcome).view === "unknown";
          const reply = checked ? CommandResultSchema.safeParse(retained.outcome?.reply) : undefined;
          const settled = !checked ? retained.outcome : await binding.executor.check(command.commandId, { ...options(attempt, binding), observe: async sent => {
            // The command's own applied reply still proves it; a lost or unapplied reply falls back to the audit.
            if (reply?.success && (reply.data.state === "applied" || reply.data.state === "already-applied")) return reply.data;
            const record = await withDeadline(binding.client.workerCommandResult(sent.commandId));
            return record.state === "recorded" && sameIntent(record.request, sent) ? record.result : undefined;
          } });
          if (settled?.kind === "refused" && settled.reason === undefined) return { id: request.id, state: "refused", message: settled.feedback.text, code: settled.feedback.code };
          if (settled?.kind !== "confirmed") return { id: request.id, state: "uncertain", message: FAILED[request.action] };
        }
        await read(attempt, binding);
        if (!valid(attempt, binding)) return { id: request.id, state: "uncertain", message: FAILED[request.action] };
        return result(request, attempt);
      } catch (cause) {
        attempt.cause = cause;
        return { id: request.id, state: "uncertain", message: FAILED[request.action] };
      } finally { release(attempt); }
    },
  };
  return port;
}

/** One short line when a control could not be confirmed after reading back. */
const FAILED: Readonly<Record<SessionPreviewRequest['action'], string>> = { add: "Workers weren't added.", refresh: "Couldn't refresh the sessions.",
  pause: "Couldn't pause this worker.", resume: "Couldn't resume this worker.", retry: "Couldn't restart this worker.", stop: "Couldn't stop this worker.", remove: "Couldn't remove this worker." };
const label = (request: SessionPreviewRequest) => request.action === 'add' ? 'Workers added' : request.action === 'refresh' ? 'Idle sessions refreshed' : ({ pause: 'Pause', resume: 'Resume', retry: 'Retry', stop: 'Stop', remove: 'Remove' }[request.action]);

export function useSessionPreviewCommands(initial: SessionsViewState, catalog: readonly WorkflowCatalogEntry[], port: SessionPreviewCommandPort, source?: Readonly<{ snapshot: object; scope: object; actorId: string; onRefused?: (problem: string) => void }>) {
  const sourceKey = source?.snapshot ?? port;
  const [readback, setReadback] = useState<{ key: object; data: SessionsViewState; removed: readonly string[] }>(() => ({ key: sourceKey, data: initial, removed: [] }));
  const data = readback.key === sourceKey ? readback.data : initial;
  const epoch = useRef<object>({});
  const identity = useRef(source?.scope ?? port);
  const scopeChanged = identity.current !== (source?.scope ?? port);
  if (scopeChanged) { identity.current = source?.scope ?? port; epoch.current = {}; }
  const latestSource = useRef(sourceKey); latestSource.current = sourceKey;
  const [operations, setOperations] = useState<Readonly<Record<string, SessionPreviewOperation>>>(() => Object.fromEntries((port.retained?.() ?? []).map(operation => [operation.request.target, operation])));
  const operationsRef = useRef<Record<string, SessionPreviewOperation>>(operations);
  // Another day, sign-in or workflow leaves nothing pending behind, even while a reply or read is outstanding.
  if (scopeChanged && Object.keys(operationsRef.current).length > 0) { operationsRef.current = {}; setOperations(operationsRef.current); }
  const onRefused = useRef(source?.onRefused); onRefused.current = source?.onRefused;
  const live = useRef(true);
  const ordinal = useRef(5);
  const idle = useRef<((request: SessionPreviewRequest, data?: SessionsViewState) => void) | undefined>(undefined);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const retain = useCallback((operation: SessionPreviewOperation) => {
    operationsRef.current = { ...operationsRef.current, [operation.request.target]: operation };
    setOperations(operationsRef.current);
  }, []);
  const acceptReadback = useCallback((key: object, request: SessionPreviewRequest, result: SessionPreviewResult) => {
    const data = result.data;
    if (data === undefined || key !== latestSource.current) return;
    setReadback(previous => {
      const knownRemoved = previous.key === key ? previous.removed : [];
      const removed = request.action === "remove" && result.state === "confirmed" ? [...knownRemoved, request.target] : knownRemoved;
      return { key, removed, data: data.state === "ready" && removed.length > 0
        ? { ...data, workers: data.workers.filter(worker => !removed.includes(worker.id)) } : data };
    });
  }, []);
  const drop = useCallback((request: SessionPreviewRequest) => {
    if (operationsRef.current[request.target]?.request.id !== request.id) return;
    const next = { ...operationsRef.current }; delete next[request.target];
    operationsRef.current = next; setOperations(next);
  }, []);
  // Settles one control: the confirmed result, or the previous state with one short failure toast. Nothing waits on the operator.
  const settle = useCallback(async (request: SessionPreviewRequest, sent: SessionPreviewResult | undefined, attemptEpoch: object, snapshot: object) => {
    const proves = (result: SessionPreviewResult | undefined): result is SessionPreviewResult => result !== undefined && result.id === request.id
      && (result.state === 'confirmed' || result.state === 'refused' && typeof result.message === 'string');
    const answered = proves(sent);
    // A lost, malformed or foreign reply is read back from the served workers, never shown.
    const read = answered ? sent : await readBack(() => port.check(request), proves);
    if (!proves(read)) await port.abandon?.(request).catch(() => undefined);
    if (!live.current || operationsRef.current[request.target]?.request.id !== request.id) return;
    // A changed scope (another day or sign-in) leaves nothing pending behind.
    if (attemptEpoch !== epoch.current) { drop(request); return; }
    const proven = proves(read) ? read : undefined;
    if (proven !== undefined) acceptReadback(snapshot, request, proven);
    if (proven?.state === 'confirmed') {
      if (request.action === 'refresh') idle.current?.(request, proven.data);
      // A result found only by reading back shows as the new state alone, with no note or toast.
      if (answered) retain({ request, state: 'confirmed', message: request.action === 'add' ? 'Workers added' : `${label(request)} confirmed` });
      else drop(request);
      return;
    }
    // A refusal the send itself returned keeps its note; one found on read-back is a toast.
    if (proven?.state === 'refused' && answered) { retain({ request, state: 'refused', message: proven.message, code: proven.code }); return; }
    drop(request);
    onRefused.current?.(proven === undefined || request.action === 'retry' ? FAILED[request.action] : proven.message);
  }, [port, acceptReadback, retain, drop]);
  // A control another mount sent is still in flight: follow it to its settled outcome instead of resending.
  useEffect(() => {
    for (const operation of Object.values(operationsRef.current)) {
      if (operation.state !== 'pending') continue;
      const attemptEpoch = epoch.current;
      void (port.afterSettled?.(operation.request) ?? Promise.resolve(undefined)).catch(() => undefined).then(next => {
        if (!live.current || operationsRef.current[operation.request.target]?.request.id !== operation.request.id) return;
        if (next?.state === 'confirmed' || next?.state === 'refused') { retain(next); return; }
        void settle(operation.request, undefined, attemptEpoch, latestSource.current);
      });
    }
  }, [port, retain, settle]);
  const perform = useCallback(async (request: SessionPreviewRequest) => {
    if (operationsRef.current[request.target]?.state === 'pending') return;
    retain({ request, state: 'pending', message: `${request.action === 'add' ? 'Adding workers' : `${label(request)} requested`}…` });
    const attemptEpoch = epoch.current;
    const snapshot = latestSource.current;
    let result: SessionPreviewResult | undefined;
    try { result = await port.send(request); } catch { result = undefined; }
    await settle(request, result, attemptEpoch, snapshot);
  }, [port, retain, settle]);
  const keepAlive = useIdleSessionRefresh(data, operations, perform);
  idle.current = keepAlive.confirmed;
  return { data, operations, idleCountdowns: keepAlive.countdowns,
    control: (target: string, action: SessionControl) => { if (data.state === 'ready' && data.stale) return; const worker = data.state === 'ready' ? data.workers.find(item => item.id === target) : undefined; void perform({ id: crypto.randomUUID(), target, action, ...(worker?.authority === undefined ? {} : { authorityKey: sessionWorkerAuthorityKey(worker.authority) }) }); },
    add: (workflow: string, count: number) => {
      if (data.state === 'ready' && data.stale) return;
      if (!Number.isSafeInteger(count) || count < 1 || !catalog.some(item => item.id === workflow)) throw new Error('SESSION_ADD_INVALID');
      const current = operationsRef.current.add;
      if (current?.state === 'pending') return;
      const first = ordinal.current; ordinal.current += count;
      void perform({ id: crypto.randomUUID(), target: 'add', action: 'add', workflow, count, ordinal: first });
    },
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
    if (operation?.state === 'refused') toast({ tone: 'danger', title: "Couldn't add workers", description: operation.message, duration: 6000 });
  }, [operation, toast, dismiss]);
}
