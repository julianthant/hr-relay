import type { delegationAccountingExecution } from "../../storage/sqlite/delegation-authority.js";
import type { EvidenceSchemaReader } from "../../../models/storage/evidence-schema-admission.js";
import type { RunClaimToken } from "../../../models/run/worker.js";
import type { GateSourceRuntime } from "../gates/gate-source-runtime.js";
import type { ContentAddressedArtifactWriter } from "../../../workflow-kit/artifacts.js";
import type { RunDiagnosticCapture } from "../../../workflow-kit/diagnostics.js";
import type { AnyTask, TaskLogger } from "../../../workflow-kit/task.js";
import type { TaskStoreRegistry } from "../../../workflow-kit/task-registry.js";
import type { AnyWorkflowDescriptor, descriptorRuntimeNodes } from "../../../workflow-kit/workflow.js";
import type { JsonValue } from "../../../rules/validation/canonical-json.js";
import type { Clock } from "../../../rules/time/clock.js";
import type { IdFactory } from "../../../rules/identity/identifiers.js";
import type { NoteTimelineWriter } from "../../storage/events/note-timeline-writer.js";
import type { BrowserAction } from "../../systems/browser-shared/action-notes.js";
import type { Fingerprint, IsoInstant, NodeId, TaskId } from "../../../rules/identity/ids.js";
import type { RunLifecycle, RunRecord } from "../../../models/run/record.js";
import type { RunPreviewStep, TerminalDependencyEvidence } from "../../../models/run/result.js";
import type { FailureRecord } from "../../../models/trust/failure.js";
import type { RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import type { RuntimeFlowNode, RuntimeScope } from "../../../models/workflow/graph.js";
import type { planStepOmissions } from "../../../models/workflow/step-omission.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-repositories.js";
import type { MonotonicDeadlineScheduler } from "../scheduling/deadline-scheduler.js";
import type { runSpanPath, SpanEmitter } from "../../logs/span-emitter.js";
import type { RunMutationOutcome, WorkerRunLifecyclePort } from "../../runs/lifecycle/run-record-service.js";
import type { WorkerSessionManager } from "../workers/worker-sessions.js";
import type { RunProviderWiring } from "./run-execution-task.js";
import type { RunExecutionOutcome } from "./run-execution-outcome.js";
import type { WriteSequencer } from "./run-execution-write.js";

/** The authority surface a run execution needs; `AuthorityDatabase` satisfies it. */
export interface RunExecutionAuthority {
  readonly evidenceSchemaHash?: EvidenceSchemaReader;
  readonly authority: Pick<AuthorityRepositories, "runCheckpoints" | "gateResults" | "artifactOutbox" | "timelineEvents" | "runResults">
    & { readonly runs: Pick<AuthorityRepositories["runs"], "get"> }
    & Partial<Pick<AuthorityRepositories, "configSnapshots">>;
  afterAuthorityCommit(publish: () => void): void;
  // Injected diagnostic capture requires row authority and failure identity, never an orphan bundle.
  withAuthorityTransaction?<Result>(work: (repositories: AuthorityRepositories) => Result): Result;
}

export type ChildRunRuntimeNode = Extract<RuntimeFlowNode, { kind: "child-run" }>;
export type TaskRuntimeNode = Extract<RuntimeFlowNode, { kind: "task" }>;

/** Ref workflow-model's delegation seam: atomic fan-out enqueue, park, and typed join. */
export interface ChildRunContext {
  readonly descriptor: AnyWorkflowDescriptor;
  readonly node: ChildRunRuntimeNode;
  readonly run: RunRecord;
  readonly claim: RunClaimToken;
  readonly scope: RuntimeScope;
  readonly signal: AbortSignal;
}

export interface ChildRunBatchContext extends Omit<ChildRunContext, "node" | "scope"> {
  readonly owner: Extract<RuntimeFlowNode, { kind: "child-run" | "parallel" }>;
  readonly leaves: readonly Pick<ChildRunContext, "node" | "scope">[];
}

export interface ChildRunExecutor {
  executeChildRuns(context: ChildRunBatchContext): Promise<unknown>;
}
export interface RunArtifactProjector {
  projectOutbox(outboxIds: readonly string[]): Promise<Readonly<{ projected: number }>>;
}

export interface RunExecutorDependencies {
  readonly beforeConfirmedWrite?: () => Promise<void>;
  readonly debugEvents?: Pick<ReturnType<typeof import("../../logs/debug-events.js").createDebugEventWriter>, "emit">;
  readonly publishCheckpoint?: (repositories: AuthorityRepositories, checkpoint: RunCheckpointRecord) => void;
  readonly lifecycle: WorkerRunLifecyclePort;
  readonly descriptor: AnyWorkflowDescriptor;
  readonly stores: TaskStoreRegistry;
  readonly authority: RunExecutionAuthority;
  readonly sessions: WorkerSessionManager;
  readonly emitter: SpanEmitter;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly scheduler: MonotonicDeadlineScheduler;
  /** Immutable per-invocation task bound (ref execution-and-sessions ); no default, no opt-out. */
  readonly taskDeadlineMs: number;
  readonly log: TaskLogger;
  /** Optional production sink for task messages and browser actions. */
  readonly taskNotes?: Pick<NoteTimelineWriter, "emitRunLog" | "emitRunAction">;
  readonly retainCallback?: (identity: Readonly<{ runId: string; claimGeneration: number; attempt: number }>, operation: Promise<unknown>) => void;
  readonly writeSequencer?: WriteSequencer;
  readonly childRuns?: ChildRunExecutor;
  /** Registered workflow/external source ports for non-operator gates. */
  readonly gateSources?: GateSourceRuntime;
  /** Ref operator-trust. Absent means no automatic bundle, never a silent empty one. */
  readonly diagnostics?: RunDiagnosticCapture;

  readonly providers?: RunProviderWiring;

  readonly artifacts?: ContentAddressedArtifactWriter;
  // Absent artifact projection fails tasks declaring durable artifacts instead of silently losing output.
  readonly artifactProjector?: RunArtifactProjector;
}

export interface ClaimedRunInput {
  readonly run: unknown;
  readonly claim: unknown;
  readonly signal: AbortSignal;
}

export interface RunExecutionContext {
  readonly deps: RunExecutorDependencies;
  readonly input: ClaimedRunInput;
  readonly initial: RunRecord;
  readonly claim: RunClaimToken;
  readonly descriptor: AnyWorkflowDescriptor;
  readonly clock: Clock;
  readonly envelope: RunRecord["envelope"];
  readonly runId: RunRecord["envelope"]["runId"];
  readonly nodes: ReturnType<typeof descriptorRuntimeNodes>;
  readonly omissionPlan: ReturnType<typeof planStepOmissions>;
  readonly instant: () => IsoInstant;
  readonly getRun: () => RunRecord;
  readonly requireOriginalClaim: (current: RunRecord) => void;
  readonly pauseAtBoundary: () => void;
  readonly workerTransition: (current: RunRecord, lifecycle: RunLifecycle) => RunMutationOutcome;
  readonly transitionTo: (lifecycle: RunLifecycle) => Promise<RunRecord>;
  readonly runningLifecycle: (currentNodeId?: NodeId) => RunLifecycle;
  readonly runSpanIdentity: Readonly<{
    runId: RunRecord["envelope"]["runId"];
    attempt: RunRecord["envelope"]["attempt"];
    traceId: RunRecord["envelope"]["traceId"];
    spanPath: ReturnType<typeof runSpanPath>;
  }>;
  readonly drainBrowserActions: (spanPath: string, actions: readonly BrowserAction[], screenshotTaskId?: TaskId) => void;
  readonly emit: (event: Readonly<Record<string, unknown>>) => void;
  readonly checkCancellation: (current?: RunRecord) => void;
  readonly terminalizeAsFailure: (failure: FailureRecord) => Promise<RunExecutionOutcome>;
  readonly boundInputIdentity: (value: unknown) => string;
  readonly labelOf: (node: TaskRuntimeNode) => string;
}

export interface RunExecutionState {
  readonly accounting: ReturnType<typeof delegationAccountingExecution> | undefined;
  readonly assertAccounting: () => void;
  readonly canonicalInput: JsonValue | undefined;
  readonly taskIndex: ReadonlyMap<string, AnyTask>;
  readonly outputs: Record<string, JsonValue>;
  readonly checkpointRecords: Map<string, RunCheckpointRecord>;
  readonly childResultEvidence: Map<string, Extract<TerminalDependencyEvidence, { state: "delegation-resolved" }>>;
  readonly gateResultEvidence: Map<string, Extract<TerminalDependencyEvidence, { state: "gate-resolved" }>>;
  readonly skippedReasons: Map<string, "condition-false" | "branch-not-selected" | "step-omitted">;
  readonly assertedRecords: Map<string, Readonly<{ step: string; assertedAt: IsoInstant; output: Readonly<{ schemaHash: Fingerprint; value: JsonValue }> }>>;
  readonly dryRunSteps: Map<string, RunPreviewStep>;
  readonly previewOnly: Set<string>;
  readonly scopeFor: (dependsOn: readonly NodeId[]) => RuntimeScope;
}
