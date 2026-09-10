import { deriveBulkChildCommand, deriveBulkChildCommandId } from "../../../domain/command-groups.js";
/**
 * The dashboard command service: the kernel is the ONE command path (D113);
 * this wrapper adds exactly what ref dashboard-surfaces assigns to 1g around it —
 *
 * 1. RunRecordService persists each queued root inside the enqueue transaction,
 *    using the workflow presentation over retained input for its title.
 * 2. The kernel persists gate.resolved with its gate result and resume transition.
 * 3. Applied presentation commands refresh their canonical run snapshot.
 *    Lifecycle terminal events belong to RunRecordService, including cancellation.
 * 4. After command settlement, projection.ingestFromTimeline() reads committed
 *    events before the response returns. The compose poll uses the same durable
 *    cursor to repair a lost wakeup or observe another process.
 *
 * No transport concern reaches the kernel: this service takes the already
 * schema-recognized command envelope as `unknown` and the kernel does its own
 * exhaustive parse.
 *
 * 5. D235's BULK arm, which is this same path executed N times. A bulk request
 *    is N real CAS-bound transitions and it is composed as N child commands —
 *    NOT as one transaction spanning every target, and not as a second command
 *    path. Two consequences fall out and both are the point: a child's outcome
 *    is settled by the SAME kernel arm a single press would have reached, so
 *    the refusal vocabulary cannot fork; and a retry in the batch gets its
 *    `run.queued` span from step 4 above, which is the reason the loop runs
 *    through this service and never through the kernel directly.
 */
import { z } from "zod";
import {
  BulkRunCommandRequestSchema,
  BulkRunCommandResponseSchema,
  CommandRequestSchema,
  type BulkRunCommandOutcome,
  type BulkRunCommandResponse,
  type CommandResult,
} from "../../../domain/commands.js";
import type { CommandKernel } from "../../../core/command-kernel.js";
import type { RunQueueProjection } from "../projectors/run-queue-projection.js";
import { errorText } from "../support.js";

export interface DashboardCommandServiceDeps {
  readonly kernel: CommandKernel;
  readonly projection: RunQueueProjection;
}

export interface DashboardCommandService {
  execute(input: unknown): CommandResult;
  /**
   * The transport door (W3): the ONE entry the command route calls. It routes
   * the worker-browser family through the kernel's async pool seam — the pool
   * supervisor's process effects (spawn birth proof, durable stop directive)
   * settle before the reply — and every other family through the synchronous
   * `execute` path unchanged. Still one command path: both roads end in the
   * same kernel, and this adds no emission or refusal vocabulary of its own.
   */
  submit(input: unknown): Promise<CommandResult>;
  /**
   * D235: `BulkRunCommandRequest` in, the complete per-run vector out. It never
   * throws for a target's own outcome — a refusal, a conflict and an untyped
   * error are all VALUES the operator has to read — and it never answers with a
   * count.
   */
  executeBulk(input: unknown): BulkRunCommandResponse;
}

/**
 * D235: a child command's id is DERIVED from the bulk id and the run it names,
 * so re-delivering one bulk request replays exactly the same N children rather
 * than filing N new ones. `ids.uuid()` would satisfy the type and break that
 * sentence — D174's lesson, one family over.
 */
export { deriveBulkChildCommandId } from "../../../domain/command-groups.js";

/**
 * Applied run commands that emit no span but DO change what the queue row
 * projects, so the projection has to be told. The two ref write-safety §4.1 write
 * resolutions belong here for exactly the reason `cancel` does: they move the
 * run off `parked-write` (to `queued` on absent, to a settled outcome on
 * present) and the row's status is folded from authority. Without the refresh
 * the operator resolves the write and the queue keeps saying `blocked`.
 */
const SPANLESS_RUN_TYPES = new Set([
  "rename", "bump", "cancel",
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

  /**
   * W3: family is sniffed from the envelope BEFORE execution because the two
   * roads differ in shape (sync vs awaited pool effect), and only the family
   * decides the road. Anything unparseable goes down the sync road, where the
   * kernel's own exhaustive parse produces the real error.
   */
  const WorkerBrowserSniffSchema = z.strictObject({ family: z.literal("worker-browser") }).loose();

  async function submit(input: unknown): Promise<CommandResult> {
    if (WorkerBrowserSniffSchema.safeParse(input).success) {
      return deps.kernel.executeWorkerPool(input);
    }
    return executeOne(input);
  }

  return Object.freeze({
    execute: executeOne,
    submit,

    /**
     * D235's loop. Every refusal below reaches NO target — it is a statement
     * about the request, not about a run — and every per-target answer is a
     * vector entry, because ref dashboard-surfaces §2.4 forbids collapsing a partial result
     * into "Done".
     */
    executeBulk(input: unknown): BulkRunCommandResponse {
      const parsed = BulkRunCommandRequestSchema.safeParse(input);
      if (!parsed.success) {
        // An empty target set lands HERE (`targets` is `.min(1)`), which is the
        // named refusal a zero-eligible selection must get. Answering "applied
        // to 0 runs" would be a bulk command that did nothing and said nothing.
        return BulkRunCommandResponseSchema.parse({
          state: "refused",
          code: "schema-mismatch",
          message: `the bulk request does not parse: ${z.prettifyError(parsed.error)}`,
        });
      }
      const request = parsed.data;

      if (request.mode !== "best-effort") {
        /*
         * D235: `all-or-none` is schema-recognized and this runtime does not
         * execute it. One command is one authority transaction here, and a mode
         * that promises "one transaction or none" across N independent runs
         * cannot be honoured by a loop — so it refuses by name rather than
         * running best-effort under an all-or-none label, which would be the
         * surface lying about atomicity it never had. The owner and the trigger
         * are named in ref dashboard-surfaces's bulk section.
         */
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
        // Two targets naming one run derive ONE child command id, so the second
        // would replay the first and be reported as applied-by-replay for a
        // transition it never made. Refuse the request instead.
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
          /*
           * An untyped throw is the authority or this service reporting that it
           * cannot answer, not a run refusing. It is REPORTED per run — the
           * message verbatim, never a substituted code — and the pass STOPS:
           * issuing further writes into a system that just failed to answer is
           * the opposite of fail-loud. `requestedCount` on the response is what
           * makes the untried remainder visible.
           */
          results.push({ outcome: "errored", runId: target.runId, commandId, detail: errorText(error) });
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
