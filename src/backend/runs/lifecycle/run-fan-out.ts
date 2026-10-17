import type { RunRecordRefusal } from "../../../models/config/authority.js";

import { CreateRunRequestSchema, lifecycleCommandId, requireLifecycleApplied, type RunRecordService } from "./run-record-service.js";
import { RuntimeConfigClaimTokenSchema } from "../../../models/config/runtime-generation.js";
import type { RunEnvelope } from "../../../models/run/envelope.js";
import { freezeWorkflowOperationDisplaySnapshot } from "../../../models/workflow/operation-display-snapshot.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import type { BrowserPresentationMode, InstanceSelection, RunPriority, RunShape } from "../../../models/run/envelope.js";
import type { StepOmissions } from "../../../models/workflow/step-omission.js";
import { isTerminalRunState, type RunRecord } from "../../../models/run/record.js";
import { RunSessionRecordSchema, type RunSessionOrigin } from "../../../models/run/session.js";

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

  readonly matchKey: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly retryOf?: string;
  readonly rawInput: unknown;

  readonly parsedInput: unknown;
}

/** Everything the runs of one fan-out share, stamped once for all of them. */
export interface FanOutEnvelope {
  readonly commandId: string;
  readonly actorId: string;
  readonly sourceBound?: RunEnvelope["sourceBound"];
  readonly recovery?: RunEnvelope["recovery"];
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
  // Optional for non-dashboard enqueue paths with retained compatibility inputs.
  readonly browserMode?: BrowserPresentationMode;
  readonly captureBrowserScreenshots?: boolean;

  readonly stepOmissions?: StepOmissions;
  readonly ingressSchemaHash: string;
  // Stamp the app build at enqueue so application-scope version changes can identify affected runs.
  readonly appVersion: string;

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
    // and enqueue anyway" (ref dashboard-surfaces  Enqueue).
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
      shape: envelope.shape, priority: envelope.priority, dryRun: envelope.dryRun, recovery: envelope.recovery,
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
