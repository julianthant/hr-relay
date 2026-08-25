/** Real-service runtime behind `cli dry-run-scenario`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { descriptorRuntimeNodes, workflowDryRunSupport } from "../../base/workflow.js";
import type { WorkerBrowserSessionFactory } from "../../base/session.js";
import type { RuntimeIsolation } from "../../config/define-runtime-isolation.js";
import { DESCRIPTORS } from "../../control/workflow-registry.js";
import {
  createCommandKernel,
  type CommandKernel,
} from "../../core/command-kernel.js";
import type {
  DryRunScenarioRuntime,
  DryRunScenarioStarted,
} from "../../core/dry-run-scenario-runner.js";
import type { Clock } from "../../domain/clock.js";
import { resolveConfigWithProvenance } from "../../domain/config/resolve.js";
import { MatchIdentityOutputSchema } from "../../domain/contracts/separations/match-identity.js";
import type { IdFactory } from "../../domain/identifiers.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../domain/ids.js";
import { RunDryRunPreviewResultSchema } from "../../domain/run/result.js";
import { deriveSchemaHash } from "../../domain/schema-bound-value.js";
import { IdentityApprovalResultSchema } from "../../domain/separations/identity-approval.js";
import type { DryRunScenarioCase } from "../../domain/trust/dry-run-scenario.js";
import { SpanEventWireSchema } from "../../events/types.js";
import { readEventStreamLines } from "../../infra/events/jsonl-streams.js";
import { AuthorityDatabase } from "../../infra/sqlite/index.js";
import { createStartPlanService } from "../dashboard/commands/start-plan-service.js";
import { createReceiptService } from "../trust/receipt-service.js";
import { composeWorkerRuntime } from "../worker/compose.js";

const PackageVersionSchema = z.strictObject({ version: z.string().min(1) }).loose();

export interface ProductionDryRunScenarioRuntimeInput {
  readonly isolation: RuntimeIsolation;
  readonly repoRoot: string;
  readonly env: NodeJS.ProcessEnv;
  readonly clock: Clock;
  readonly ids: IdFactory;
  /** Deterministic integration seam; production always uses the real worker composition. */
  readonly drainWorker?: (workflow: string) => Promise<void>;
  /** Deterministic system edge; omitted by production CLI composition. */
  readonly sessionFactory?: WorkerBrowserSessionFactory;
  readonly processId?: number;
  readonly write?: (line: string) => void;
}

function unavailable(capability: string): never {
  throw new Error(`dry-run scenario command did not compose ${capability}; this command does not use that arm`);
}

function descriptorFor(workflow: string) {
  return DESCRIPTORS.find(({ id }) => id === workflow);
}

function createScenarioKernel(input: Readonly<{
  database: AuthorityDatabase;
  clock: Clock;
  ids: IdFactory;
  appVersion: string;
  configFingerprint: string;
  configSnapshotId: string;
}>): CommandKernel {
  return createCommandKernel({
    authority: { withAuthorityTransaction: (work) => input.database.withAuthorityTransaction(work) },
    clock: input.clock,
    ids: input.ids,
    appVersion: input.appVersion,
    descriptors: { resolve: descriptorFor },
    configIdentity: {
      configFingerprint: input.configFingerprint,
      configSnapshotId: input.configSnapshotId,
    },
    writeResolution: {
      resolvePresent: () => unavailable("write resolution"),
      resolveAbsent: () => unavailable("write resolution"),
    },
    workerRuntime: {
      planWorkerCount: () => unavailable("worker planning"),
      spawnWorker: () => unavailable("worker spawning"),
      refreshBrowser: () => unavailable("browser refresh"),
      reopenBrowser: () => unavailable("browser reopen"),
    },
    intakeParser: { parse: () => unavailable("intake parsing") },
    intakeProjections: { resolve: () => undefined },
    archiveSnapshots: { snapshot: () => unavailable("archive snapshots") },
  });
}

function requireApplied(action: string, outcome: ReturnType<CommandKernel["execute"]>): void {
  if (outcome.state === "applied") return;
  const detail = "message" in outcome
    ? outcome.message
    : "the command journal reports this first execution was already applied";
  throw new Error(`${action} was ${outcome.state}: ${detail}`);
}

function parseRunEvents(stateRoot: string, workflow: string, runId: string) {
  return readEventStreamLines(stateRoot, "spans")
    .filter(({ file }) => file.workflow === workflow)
    .map(({ text }) => SpanEventWireSchema.parse(JSON.parse(text)))
    .filter((event) => "runId" in event && event.runId === runId);
}

function reachedNodes(
  stateRoot: string,
  workflow: string,
  runId: string,
  descriptor: NonNullable<ReturnType<typeof descriptorFor>>,
  failedNodeId?: string,
): readonly string[] {
  const taskIdBySpanName = new Map<string, string>();
  for (const node of descriptorRuntimeNodes(descriptor)) {
    if (node.kind !== "task") continue;
    const spanName = node.label ?? node.uses.title;
    if (taskIdBySpanName.has(spanName)) {
      throw new Error(`descriptor ${descriptor.id} repeats task span name ${spanName}; reached-node evidence is ambiguous`);
    }
    taskIdBySpanName.set(spanName, String(node.id));
  }
  const ordered: string[] = [];
  for (const event of parseRunEvents(stateRoot, workflow, runId)) {
    const node = event.t === "span.started" && event.kind === "task"
      ? taskIdBySpanName.get(event.name)
      : event.t === "gate.opened"
        ? event.gate
        : event.t === "transaction.previewed"
          ? event.node
          : undefined;
    if (node !== undefined && !ordered.includes(node)) ordered.push(node);
  }
  // A transaction failure happens before `transaction.previewed`; its durable
  // FailureRecord is the authority that proves the node was entered.
  if (failedNodeId !== undefined && !ordered.includes(failedNodeId)) ordered.push(failedNodeId);
  return Object.freeze(ordered);
}

export function createProductionDryRunScenarioRuntime(
  input: ProductionDryRunScenarioRuntimeInput,
): DryRunScenarioRuntime {
  const stateRoot = join(input.repoRoot, input.isolation.stateRoot);
  const databasePath = join(stateRoot, "state.db");
  const appVersion = PackageVersionSchema.parse(
    JSON.parse(readFileSync(join(input.repoRoot, "package.json"), "utf8")),
  ).version;
  let scenarioCase: DryRunScenarioCase | undefined;
  let configIdentity: Readonly<{ fingerprint: string; snapshotId: string }> | undefined;

  const open = (): AuthorityDatabase => AuthorityDatabase.open(
    { path: databasePath, busyTimeoutMs: 5000, migrationOwner: "dry-run-scenario-runtime" },
    input.clock,
  );

  const drain = input.drainWorker ?? (async (workflow: string): Promise<void> => {
    await composeWorkerRuntime({
      isolation: input.isolation,
      args: [workflow, "--drain"],
      env: input.env,
      clock: input.clock,
      ids: input.ids,
      repoRoot: input.repoRoot,
      ...(input.sessionFactory === undefined ? {} : { sessionFactory: input.sessionFactory }),
      ...(input.processId === undefined ? {} : { processId: input.processId }),
      ...(input.write === undefined ? {} : { write: input.write }),
    });
  });

  const runtime: DryRunScenarioRuntime = {
    start: async (request): Promise<DryRunScenarioStarted> => {
      scenarioCase = request.scenarioCase;
      const descriptor = descriptorFor(request.manifest.workflow);
      if (descriptor === undefined) {
        throw new Error(`dry-run workflow ${request.manifest.workflow} is not registered`);
      }
      const support = workflowDryRunSupport(descriptor);
      if (support.state !== "supported") {
        throw new Error(
          `dry-run workflow ${request.manifest.workflow} is unsupported: ${support.reason}`,
        );
      }
      if (support.stopsAt !== request.manifest.transactionNode) {
        throw new Error(
          `dry-run manifest ${request.manifest.scenarioId} names transaction ${request.manifest.transactionNode}, `
          + `but descriptor ${request.manifest.workflow} stops at ${support.stopsAt}`,
        );
      }
      const database = open();
      try {
        const resolved = resolveConfigWithProvenance(input.env, {}, input.clock);
        const configSnapshotId = input.ids.uuid();
        database.authority.configSnapshots.insert({
          configSnapshotId,
          revision: 1,
          fingerprint: resolved.fingerprint,
          capturedAt: input.clock.now().toISOString(),
          capturedBy: LOCAL_OPERATOR_ACTOR_ID,
          config: resolved.config,
          provenance: resolved.provenance,
        });
        configIdentity = { fingerprint: resolved.fingerprint, snapshotId: configSnapshotId };
        const plans = createStartPlanService({
          authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
          authorityRead: database,
          descriptors: { resolve: descriptorFor },
          clock: input.clock,
          ids: input.ids,
          planTtlMs: 10 * 60 * 1000,
          configFingerprint: resolved.fingerprint,
          configSnapshotId,
          plannedBy: LOCAL_OPERATOR_ACTOR_ID,
        });
        const plan = plans.plan({
          workflowId: request.manifest.workflow,
          submissions: [request.canonicalInput],
          dryRun: true,
          priority: "interactive",
        });
        if (plan.refused.length !== 0 || plan.planned.length !== 1) {
          throw new Error(
            `dry-run start plan for ${request.manifest.workflow}/${request.scenarioCase.subjectLabel} `
            + `planned ${String(plan.planned.length)} and refused ${String(plan.refused.length)}; exactly one planned run is required`,
          );
        }
        const planned = plan.planned[0];
        if (planned === undefined) throw new Error("dry-run start plan lost its only planned run");
        const before = database.authority.writeIntents.countDryRunEvidenceByRun(planned.runId);
        const kernel = createScenarioKernel({
          database,
          clock: input.clock,
          ids: input.ids,
          appVersion,
          configFingerprint: resolved.fingerprint,
          configSnapshotId,
        });
        const outcome = kernel.execute({
          commandId: input.ids.uuid(),
          requestedAt: input.clock.now().toISOString(),
          requestedBy: LOCAL_OPERATOR_ACTOR_ID,
          source: "dry-run-scenario",
          family: "start",
          type: "start-run",
          target: {
            workflowId: plan.workflowId,
            startPlanId: plan.startPlanId,
            expectedVersion: plan.expectedVersion,
          },
          payload: plan.fingerprints,
        });
        requireApplied("dry-run start-run command", outcome);
        return {
          runId: planned.runId,
          traceId: planned.traceId,
          writeSafetyBefore: before,
        };
      } finally {
        database.close();
      }
    },

    drain,

    resolveGate: async ({ manifest, scenarioCase: expected, runId }): Promise<void> => {
      const gateExpectation = expected.gateResults[0];
      if (expected.gateResults.length !== 1 || gateExpectation === undefined) {
        throw new Error(`dry-run ${manifest.workflow}/${expected.caseId} must declare exactly one resolvable gate`);
      }
      if (gateExpectation.decision !== "approved"
        || gateExpectation.resolvedBy !== LOCAL_OPERATOR_ACTOR_ID
        || gateExpectation.leaf !== "resolve-gate-approved") {
        throw new Error(`dry-run ${manifest.workflow}/${expected.caseId} does not name the served approved gate leaf`);
      }
      const database = open();
      try {
        const run = database.authority.runs.get(runId);
        if (run === undefined) throw new Error(`dry-run ${runId} does not exist after worker drain`);
        if (run.lifecycle.state !== "parked-gate"
          || String(run.lifecycle.gateId) !== String(gateExpectation.gate)) {
          throw new Error(`dry-run ${runId} is ${run.lifecycle.state}, not parked at ${gateExpectation.gate}`);
        }
        const descriptor = descriptorFor(manifest.workflow);
        if (descriptor === undefined) throw new Error(`workflow ${manifest.workflow} is not registered`);
        const gate = descriptorRuntimeNodes(descriptor).find((node) =>
          node.kind === "gate" && String(node.id) === String(gateExpectation.gate));
        if (gate === undefined || gate.kind !== "gate") {
          throw new Error(`descriptor ${manifest.workflow} has no gate ${gateExpectation.gate}`);
        }
        const comparison = database.authority.runCheckpoints.latest(
          run.envelope.workflow,
          run.envelope.itemId,
          "comparison",
        );
        if (comparison === undefined || comparison.runId !== runId) {
          throw new Error(`dry-run ${runId} has no current comparison checkpoint for gate approval`);
        }
        const compared = MatchIdentityOutputSchema.parse(comparison.output.value);
        const identity = configIdentity;
        if (identity === undefined) throw new Error("dry-run gate resolution lost its start config identity");
        const kernel = createScenarioKernel({
          database,
          clock: input.clock,
          ids: input.ids,
          appVersion,
          configFingerprint: identity.fingerprint,
          configSnapshotId: identity.snapshotId,
        });
        const outcome = kernel.execute({
          commandId: input.ids.uuid(),
          requestedAt: input.clock.now().toISOString(),
          requestedBy: LOCAL_OPERATOR_ACTOR_ID,
          source: "dry-run-scenario",
          family: "gate",
          type: "resolve-gate",
          target: {
            runId,
            gateId: gateExpectation.gate,
            expectedVersion: run.version,
          },
          payload: {
            result: {
              schemaHash: deriveSchemaHash(gate.result, "output"),
              value: {
                decision: "approved",
                eid: compared.packet.emplId,
                chosenFrom: "checked",
                evidenceDigest: compared.evidenceDigest,
              },
            },
          },
        });
        requireApplied("dry-run resolve-gate command", outcome);
      } finally {
        database.close();
      }
    },

    collectEvidence: async (runId): Promise<unknown> => {
      const expected = scenarioCase;
      if (expected === undefined) throw new Error("dry-run evidence collection ran before start");
      const database = open();
      try {
        const run = database.authority.runs.get(runId);
        if (run === undefined) throw new Error(`dry-run ${runId} does not exist at evidence collection`);
        if (run.lifecycle.state !== "terminal") {
          throw new Error(`dry-run ${runId} is ${run.lifecycle.state}; evidence requires a terminal run`);
        }
        const checkpoints = database.authority.runCheckpoints
          .listByItem(run.envelope.workflow, run.envelope.itemId)
          .filter((checkpoint) => checkpoint.runId === runId)
          .sort((left, right) => {
            const leftIndex = expected.nodesReached.indexOf(left.nodeId);
            const rightIndex = expected.nodesReached.indexOf(right.nodeId);
            return leftIndex - rightIndex;
          })
          .map((checkpoint) => ({
            node: checkpoint.nodeId,
            attempt: checkpoint.attempt,
            keyedBy: [
              "workflow", "item", "node", "attempt",
              ...(checkpoint.claimGeneration === undefined ? [] : ["claimGeneration"]),
            ],
          }));
        const gateResults = database.authority.gateResults.listByRun(runId).map((gate) => ({
          gate: gate.gateId,
          decision: IdentityApprovalResultSchema.parse(gate.result.value).decision,
          resolvedBy: gate.resolvedBy,
        }));
        const receipt = createReceiptService({ database, descriptors: DESCRIPTORS }).ensureReceipt(runId);
        const failure = run.lifecycle.failureId === undefined
          ? undefined
          : database.authority.failures.get(run.lifecycle.failureId);
        if (run.lifecycle.outcome === "failed" && failure === undefined) {
          throw new Error(`dry-run ${runId} failed without its durable failure record`);
        }
        const descriptor = descriptorFor(run.envelope.workflow);
        if (descriptor === undefined) throw new Error(`dry-run ${runId} names unregistered workflow ${run.envelope.workflow}`);
        const receiptEvidence = {
          result: receipt.result,
          confidence: receipt.confidence,
          verification: receipt.verification.map(({ obligation, verdict, mandatory }) => ({
            obligation,
            verdict,
            mandatory,
          })),
        };
        const common = {
          reachedNodeIds: reachedNodes(
            stateRoot,
            run.envelope.workflow,
            runId,
            descriptor,
            failure?.nodeId,
          ),
          checkpoints,
          gateResults,
          writeSafetyAfter: database.authority.writeIntents.countDryRunEvidenceByRun(runId),
          receipt: receiptEvidence,
        };
        if (run.lifecycle.outcome === "failed") {
          if (failure?.nodeId === undefined) {
            throw new Error(`dry-run ${runId} failed before a node; this scenario requires node-bound evidence`);
          }
          return {
            ...common,
            terminal: {
              lifecycle: "failed",
              code: failure.code,
              node: failure.nodeId,
              fingerprint: failure.fingerprint,
            },
          };
        }
        if (run.lifecycle.outcome !== "done") {
          throw new Error(`dry-run ${runId} terminal outcome ${run.lifecycle.outcome} is unsupported scenario evidence`);
        }
        const result = database.authority.runResults.get(runId);
        if (result === undefined) throw new Error(`dry-run ${runId} is done without a run result`);
        const expectedHash = deriveSchemaHash(RunDryRunPreviewResultSchema, "output");
        if (result.resultSchemaHash !== expectedHash || result.result.schemaHash !== expectedHash) {
          throw new Error(`dry-run ${runId} result is not bound to RunDryRunPreviewResultSchema`);
        }
        const previewResult = RunDryRunPreviewResultSchema.parse(result.result.value);
        const preview = previewResult.preview.outcome.state === "already-present"
          ? {
            outcome: "already-present" as const,
            proofSource: previewResult.preview.outcome.proofSource,
            staged: false as const,
            subject: "not-observed" as const,
          }
          : {
            outcome: "would-prepare" as const,
            subject: previewResult.preview.outcome.subject.state,
            staged: true,
          };
        return {
          ...common,
          terminal: {
            lifecycle: "done",
            resultSchema: "RunDryRunPreviewResultSchema",
            kind: previewResult.kind,
            externalCommit: previewResult.externalCommit,
            stoppedAtNodeId: previewResult.stoppedAtNodeId,
            preview,
          },
        };
      } finally {
        database.close();
      }
    },
  };
  return Object.freeze(runtime);
}
