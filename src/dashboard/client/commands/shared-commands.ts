import {
BulkRunCommandRequestSchema,
BulkRunCommandResponseSchema,
CommandRequestSchema,
CommandResultSchema,
commandNoChangeResultMatches,
type BulkRunCommandResponse,
type BulkRunCommandRequest,
type CommandRequest,
type CommandResult
} from "../../../rules/commands/commands.js";
import { deriveBulkChildCommandId } from "../../../rules/commands/command-groups.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../models/failures/error-catalog.js";
import { DashboardClientError } from "../errors.js";
import { parseOrThrow } from "../queries/query-parse.js";
import type { DashboardTransport } from "../transport.js";

function identityMismatch(response: unknown): never {
  throw new DashboardClientError({ kind: "protocol", code: "COMMAND_RESULT_IDENTITY_MISMATCH",
    message: formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_RESULT_IDENTITY_MISMATCH", {})).text,
    cause: response });
}

export function checkedCommandResult(command: CommandRequest, response: unknown): CommandResult {
  const result = parseOrThrow(CommandResultSchema, "POST /api/v1/commands", response);
  if (result.commandId !== command.commandId || result.state === "pending" && command.family !== "worker-browser") identityMismatch(response);
  if (result.state !== "applied" && result.state !== "already-applied") return result;
  if (!commandNoChangeResultMatches(command, result)) identityMismatch(response);
  const targets = result.affectedTargets;
  if (command.family === "worker-browser" && command.type === "check-parked-write" && targets.length !== 2) identityMismatch(response);
  const matches = (target: typeof targets[number]): boolean => {
    switch (command.family) {
      case 'assistant-model-preference': return target.family === 'assistant-model-preference'
        && target.profileId === command.target.profileId && target.revision === command.target.expectedRevision + 1;
      case "run": return target.family === "run" && (target.runId === command.target.runId
        || ["cancel", "delete", "retry", "restart"].includes(command.type));
      case "gate": return (target.family === "gate" && target.runId === command.target.runId && target.gateId === command.target.gateId)
        || (target.family === "run" && target.runId === command.target.runId);
      case "start": return target.family === "run" || (target.family === "start" && target.workflowId === command.target.workflowId
        && target.startPlanId === command.target.startPlanId && target.expectedVersion === command.target.expectedVersion);
      case "intake": return (target.family === "intake" && target.intakeSessionId === command.target.intakeSessionId)
        || (command.type === "enqueue-intake-manifest" && target.family === "run");
      case "worker-browser":
        if (command.type === "check-parked-write") return target.family === "worker-browser" && target.workerId === command.target.workerId
          || target.family === "run" && target.runId === command.target.runId;
        if (command.type === "remove-worker") return target.family === "worker-browser" && target.workerId === command.target.workerId
          || target.family === "worker-pool" && target.workflowId === command.target.workflowId;
        if (command.type === "plan-worker-count") return target.family === "worker-browser"
          || (target.family === "worker-pool" && target.workflowId === command.target.workflowId);
        return target.family === "worker-browser" && target.workerId === (command.type === "spawn-worker" ? command.payload.workerId : command.target.workerId);
      case "settings": return target.family === (command.type === "apply-settings" ? "settings" : "protected-settings");
      case "storage-relocation": return target.family === "storage-relocation";
      case "notification": return target.family === "notification" && ("members" in command.target ? command.target.members.some(member => member.notificationId === target.notificationId) : target.notificationId === command.target.notificationId);
      case "workflow-batch": return target.family === "workflow-batch" && target.batchId === command.target.batchId;
      case "failure-resolution": return target.family === "failure-resolution" && target.runId === command.target.runId && target.failureId === command.target.failureId;
    }
  };
  if (!targets.every(matches)) identityMismatch(response);
  const anchor = targets.some(target => {
    if (command.family === "run") return target.family === "run" && target.runId === command.target.runId;
    if (command.family === "gate") return target.family === "gate";
    if (command.family === "start") return target.family === "start";
    if (command.family === "intake") return target.family === "intake";
    if (command.family === "worker-browser" && command.type === "plan-worker-count") return target.family === "worker-pool";
    return true;
  });
  if (command.family === "notification" && "members" in command.target && targets.length !== command.target.matchingCount) identityMismatch(response);
  if ((!anchor && !(command.family === "notification" && "members" in command.target && command.target.matchingCount === 0)) || new Set(targets.map(target => JSON.stringify(target))).size !== targets.length) identityMismatch(response);
  return result;
}

export function checkedBulkCommandResult(command: BulkRunCommandRequest, response: unknown): BulkRunCommandResponse {
  const result = parseOrThrow(BulkRunCommandResponseSchema, "POST /api/v1/commands/bulk", response);
  if (result.state === "refused") return result;
  if (result.bulkCommandId !== command.bulkCommandId || result.type !== command.type
    || result.requestedCount !== command.targets.length || result.results.length > command.targets.length
    || (result.results.length < command.targets.length && result.results.at(-1)?.outcome !== "errored")) identityMismatch(response);
  const ids = new Set<string>();
  for (const [index, child] of result.results.entries()) {
    if (child.runId !== command.targets[index].runId || child.commandId !== deriveBulkChildCommandId(command.bulkCommandId, child.runId)
      || ids.has(child.commandId) || (child.outcome === "errored" && index !== result.results.length - 1)) identityMismatch(response);
    ids.add(child.commandId);
  }
  return result;
}


export interface SharedCommands {

  executeCommand(request: unknown): Promise<CommandResult>;

  /** One request, N CAS-bound transitions, N outcomes. The client parses
 * the vector verbatim for the same reason it parses a single result verbatim */
  executeBulkCommand(request: unknown): Promise<BulkRunCommandResponse>;
}

export function createSharedCommands(transport: DashboardTransport): SharedCommands { return Object.freeze({

    async executeCommand(request: unknown): Promise<CommandResult> {
      const command = CommandRequestSchema.parse(request);
      const response = await transport.requestJson("/api/v1/commands", {
        method: "POST",
        body: JSON.stringify(command),
      });
      return checkedCommandResult(command, response);
    },

    async executeBulkCommand(request: unknown): Promise<BulkRunCommandResponse> {
      const bulk = BulkRunCommandRequestSchema.parse(request);
      const response = await transport.requestJson("/api/v1/commands/bulk", {
        method: "POST",
        body: JSON.stringify(bulk),
      });
      return checkedBulkCommandResult(bulk, response);
    }
}); }
