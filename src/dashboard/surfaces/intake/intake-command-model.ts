import type { z } from "zod";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IntakeSessionWire } from "../../../models/intake/wire.js";
import { deriveMappingSnapshotHash } from "../../../models/intake/mapping.js";
import { IntakeSessionWireSchema } from "../../../models/intake/wire.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { IntakeCommandRequestSchema, type CommandRequest, type CommandResult, type BulkRunCommandOutcome } from "../../../rules/commands/commands.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../models/failures/error-catalog.js";
import type { DashboardClient } from "../../client/index.js";
import type { CommandExecutor, CommandOutcome, CommandReadbackVerification } from "../../app/commands/command-executor.js";
import { serverLocalDay } from "../shell/date-navigation-model.js";
import { useDashboardCommandBinding } from "../../state/client-context.js";

export type IntakeRequest = Extract<CommandRequest, { family: "intake" }>;
type IntakeCommandInput = z.input<typeof IntakeCommandRequestSchema>;
export type IntakeCommand = IntakeCommandInput extends infer Request ? Request extends IntakeCommandInput ? Pick<Request, "type"> & (Request extends { payload: infer Payload } ? { readonly payload: Payload } : object) : never : never;
export type CommandProblem =
  | { readonly kind: "rejected"; readonly code: string; readonly message: string }
  | { readonly kind: "confirmation-required"; readonly message: string }
  | { readonly kind: "conflict"; readonly currentVersion: number; readonly message: string }
  | { readonly kind: "transport"; readonly message: string; readonly cause?: unknown };
interface IntakeAttemptEvidence { readonly before: IntakeSessionWire; readonly pendingKey: string; readonly zone: string }
const intakeEvidence = new WeakMap<CommandExecutor, Map<string, IntakeAttemptEvidence>>();

function same(left: unknown, right: unknown): boolean {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}

export function intakeFailureMessage(): string {
  return formatErrorCatalogFailure(createErrorCatalogFailure("TASK_UNHANDLED_FAILURE", {})).text;
}

function commandChanged(request: IntakeRequest, before: IntakeSessionWire, next: IntakeSessionWire): boolean {
  switch (request.type) {
    case "inspect-intake": return before.sheet !== next.sheet || before.headerRowIndex !== next.headerRowIndex
      || (request.payload.comparisonManifestId !== undefined && before.comparisonManifestId !== request.payload.comparisonManifestId);
    case "confirm-intake-mapping": return !before.bindings.some(row => row.targetFieldId === request.payload.targetFieldId && row.sourceColumnId === request.payload.sourceColumnId);
    case "correct-intake-row": return !before.corrections.some(row => row.sourceRow === request.payload.sourceRow && row.field === request.payload.field && row.correctedValue === request.payload.correctedValue);
    case "exclude-intake-row": return !before.exclusions.some(row => row.sourceRow === request.payload.sourceRow && row.reason === request.payload.reason);
    case "validate-intake": case "enqueue-intake-manifest": return true;
  }
}

export async function verifyIntakeCommand(client: DashboardClient, before: IntakeSessionWire, request: IntakeRequest, reply: CommandResult, zone: string): Promise<CommandReadbackVerification> {
  if (reply.state !== "applied" && reply.state !== "already-applied") return { state: "mismatch", evidence: reply };
  const next = IntakeSessionWireSchema.parse(await client.intakeSession(request.target.intakeSessionId));
  const evidence = { session: next, reply };
  const targets = reply.affectedTargets.filter(target => target.family === "intake");
  if (targets.length !== 1 || targets[0]?.intakeSessionId !== request.target.intakeSessionId
    || before.intakeSessionId !== request.target.intakeSessionId || next.intakeSessionId !== before.intakeSessionId
    || !same(next.targets, before.targets) || next.workflow !== before.workflow || next.sourceName !== before.sourceName || next.reservedManifestId !== before.reservedManifestId || !same(next.artifact, before.artifact)
    || before.expectedVersion !== request.target.expectedVersion) return { state: "mismatch", evidence };
  const changed = commandChanged(request, before, next);
  const version = request.target.expectedVersion + (changed ? 1 : 0);
  if (next.expectedVersion !== version) return { state: next.expectedVersion > version ? "conflict" : "mismatch", evidence };
  if (!same(before.constants, next.constants)) return { state: "mismatch", evidence };
  let effect = false;
  switch (request.type) {
    case "inspect-intake": {
      const layoutChanged = before.sheet !== next.sheet || before.headerRowIndex !== next.headerRowIndex;
      effect = (next.sheet === (request.payload.sheet ?? before.sheet))
        && (request.payload.headerRowIndex === undefined ? next.sheet !== before.sheet || next.headerRowIndex === before.headerRowIndex
          : next.headerRowIndex === request.payload.headerRowIndex)
        && (request.payload.comparisonManifestId === undefined ? next.comparisonManifestId === before.comparisonManifestId
          : next.comparisonManifestId === request.payload.comparisonManifestId && next.rerun?.intakeManifestId === request.payload.comparisonManifestId)
        && (layoutChanged ? next.state === "mapping" && next.validation.state === "none" && next.bindings.length === 0 && next.corrections.length === 0 && next.exclusions.length === 0
          : next.state === before.state && same(next.validation, before.validation) && same(next.bindings, before.bindings) && same(next.corrections, before.corrections) && same(next.exclusions, before.exclusions));
      break;
    }
    case "confirm-intake-mapping": effect = next.headerFingerprint === request.payload.headerFingerprint
      && next.bindings.filter(row => row.targetFieldId === request.payload.targetFieldId).length === 1
      && next.bindings.some(row => row.targetFieldId === request.payload.targetFieldId && row.sourceColumnId === request.payload.sourceColumnId
        && row.canonicalFieldId === before.targets.find(target => target.targetFieldId === request.payload.targetFieldId)?.canonicalFieldId)
      && same(next.bindings.filter(row => row.targetFieldId !== request.payload.targetFieldId), before.bindings.filter(row => row.targetFieldId !== request.payload.targetFieldId))
      && same(next.corrections, before.corrections) && same(next.exclusions, before.exclusions); break;
    case "correct-intake-row": effect = next.corrections.filter(row => row.sourceRow === request.payload.sourceRow && row.field === request.payload.field).length === 1
      && next.corrections.some(row => row.sourceRow === request.payload.sourceRow && row.field === request.payload.field && row.correctedValue === request.payload.correctedValue)
      && same(next.corrections.filter(row => row.sourceRow !== request.payload.sourceRow || row.field !== request.payload.field), before.corrections.filter(row => row.sourceRow !== request.payload.sourceRow || row.field !== request.payload.field))
      && same(next.bindings, before.bindings) && same(next.exclusions, before.exclusions); break;
    case "exclude-intake-row": effect = next.exclusions.filter(row => row.sourceRow === request.payload.sourceRow).length === 1
      && next.exclusions.some(row => row.sourceRow === request.payload.sourceRow && row.reason === request.payload.reason)
      && same(next.exclusions.filter(row => row.sourceRow !== request.payload.sourceRow), before.exclusions.filter(row => row.sourceRow !== request.payload.sourceRow))
      && same(next.bindings, before.bindings) && same(next.corrections, before.corrections); break;
    case "validate-intake": effect = next.state === "validated" && next.validation.state === "validated"
      && next.validation.validatedAt === next.updatedAt && next.validation.readAt === next.validation.validatedAt
      && same(next.bindings, before.bindings) && same(next.corrections, before.corrections) && same(next.exclusions, before.exclusions); break;
    case "enqueue-intake-manifest": {
      const manifest = next.manifest;
      if (next.state !== "enqueued" || manifest === undefined || before.reservedManifestId === undefined
        || next.intakeManifestId !== before.reservedManifestId || manifest.manifestId !== before.reservedManifestId
        || before.validation.state !== "validated" || next.validation.state !== "validated"
        || !same(next.validation, before.validation) || !same(next.bindings, before.bindings)
        || !same(next.corrections, before.corrections) || !same(next.exclusions, before.exclusions)
        || manifest.totals.valid !== before.validation.validRows || manifest.totals.sourceRows !== before.rowCount
        || before.headerRowIndex === null || before.headerFingerprint === null
        || manifest.mappingFingerprint !== before.headerFingerprint
        || manifest.mappingSnapshotHash !== deriveMappingSnapshotHash({ workflow: before.workflow, sheet: before.sheet,
          headerRowIndex: before.headerRowIndex, headerFingerprint: before.headerFingerprint, bindings: before.bindings, constants: before.constants })) break;
      const runIds = reply.affectedTargets.flatMap(target => target.family === "run" ? [target.runId] : []);
      if (reply.affectedTargets.length !== runIds.length + 1 || new Set(runIds).size !== runIds.length || runIds.length !== manifest.validRows.length || runIds.length === 0) break;
      const day = serverLocalDay({ now: manifest.createdAt, zone });
      const queue = await client.dashboardDay(day);
      const rows = queue.queueSurfaces.filter(row => row.session.state === "present" && row.session.origin?.kind === "intake-manifest" && row.session.origin.intakeManifestId === manifest.manifestId);
      const items = new Set(manifest.validRows.map(row => row.itemId));
      const sessions = new Set(rows.flatMap(row => row.session.state === "present" ? [row.session.sessionId] : []));
      effect = queue.day === day && rows.length === runIds.length && sessions.size === 1
        && rows.every(row => runIds.includes(row.runId) && row.workflowId === before.workflow && row.descriptorHash === manifest.workflowContractFingerprint && row.actorId === request.requestedBy && row.dryRun === request.payload.dryRun && items.delete(row.itemId)
          && row.session.state === "present" && row.session.origin?.kind === "intake-manifest" && row.session.origin.actorId === request.requestedBy)
        && items.size === 0;
      break;
    }
  }
  if (request.type === "confirm-intake-mapping" || request.type === "correct-intake-row" || request.type === "exclude-intake-row") {
    effect &&= changed ? next.state === "mapping" && next.validation.state === "none" : next.state === before.state && same(next.validation, before.validation);
    effect &&= next.sheet === before.sheet && next.headerRowIndex === before.headerRowIndex && next.headerFingerprint === before.headerFingerprint;
  }
  if (request.type !== "inspect-intake") effect &&= next.sheet === before.sheet && next.headerRowIndex === before.headerRowIndex
    && next.headerFingerprint === before.headerFingerprint && next.comparisonManifestId === before.comparisonManifestId;
  if (request.type !== "enqueue-intake-manifest") effect &&= reply.affectedTargets.length === 1;
  return { state: effect ? "matched" : "mismatch", evidence };
}

export function useIntakeCommands(client: DashboardClient, sessionId: string, adopt: (session: IntakeSessionWire, command: IntakeRequest) => void) {
  const binding = useDashboardCommandBinding();
  const [pending, setPending] = useState<string | null>(null);
  const [problem, setProblem] = useState<CommandProblem | null>(null);
  const [recoveryId, setRecoveryId] = useState<string | undefined>(undefined);
  const view = useMemo(() => Object.freeze({ client, sessionId, scope: binding?.scope }), [client, sessionId, binding?.scope]);
  const current = useRef(view);
  current.current = view;
  const active = useRef(false);
  const inFlight = useRef<object | undefined>(undefined);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const retained = binding?.executor.retainedAttempts().find(attempt => "family" in attempt.request && attempt.request.family === "intake" && attempt.request.target.intakeSessionId === sessionId && (attempt.state === "pending" || attempt.outcome?.kind === "uncertain"));
  const retainedId = useRef(retained?.request.commandId);
  retainedId.current = retained?.request.commandId;
  useEffect(() => {
    inFlight.current = undefined;
    setPending(null);
    setRecoveryId(retainedId.current);
  }, [view]);

  const perform = useCallback((request: IntakeRequest, basis: IntakeAttemptEvidence, recover: boolean) => {
    if (!active.current || current.current !== view) return;
    if (binding === undefined || binding.scope.client !== client) {
      setProblem({ kind: "transport", message: intakeFailureMessage() });
      return;
    }
    if (inFlight.current === view) return;
    inFlight.current = view;
    const token = view;
    const publish = (outcome: CommandOutcome) => {
      if (!active.current || current.current !== token) return;
      binding.feedback(outcome);
      if (outcome.kind === "confirmed") {
        const readback = outcome.readback;
        if (typeof readback !== "object" || readback === null || !("session" in readback)) throw new Error("Intake confirmation lacks session evidence");
        adopt(IntakeSessionWireSchema.parse(readback.session), request);
        setProblem(null); setRecoveryId(undefined);
      } else {
        const reply = outcome.reply;
        setProblem(reply !== undefined && "state" in reply && reply.state === "conflict"
          ? { kind: "conflict", currentVersion: reply.currentVersion, message: outcome.feedback.text }
          : outcome.kind === "confirmation-required" ? { kind: "confirmation-required", message: outcome.feedback.text }
          : outcome.kind === "refused" && reply !== undefined && "state" in reply && reply.state === "rejected"
            ? { kind: "rejected", code: outcome.feedback.code, message: outcome.feedback.text }
            : { kind: "transport", message: outcome.feedback.text, cause: outcome });
        if (outcome.kind === "uncertain") setRecoveryId(request.commandId);
      }
    };
    setPending(basis.pendingKey); setProblem(null);
    const options = { scope: binding.scope, readback: async (sent: CommandRequest, reply: CommandResult | BulkRunCommandOutcome) => {
      if (sent.family !== "intake" || "outcome" in reply) return { state: "mismatch" as const, evidence: sent };
      return verifyIntakeCommand(client, basis.before, sent, reply, basis.zone);
    }, publish };
    void (recover ? binding.executor.check(request.commandId, { ...options, observe: async sent => {
      const record = await client.intakeCommandResult(request.target.intakeSessionId, sent.commandId);
      return record.state === "recorded" && same(record.request, { ...sent, requestedAt: record.request.requestedAt }) ? record.result : undefined;
    } }) : binding.executor.execute(request, options)).finally(() => {
      if (active.current && current.current === token) { inFlight.current = undefined; setPending(null); }
    });
  }, [adopt, binding, client, view]);

  const issue = useCallback((session: IntakeSessionWire, command: IntakeCommand, pendingKey: string) => {
    if (!active.current || current.current !== view) return;
    if (inFlight.current === view || pending !== null || retained !== undefined || recoveryId !== undefined) return;
    if (binding === undefined || binding.scope.client !== client || session.intakeSessionId !== sessionId) {
      setProblem({ kind: "transport", message: intakeFailureMessage() }); return;
    }
    const parsed = IntakeCommandRequestSchema.safeParse({ commandId: crypto.randomUUID(), requestedAt: binding.authority.nowIso,
      requestedBy: binding.scope.actorId, source: "dashboard", family: "intake", target: { intakeSessionId: sessionId, expectedVersion: session.expectedVersion }, ...command });
    if (!parsed.success) { setProblem({ kind: "transport", message: intakeFailureMessage(), cause: parsed.error }); return; }
    let evidence = intakeEvidence.get(binding.executor);
    if (evidence === undefined) { evidence = new Map(); intakeEvidence.set(binding.executor, evidence); }
    const basis = { before: session, pendingKey, zone: binding.authority.epoch.bootstrap.serverClock.zone };
    evidence.set(parsed.data.commandId, basis);
    perform(parsed.data, basis, false);
  }, [binding, client, pending, perform, recoveryId, retained, sessionId, view]);
  const recovery = recoveryId === undefined && retained === undefined ? null : { retry: () => {
    if (!active.current || current.current !== view) return;
    const id = recoveryId ?? retained?.request.commandId;
    const attempt = binding?.executor.retainedAttempts().find(entry => entry.request.commandId === id);
    const basis = id === undefined || binding === undefined ? undefined : intakeEvidence.get(binding.executor)?.get(id);
    if (attempt === undefined || basis === undefined || !("family" in attempt.request) || attempt.request.family !== "intake") {
      setProblem({ kind: "transport", message: intakeFailureMessage() }); return;
    }
    perform(attempt.request, basis, true);
  } };
  return { issue, pending, problem, setProblem, recovery, busy: pending !== null || recovery !== null, commandView: view };
}
