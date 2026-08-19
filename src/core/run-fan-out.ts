/**
 * The ONE place N queued runs are inserted (doc 03 §2.4 Enqueue, D171, D174).
 *
 * It began inside the command kernel because its only two callers were command
 * arms — `start-run` and `enqueue-intake-manifest`. The capture finalize
 * handoff is the third caller and is NOT a command: it runs inside the finalize
 * projector's settlement transaction, where there is no command envelope to
 * reject against. So the enqueue moved here whole rather than being copied,
 * and its ONE command-shaped dependency — how to refuse — became a callback.
 *
 * Everything it writes is inside the CALLER's authority transaction, so a
 * refusal on run 39 of 40 leaves nothing behind. That property is why the
 * refusal is a `never`-returning callback rather than a returned result: a
 * caller that could keep going after a policy refusal would be able to enqueue
 * exactly the partial fan-out this function exists to prevent.
 */
import type { AuthorityRepositories } from "../infra/sqlite/authority-database.js";
import type { AnyWorkflowDescriptor } from "../base/workflow.js";
import type { InstanceSelection, RunPriority, RunShape } from "../domain/run/envelope.js";
import { isTerminalRunState, RunRecordSchema, type RunRecord } from "../domain/run/record.js";

/** Built loosely, then proven strict by the `CommandResultSchema`/audit parses. */
export type TargetReference = Readonly<Record<string, unknown>>;

export interface VersionChange {
  readonly target: TargetReference;
  readonly before: number;
  readonly after: number;
}

export function runTarget(runId: string): TargetReference {
  return { family: "run", runId };
}

export function requireApplied(outcome: { state: string }, what: string): void {
  if (outcome.state !== "applied") {
    throw new Error(`${what} unexpectedly reported ${outcome.state} inside an exclusive authority transaction`);
  }
}

export function activeRunsForItem(
  repositories: AuthorityRepositories,
  workflowId: string,
  itemId: string,
): readonly RunRecord[] {
  return repositories.runs
    .listByItem({ workflow: workflowId, itemId })
    .filter((run) => !isTerminalRunState(run.lifecycle));
}

export interface PlannedRunInsert {
  readonly runId: string;
  readonly itemId: string;
  readonly traceId: string;
  /** Only ever used to NAME the item in an enqueue-policy refusal. */
  readonly matchKey: string;
  readonly rawInput: unknown;
  /** The canonical value bound to its schema hash (D62/D110). */
  readonly parsedInput: unknown;
}

/** Everything the runs of one fan-out share, stamped once for all of them. */
export interface FanOutEnvelope {
  readonly workflow: string;
  readonly descriptorVersion: number;
  readonly contractFingerprint: string;
  readonly requestedInstance?: InstanceSelection;
  readonly resolvedInstance: InstanceSelection;
  readonly configFingerprint: string;
  readonly configSnapshotId: string;
  readonly shape: RunShape;
  readonly priority: RunPriority;
  readonly dryRun: boolean;
  readonly ingressSchemaHash: string;
  /**
   * Charter §25 / D179: the app build stamped on every run AT ENQUEUE. It is
   * required here — the one place runs are created — because a run without it
   * cannot be told apart from a current one by an application-scope version
   * bump, and back-filling it later would claim a build the run never saw.
   */
  readonly appVersion: string;
}

/**
 * How this caller refuses an enqueue policy collision. A command arm throws its
 * typed `policy-refused` rejection; the capture handoff throws, which the
 * finalize projector turns into durable `failed` plus Retry Finalize.
 */
export type FanOutRefusal = (message: string) => never;

export function fanOutQueuedRuns(
  repositories: AuthorityRepositories,
  refuse: FanOutRefusal,
  descriptor: AnyWorkflowDescriptor,
  envelope: FanOutEnvelope,
  planned: readonly PlannedRunInsert[],
  now: string,
  origin: string,
): Readonly<{ affectedTargets: readonly TargetReference[]; versionChanges: readonly VersionChange[] }> {
  const affectedTargets: TargetReference[] = [];
  const versionChanges: VersionChange[] = [];
  for (const entry of planned) {
    // An authority read error here aborts the whole fan-out — never "continue
    // and enqueue anyway" (doc 03 §2.4 Enqueue).
    const active = activeRunsForItem(repositories, envelope.workflow, entry.itemId);
    if (descriptor.enqueue === "reject-active" && active.length > 0) {
      refuse(
        `${envelope.workflow} item ${entry.itemId} (${entry.matchKey}) already has an active run `
        + `(${active[0].envelope.traceId}); nothing from ${origin} was started`,
      );
    }
    if (descriptor.enqueue === "supersede-active") {
      for (const activeRun of active) {
        const outcome = repositories.runs.transition({
          runId: activeRun.envelope.runId,
          expectedVersion: activeRun.version,
          lifecycle: { state: "terminal", outcome: "superseded", endedAt: now },
          now,
        });
        requireApplied(outcome, `superseding run ${activeRun.envelope.runId}`);
        affectedTargets.push(runTarget(activeRun.envelope.runId));
        versionChanges.push({
          target: runTarget(activeRun.envelope.runId),
          before: activeRun.version,
          after: activeRun.version + 1,
        });
      }
    }

    const record = RunRecordSchema.parse({
      envelope: {
        runId: entry.runId,
        workflow: envelope.workflow,
        itemId: entry.itemId,
        traceId: entry.traceId,
        descriptorVersion: envelope.descriptorVersion,
        contractFingerprint: envelope.contractFingerprint,
        ...(envelope.requestedInstance === undefined ? {} : { requestedInstance: envelope.requestedInstance }),
        resolvedInstance: envelope.resolvedInstance,
        configFingerprint: envelope.configFingerprint,
        configSnapshotId: envelope.configSnapshotId,
        shape: envelope.shape,
        priority: envelope.priority,
        dryRun: envelope.dryRun,
        /*
         * D221 — the attempt belongs to the ITEM. A fan-out entry whose item has
         * run before (a re-run of the same subject, a superseded predecessor)
         * takes the next attempt, so its executions never land on a key an
         * earlier run of that item already owns. Read per entry, inside this
         * transaction, AFTER any supersede above: two entries of one fan-out can
         * name the same item.
         */
        attempt: repositories.runs.nextItemAttempt({ workflow: envelope.workflow, itemId: entry.itemId }),
        enqueuedAt: now,
      },
      input: {
        raw: entry.rawInput,
        parsed: entry.parsedInput,
        ingressSchemaHash: envelope.ingressSchemaHash,
      },
      lifecycle: { state: "queued" },
      claimGeneration: 0,
      appVersion: envelope.appVersion,
      /*
       * D230 — this run's ordinal within its workflow, the queue footer's `#N`.
       *
       * Read per entry, inside this transaction, exactly as the attempt above
       * is: each `enqueue` below writes its row before the next entry reads the
       * counter, so a fan-out of forty takes forty consecutive numbers rather
       * than forty copies of one. Reading it once outside the loop is the
       * defect this comment exists to prevent.
       */
      runNumber: repositories.runs.nextWorkflowRunNumber(envelope.workflow),
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    const inserted = repositories.runs.enqueue(record);
    if (inserted.state !== "inserted") {
      throw new Error(`${origin} proposed run id ${entry.runId}, which already exists; refusing to adopt it`);
    }
    affectedTargets.push(runTarget(entry.runId));
  }
  return Object.freeze({ affectedTargets, versionChanges });
}
