import { createCredentialStore } from "../../infra/config/credential-store.js";
import { assertNoMigratedEnvironmentKeys } from "../../domain/secrets.js";
import { RunRecordService, type RunRecordServiceDependencies } from "../../core/run-record-service.js";
import { hostConfigFacts } from "../../domain/config/host-display.js";
/** Real-service runtime behind `cli dry-run-scenario`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { descriptorRuntimeNodes, workflowDryRunSupport, workflowTerminalResultExecution } from "../../base/workflow.js";
import type { WorkerBrowserSessionFactory } from "../../base/session.js";
import type { RuntimeIsolation } from "../../config/define-runtime-isolation.js";
import type { GraphNodeKind } from "../../domain/workflow/graph.js";
import { DESCRIPTORS } from "../../control/workflow-registry.js";
import {
  createCommandKernel,
  type CommandKernel,
} from "../../core/command-kernel.js";
import type { DuoCeremonyGateFactory } from "../../core/duo-ceremony-gate.js";
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
import type { DryRunScenarioAnyCase } from "../../domain/trust/dry-run-scenario.js";
import { SpanEventWireSchema } from "../../events/types.js";
import { readEventStreamLines } from "../../infra/events/jsonl-streams.js";
import { createSpanJsonlWriter } from "../../infra/events/span-jsonl-writer.js";
import { AuthorityDatabase } from "../../infra/sqlite/index.js";
import type { ProcessIdentityObserver } from "../../infra/sqlite/runtime-process-locks.js";
import { createStartPlanService } from "../dashboard/commands/start-plan-service.js";
import { runQueuedSpanEvent } from "../dashboard/commands/run-queued-span.js";
import { withCurrentSettings, createCredentialSecretSource, readSettings, requireCurrentSettings } from "../settings-runtime.js";
import { createReceiptService } from "../trust/receipt-service.js";
import { composeWorkerRuntime } from "../worker/compose.js";

const PackageVersionSchema = z.strictObject({ version: z.string().min(1) }).loose();

export interface ProductionDryRunScenarioRuntimeInput {
  readonly isolation: RuntimeIsolation;
  readonly repoRoot: string;
  readonly env: NodeJS.ProcessEnv;
  /** Test-only race seam after journal authentication and before final start admission. */
  readonly afterSettingsRead?: () => void;
  readonly clock: Clock;
  readonly ids: IdFactory;
  /** Deterministic integration seam; production always uses the real worker composition. */
  readonly drainWorker?: (workflow: string) => Promise<void>;
  /** Deterministic system edge; omitted by production CLI composition. */
  readonly sessionFactory?: WorkerBrowserSessionFactory;
  /** Deterministic credential-free gate seam; omitted by production CLI composition. */
  readonly duoCeremony?: DuoCeremonyGateFactory;
  readonly processId?: number;
  /** Test seam paired with a synthetic process id; production observes the OS. */
  readonly processIdentityObserver?: ProcessIdentityObserver;
  readonly write?: (line: string) => void;
}

function unavailable(capability: string): never {
  throw new Error(`dry-run scenario command did not compose ${capability}; this command does not use that arm`);
}

function descriptorFor(workflow: string) {
  return DESCRIPTORS.find(({ id }) => id === workflow);
}

function createScenarioKernel(input: Readonly<{
  publishQueued: RunRecordServiceDependencies["publishQueued"];
  database: AuthorityDatabase;
  clock: Clock;
  ids: IdFactory;
  appVersion: string;
  configFingerprint: string;
  configSnapshotId: string;
}>): CommandKernel {
  return createCommandKernel({
    lifecycle: new RunRecordService({ database: input.database, clock: input.clock, ids: input.ids, publishQueued: input.publishQueued }),
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
  const events = parseRunEvents(stateRoot, workflow, runId);
  // A task the executor SKIPPED on its declared condition (or an omitted step)
  // still owns a span pair — started, then ended `skipped` — so the timeline
  // can say why it did not run. Reached means executed: those spans are held
  // out, and a manifest lists such a node under `nodesExcluded`.
  const skippedSpanPaths = new Set(events
    .filter((event) => event.t === "span.ended" && event.kind === "task" && event.outcome === "skipped")
    .map((event) => event.spanPath));
  const ordered: string[] = [];
  for (const event of events) {
    const node = event.t === "span.started" && event.kind === "task"
      ? (skippedSpanPaths.has(event.spanPath) ? undefined : taskIdBySpanName.get(event.name))
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

/**
 * D318 — the graph facts that decide which T1b arm a descriptor may declare.
 * A `live-read` runs the ORDINARY path with `dryRun: false`, so the graph may
 * hold neither a transaction node nor a `child-run` node: a delegated child
 * inherits the parent's `dryRun` and its writes live under its own run, which
 * the parent's per-run zero-delta proof cannot see. Pure, so a fixture graph
 * can prove the refusal without a registered workflow.
 */
/**
 * The node kinds a `live-read` graph may hold: every one of them reads or
 * routes and none can reach an external write. This is an ALLOWLIST so that a
 * node kind added to the graph vocabulary later is refused by name until it is
 * classified, never admitted by default into a `dryRun: false` run.
 */
export const LIVE_READ_ADMITTED_NODE_KINDS: ReadonlySet<GraphNodeKind> = new Set<GraphNodeKind>([
  "task", "branch", "parallel", "gate",
]);

export function liveReadGraphRefusal(
  descriptor: NonNullable<ReturnType<typeof descriptorFor>>,
  scenarioId: string,
): string | undefined {
  const nodes = descriptorRuntimeNodes(descriptor);
  const transactions = nodes.filter((node) => node.kind === "transaction").map((node) => String(node.id));
  const delegations = nodes.filter((node) => node.kind === "child-run").map((node) => String(node.id));
  const unclassified = nodes
    .filter((node) => node.kind !== "transaction" && node.kind !== "child-run" && !LIVE_READ_ADMITTED_NODE_KINDS.has(node.kind))
    .map((node) => `${String(node.id)} (${node.kind})`);
  if (transactions.length > 0) {
    return `live-read manifest ${scenarioId} names workflow ${String(descriptor.id)}, whose compiled graph carries `
      + `transaction node(s) ${transactions.join(", ")}; a transaction-bearing graph must declare the dry-run-preview arm (D318)`;
  }
  if (delegations.length > 0) {
    return `live-read manifest ${scenarioId} names workflow ${String(descriptor.id)}, whose compiled graph carries `
      + `child-run node(s) ${delegations.join(", ")}; a delegating graph runs its child under its own run and write intents, `
      + "which this run's zero-delta proof cannot see — no live-read arm admits it (D318)";
  }
  if (unclassified.length > 0) {
    return `live-read manifest ${scenarioId} names workflow ${String(descriptor.id)}, whose compiled graph carries `
      + `node(s) of a kind the live-read arm has not classified: ${unclassified.join(", ")}; classify the kind before `
      + "admitting it to a dryRun=false run (D318)";
  }
  return undefined;
}

export function createProductionDryRunScenarioRuntime(
  input: ProductionDryRunScenarioRuntimeInput,
): DryRunScenarioRuntime {
  assertNoMigratedEnvironmentKeys(input.env);
  const hostFacts = hostConfigFacts(input.env);
  const stateRoot = join(input.repoRoot, input.isolation.stateRoot);
  const databasePath = join(stateRoot, "state.db");
  const appVersion = PackageVersionSchema.parse(
    JSON.parse(readFileSync(join(input.repoRoot, "package.json"), "utf8")),
  ).version;
  const spans = createSpanJsonlWriter({
    stateRoot,
    clock: input.clock,
    ...(input.processId === undefined ? {} : { pid: input.processId }),
  });
  let scenarioCase: DryRunScenarioAnyCase | undefined;
  let scenarioArm: "dry-run-preview" | "live-read" | undefined;
  let configIdentity: Readonly<{ fingerprint: string; snapshotId: string }> | undefined;

  const open = (): AuthorityDatabase => AuthorityDatabase.open(
    { path: databasePath, busyTimeoutMs: 5000, migrationOwner: "dry-run-scenario-runtime" },
    input.clock,
  );

  const drain = input.drainWorker ?? (async (workflow: string): Promise<void> => {
    await composeWorkerRuntime({
      isolation: input.isolation,
      // The scenario runner owns one explicit ephemeral worker identity. It
      // may restart that same member for the post-gate drain, but it never
      // infers an index from pool or lease state.
      args: [workflow, "--pool-index", "1", "--drain"],
      env: input.env,
      clock: input.clock,
      ids: input.ids,
      repoRoot: input.repoRoot,
      ...(input.sessionFactory === undefined ? {} : { sessionFactory: input.sessionFactory }),
      ...(input.duoCeremony === undefined ? {} : { duoCeremony: input.duoCeremony }),
      ...(input.processId === undefined ? {} : { processId: input.processId }),
      ...(input.processIdentityObserver === undefined
        ? {}
        : { processIdentityObserver: input.processIdentityObserver }),
      ...(input.write === undefined ? {} : { write: input.write }),
    });
  });

  const runtime: DryRunScenarioRuntime = {
    start: async (request): Promise<DryRunScenarioStarted> => {
      scenarioCase = undefined;
      scenarioArm = undefined;
      configIdentity = undefined;
      const descriptor = descriptorFor(request.manifest.workflow);
      if (descriptor === undefined) {
        throw new Error(`dry-run workflow ${request.manifest.workflow} is not registered`);
      }
      /*
       * D318 — the manifest's explicit arm must agree with the COMPILED graph,
       * before any browser or effect. A transaction-bearing graph previews its
       * first transaction under `dryRun: true` (D209/D210); a transaction-free
       * graph runs the ordinary path under `dryRun: false` and proves zero
       * write-authority deltas. Either mismatch refuses by name — a no-op
       * transaction added only to enter the preview arm is false graph
       * authority, and `dryRun: true` on a transaction-free graph would misstate
       * D209.
       */
      const support = workflowDryRunSupport(descriptor);
      let dryRun: boolean;
      if (request.manifest.arm === "live-read") {
        if ("preview" in request.scenarioCase) {
          throw new Error(`live-read manifest ${request.manifest.scenarioId} carries a preview-arm case; the arms are exclusive`);
        }
        const refusal = liveReadGraphRefusal(descriptor, request.manifest.scenarioId);
        if (refusal !== undefined) throw new Error(refusal);
        dryRun = false;
      } else {
        if (!("preview" in request.scenarioCase)) {
          throw new Error(`dry-run-preview manifest ${request.manifest.scenarioId} carries a live-read case; the arms are exclusive`);
        }
        if (support.state !== "supported") {
          throw new Error(
            support.reason === "no-transaction-node"
              ? `dry-run-preview manifest ${request.manifest.scenarioId} names workflow ${request.manifest.workflow}, whose `
                + "compiled graph has no transaction node; a transaction-free graph must declare the live-read arm (D318) "
                + "— D209 still refuses dryRun for it (no-transaction-node)"
              : `dry-run workflow ${request.manifest.workflow} is unsupported: ${support.reason}`,
          );
        }
        if (support.stopsAt !== request.manifest.transactionNode) {
          throw new Error(
            `dry-run manifest ${request.manifest.scenarioId} names transaction ${request.manifest.transactionNode}, `
            + `but descriptor ${request.manifest.workflow} stops at ${support.stopsAt}`,
          );
        }
        dryRun = true;
      }
      const database = open();
      let admitted: Readonly<{
        identity: Readonly<{ fingerprint: string; snapshotId: string }>;
        started: DryRunScenarioStarted;
      }>;
      try {
        const persistedSettings = database.withAuthorityTransaction((repositories) =>
          readSettings(repositories));
        input.afterSettingsRead?.();
        const resolved = resolveConfigWithProvenance(persistedSettings.settings, hostFacts, input.clock);
        admitted = database.withAuthorityTransaction((repositories) => {
          // SQLite excludes ordinary settings changes throughout start admission.
          // Credential availability is read independently at its next-use boundary.
          withCurrentSettings(repositories, { revision: persistedSettings.revision,
            settingsFingerprint: persistedSettings.settingsFingerprint }, () => {
            requireCurrentSettings(persistedSettings, repositories);
          });
          repositories.runtimeConfig.requireActive({
            settingsRevision: persistedSettings.revision,
            settingsFingerprint: persistedSettings.settingsFingerprint,
            configFingerprint: resolved.fingerprint,
          });
          const active = repositories.runtimeConfig.get();
          if (active === undefined) throw new Error("dry-run start lost its dashboard-activated config snapshot");
          const configSnapshotId = active.configSnapshotId;
          const identity = { fingerprint: active.configFingerprint, snapshotId: configSnapshotId };
          const plans = createStartPlanService({
            ...(request.protectedBindings === undefined ? {} : { protectedSubmissionBindings: request.protectedBindings }),
            protectedSecrets: createCredentialSecretSource(createCredentialStore({ stateRoot })),
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
            dryRun,
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
          return withCurrentSettings(repositories, { revision: persistedSettings.revision,
            settingsFingerprint: persistedSettings.settingsFingerprint }, () => {
          requireCurrentSettings(persistedSettings, repositories);
          const kernel = createScenarioKernel({
            publishQueued: (run, publication) => {
              if (publication === undefined) throw new Error("scenario queued publication context missing");
              spans.emit(runQueuedSpanEvent({ run, ...publication, actorId: LOCAL_OPERATOR_ACTOR_ID }));
            },
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
          if (outcome.state !== "applied") throw new Error("scenario start did not apply");
          const target = outcome.affectedTargets.find((entry) => entry.family === "run");
          if (target?.family !== "run") throw new Error("scenario start returned no run identity");
          const run = database.authority.runs.get(target.runId);
          if (run === undefined) {
            throw new Error(`dry-run run ${target.runId} vanished after its start command applied`);
          }
          return {
            identity,
            started: {
              runId: run.envelope.runId,
              traceId: run.envelope.traceId,
              writeSafetyBefore: database.authority.writeIntents.countDryRunEvidenceByRun(run.envelope.runId),
            },

          };
          });
        });
      } finally {
        database.close();
      }
      // Authority commits first; the write-once queue root follows through the
      // same shared projection as dashboard starts. Publish scenario identity
      // only after both the transaction handle and its required span settle.
      configIdentity = admitted.identity;
      scenarioCase = request.scenarioCase;
      scenarioArm = request.manifest.arm;
      return admitted.started;
    },

    drain,

    resolveGate: async ({ manifest, scenarioCase: expected, runId }): Promise<void> => {
      const gateExpectation = expected.gateResults[0];
      if (expected.gateResults.length !== 1 || gateExpectation === undefined) {
        throw new Error(`dry-run ${manifest.workflow}/${expected.caseId} must declare exactly one resolvable gate`);
      }
      // This runtime serves exactly one gate outcome — the local operator's
      // `approved` — so a manifest expecting anything else would be silently
      // handed a decision it did not declare.
      if (gateExpectation.decision !== "approved"
        || gateExpectation.resolvedBy !== LOCAL_OPERATOR_ACTOR_ID) {
        throw new Error(
          `dry-run ${manifest.workflow}/${expected.caseId} does not declare the approved local-operator gate this runtime serves`,
        );
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
          publishQueued: () => { throw new Error("gate resolution cannot create runs"); },
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
        const previewHash = deriveSchemaHash(RunDryRunPreviewResultSchema, "output");
        if (scenarioArm === undefined) throw new Error("dry-run evidence collection lost the admitted arm");
        if ((scenarioArm === "live-read") === ("preview" in expected)) {
          throw new Error(`dry-run ${runId} evidence arm ${scenarioArm} disagrees with its case shape`);
        }
        if (scenarioArm === "live-read") {
          // D318 — the live-read arm settled the ORDINARY workflow result: the
          // row must be bound to the descriptor's own declared result schema,
          // and never to the preview schema.
          const declaredHash = workflowTerminalResultExecution(descriptor).schemaHash;
          if (result.resultSchemaHash !== declaredHash || result.result.schemaHash !== declaredHash) {
            throw new Error(`live-read ${runId} result is not bound to ${run.envelope.workflow}'s declared result schema`);
          }
          if (result.resultSchemaHash === previewHash) {
            throw new Error(`live-read ${runId} result is bound to the preview schema; a live read previews nothing`);
          }
          return {
            ...common,
            terminal: { lifecycle: "done-live-read", resultSchema: "workflow-result", kind: "live-read" },
          };
        }
        const expectedHash = previewHash;
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
