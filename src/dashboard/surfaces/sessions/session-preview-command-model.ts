import { LOCAL_OPERATOR_ACTOR_ID } from "../../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { checkedCommandResult } from "../../client/commands/shared-commands.js";
import { workerPoolMember } from "../../../models/run/worker-slot.js";
import type { DashboardClient } from '../../client/index.js';
import type { DashboardDayState } from '../../state/use-dashboard-day.js';
import type { DashboardDayWire } from '../../../models/dashboard/projection.js';
import { CommandRequestSchema, type CommandRequest, type CommandResult } from '../../../rules/commands/commands.js';
import { CommandExecutor, type CommandExecutionScope, type CommandExecutionOptions, type CommandOutcome } from '../../app/commands/command-executor.js';
import { createErrorCatalogFailure, formatErrorCatalogFailure } from '../../../models/failures/error-catalog.js';
import { sessionsFromDay } from './sessions-view-model.js';
import { useIdleSessionRefresh } from './session-idle-model.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkflowCatalogEntry } from '../workflows/workflow-catalog-model.js';
import { sessionWorkerAuthorityKey, type SessionControl, type SessionsViewState } from './sessions-view-model.js';

export type SessionPreviewRequest = Readonly<{ id: string; target: string; action: SessionControl; authorityKey?: string } | { id: string; target: string; action: 'refresh'; browserIds: readonly string[]; nativeCommandIds?: readonly string[]; authorityKey?: string } | { id: string; target: 'add'; action: 'add'; workflow: string; count: number; ordinal: number }>;
export type SessionPreviewResult = Readonly<{ data?: SessionsViewState } & ({ id: string; state: 'confirmed' } | { id: string; state: 'refused'; message: string } | { id: string; state: 'uncertain'; message: string })>;
export type SessionPreviewOperation = Readonly<{ request: SessionPreviewRequest; state: 'pending' | 'checking' | 'confirmed' | 'refused' | 'uncertain'; message: string; diagnostic?: unknown }>;
export interface SessionPreviewCommandPort {
  send(request: SessionPreviewRequest): Promise<SessionPreviewResult>;
  check(request: SessionPreviewRequest): Promise<SessionPreviewResult>;
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

function commandIntent(request: CommandRequest) {
  const { requestedAt: _requestedAt, requestedBy: _requestedBy, source: _source, ...intent } = request;
  return canonicalJsonStringify(intent);
}

/** Native readback is immutable operation evidence, independent of the worker's newest phase. */
export function sessionCommandApplication(day: DashboardDayWire, request: CommandRequest): CommandResult | undefined {
  const record = day.workerOperations.find(operation => operation.commandId === request.commandId);
  if (record === undefined || request.requestedBy !== LOCAL_OPERATOR_ACTOR_ID || record.request.requestedBy !== LOCAL_OPERATOR_ACTOR_ID
    || commandIntent(record.request) !== commandIntent(request) || record.auditedAt === undefined || record.phase.state !== "succeeded") return undefined;
  const ack = record.phase.acknowledgement;
  if (request.type === "stop-worker" && (record.reset === undefined || ack.kind !== "reset" && ack.kind !== "reset-replacement")) return undefined;
  if (request.type === "remove-worker" && (record.lifecycle?.operation.kind !== "remove" || ack.kind !== "remove")) return undefined;
  if (request.type === "retry-worker" && (record.lifecycle?.operation.kind !== "retry" || ack.kind !== "retry")) return undefined;
  if (request.type === "plan-worker-count" && (record.roster === undefined || ack.kind !== "plan")) return undefined;
  if (["pause-worker", "resume-worker", "spawn-worker", "refresh-browser"].includes(request.type) && ack.kind !== "control") return undefined;
  if (request.type === "refresh-browser" && request.family === "worker-browser" && request.type === record.request.type
    && (ack.kind !== "control" || ack.browserSessionId !== request.target.browserSessionId)) return undefined;
  if (record.phase.application === undefined) return undefined;
  if (request.type === "plan-worker-count" && request.family === "worker-browser" && ack.kind === "plan") {
    const applied = record.phase.application.result;
    if (applied.state !== "applied" && applied.state !== "already-applied") return undefined;
    const pools = applied.affectedTargets.filter(target => target.family === "worker-pool");
    const workers = applied.affectedTargets.filter(target => target.family === "worker-browser");
    if (pools.length !== 1 || pools[0]?.workflowId !== request.target.workflowId
      || applied.affectedTargets.length !== workers.length + 1 || !same(workers.map(target => target.workerId).sort(), [...ack.workerIds].sort())) return undefined;
  }
  return checkedCommandResult(request, record.phase.application.result);
}

export function createSessionPreviewPort(current: () => Readonly<{ binding?: SessionCommandBinding; catalog: readonly WorkflowCatalogEntry[] }>): SessionPreviewCommandPort {
  const attempts = new Map<string, NativeAttempt>();
  const requireBinding = () => {
    const binding = current().binding;
    if (binding === undefined) throw new Error("SESSION_AUTHORITY_UNAVAILABLE");
    return binding;
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
      const native = sessionCommandApplication(day, command);
      const matched = native !== undefined && "state" in reply && (reply.state === "applied" || reply.state === "already-applied")
        && same({ ...native, state: "applied" }, { ...reply, state: "applied" });
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
      && (outcome === undefined || outcome.kind === "confirmed") && attempt.commands.every(command => sessionCommandApplication(attempt.snapshot!, command) !== undefined);
    const data = attempt.snapshot === undefined ? undefined : sessionsFromDay(attempt.snapshot, current().catalog, requireBinding().nowIso);
    return all ? { id: request.id, state: "confirmed", data } : { id: request.id,
      state: attempt.commands.length === 1 && (outcome?.kind === "refused" || outcome?.kind === "conflict" || outcome?.kind === "confirmation-required" || outcome?.kind === "failed") ? "refused" : "uncertain",
      message: outcome !== undefined && outcome.kind !== "confirmed" ? outcome.feedback.text : commandFeedback("COMMAND_OUTCOME_UNCERTAIN"), data };
  };
  return {
    async send(request) {
      if (attempts.has(request.id)) throw new Error("SESSION_COMMAND_ALREADY_SUBMITTED");
      const binding = requireBinding();
      if (binding.dayState.day.state !== "loaded") return { id: request.id, state: "refused", message: commandFeedback("COMMAND_REFUSED") };
      const day = binding.dayState.day.value;
      if (day.workerAuthority.state !== "present") return { id: request.id, state: "refused", message: commandFeedback("COMMAND_REFUSED") };
      const attempt: NativeAttempt = { body: JSON.stringify(request), actor: binding.scope.actorId, client: binding.client, authority: binding.scope.authority, commands: [], expected: request.action === "add" ? request.count + 1 : request.action === "refresh" ? request.browserIds.length : 1 };
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
          const before = day.workerAuthority.members.filter(member => member.workflow === request.workflow).map(workerPoolMember);
          if (pool === undefined && before.length !== 0 || pool !== undefined && pool.desiredWorkers !== before.length || !Number.isSafeInteger((pool?.desiredWorkers ?? 0) + request.count)) throw new Error("SESSION_POOL_UNAVAILABLE");
          const outcome = await dispatch({ ...envelope(request.id, binding), type: "plan-worker-count", target: { workflowId: request.workflow, expectedVersion: pool?.version ?? 0 }, payload: { desiredWorkers: (pool?.desiredWorkers ?? 0) + request.count } });
          if (outcome.kind !== "confirmed") return result(request, attempt, outcome);
          const snapshot = attempt.snapshot!;
          const record = snapshot.workerOperations.find(record => record.commandId === request.id)!;
          const selected = record.roster?.selected.filter(member => !before.some(old => same(old, workerPoolMember(member))));
          if (selected === undefined || selected.length !== request.count || before.some(old => !record.roster?.selected.some(member => same(old, workerPoolMember(member))))) return result(request, attempt);
          const afterPool = snapshot.workerPools.find(pool => pool.workflowId === request.workflow);
          const afterMembers = snapshot.workerAuthority.members.filter(slot => slot.workflow === request.workflow).map(workerPoolMember);
          if (afterPool === undefined || afterPool.version !== record.roster?.afterVersion || afterPool.desiredWorkers !== before.length + request.count
            || !same(afterMembers.map(member => JSON.stringify(member)).sort(), record.roster.selected.map(slot => JSON.stringify(workerPoolMember(slot))).sort())) return result(request, attempt);
          const spawns = selected.map(member => ({ ...envelope(crypto.randomUUID(), binding), type: "spawn-worker", target: { workflowId: request.workflow, expectedVersion: afterPool.version }, payload: { workerId: member.workerId } }));
          for (const spawn of spawns) {
            const outcome = await dispatch(spawn);
            if (outcome.kind !== "confirmed") return result(request, attempt, outcome);
          }
          return result(request, attempt);
        }
        const card = cardFor(day, request);
        const basis = card.controls!.basis;
        if (basis.state !== "present") throw new Error("SESSION_BASIS_UNAVAILABLE");
        if (!["stop", "retry"].includes(request.action) && card.controls!.ownership.state !== "owned") throw new Error("SESSION_OWNER_UNAVAILABLE");
        if (request.action === "refresh") {
          if (card.state !== "idle" || !same(request.browserIds, card.browsers.map(browser => browser.sessionId).sort()) || !card.browsers.every(browser => browser.observation?.state === "present" && browser.observation.health === "authenticated")) throw new Error("SESSION_REFRESH_CHANGED");
          for (const [index, browserSessionId] of request.browserIds.entries()) {
            const latest = index === 0 ? day : attempt.snapshot!;
            const next = latest.workerCards.find(next => next.workerId === card.workerId);
            if (next === undefined || !same(next.member, card.member) || next.controls?.basis.state !== "present" || next.controls.basis.value.leaseGeneration !== basis.value.leaseGeneration || next.state !== "idle" || !same(next.browsers.map(browser => browser.sessionId).sort(), request.browserIds)) return result(request, attempt);
            const outcome = await dispatch({ ...envelope(request.nativeCommandIds?.[index] ?? (index === 0 ? request.id : crypto.randomUUID()), binding), type: "refresh-browser", target: { workerId: card.workerId, browserSessionId, expectedVersion: next.leaseVersion, controlBasis: next.controls.basis.value } });
            if (outcome.kind !== "confirmed") return result(request, attempt, outcome);
          }
          return result(request, attempt);
        }
        const pool = day.workerPools.find(pool => pool.workflowId === card.workflowId);
        const target = request.action === "remove" || request.action === "retry" ? { workerId: card.workerId, workflowId: card.workflowId, membershipRevision: card.member.membershipRevision, expectedVersion: pool?.version, controlBasis: basis.value }
          : { workerId: card.workerId, expectedVersion: card.leaseVersion, controlBasis: basis.value, ...(request.action === "stop" ? { membershipRevision: card.member.membershipRevision } : {}) };
        return result(request, attempt, await dispatch({ ...envelope(request.id, binding), type: `${request.action}-worker`, target }));
      } catch (cause) {
        attempt.cause = cause;
        return { id: request.id, state: attempt.commands.length === 0 ? "refused" : "uncertain", message: commandFeedback(attempt.commands.length === 0 ? "COMMAND_REFUSED" : "COMMAND_OUTCOME_UNCERTAIN") };
      }
    },
    async check(request) {
      const binding = requireBinding();
      let attempt = attempts.get(request.id);
      if (attempt === undefined && request.action !== "add" && binding.dayState.day.state === "loaded") {
        const record = binding.dayState.day.value.workerOperations.find(record => record.commandId === request.id);
        if (record !== undefined && record.request.requestedBy === binding.scope.actorId && "workerId" in record.request.target
          && record.request.target.workerId === request.target && (request.action === "refresh" ? record.request.type === "refresh-browser" && same(request.browserIds, [record.request.target.browserSessionId]) : record.request.type === `${request.action}-worker`)) {
          attempt = { body: JSON.stringify(request), actor: binding.scope.actorId, client: binding.client, authority: binding.scope.authority, commands: [record.request], expected: 1 };
          attempts.set(request.id, attempt);
        }
      }
      if (attempt === undefined || attempt.body !== JSON.stringify(request) || !valid(attempt, binding)) return { id: request.id, state: "uncertain", message: commandFeedback("COMMAND_OUTCOME_UNCERTAIN") };
      try {
        const day = await read(attempt, binding);
        for (const command of attempt.commands) {
          const retained = binding.executor.retainedAttempts().find(attempt => attempt.request.commandId === command.commandId);
          if (retained !== undefined) {
            if (retained.scope.actorId !== binding.scope.actorId || retained.scope.client !== binding.scope.client || retained.scope.authority !== binding.scope.authority) return { id: request.id, state: "uncertain", message: commandFeedback("COMMAND_OUTCOME_UNCERTAIN") };
            if (retained.outcome?.kind === "uncertain") {
              const outcome = await binding.executor.check(command.commandId, { ...options(attempt, binding), observe: async () => sessionCommandApplication(day, command) });
              if (outcome.kind !== "confirmed") return { id: request.id, state: "uncertain", message: outcome.feedback.text };
            } else if (retained.outcome?.kind !== "confirmed") return { id: request.id, state: "uncertain", message: commandFeedback("COMMAND_OUTCOME_UNCERTAIN") };
          }
        }
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

export function useSessionPreviewCommands(initial: SessionsViewState, catalog: readonly WorkflowCatalogEntry[], port: SessionPreviewCommandPort, source?: Readonly<{ snapshot: object; scope: object; actorId: string; records?: DashboardDayWire["workerOperations"] }>) {
  const sourceKey = source?.snapshot ?? port;
  const [readback, setReadback] = useState<{ key: object; data: SessionsViewState }>(() => ({ key: sourceKey, data: initial }));
  const data = readback.key === sourceKey ? readback.data : initial;
  const epoch = useRef<object>({});
  const identity = useRef(source?.scope ?? port);
  if (identity.current !== (source?.scope ?? port)) { identity.current = source?.scope ?? port; epoch.current = {}; }
  const latestSource = useRef(sourceKey); latestSource.current = sourceKey;
  const [operations, setOperations] = useState<Readonly<Record<string, SessionPreviewOperation>>>({});
  const operationsRef = useRef<Record<string, SessionPreviewOperation>>({});
  const live = useRef(true);
  const ordinal = useRef(5);
  const idle = useRef<((request: SessionPreviewRequest, data?: SessionsViewState) => void) | undefined>(undefined);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const retain = useCallback((operation: SessionPreviewOperation) => {
    operationsRef.current = { ...operationsRef.current, [operation.request.target]: operation };
    setOperations(operationsRef.current);
  }, []);
  useEffect(() => {
    for (const record of source?.records ?? []) {
      if (record.auditedAt !== undefined || record.request.requestedBy !== source?.actorId || !("workerId" in record.request.target)) continue;
      const actions: Readonly<Record<string, SessionControl | "refresh" | undefined>> = { "stop-worker": "stop", "remove-worker": "remove", "retry-worker": "retry", "pause-worker": "pause", "resume-worker": "resume", "refresh-browser": "refresh" };
      const action = actions[record.request.type];
      const prior = operationsRef.current[record.request.target.workerId];
      if (action === undefined || prior?.request.id === record.commandId || prior !== undefined && ["pending", "checking", "uncertain"].includes(prior.state)) continue;
      let request: SessionPreviewRequest;
      if (action === "refresh") {
        if (record.request.type !== "refresh-browser") continue;
        request = { id: record.commandId, target: record.request.target.workerId, action, browserIds: [record.request.target.browserSessionId], nativeCommandIds: [record.commandId] };
      } else request = { id: record.commandId, target: record.request.target.workerId, action };
      retain({ request, state: "uncertain", message: commandFeedback("COMMAND_OUTCOME_UNCERTAIN") });
    }
  }, [source?.records, source?.actorId, retain]);
  const perform = useCallback(async (request: SessionPreviewRequest, checking = false) => {
    const current = operationsRef.current[request.target];
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
