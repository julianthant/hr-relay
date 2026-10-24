import type { DashboardClient } from "../../client/index.js";
import type { CommandRequest, CommandResult, BulkRunCommandOutcome } from "../../../rules/commands/commands.js";
import type { DashboardDayWire, QueueSurfaceWire } from "../../../models/dashboard/projection.js";
import type { CommandReadbackVerification } from "./command-executor.js";
import { lifecycleCommandId } from "../../../rules/commands/lifecycle-command-id.js";
/** Turning a SERVED action descriptor into the ONE command envelope (ref frontend-backend-integration
 * §3.4), for the confirm-first flow the app root mounts. */
import { systemClock } from "../../../rules/time/clock.js";
import type { ActionDescriptorWire } from "../../../models/dashboard/actions.js";
import { directIdentifierDisplay } from "../../../rules/redaction/redaction.js";
import type { ActionTarget } from "../../surfaces/shared/actions/actions.js";
import {
  identityCeremonyFor,
  identityDraftProblem,
  optionFor,
  type IdentityGateAnswer,
  type IdentityGatePayload,
} from "../../surfaces/run-detail/identity/identity-ceremony.js";
import { renameDraftProblem } from "../../surfaces/run-detail/identity/rename-draft.js";

export type CommandAction = Extract<ActionDescriptorWire, { kind: "command" }>;

/** What the app can say about a descriptor it was asked to dispatch; `refused`
 * is a legitimate answer with a sentence the surface reports. */
export type ComposedCommand =
  | { readonly state: "ready"; readonly request: unknown }
  | { readonly state: "refused"; readonly reason: string };

/** The four envelope fields every family shares, stamped once per dispatch. */
interface CommandEnvelopeFields {
  readonly commandId: string;
  readonly requestedAt: string;
  readonly requestedBy: string;
  readonly source: string;
}

export interface CommandContext {
  /** who is asking — the bootstrap document's actor */
  readonly actorId: string;
  /** the surface the operator pressed the control */
  readonly source: "queue" | "run-detail";
  /** the gate section the run advertised, when one is open */
  readonly gate?: IdentityGatePayload | undefined;
  /** What the operator answered in the ceremony dialog. It is OPTIONAL because
 * exactly one ceremony needs no answer — a `one-click` packet naming one */
  readonly gateAnswer?: IdentityGateAnswer | undefined;
  /** What the operator typed into the rename dialog, already judged by `renameDraftProblem` */
  readonly renameAnswer?: string | undefined;
  /** retained request identity for replay and in-flight protection */
  readonly commandId?: string | undefined;
  readonly requestedAt?: string | undefined;
}

/** The identity gate's answer: the operator's decision, wearing the server's
 * facts. */
function composeGateResult(
  action: CommandAction,
  gate: IdentityGatePayload | undefined,
  answer: IdentityGateAnswer | undefined,
  envelope: CommandEnvelopeFields,
): ComposedCommand {
  if (gate === undefined || gate.state !== "available") {
    return {
      state: "refused",
      reason: gate === undefined
        ? "this run served no identity-gate section, so there is no packet to answer"
        : `the identity-gate section is ${gate.state}: ${"reason" in gate ? gate.reason : gate.message}`,
    };
  }
  const served = gate.value;
  const { resolution } = action;
  if (resolution === undefined) {
    return {
      state: "refused",
      reason: `the served gate action ${action.key} names no typed resolution`,
    };
  }
  const ceremony = identityCeremonyFor(served, resolution);
  if (ceremony.kind === "unsupported") return { state: "refused", reason: ceremony.reason };

  // The ONE ceremony whose answer is a served fact: the server said one click,
  // and named exactly one candidate. Everything else waits for a human.
  const decided: IdentityGateAnswer | undefined = answer
    ?? (ceremony.kind === "confirm" ? { decision: "approved", eid: ceremony.option.eid } : undefined);
  if (decided === undefined) {
    return {
      state: "refused",
      reason: `this gate's ceremony is "${served.approvalShape}" and no operator answer was supplied; `
        + "the identity-approval dialog owns that answer and nothing here may author it",
    };
  }
  if (decided.decision !== resolution) {
    return {
      state: "refused",
      reason: `the operator answered "${decided.decision}" and the control pressed was `
        + `"${resolution}"; nothing is sent while the two disagree`,
    };
  }

  const problem = identityDraftProblem(ceremony, {
    eid: decided.decision === "approved" ? decided.eid : "",
    reason: decided.decision === "rejected" ? decided.reason : "",
  });
  if (problem !== undefined) return { state: "refused", reason: problem };

  const value = ((): Record<string, unknown> | undefined => {
    if (decided.decision === "rejected") {
      return {
        decision: "rejected",
        reason: decided.reason.trim(),
        evidenceDigest: served.evidenceDigest,
      };
    }
    const option = optionFor(served.options, decided.eid);
    // `identityDraftProblem` already refused an unshown EID on every approval
// ceremony, so this is unreachable — and it refuses rather than asserting
    if (option === undefined) {
      return undefined;
    }
    return {
      decision: "approved",
      eid: option.eid,
      chosenFrom: option.chosenFrom,
      evidenceDigest: served.evidenceDigest,
    };
  })();
  if (value === undefined) {
    return {
      state: "refused",
      reason: `EID ${decided.decision === "approved" ? directIdentifierDisplay(decided.eid) : "unavailable"} is not among the candidates `
        + "this packet served, so there is no `chosenFrom` label to record it under",
    };
  }

  return {
    state: "ready",
    request: {
      ...envelope,
      family: "gate",
      type: "resolve-gate",
      target: {
        runId: served.runId,
        gateId: served.gateId,
        expectedVersion: action.expectedVersion,
      },
      payload: { result: { schemaHash: served.resultSchemaHash, value } },
    },
  };
}

/** Refuse unknown served verbs by name; never turn new commands into silent no-ops. */
export function composeCommandRequest(
  action: CommandAction,
  target: ActionTarget,
  context: CommandContext,
): ComposedCommand {
  const envelope = {
    commandId: context.commandId ?? crypto.randomUUID(),
    requestedAt: context.requestedAt ?? systemClock.now().toISOString(),
    requestedBy: context.actorId,
    source: context.source,
  };
  switch (action.command) {
    case "retry":
    case "restart":
      return { state: "refused", reason: "Open Rerun to review steps and values before starting a new run." };
    case "archive":
      return { state: "refused", reason: "Archive page removed" };
    case "cancel":
    case "bump":
    case "delete":
      /* Rename requires a value; target-only destructive commands use the served confirmation. */
      return {
        state: "ready",
        request: {
          ...envelope,
          family: "run",
          type: action.command,
          target: { runId: target.runId, expectedVersion: action.expectedVersion },
        },
      };
    case "rename": {
      /* Human-authored values must accompany the call; never invent a missing answer. */
      const answer = context.renameAnswer;
      if (answer === undefined) {
        return {
          state: "refused",
          reason: "no name was supplied; the rename dialog owns that value and nothing here may author one",
        };
      }
      const problem = renameDraftProblem(answer);
      if (problem !== undefined) return { state: "refused", reason: problem };
      return {
        state: "ready",
        request: {
          ...envelope,
          family: "run",
          type: "rename",
          target: { runId: target.runId, expectedVersion: action.expectedVersion },
          payload: { displayName: answer.trim() },
        },
      };
    }
    case "resolve-gate":
      return composeGateResult(action, context.gate, context.gateAnswer, envelope);
    case "resolve-write-present":
    case "resolve-write-absent":
      // Park resolutions use the evidence-note dialog; this composer cannot carry that required proof.
      return {
        state: "refused",
        reason: `${action.command} is answered by the parked-write dialog, not by this dispatcher`,
      };
  }
}

export { composeStopWorkerCommand, composePlanWorkerCountCommand, composeSpawnWorkerCommand } from "./worker-command-dispatch.js";

/** Read effect facts from the same served day, including cross-day delegated rows. */
export async function verifyShellCommandEffect(
  client: DashboardClient,
  day: string,
  request: CommandRequest,
  reply: CommandResult | BulkRunCommandOutcome,
): Promise<CommandReadbackVerification> {
  const mismatch = (evidence: unknown) => ({ state: "mismatch" as const, evidence });
  if (request.family === "notification" && "members" in request.target) {
    if (!("affectedTargets" in reply) || reply.affectedTargets.length !== request.target.matchingCount) return mismatch(reply);
    const rows = await client.notificationSnapshot();
    if (rows.length !== request.target.members.length || new Set(rows.map(row => row.notificationId)).size !== rows.length) return mismatch(rows);
    if (new Set(reply.affectedTargets.map(target => target.family === "notification" ? target.notificationId : "")).size !== reply.affectedTargets.length) return mismatch(reply);
    for (const member of request.target.members) {
      const row = rows.find(row => row.notificationId === member.notificationId);
      if (row === undefined || row.actorId !== request.target.actorId) return mismatch(rows);
      const affected = reply.affectedTargets.some(target => target.family === "notification" && target.notificationId === member.notificationId);
      if (!affected && row.kind === "notification" && Number(row.revision) !== Number(member.expectedVersion)) return mismatch(row);
    }
    const evidence = [];
    for (const target of reply.affectedTargets) {
      if (target.family !== "notification") return mismatch(reply);
      const before = request.target.members.find(member => member.notificationId === target.notificationId);
      const row = rows.find(member => member.notificationId === target.notificationId);
      if (before === undefined || row?.kind !== "notification" || row.actorId !== request.target.actorId || row.revision !== before.expectedVersion + 1) return mismatch(rows);
      const matches = request.type === "notification-read-all" ? row.readState === "read" : request.type === "notification-unread-all" ? row.readState === "unread"
        : request.type === "notification-unsnooze-all" ? row.state !== "snoozed" : row.state === "snoozed" && row.snoozedUntil !== undefined && Date.parse(row.snoozedUntil) > Date.parse(request.requestedAt);
      if (!matches) return mismatch(row);
      evidence.push(row);
    }
    return { state: "matched", evidence };
  }
  if (request.family === "notification" && "notificationId" in request.target) {
    if (!("affectedTargets" in reply) || reply.affectedTargets.length !== 1 || reply.affectedTargets[0]?.family !== "notification"
      || reply.affectedTargets[0].notificationId !== request.target.notificationId) return mismatch(reply);
    const rows = await client.notificationSnapshot();
    const target = request.target;
    const row = rows.find(row => row.notificationId === target.notificationId);
    if (request.target.actorId !== request.requestedBy || row?.actorId !== request.target.actorId || row.kind !== "notification"
      || row.revision !== request.target.expectedVersion + 1) return mismatch(rows);
    const matches = request.type === "notification-read" ? row.readState === "read"
      : request.type === "notification-unread" ? row.readState === "unread"
      : request.type === "notification-unsnooze" ? row.state !== "snoozed"
      : row.state === "snoozed" && row.snoozedUntil !== undefined && Date.parse(row.snoozedUntil) > Date.parse(request.requestedAt);
    return matches ? { state: "matched", evidence: row } : mismatch(row);
  }
  if (request.family === "gate") {
    const detail = await client.runDetail(request.target.runId);
    const value = request.payload.result.value;
    const decision = typeof value === "object" && value !== null && "decision" in value ? value.decision : undefined;
    return detail.rowRevision > request.target.expectedVersion && detail.gate.state === "resolved"
      && detail.gate.nodeId !== undefined && String(detail.gate.nodeId) === String(request.target.gateId) && detail.gate.resolvedBy === request.requestedBy
      && detail.gate.resolution === decision ? { state: "matched", evidence: detail } : mismatch(detail);
  }
  if (request.family === "run" && request.type === "delete") {
    if (!("affectedTargets" in reply)) return mismatch(reply);
    const expected = lifecycleCommandId("operator-delete", request.commandId);
    const histories = [];
    for (const target of reply.affectedTargets) {
      if (target.family !== "run") return mismatch(reply);
      const history = await client.itemAttemptHistory(target.runId);
      histories.push(history);
      if (!("selected" in history) || history.selected.state !== "deleted" || history.selected.commandId !== expected) return mismatch(histories);
    }
    return { state: "matched", evidence: histories };
  }
  if (request.family !== "run" && request.family !== "workflow-batch") return mismatch(request);
  const snapshots = new Map<string, DashboardDayWire>();
  const snapshot = async (partition: string) => {
    const previous = snapshots.get(partition);
    if (previous !== undefined) return previous;
    const next = await client.dashboardDay(partition); snapshots.set(partition, next); return next;
  };
  const current = await snapshot(day);
  if (request.family === "workflow-batch") {
    const sessions = current.queueSurfaces.filter(row => row.session.state === "present" && row.session.sessionId === request.target.batchId);
    return sessions.length > 0 && sessions.every(row => row.session.state === "present"
      && row.session.presentation?.version === request.target.expectedVersion + 1 && row.session.presentation.groupInQueue === request.payload.groupInQueue)
      ? { state: "matched", evidence: current } : mismatch(current);
  }
  const readRow = async (runId: string): Promise<QueueSurfaceWire | undefined> => {
    for (const wire of snapshots.values()) {
      const row = wire.queueSurfaces.find(candidate => candidate.runId === runId);
      if (row !== undefined) return row;
    }
    let history = await client.itemAttemptHistory(runId);
    while (history.state === "available") {
      const entry = history.page.entries.find(candidate => candidate.runId === runId);
      if (entry?.disposition === "live") {
        const row = (await snapshot(entry.partitionDay)).queueSurfaces.find(candidate => candidate.runId === runId);
        return row;
      }
      if (history.page.nextCursor === null) break;
      history = await client.itemAttemptHistory(runId, { cursor: history.page.nextCursor });
    }
    return undefined;
  };
  const rootRead = await readRow(request.target.runId);
  if (rootRead === undefined) return mismatch([...snapshots.values()]);
  const root = rootRead;
  if (request.type === "rename") return root.rowRevision === request.target.expectedVersion + 1
    && root.displayName.state === "present" && root.displayName.value === request.payload.displayName
    ? { state: "matched", evidence: root } : mismatch(root);
  if (request.type === "bump") return root.rowRevision >= request.target.expectedVersion && root.priority === "interactive"
    ? { state: "matched", evidence: root } : mismatch(root);
  if (request.type !== "cancel") return mismatch(root);
  const legal = new Map<string, QueueSurfaceWire>([[root.runId, root]]);
  const affected = "affectedTargets" in reply ? reply.affectedTargets : [{ family: "run" as const, runId: request.target.runId }];
  for (const target of affected) {
    if (target.family !== "run") return mismatch(reply);
    let descendant = await readRow(target.runId);
    const path = new Map<string, QueueSurfaceWire>();
    while (descendant !== undefined && !legal.has(descendant.runId)) {
      const row = descendant;
      if (path.has(row.runId) || row.lineage.state !== "child") return mismatch([...path.values()]);
      path.set(row.runId, row);
      descendant = await readRow(row.lineage.parentRunId);
    }
    if (descendant === undefined) return mismatch([...snapshots.values()]);
    for (const [runId, row] of path) legal.set(runId, row);
  }
  const matches = root.rowRevision > request.target.expectedVersion && affected.every(target => {
    if (target.family !== "run") return false;
    const row = legal.get(target.runId);
    return row !== undefined && (row.status === "cancelled" || row.status === "cancelling");
  });
  return matches ? { state: "matched", evidence: [...legal.values()] } : mismatch([...legal.values()]);
}
