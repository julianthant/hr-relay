import { WorkerLogChannelError } from "../../storage/events/log-mutations.js";
import { OcrApprovalReadResultSchema } from "../../../models/processing/ocr/approved-snapshot.js";
import { RunContinuationRefusedError, readContinuationGate } from "../../storage/sqlite/run-continuation.js";
import { commitGeneratedCheckpoint, generatedUpdateId, pendingGeneratedUpdateIds } from "../../logs/generated-artifact-projection.js";
import { retainedRunProtectedBindings } from "../../../models/write-safety/protected-input.js";
import { shouldRetryTaskFailure } from "../policies/task-retry.js";
import { z } from "zod";
import { CURRENT_DIAGNOSTIC_SAFETY_VERSION } from "../../../models/trust/failure.js";
import type { ContentAddressedArtifactWriter } from "../../../workflow-kit/artifacts.js";
import { browserLoginFailure } from "../../systems/browser-shared/login-contract.js";
import { TaskError, taskErrorCause, wrapUnhandledTaskError } from "../../../workflow-kit/errors.js";
import type { ProviderClient } from "../../../workflow-kit/providers.js";
import type { AnyTask, TaskLogger } from "../../../workflow-kit/task.js";
import { canonicalJsonStringify, JsonValueSchema } from "../../../rules/validation/canonical-json.js";
import { observationLeafPaths, resolveObservationOrigin } from "../../../models/events/data-observation-origin.js";
import type { AnyReadTaskContract } from "../../../models/task/task-contract.js";
import type { GateResultRecord } from "../../../models/workflow/gates.js";
import { withBrowserActionNotes } from "../../systems/browser-shared/action-notes.js";
import { ProviderCapabilityIdSchema } from "../../../rules/identity/ids.js";
import type { NodeId, ProviderCapabilityId } from "../../../rules/identity/ids.js";
import { RunResultRecordSchema, type RunResultRecord } from "../../../models/run/result.js";
import type { SessionNeed } from "../../../models/sessions/session.js";
import { taskImplFingerprint } from "../../../workflow-kit/fingerprints.js";
import { RunCheckpointRecordSchema, type RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import { deriveArtifactProjectionRows } from "../../../models/workflow/artifact-projection.js";
import type { RuntimeFlowNode, RuntimeScope } from "../../../models/workflow/graph.js";
import { deriveSchemaHash, schemaBoundValueSchema } from "../../../models/validation/schema-bound-value.js";
import { createProviderClient, type ProviderAdapterRegistry, type ProviderClientDependencies, type ProviderRequestIdFactory } from "../../processing/providers/provider-client.js";
import { followingFailureCause, type FailureEvidenceCause } from "./run-failure.js";
import { taskSpanPath } from "../../logs/span-emitter.js";
import { redactObservedDataPoints } from "../../logs/observed-data.js";
import { createTaskProvenanceCollector } from "../../runs/provenance/task-provenance.js";
import { runWorkbookReferenceTypeIds } from "../../../models/dashboard/workbooks.js";
import type { RunExecutionContext, RunExecutionState, TaskRuntimeNode } from "./run-execution-contract.js";
import type { RunExecutionPlan } from "./run-execution-plan.js";
import { RunAbandonedError, type RunExecutionOutcome } from "./run-execution-outcome.js";

export interface RunProviderWiring {
  readonly adapters: ProviderAdapterRegistry;
  /** `AuthorityRepositories["configSnapshots"]` satisfies this. */
  readonly configSnapshots: Readonly<{ get(snapshotId: string): unknown }>;
  readonly idFactory: ProviderRequestIdFactory;
}

/** The per-node slice of `RunProviderWiring` plus the run's exact stored snapshot. */
type ProviderInvocationContext = Readonly<{
  wiring: RunProviderWiring;
  storedSnapshot: unknown;
}>;

/** What `executeTaskNode` proved present before invocation may attach it to ctx. */
type TaskCapabilityWiring = Readonly<{
  providers?: ProviderInvocationContext;
  artifacts?: ContentAddressedArtifactWriter;
}>;


function admittedClientFor(
  capability: ProviderCapabilityId,
  dependencies: ProviderClientDependencies,
): ProviderClient<ProviderCapabilityId> {
  switch (capability) {
    case "ocr.extract": return createProviderClient(capability, dependencies);
    case "ocr.review": return createProviderClient(capability, dependencies);
    case "geocode.census": return createProviderClient(capability, dependencies);
    case "geocode.nominatim": return createProviderClient(capability, dependencies);
    case "workbooks.library": return createProviderClient(capability, dependencies);
    case "ocr.approved-snapshot": return createProviderClient(capability, dependencies);
  }
}

const RunnableTaskSchema = z.custom<(args: {
  input: unknown;
  ctx: Readonly<Record<string, unknown>>;
}) => Promise<unknown>>((value) => typeof value === "function", "task implementation requires run");


function observeRaceLoser(error: unknown): void {
  void error;
}

// Race non-cooperative tasks against abort so cancellation cannot hold the worker indefinitely.
async function raceAbortable<Result>(
  operation: Promise<Result>,
  signal: AbortSignal,
  label: string,
  retain?: (operation: Promise<unknown>) => void,
): Promise<Result> {
  retain?.(operation);
  // Observe the race loser to prevent a late rejection becoming unhandled.
  operation.catch(observeRaceLoser);
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error(`${label} was aborted before it started`);
  }
  let removeAbort = (): void => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    const listener = (): void => {
      reject(signal.reason instanceof Error ? signal.reason : new Error(`${label} was aborted`));
    };
    signal.addEventListener("abort", listener, { once: true });
    removeAbort = (): void => signal.removeEventListener("abort", listener);
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    removeAbort();
  }
}

export function createTaskExecution(
  context: RunExecutionContext,
  state: RunExecutionState,
  preparedPlan: RunExecutionPlan,
  failNode: (node: RuntimeFlowNode, taskId: string | undefined, error: unknown, secondaryCauses?: readonly FailureEvidenceCause[]) => Promise<RunExecutionOutcome>,
  abortReason: (fallback: string) => RunAbandonedError,
) {
  const {
    deps, input, initial, claim, descriptor, clock, envelope, runId, nodes, instant, getRun, pauseAtBoundary,
    transitionTo, runningLifecycle, runSpanIdentity, drainBrowserActions, emit, labelOf,
  } = context;
  const {
    accounting, assertAccounting, canonicalInput, taskIndex, outputs, checkpointRecords,
    childResultEvidence, skippedReasons,
  } = state;
  const { continuationAuthority, memberRetry } = preparedPlan;

  const childUpstreamEvidenceFor = (nodeId: NodeId) => {
    const child = childResultEvidence.get(String(nodeId));
    if (child === undefined) return undefined;
    const results: RunResultRecord[] = [];
    const checkpoints: RunCheckpointRecord[] = [];
    const visited = new Set<string>();
    const visit = (record: RunResultRecord, depth = 0): void => {
      if (depth > 16 || visited.has(record.runId) || visited.size >= 256) throw new Error("child-upstream-cycle-or-depth");
      visited.add(record.runId); results.push(record);
      for (const dependency of record.dependencies) {
        if (dependency.state === "resolved") {
          const address = dependency.checkpoint;
          const checkpoint = deps.authority.authority.runCheckpoints.get(address.workflowId, address.itemId, dependency.nodeId, address.attempt, address.claimGeneration);
          if (checkpoint === undefined || checkpoints.length >= 256) throw new Error("child-upstream-checkpoint-unavailable-or-limit");
          if (!checkpoints.some(retained => canonicalJsonStringify(retained) === canonicalJsonStringify(checkpoint))) checkpoints.push(checkpoint);
        } else if (dependency.state === "child-resolved") {
          const nested = deps.authority.authority.runResults.get(dependency.child.runId);
          const nestedRun = deps.authority.authority.runs.get(dependency.child.runId);
          if (nested === undefined || nestedRun?.lifecycle.state !== "terminal" || nestedRun.envelope.parent?.runId !== record.runId
            || nestedRun.envelope.parent.edgeId !== dependency.edgeId || nested.resultDigest !== dependency.child.resultDigest
            || nested.dependencyDigest !== dependency.child.dependencyDigest || nested.contractFingerprint !== dependency.child.contractFingerprint
            || nested.resultSchemaHash !== dependency.child.resultSchemaHash) throw new Error("child-upstream-canonical-descendant-mismatch");
          visit(RunResultRecordSchema.parse(nested), depth + 1);
        } else if (dependency.state === "delegation-resolved") {
          for (const member of dependency.members) {
            const nested = deps.authority.authority.runResults.get(member.runId);
            const nestedRun = deps.authority.authority.runs.get(member.runId);
            if (nested === undefined || nestedRun?.lifecycle.state !== "terminal" || nestedRun.envelope.parent?.runId !== record.runId
              || nestedRun.envelope.parent.edgeId !== dependency.edgeId || nested.resultDigest !== member.resultDigest) throw new Error("child-upstream-canonical-descendant-mismatch");
            visit(RunResultRecordSchema.parse(nested), depth + 1);
          }
        }
      }
    };
    for (const member of child.children) visit(member.result);
    return { evidence: child, results, checkpoints };
  };
  const waitForBackoff = async (ms: number): Promise<void> => {
    if (ms <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const handle = deps.scheduler.schedule(clock.monotonicMs() + ms, () => {
        input.signal.removeEventListener("abort", onAbort);
        resolve();
      });
      const onAbort = (): void => {
        handle.cancel();
        reject(new RunAbandonedError(`run ${runId} was aborted during retry backoff`));
      };
      input.signal.addEventListener("abort", onAbort, { once: true });
    });
  };


  const gateResultFor = (nodeId: string): GateResultRecord | undefined => {
    const gateNode = nodes.find((candidate) => String(candidate.id) === nodeId);
    if (gateNode?.kind !== "gate") return undefined;
    return readContinuationGate(deps.authority.authority, envelope, nodeId);
  };

  const invokeTask = async (
    node: TaskRuntimeNode,
    task: AnyTask,
    scope: RuntimeScope,
    need: SessionNeed | undefined,
    capabilityWiring: TaskCapabilityWiring,
    spanPath: string,
    failureCauses: FailureEvidenceCause[],
  ): Promise<RunCheckpointRecord> => {
    const contract: AnyReadTaskContract = node.uses;
    const bound: unknown = node.bind(scope);
    const parsedInput: unknown = contract.input.parse(bound);
    const conditionIds = new Set<string>();
    const gatherCondition = (id: string): void => {
      const skipped = nodes.find(candidate => String(candidate.id) === id);
      if ((skipped?.kind !== "task" && !(skipped?.kind === "gate" && skipped.resolvedBy === "operator")) || skipped.when === undefined || skipped.when.of.from !== "node") return;
      const source = String(skipped.when.of.nodeId);
      if (!node.dependsOn.some(dependency => String(dependency) === source)) conditionIds.add(source);
      if (skippedReasons.get(source) === "condition-false") gatherCondition(source);
    };
    for (const dependency of node.dependsOn) if (skippedReasons.get(String(dependency)) === "condition-false") gatherCondition(String(dependency));
    const collector = createTaskProvenanceCollector({
      descriptor,
      schemaReader: deps.authority.evidenceSchemaHash?.bind(deps.authority),
      ...(continuationAuthority === undefined ? {} : { continuation: continuationAuthority }),
      canonicalInput, references: runWorkbookReferenceTypeIds(getRun().input.workbookReferences),
      execution: {
        runId,
        traceId: envelope.traceId,
        attempt: envelope.attempt,
        workflowId: descriptor.id,
        nodeId: String(node.id),
        taskId: contract.id,
      },

      upstreamEvidence: {
        conditionEvidence: {
          checkpoints: [...conditionIds].flatMap(id => { const checkpoint = checkpointRecords.get(id); return checkpoint === undefined ? [] : [checkpoint]; }),
          gateResults: [...conditionIds].flatMap(id => { const gate = gateResultFor(id); return gate === undefined ? [] : [gate]; }),
          skippedTasks: [...conditionIds].filter(id => skippedReasons.get(id) === "condition-false" && nodes.some(node => String(node.id) === id && node.kind === "task")),
          skippedGates: [...conditionIds].filter(id => skippedReasons.get(id) === "condition-false" && nodes.some(node => String(node.id) === id && node.kind === "gate")),
        },
        children: node.dependsOn.flatMap((dependency) => { const child = childUpstreamEvidenceFor(dependency); return child === undefined ? [] : [child]; }),
        checkpoints: node.dependsOn.flatMap((dependency) => {
          if (childResultEvidence.has(String(dependency))) return [];
          const record = checkpointRecords.get(String(dependency));
          if (record !== undefined) return [record];
          if (skippedReasons.get(String(dependency)) === "condition-false"
            && nodes.some((candidate) => candidate.id === dependency && (candidate.kind === "gate" || candidate.kind === "task"))) return [];
          if (gateResultFor(String(dependency)) !== undefined) return [];
          throw new Error(
            `task ${contract.id} declared dependency "${dependency}" has no checkpoint record to hand `
            + "to the provenance collector",
          );
        }),
        skippedTasks: node.dependsOn.filter((dependency) =>
          skippedReasons.get(String(dependency)) === "condition-false"
          && nodes.some((candidate) => candidate.id === dependency && candidate.kind === "task")),
        skippedGates: node.dependsOn.filter((dependency) =>
          skippedReasons.get(String(dependency)) === "condition-false"
          && nodes.some((candidate) => candidate.id === dependency && candidate.kind === "gate")),
        gateResults: node.dependsOn.flatMap((dependency) => {
          if (skippedReasons.get(String(dependency)) === "condition-false") return [];
          const stored = gateResultFor(String(dependency));
          return stored === undefined ? [] : [stored];
        }),
      },
      clock,

      onRecord: ({ recordedAt, points }) => {
        emit({
          t: "data.observed",
          ts: recordedAt,
          ...runSpanIdentity,
          spanPath,
          parentSpanPath: runSpanIdentity.spanPath,
          nodeId: String(node.id),
          taskId: contract.id,
          observedAt: recordedAt,
          points: redactObservedDataPoints(contract.id, points),
        });
      },
      observationSpanPath: spanPath,
    });

    const taskLog = (level: "step" | "debug" | "warn", message: string,
      fields?: Parameters<TaskLogger["info"]>[1]): void => {
      const sink = deps.taskNotes;
      if (sink === undefined) return;
      const address = { runId, attempt: envelope.attempt, traceId: envelope.traceId, spanPath };
      sink.emitRunLog({
        workflow: descriptor.id,
        address,
        level,
        message,
        fields,
      }, getRun());
    };
    const taskLogger: TaskLogger = {
      debug: (message, fields) => {
        deps.log.debug(message, fields);
        taskLog("debug", message, fields);
      },
      info: (message, fields) => {
        deps.log.info(message, fields);
        taskLog("step", message, fields);
      },
      warn: (message, fields) => {
        deps.log.warn(message, fields);
        taskLog("warn", message, fields);
      },
    };

    const controller = new AbortController();
    const forwardAbort = (): void => {
      controller.abort(input.signal.reason instanceof Error
        ? input.signal.reason
        : new Error(`run ${runId} execution was aborted`));
    };
    if (input.signal.aborted) forwardAbort();
    input.signal.addEventListener("abort", forwardAbort, { once: true });
    const deadline = deps.scheduler.schedule(
      clock.monotonicMs() + deps.taskDeadlineMs,
      () => {
        controller.abort(new Error(
          `${contract.id} exceeded its immutable ${String(deps.taskDeadlineMs)}ms task deadline`,
        ));
      },
    );

    let raw: unknown;
    try {
      const run = RunnableTaskSchema.parse(task.impl.run);
      const ctxCommon = {
        signal: controller.signal,
        log: taskLogger,
        fail: (code: string, message: string, options?: Readonly<{
          subject?: string; transient?: boolean; cause?: unknown;
        }>): never => {
          throw new TaskError(contract.id, code, message, options);
        },
        recordData: collector.recordData,
      } as const;

      const declaredProviders = contract.providers ?? [];
      let providerClients: Readonly<Record<string, ProviderClient<ProviderCapabilityId>>> | undefined;
      if (declaredProviders.length > 0) {
        const provider = capabilityWiring.providers;
        if (provider === undefined) {
          throw new Error(
            `${contract.id} requires provider capabilities but reached invocation without wiring; `
            + "executeTaskNode must refuse before invoking",
          );
        }
        // Mint one provider client per capability and invocation; it is not reusable authority.
        const clients: Record<string, ProviderClient<ProviderCapabilityId>> = {};
        for (const declared of declaredProviders) {
          const capability = ProviderCapabilityIdSchema.parse(declared);
          const client = admittedClientFor(capability, {
            execution: {
              runId,
              attempt: envelope.attempt,
              nodeId: String(node.id),
              taskId: contract.id,
            },
            configSnapshotId: envelope.configSnapshotId,
            configFingerprint: envelope.configFingerprint,
            configSnapshot: provider.storedSnapshot,
            runSignal: controller.signal,
            adapters: provider.wiring.adapters,
            observe: event => {
              taskLogger.debug("provider request", { ...(event.requestId === undefined ? {} : { requestId: event.requestId }),
                capability: event.capability, state: event.state, nodeId: String(node.id), taskId: contract.id });
              if (event.state !== "produced") deps.debugEvents?.emit({ category: "worker", phase: "failed", area: "provider",
                code: "PROVIDER_CALL_FAILED", correlationId: event.requestId ?? runId,
                reason: event.state === "timeout" ? "provider-timeout" : event.state === "aborted" ? "provider-aborted"
                  : event.state === "invalid-response" ? "provider-response-invalid" : "provider-unavailable" }, { kind: "run", runId }, envelope.workflow);
            },
            clock,
            idFactory: provider.wiring.idFactory,
            deadlineScheduler: deps.scheduler,
          });
          if (memberRetry !== undefined && memberRetry.nodeId === node.id && capability === "ocr.approved-snapshot") {
            clients[capability] = Object.freeze({ ...client, async call(payload: Parameters<typeof client.call>[0]) {
              const response = await client.call(payload);
              if (response.state === "produced") {
                const result = schemaBoundValueSchema(OcrApprovalReadResultSchema, deriveSchemaHash(OcrApprovalReadResultSchema, "output"))
                  .parse(response.value).value;
                if (result.state === "record") memberRetry.assertRetained(RunCheckpointRecordSchema.shape.output.parse({ schemaHash: deriveSchemaHash(contract.output, "output"),
                  value: JsonValueSchema.parse(contract.output.parse({ record: result.record })),
                  ...(retainedRunProtectedBindings(initial).length === 0 ? {} : { protectedBindings: retainedRunProtectedBindings(initial) }) }));
              }
              return response;
            } });
          } else clients[capability] = client;
        }
        providerClients = Object.freeze(clients);
      }
      const ctxExtras = {
        ...(providerClients === undefined ? {} : { providers: providerClients }),
        ...(capabilityWiring.artifacts === undefined ? {} : { artifacts: capabilityWiring.artifacts }),
      } as const;

      const retain = deps.retainCallback === undefined ? undefined : (operation: Promise<unknown>) => {
        deps.retainCallback?.({ runId, claimGeneration: claim.claimGeneration, attempt: envelope.attempt }, operation);
      };
      if (need === undefined) {
        raw = await withBrowserActionNotes(clock, () => raceAbortable(
          Promise.resolve().then(() => run({ input: parsedInput, ctx: { ...ctxCommon, ...ctxExtras } })),
          controller.signal, contract.id, retain,
        ), (actions) => drainBrowserActions(spanPath, actions));
      } else {
        const instanceSelection = envelope.resolvedInstance[need.system];
        if (instanceSelection === undefined) {
          throw new Error(
            `run ${runId} resolved no ${need.system} instance at enqueue, and ${contract.id} needs one`,
          );
        }
        const captureRefusals: Readonly<{ reason: string; detail?: string }>[] = [];
        const screenshotLog: Pick<TaskLogger, "warn"> = { warn: (message, fields) => {
          if (fields?.code === "BROWSER_SCREENSHOT_CAPTURE_FAILED" && typeof fields.reason === "string") {
            const detail = fields.captureFailure;
            captureRefusals.push(typeof detail === "string" && detail !== fields.reason ? { reason: fields.reason, detail } : { reason: fields.reason });
          }
          taskLogger.warn(message, fields);
        } };
        let operationFailure: Readonly<{ error: unknown }> | undefined;
        let stopped: Readonly<{ error: unknown }> | undefined;
        const failureCapture: { state: "pending" | "settled" } = { state: "pending" };
        const failureCaptureRefused = (refusal: Readonly<{ reason: string; detail?: string }>): void => {
          if (failureCapture.state === "settled") return;
          failureCapture.state = "settled";
          failureCauses.push({ code: "BROWSER_SCREENSHOT_CAPTURE_FAILED", summary: `Failure screenshot not taken: ${refusal.reason}` });
          if (refusal.detail !== undefined) failureCauses.push({ code: "BROWSER_SCREENSHOT_CAPTURE_FAILED", summary: `Screenshot capture stopped at ${refusal.detail}` });
        };
        try {
          raw = await withBrowserActionNotes(clock,
            () => raceAbortable(
              deps.sessions.withDriver(need, instanceSelection, controller.signal, (driver, captureScreenshot) => raceAbortable(
                Promise.resolve().then(async () => {
                    let captured = false;
                    let captureFailure: Readonly<{ error: unknown }> | undefined;
                    const requiredCapture = async (): Promise<void> => {
                      const earlierRefusals = captureRefusals.length;
                      try { await captureScreenshot(); captured = true; }
                      catch (error) {
                        captureFailure = { error };
                        const refusal = captureRefusals.slice(earlierRefusals).at(-1);
                        if (refusal !== undefined) failureCaptureRefused(refusal);
                        throw error;
                      }
                    };
                    let output: unknown;
                    try {
                      output = await run({ input: parsedInput, ctx: { ...ctxCommon, ...ctxExtras, driver,
                        captureScreenshot: task.impl.screenshots === "task" ? requiredCapture : () => Promise.reject(new TaskError(
                          contract.id, "BROWSER_SCREENSHOT_CAPTURE_FAILED", "Task screenshot capture requires declared task ownership",
                        )),
                      } });
                    } catch (taskFailure) {
                      stopped = { error: taskFailure };
                      // The page the step stopped on, while its lease still holds it; a refusal is evidence, never the failure.
                      if (captureFailure === undefined || captureFailure.error !== taskFailure) {
                        const earlierRefusals = captureRefusals.length;
                        try { await captureScreenshot(); }
                        catch { failureCaptureRefused(captureRefusals.slice(earlierRefusals).at(-1) ?? { reason: controller.signal.aborted ? "task-deadline" : "lease-ended" }); }
                      }
                      failureCapture.state = "settled";
                      throw taskFailure;
                    }
                    if (captureFailure !== undefined) throw captureFailure.error;
                    if (!captured) await requiredCapture();
                    return output;
                  }),
                controller.signal,
                contract.id, retain,
              ), { taskId: contract.id, nodeId: String(node.id), attempt: envelope.attempt, log: screenshotLog }),
              controller.signal,
              contract.id, retain,
            ).catch((error: unknown) => { operationFailure = { error }; throw error; }),
            (actions) => {
              try { drainBrowserActions(spanPath, actions, contract.id); }
              catch (error) {
                if (operationFailure === undefined) throw error;
                failureCauses.push({ code: "BROWSER_SCREENSHOT_CAPTURE_FAILED", summary: "Failure screenshot not saved to the run log" });
              }
            },
          );
        } catch (error) {
          // A deadline or lease fault after the task stopped is recorded beside the task's own failure, not in its place.
          if (stopped === undefined || error === stopped.error || error instanceof RunAbandonedError) throw error;
          if (failureCapture.state === "settled") failureCauses.push(followingFailureCause(error, "The browser lease failed after the task stopped"));
          else failureCaptureRefused({ reason: controller.signal.aborted ? "task-deadline" : "lease-ended" });
          throw stopped.error;
        }
      }
    } finally {
      deadline.cancel();
      input.signal.removeEventListener("abort", forwardAbort);
    }


    const provenance = collector.finalizeRead(raw);
    const parsedOutput: unknown = contract.output.parse(raw);
    return RunCheckpointRecordSchema.parse({
      workflowId: descriptor.id,
      itemId: envelope.itemId,
      nodeId: String(node.id),
      attempt: envelope.attempt,

      claimGeneration: claim.claimGeneration,
      runId,
      output: {
        schemaHash: deriveSchemaHash(contract.output, "output"),
        value: JsonValueSchema.parse(parsedOutput),
        ...(retainedRunProtectedBindings(initial).length === 0 ? {} : { protectedBindings: retainedRunProtectedBindings(initial) }),
      },
      descriptorVersion: descriptor.version,
      contractFingerprint: descriptor.contractFingerprint,
      implFingerprint: taskImplFingerprint(contract),
      provenance: provenance.provenance,
      observationOrigins: provenance.points.flatMap(point => observationLeafPaths(point.value).map(path => ({
        path: [...point.field.split("."), ...path], origin: resolveObservationOrigin({ ...point.execution, spanPath }, point, path),
      }))),
      writtenAt: instant(),
    });
  };

  const projectionsFor = (nodeId: string) =>
    (descriptor.artifactProjections ?? []).filter((spec) => String(spec.source.nodeId) === nodeId);
  const dryRunProjectionRefusal = (node: TaskRuntimeNode) =>
    new Error(`node "${node.id}" declares a durable artifact projection, which a dry run must never reach`);

  // Only the exact source checkpoint may acknowledge its retained output updates.
  const resumePendingProjections = async (
    node: TaskRuntimeNode,
    record: RunCheckpointRecord,
  ): Promise<RunExecutionOutcome | undefined> => {
    const specs = projectionsFor(String(node.id));
    if (specs.length === 0) return undefined;
    if (envelope.dryRun) return await failNode(node, node.uses.id, dryRunProjectionRefusal(node));
    try {
      const withTransaction = deps.authority.withAuthorityTransaction?.bind(deps.authority);
      if (withTransaction === undefined) throw new Error("generated-artifact-replay-requires-transaction");
      if (deps.beforeConfirmedWrite !== undefined) await deps.beforeConfirmedWrite();
      const pending = withTransaction(repositories => pendingGeneratedUpdateIds(repositories, record, specs));
      if (pending.length === 0) return undefined;
      const projector = deps.artifactProjector;
      if (projector === undefined) {
        return await failNode(node, node.uses.id, new Error(
          `node "${node.id}" replays a checkpoint with ${String(pending.length)} unacknowledged artifact `
          + "outbox rows, and this composition wires no artifact sink projector",
        ));
      }
      await projector.projectOutbox(pending);
    } catch (error) {
      if (error instanceof WorkerLogChannelError) throw error;
      return await failNode(node, node.uses.id, error);
    }
    return undefined;
  };

  const executeTaskNode = async (
    node: TaskRuntimeNode,
    scope: RuntimeScope,
  ): Promise<RunExecutionOutcome | undefined> => {
    const contract = node.uses;
    const task = taskIndex.get(contract.id);
    if (task === undefined) {
      return await failNode(node, contract.id, new Error(`no store implements ${contract.id}`));
    }
    if (task.contract !== contract) {
      return await failNode(node, contract.id, new Error(
        `store task ${contract.id} binds a different contract object than the descriptor imports`,
      ));
    }
    if (contract.artifacts !== undefined && deps.artifacts === undefined) {
      return await failNode(node, contract.id, new Error(
        `${contract.id} declares content-addressed artifacts, and this composition wires no artifact writer`,
      ));
    }
    let providerInvocation: ProviderInvocationContext | undefined;
    if (contract.providers !== undefined && contract.providers.length > 0) {
      const wiring = deps.providers;
      if (wiring === undefined) {
        return await failNode(node, contract.id, new Error(
          `${contract.id} requires provider capabilities, and this composition wires no admitted provider client`,
        ));
      }

      const storedSnapshot = wiring.configSnapshots.get(envelope.configSnapshotId);
      if (storedSnapshot === undefined) {
        return await failNode(node, contract.id, new Error(
          `run ${runId} retained config snapshot ${envelope.configSnapshotId} is absent from authority; `
          + `refusing to admit ${contract.id} provider calls without the exact stored snapshot`,
        ));
      }
      providerInvocation = Object.freeze({ wiring, storedSnapshot });
    }
    const capabilityWiring: TaskCapabilityWiring = Object.freeze({
      ...(providerInvocation === undefined ? {} : { providers: providerInvocation }),
      ...(contract.artifacts === undefined || deps.artifacts === undefined
        ? {}
        : { artifacts: deps.artifacts }),
    });

    const declaredProjections = projectionsFor(String(node.id));
    if (envelope.dryRun && declaredProjections.length > 0) return await failNode(node, contract.id, dryRunProjectionRefusal(node));
    if (declaredProjections.length > 0 && deps.artifactProjector === undefined) {
      return await failNode(node, contract.id, new Error(
        `node "${node.id}" declares a durable artifact projection, and this composition wires no `
        + "artifact sink projector",
      ));
    }
    if (declaredProjections.length > 0 && deps.authority.withAuthorityTransaction === undefined) {
      return await failNode(node, contract.id, new Error(
        `node "${node.id}" declares a durable artifact projection, whose checkpoint and outbox rows `
        + "must commit atomically — and this authority exposes no transaction",
      ));
    }

    const refreshedMember = memberRetry?.nodeId === node.id;
    const refreshedRetained = node.replay === "always-rerun" && accounting?.plan.retain.includes(String(node.id)) === true;
    const attempts = task.impl.retry?.attempts ?? 1;
    const backoffMs = task.impl.retry?.backoffMs ?? 0;
    const need = task.impl.sessions[0];
    for (let taskAttempt = 1; taskAttempt <= attempts; taskAttempt += 1) {
      await transitionTo(runningLifecycle(node.id));
      const spanPath = taskSpanPath(envelope.traceId, node.id, taskAttempt, claim.claimGeneration);
      emit({
        t: "span.started", kind: "task",
        ...runSpanIdentity, spanPath, parentSpanPath: runSpanIdentity.spanPath,
        name: labelOf(node),
        ...(need === undefined ? {} : { system: need.system }),
      });
      const failureCauses: FailureEvidenceCause[] = [];
      try {
        const record = await invokeTask(node, task, scope, need, capabilityWiring, spanPath, failureCauses);
        if (deps.beforeConfirmedWrite !== undefined) await deps.beforeConfirmedWrite();
        if (refreshedRetained || refreshedMember || accounting?.plan.recompute.includes(String(node.id))) {
          pauseAtBoundary();
          if (deps.authority.withAuthorityTransaction === undefined) throw new Error("delegation-accounting-transaction-unavailable");
          deps.authority.withAuthorityTransaction(repositories => {
            assertAccounting();
            if (refreshedRetained) accounting?.assertRetained(record);
            if (refreshedMember) memberRetry?.assertRetained(record.output);
            repositories.runCheckpoints.insert(record);
            deps.publishCheckpoint?.(repositories, record);
          });
        } else if (declaredProjections.length === 0) {
          if (deps.publishCheckpoint === undefined) deps.authority.authority.runCheckpoints.insert(record);
          else {
            if (deps.authority.withAuthorityTransaction === undefined) throw new Error("checkpoint-publication-transaction-unavailable");
            deps.authority.withAuthorityTransaction(repositories => {
              repositories.runCheckpoints.insert(record);
              deps.publishCheckpoint?.(repositories, record);
            });
          }
        } else {

          const withTransaction = deps.authority.withAuthorityTransaction?.bind(deps.authority);
          const projector = deps.artifactProjector;
          if (withTransaction === undefined || projector === undefined) {
            throw new Error(`node "${node.id}" projection wiring disappeared between refusal check and commit`);
          }
          const derived = deriveArtifactProjectionRows({
            specs: declaredProjections,
            nodeId: String(node.id),
            outputValue: record.output.value,
            runId: record.runId,
          });
          const outboxRows = derived.map((row) => ({
            outboxId: generatedUpdateId(record, row),
            artifactId: deps.ids.uuid(),
            projectionId: row.projectionId,
            stableKeyFingerprint: row.stableKeyFingerprint,
            keyValues: row.keyValues,
            sinkId: row.sinkId,
            sourceRunId: runId,
            sourceNodeId: String(node.id),
            state: "pending",
            payload: { schemaHash: record.output.schemaHash, value: row.value },
            createdAt: instant(),
          }));

          commitGeneratedCheckpoint({withTransaction, checkpoint:record, updates:outboxRows,
            ...(deps.publishCheckpoint === undefined ? {} : { publish: deps.publishCheckpoint })});
          // A task cannot finish before every artifact outbox row is acknowledged.
          await projector.projectOutbox(outboxRows.map((row) => String(row.outboxId)));
        }
        checkpointRecords.set(String(node.id), record);
        outputs[String(node.id)] = JsonValueSchema.parse(record.output.value);
        emit({
          t: "span.ended", kind: "task",
          ...runSpanIdentity, spanPath, parentSpanPath: runSpanIdentity.spanPath,
          outcome: "done",
        });
        return undefined;
      } catch (error) {
        if (error instanceof WorkerLogChannelError) throw error;
        if (input.signal.aborted) {
          emit({
            t: "span.ended", kind: "task",
            ...runSpanIdentity, spanPath, parentSpanPath: runSpanIdentity.spanPath,
            outcome: "cancelled",
          });
          throw abortReason(`run ${runId} was aborted during ${contract.id}`);
        }
        if (error instanceof RunAbandonedError || (refreshedRetained || refreshedMember) && error instanceof RunContinuationRefusedError) throw error;
        const loginFailure = browserLoginFailure(error);
        const nestedTaskError = taskErrorCause(error);
        const taskError = error instanceof TaskError ? error : nestedTaskError?.code === "BROWSER_SCREENSHOT_CAPTURE_FAILED"
          ? new TaskError(contract.id, nestedTaskError.code, "The browser screenshot could not be captured or saved.", { cause: error })
          : loginFailure !== undefined
          ? new TaskError(contract.id, loginFailure.code, loginFailure.message, { cause: error })
          : wrapUnhandledTaskError(contract.id, error);
        emit({
          t: "span.ended", kind: "task",
          ...runSpanIdentity, spanPath, parentSpanPath: runSpanIdentity.spanPath,
          outcome: "failed",
          diagnosticSafetyVersion: CURRENT_DIAGNOSTIC_SAFETY_VERSION,
          errorSummary: `task ${contract.id} failed; inspect its structured failure record`,
        });
        const retryable = shouldRetryTaskFailure(taskError.transient, taskAttempt, attempts);
        if (!retryable) return await failNode(node, contract.id, taskError, failureCauses);
        await waitForBackoff(backoffMs);
      }
    }
    throw new Error(`task ${contract.id} exhausted its retry loop without a terminal decision`);
  };

  return { projectionsFor, resumePendingProjections, executeTaskNode };
}
