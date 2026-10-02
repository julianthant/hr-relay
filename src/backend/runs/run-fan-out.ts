import type { RunRecordRefusal } from "../../domain/authority.js";
/**
 * The ONE place N queued runs are inserted (ref dashboard-surfaces §2.4 Enqueue, D171, D174).
 *
 * Start and intake commands share this atomic fan-out.
 * Lifecycle creation and publication belong to the injected run service.
 *
 * Everything it writes is inside the CALLER's authority transaction, so a
 * refusal on run 39 of 40 leaves nothing behind. That property is why the
 * refusal is a `never`-returning callback rather than a returned result: a
 * caller that could keep going after a policy refusal would be able to enqueue
 * exactly the partial fan-out this function exists to prevent.
 */
import { CreateRunRequestSchema, lifecycleCommandId, requireLifecycleApplied, type RunRecordService } from "./run-record-service.js";
import { RuntimeConfigClaimTokenSchema } from "../../domain/config/runtime-generation.js";
import type { RunEnvelope } from "../../domain/run/envelope.js";
import { freezeWorkflowOperationDisplaySnapshot } from "../../domain/workflow/operation-display-snapshot.js";
import type { AuthorityRepositories } from "../storage/sqlite/authority-database.js";
import type { AnyWorkflowDescriptor } from "../../base/workflow.js";
import type { BrowserPresentationMode, InstanceSelection, RunPriority, RunShape } from "../../domain/run/envelope.js";
import type { StepOmissions } from "../../domain/workflow/step-omission.js";
import { isTerminalRunState, type RunRecord } from "../../domain/run/record.js";
import { RunSessionRecordSchema, type RunSessionOrigin } from "../../domain/run/session.js";

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
  readonly itemId: string;
  /** Only ever used to NAME the item in an enqueue-policy refusal. */
  readonly matchKey: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly retryOf?: string;
  readonly rawInput: unknown;
  /** The canonical value bound to its schema hash (D62/D110). */
  readonly parsedInput: unknown;
}

/** Everything the runs of one fan-out share, stamped once for all of them. */
export interface FanOutEnvelope {
  readonly commandId: string;
  readonly actorId: string;
  readonly sourceBound?: RunEnvelope["sourceBound"];
  readonly relaunch?: Readonly<{ archivedRunId: string; archiveFingerprint: string }>;
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
  /** Optional only for non-dashboard/historical-compatible enqueue doors. */
  readonly browserMode?: BrowserPresentationMode;
  readonly captureBrowserScreenshots?: boolean;
  /** D307 — copied unchanged onto every fanned-out run. */
  readonly stepOmissions?: StepOmissions;
  readonly ingressSchemaHash: string;
  /**
   * Charter §25 / D179: the app build stamped on every run AT ENQUEUE. It is
   * required here — the one place runs are created — because a run without it
   * cannot be told apart from a current one by an application-scope version
   * bump, and back-filling it later would claim a build the run never saw.
   */
  readonly appVersion: string;
  /**
   * D269 (ref execution-and-sessions §11.1): the SESSION this fan-out is. One
   * per fan-out, N ≥ 1, minted by the caller and inserted before members,
   * inside the same outer transaction.
   */
  readonly session: Readonly<{ sessionId: string; origin: RunSessionOrigin }>;
}

/** A refusal must abort the caller's outer authority transaction. */
export type FanOutRefusal = (message: string, refusal?: RunRecordRefusal) => never;

export function fanOutQueuedRuns(
  repositories: AuthorityRepositories,
  lifecycle: RunRecordService,
  refuse: FanOutRefusal,
  descriptor: AnyWorkflowDescriptor,
  envelope: FanOutEnvelope,
  planned: readonly PlannedRunInsert[],
  now: string,
  origin: string,
): Readonly<{ affectedTargets: readonly TargetReference[]; versionChanges: readonly VersionChange[]; runs: readonly RunRecord[] }> {
  if (envelope.relaunch !== undefined) refuse("archive relaunch is retired", { reason: "invalid-state" });
  const operationDisplaySnapshot = freezeWorkflowOperationDisplaySnapshot({
    workflowId: descriptor.id,
    definitionFingerprint: descriptor.contractFingerprint,
    display: descriptor.operationDisplay,
  });
  const runs: RunRecord[] = [];
  const activeConfig = repositories.runtimeConfig.get();
  if (activeConfig === undefined) throw new Error("fan-out has no active runtime config");
  const runtimeConfig = RuntimeConfigClaimTokenSchema.parse({ generation: activeConfig.generation,
    settingsRevision: activeConfig.settingsRevision, settingsFingerprint: activeConfig.settingsFingerprint,
    configFingerprint: activeConfig.configFingerprint });
  const affectedTargets: TargetReference[] = [];
  const versionChanges: VersionChange[] = [];
  /*
   * The session row FIRST (D269). It holds no member list — membership is the
   * `sessionId` each run below carries — so inserting it before the loop is
   * what lets `runs.enqueue` refuse a member whose session authority never
   * wrote, and a refusal on run 39 of 40 still unwinds it with everything else.
   */
  const session = repositories.runSessions.insert(RunSessionRecordSchema.parse({
    sessionId: envelope.session.sessionId,
    groupInQueue: planned.length > 1,
    version: 1,
    workflow: envelope.workflow,
    origin: envelope.session.origin,
    startedAt: now,
    createdAt: now,
  }));
  if (session.state !== "inserted") {
    throw new Error(
      `${origin} proposed session id ${envelope.session.sessionId}, which already exists; refusing to adopt it`,
    );
  }
  for (const entry of planned) {
    // An authority read error here aborts the whole fan-out — never "continue
    // and enqueue anyway" (ref dashboard-surfaces §2.4 Enqueue).
    const active = activeRunsForItem(repositories, envelope.workflow, entry.itemId);
    if (descriptor.enqueue === "reject-active" && active.length > 0) {
      refuse(
        `${envelope.workflow} item ${entry.itemId} (${entry.matchKey}) already has an active run `
        + `(${active[0].envelope.traceId}); nothing from ${origin} was started`,
      );
    }
    if (descriptor.enqueue === "supersede-active") {
      for (const activeRun of active) {
        const outcome = lifecycle.transition({
          commandId: lifecycleCommandId("operator-supersede", { commandId: envelope.commandId, runId: activeRun.envelope.runId }),
          runId: activeRun.envelope.runId,
          expectedVersion: activeRun.version,
          lifecycle: { state: "terminal", outcome: "superseded", endedAt: now },
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

    const create = CreateRunRequestSchema.parse(Object.fromEntries(Object.entries({
      commandId: lifecycleCommandId("operator-create", { commandId: envelope.commandId, entry: runs.length }),
      code: descriptor.code, matchKey: entry.matchKey, workflow: envelope.workflow,
      descriptorVersion: envelope.descriptorVersion, contractFingerprint: envelope.contractFingerprint,
      operationDisplayCapability: operationDisplaySnapshot === undefined ? "legacy" : "complete",
      operationDisplaySnapshot,
      requestedInstance: envelope.requestedInstance, resolvedInstance: envelope.resolvedInstance,
      configFingerprint: envelope.configFingerprint, configSnapshotId: envelope.configSnapshotId,
      shape: envelope.shape, priority: envelope.priority, dryRun: envelope.dryRun,
      browserMode: envelope.browserMode, captureBrowserScreenshots: envelope.captureBrowserScreenshots,
      stepOmissions: envelope.stepOmissions, sourceBound: envelope.sourceBound,
      retryOf: entry.retryOf, appVersion: envelope.appVersion, sessionId: envelope.session.sessionId,
      input: { raw: entry.rawInput, parsed: entry.parsedInput, ingressSchemaHash: envelope.ingressSchemaHash },
      runtimeConfig,
    }).filter(([, value]) => value !== undefined)));
    const publication = { title: entry.title, ...(entry.subtitle === undefined ? {} : { subtitle: entry.subtitle }), actorId: envelope.actorId };
    const outcome = lifecycle.create(create, publication);
    if (outcome.state === "refused") refuse("run lifecycle refused", outcome.refusal);
    const record = requireLifecycleApplied(outcome);
    runs.push(record);
    affectedTargets.push(runTarget(record.envelope.runId));
    versionChanges.push({ target: runTarget(record.envelope.runId), before: 0, after: record.version });
  }
  return Object.freeze({ affectedTargets, versionChanges, runs });
}
