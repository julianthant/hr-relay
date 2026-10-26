import { deriveBulkChildCommand, deriveBulkChildCommandId } from "../../../rules/commands/command-groups.js";

import { z } from "zod";
import {
  AssistantModelPreferenceCommandRequestSchema,
  BulkRunCommandRequestSchema,
  BulkRunCommandResponseSchema,
  CommandRequestSchema,
  type BulkRunCommandOutcome,
  type BulkRunCommandResponse,
  type CommandResult,
} from "../../../rules/commands/commands.js";
import type { CommandKernel } from "./command-kernel.js";
import type { RunQueueProjection } from "../projections/run-queue-projection.js";
import { errorText } from "../lifecycle/support.js";
import type { RunWorkerCapacity } from "./run-worker-capacity.js";

export interface DashboardCommandServiceDeps {
  readonly kernel: CommandKernel;
  readonly projection: Pick<RunQueueProjection, "ingestFromTimeline" | "refreshRun">;
  readonly startWorkerCapacity?: RunWorkerCapacity;
}

export interface DashboardCommandService {
  execute(input: unknown): CommandResult;

  submit(input: unknown): Promise<CommandResult>;

  executeBulk(input: unknown): BulkRunCommandResponse;
}

// Derive child command IDs from bulk ID and run ID for exact replay.
export { deriveBulkChildCommandId } from "../../../rules/commands/command-groups.js";


const SPANLESS_RUN_TYPES = new Set([
  "rename", "bump", "cancel", "delete",
  "resolve-write-present", "resolve-write-absent",
]);

export function createDashboardCommandService(deps: DashboardCommandServiceDeps): DashboardCommandService {
  function executeOne(input: unknown, parentCommandId?: string): CommandResult {
      const result = deps.kernel.execute(input, parentCommandId);
      if (result.state !== "applied") return result;
      // The kernel already validated the request exhaustively; this re-parse
      // only recovers the typed view the emission step dispatches on.
      const request = CommandRequestSchema.parse(input);

      if (request.family === "start" || (request.family === "intake" && request.type === "enqueue-intake-manifest")
        || (request.family === "run" && (request.type === "retry" || request.type === "restart"))) {
        deps.projection.ingestFromTimeline();
        return result;
      }

      if (request.family === "gate") {
        deps.projection.ingestFromTimeline();
        return result;
      }

      if (request.family === "run" && SPANLESS_RUN_TYPES.has(request.type)) {
        deps.projection.refreshRun(request.target.runId);
      }
      return result;
  }

  // Choose sync or async execution by envelope family; malformed input still reaches kernel validation.
  const WorkerBrowserSniffSchema = z.strictObject({ family: z.literal("worker-browser") }).loose();

  const startTails = new Map<string, Promise<void>>();
  async function submit(input: unknown): Promise<CommandResult> {
    if (AssistantModelPreferenceCommandRequestSchema.safeParse(input).success) return deps.kernel.executeAssistantModelPreference(input);
    if (WorkerBrowserSniffSchema.safeParse(input).success) {
      return deps.kernel.executeWorkerPool(input);
    }
    const parsed = CommandRequestSchema.safeParse(input);
    if (!parsed.success || parsed.data.family !== "start" || deps.startWorkerCapacity === undefined) return executeOne(input);
    const request = parsed.data;
    const key = request.target.workflowId;
    const previous = startTails.get(key);
    let release: () => void = () => undefined;
    const current = new Promise<void>(resolve => { release = resolve; });
    startTails.set(key, current);
    if (previous !== undefined) await previous;
    try {
      const result = executeOne(request);
      await deps.startWorkerCapacity.ensure(request, result);
      return result;
    } finally {
      if (startTails.get(key) === current) startTails.delete(key);
      release();
    }
  }

  return Object.freeze({
    execute: executeOne,
    submit,

    // Whole-request refusals reach no target; each target outcome remains a separate vector entry.
    executeBulk(input: unknown): BulkRunCommandResponse {
      const parsed = BulkRunCommandRequestSchema.safeParse(input);
      if (!parsed.success) {

        return BulkRunCommandResponseSchema.parse({
          state: "refused",
          code: "schema-mismatch",
          message: `the bulk request does not parse: ${z.prettifyError(parsed.error)}`,
        });
      }
      const request = parsed.data;

      if (request.mode !== "best-effort") {
        // `all-or-none` is recognized but unsupported; independent target transactions cannot promise atomic bulk writes.
        return BulkRunCommandResponseSchema.parse({
          state: "refused",
          code: "capability-unavailable",
          message: `bulk mode "${request.mode}" is schema-recognized and unexecuted: one command is one authority `
            + "transaction, so an all-or-none batch would need a kernel arm that spans N commands. Nothing was "
            + "attempted; re-send the batch as best-effort to receive the per-run vector",
        });
      }

      const runIds = request.targets.map(({ runId }) => runId);
      if (new Set(runIds).size !== runIds.length) {
        // Repeated run targets would replay one child ID and falsely claim two independent outcomes.
        return BulkRunCommandResponseSchema.parse({
          state: "refused",
          code: "schema-mismatch",
          message: "the bulk request names the same run more than once; a run appears at most once in a batch",
        });
      }

      const results: BulkRunCommandOutcome[] = [];
      for (const target of request.targets) {
        const commandId = deriveBulkChildCommandId(request.bulkCommandId, target.runId);
        const child = deriveBulkChildCommand(request, target);
        let result: CommandResult;
        try {
          result = executeOne(child, request.bulkCommandId);
        } catch (error) {
          // Report an untyped throw per run and continue the remaining targets; it is not a target refusal.
          results.push({ outcome: "errored", runId: target.runId, commandId, detail: errorText(error) });
          break;
        }
        if (result.state === "pending" || result.state === "confirmation-required") {
          results.push({ outcome: "errored", runId: target.runId, commandId, detail: "Command has no terminal outcome; retain its original identity." });
          break;
        }
        results.push(
          result.state === "conflict"
            ? {
              outcome: "conflict",
              runId: target.runId,
              commandId,
              currentVersion: result.currentVersion,
              detail: result.message,
            }
            : result.state === "rejected"
              ? { outcome: "refused", runId: target.runId, commandId, code: result.code, detail: result.message }
              : {
                outcome: "applied",
                runId: target.runId,
                commandId,
                replayed: result.state === "already-applied",
                detail: result.state === "already-applied"
                  ? `${request.type} had already been recorded for this run under the same batch`
                  : `${request.type} recorded`,
              },
        );
      }

      return BulkRunCommandResponseSchema.parse({
        state: "vector",
        bulkCommandId: request.bulkCommandId,
        type: request.type,
        requestedCount: request.targets.length,
        results,
      });
    },
  });
}
