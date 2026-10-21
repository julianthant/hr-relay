import { WorkerSessionClosureUnprovedError } from "../../runtime/workers/worker-sessions.js";
import { composeRuntimePreflight, type RuntimePreflight } from "../preflight/runtime-admission.js";
import type { RuntimePreflightRunnerFactory } from "../preflight/runtime-runners.js";
import { createCredentialStore } from "../../storage/configuration/credential-store.js";
import { assertNoMigratedEnvironmentKeys } from "../../../models/config/secrets.js";
import { RunRecordService, type RunRecordServiceDependencies } from "../../runs/lifecycle/run-record-service.js";
import { hostConfigFacts } from "../../../models/config/host-display.js";
/** Real-service runtime behind `cli dry-run-scenario`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { descriptorRuntimeNodes, workflowDryRunSupport, workflowTerminalResultExecution } from "../../../workflow-kit/workflow.js";
import type { WorkerBrowserSessionFactory } from "../../../workflow-kit/session.js";
import type { RuntimeIsolation } from "../../../models/config/define-runtime-isolation.js";
import type { GraphNodeKind } from "../../../models/workflow/graph.js";
import { DESCRIPTORS } from "../registries/workflow-registry.js";
import { separationsKualiFinalizationModule } from "../registries/step-proof-modules.js";
import {
  createCommandKernel,
  type CommandKernel,
} from "../../runs/commands/command-kernel.js";
import type { DuoCeremonyGateFactory } from "../../runtime/gates/duo-ceremony-gate.js";
import type {
  DryRunScenarioRuntime,
  DryRunScenarioStarted,
} from "../../runs/start/dry-run-scenario-runner.js";
import type { Clock } from "../../../rules/time/clock.js";
import { resolveConfigWithProvenance } from "../config/resolve.js";
import { MatchIdentityOutputSchema } from "../../../models/workflows/separations/match-identity.js";
import type { IdFactory } from "../../../rules/identity/identifiers.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../rules/identity/ids.js";
import { RunDryRunPreviewResultSchema } from "../../../models/run/result.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { IdentityApprovalResultSchema } from "../../../rules/separations/identity-approval.js";
import type { DryRunScenarioAnyCase } from "../../../models/trust/dry-run-scenario.js";
import { NoteWireSchema, SpanEventWireSchema } from "../../../models/events/types.js";
import { readTimelineRecords } from "../../storage/events/timeline-reader.js";
import { createTimelineEmitter } from "../../storage/events/timeline-emitter.js";
import { AuthorityDatabase } from "../../storage/sqlite/index.js";
import { type RuntimeAdmission } from "../../storage/admission/admission.js";
import { requireRuntimeAdmission } from "../../storage/admission/admission-identity.js";
import type { ProcessIdentityObserver } from "../../storage/sqlite/runtime-process-locks.js";
import { createStartPlanService } from "../../runs/commands/start-plan-service.js";
import { runQueuedSpanEvent } from "../../runs/commands/run-queued-span.js";
import { withCurrentSettings, createCredentialSecretSource, readSettings, requireCurrentSettings } from "../../runtime/settings/settings-runtime.js";
import { createTrustRunReader } from "../../runs/trust/canonical-reader.js";
import { requireTrustRun, assertTrustEvidenceIdentity } from "../../runs/trust/run-reader.js";
import { createReceiptService } from "../../runs/trust/receipt-service.js";
import { composeWorkerRuntime } from "../composition/worker-compose.js";

import { createServerVerifiedArtifactReader } from "../../storage/artifacts/server-verified-artifact-reader.js";
import { readRunCaptureSection } from "../../runs/queries/run-captures.js";
import { nodeIdOfTaskSpanPath } from "../../runs/lifecycle/support.js";
import { LogIdentityRefusedError } from "../../runs/commands/refusals.js";

const PackageVersionSchema = z.strictObject({ version: z.string().min(1) }).loose();

export interface ProductionDryRunScenarioRuntimeInput {
  readonly admission?: RuntimeAdmission;
  readonly preflightRunnerFactory?: RuntimePreflightRunnerFactory;
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
  return DESCRIPTORS.find(({ id }) => id === workflow)
    ?? (workflow === separationsKualiFinalizationModule.descriptor.id
      ? separationsKualiFinalizationModule.descriptor
      : undefined);
}

const SCENARIO_DESCRIPTORS = Object.freeze([...DESCRIPTORS, separationsKualiFinalizationModule.descriptor]);

function createScenarioKernel(input: Readonly<{
  publishQueued: RunRecordServiceDependencies["publishQueued"];
  preflight?: RuntimePreflight;
  database: AuthorityDatabase;
  clock: Clock;
  ids: IdFactory;
  appVersion: string;
  configFingerprint: string;
  configSnapshotId: string;
}>): CommandKernel {
  return createCommandKernel({
    ...(input.preflight === undefined ? {} : { preflight: input.preflight.admission }),
    lifecycle: new RunRecordService({ database: input.database, clock: input.clock, ids: input.ids, publishQueued: input.publishQueued,
      ...(input.preflight === undefined ? {} : { admitQueuedRun: run => input.preflight?.admission.assertReady(input.preflight.runScope(run.envelope)) }) }),
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
    workerRuntime: { pool: {
      planPoolWorkerCount: async () => unavailable("worker planning"),
      spawnPoolWorker: async () => unavailable("worker spawning"),
      refreshPoolBrowser: async () => unavailable("browser refresh"),
      reopenPoolBrowser: async () => unavailable("browser reopen"),
      stopPoolWorker: async () => unavailable("worker stopping"),
      pausePoolWorker: async () => unavailable("worker pausing"),
      resumePoolWorker: async () => unavailable("worker resuming"),
    } },
    intakeParser: { parse: () => unavailable("intake parsing") },
    intakeProjections: { resolve: () => undefined },
  });
}

function requireApplied(action: string, outcome: ReturnType<CommandKernel["execute"]>): void {
  if (outcome.state === "applied") return;
  const detail = "message" in outcome
    ? outcome.message
    : "the command journal reports this first execution was already applied";
  throw new Error(`${action} was ${outcome.state}: ${detail}`);
}

function parseRunEvents(database: AuthorityDatabase, workflow: string, runId: string) {
  return readTimelineRecords(database.authority.timelineEvents, 0, runId).records
    .filter((record) => record.workflow === workflow && record.payload.kind === "span")
    .map((record) => SpanEventWireSchema.parse(record.payload.kind === "span" ? record.payload.event : undefined))
    .filter((event) => "runId" in event && event.runId === runId);
}

function reachedNodes(
  database: AuthorityDatabase,
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
  const events = parseRunEvents(database, workflow, runId);

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

  if (failedNodeId !== undefined && !ordered.includes(failedNodeId)) ordered.push(failedNodeId);
  return Object.freeze(ordered);
}

// Live-read graphs cannot contain transactions or delegated children whose effects escape zero-delta proof.

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
      + `transaction node(s) ${transactions.join(", ")}; a transaction-bearing graph must declare the dry-run-preview arm`;
  }
  if (delegations.length > 0) {
    return `live-read manifest ${scenarioId} names workflow ${String(descriptor.id)}, whose compiled graph carries `
      + `child-run node(s) ${delegations.join(", ")}; a delegating graph runs its child under its own run and write intents, `
      + "which this run's zero-delta proof cannot see — no live-read arm admits it";
  }
  if (unclassified.length > 0) {
    return `live-read manifest ${scenarioId} names workflow ${String(descriptor.id)}, whose compiled graph carries `
      + `node(s) of a kind the live-read arm has not classified: ${unclassified.join(", ")}; classify the kind before `
      + "admitting it to a dryRun=false run";
  }
  return undefined;
}

export function createProductionDryRunScenarioRuntime(
  input: ProductionDryRunScenarioRuntimeInput,
): DryRunScenarioRuntime {
  assertNoMigratedEnvironmentKeys(input.env);
  const admission = requireRuntimeAdmission(input.admission);
  const hostFacts = hostConfigFacts(input.env);
  const stateRoot = admission.stateRoot;
  const databasePath = join(stateRoot, "state.db");
  const appVersion = PackageVersionSchema.parse(
    JSON.parse(readFileSync(join(input.repoRoot, "package.json"), "utf8")),
  ).version;

  let scenarioCase: DryRunScenarioAnyCase | undefined;
  let scenarioArm: "dry-run-preview" | "live-read" | undefined;
  let configIdentity: Readonly<{ fingerprint: string; snapshotId: string }> | undefined;

  const open = (): AuthorityDatabase => AuthorityDatabase.open(
    admission,
    { path: databasePath, busyTimeoutMs: 5000, migrationOwner: "dry-run-scenario-runtime" },
    input.clock,
  );

  const drain = input.drainWorker ?? (async (workflow: string): Promise<void> => {
    const report = await composeWorkerRuntime({
      admission,
      ...(workflow === separationsKualiFinalizationModule.descriptor.id
        ? { scenarioStepProofModule: separationsKualiFinalizationModule }
        : {}),
      ...(input.preflightRunnerFactory === undefined ? {} : { preflightRunnerFactory: input.preflightRunnerFactory }),
      isolation: input.isolation,

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
    if (report.closure === "unproved") throw new WorkerSessionClosureUnprovedError(report.workerId);
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
                + "compiled graph has no transaction node; a transaction-free graph must declare the live-read arm "
                + "— dryRun is refused for it (no-transaction-node)"
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
        const resolved = resolveConfigWithProvenance(persistedSettings.settings, hostFacts, input.clock,
          { stateRoot: admission.stateRoot, artifactRoot: admission.artifactRoot });
        database.withAuthorityTransaction(repositories => {
          withCurrentSettings(repositories, { revision: persistedSettings.revision, settingsFingerprint: persistedSettings.settingsFingerprint }, () => requireCurrentSettings(persistedSettings, repositories));
          repositories.runtimeConfig.requireActive({ settingsRevision: persistedSettings.revision, settingsFingerprint: persistedSettings.settingsFingerprint, configFingerprint: resolved.fingerprint });
        });
        const preflight = composeRuntimePreflight({ admission, database, clock: input.clock, repoRoot: input.repoRoot, isolation: input.isolation,
          descriptors: { resolve: descriptorFor }, descriptorSetHash: descriptor.contractFingerprint,
          protectedSecrets: createCredentialSecretSource(createCredentialStore({ admission, stateRoot })), environment: input.env,
          ...(input.preflightRunnerFactory === undefined ? {} : { runnerFactory: input.preflightRunnerFactory }) });
        const preflightScope = preflight.currentScope(request.manifest.workflow);
        await preflight.admission.prepare(preflightScope, new AbortController().signal);
        preflight.admission.assertReady(preflightScope);
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
            ...(request.manifest.arm === "live-read" ? { recovery: "restart-from-start" as const } : {}),
            preflight: preflight.admission,
            ...(request.protectedBindings === undefined ? {} : { protectedSubmissionBindings: request.protectedBindings }),
            protectedSecrets: createCredentialSecretSource(createCredentialStore({ admission, stateRoot })),
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
            captureBrowserScreenshots: request.scenarioCase.screenshots !== undefined,

            browserMode: resolved.config.browser.headless ? "headless" : "headed",
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
            preflight,
            publishQueued: (run, publication) => {
              if (publication === undefined) throw new Error("scenario queued publication context missing");
              createTimelineEmitter({ repository: database.authority.timelineEvents, clock: input.clock,
                ...(input.processId === undefined ? {} : { pid: input.processId }) }).emit(runQueuedSpanEvent({ run, ...publication, actorId: LOCAL_OPERATOR_ACTOR_ID }));
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
        const runReader = createTrustRunReader(database, input.clock);
        const run = requireTrustRun(runReader, runId);
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
        const gateResults = database.authority.gateResults.listByRun(runId).map((gate) => {
          if (!("resolvedBy" in gate)) throw new Error(`dry-run ${runId} contains a source-settled gate`);
          return {
            gate: gate.gateId,
            decision: IdentityApprovalResultSchema.parse(gate.result.value).decision,
            resolvedBy: gate.resolvedBy,
          };
        });
        const receipt = createReceiptService({ database, descriptors: SCENARIO_DESCRIPTORS, runReader }).ensureReceipt(runId);
        const failure = run.lifecycle.failureId === undefined
          ? undefined
          : database.authority.failures.get(run.lifecycle.failureId);
        if (run.lifecycle.outcome === "failed" && failure === undefined) {
          throw new Error(`dry-run ${runId} failed without its durable failure record`);
        }
        if (failure !== undefined) assertTrustEvidenceIdentity(run, failure, "dry-run failure");
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
        const screenshots = expected.screenshots === undefined ? undefined : await (async () => {
          const artifactReader = createServerVerifiedArtifactReader({ admission });
          await artifactReader.ready;
          const captures = await readRunCaptureSection({ runReader,
            captures: { authority: database.authority.diagnosticBundles, artifactReader } }, runId);
          if (captures.section !== "captures") throw new Error("scenario capture query returned a different section");
          return readTimelineRecords(database.authority.timelineEvents, 0, runId).records.flatMap(record => {
            if (record.payload.kind !== "note") return [];
            const note = NoteWireSchema.parse(record.payload.note);
            if (note.action?.kind !== "screenshot" || !note.action.targetId.endsWith(".task-capture")) return [];
            const association = z.templateLiteral([z.uuid(), ":", z.uuid()]).safeParse(note.action.value);
            const node = nodeIdOfTaskSpanPath(note.spanPath);
            if (!("runId" in note) || note.runId !== runId || note.workflow !== run.envelope.workflow
              || record.workflow !== run.envelope.workflow || note.traceId !== run.envelope.traceId
              || note.attempt !== run.envelope.attempt || node === undefined || !association.success
              || note.action.physicalSessionId === undefined) {
              throw new LogIdentityRefusedError("RUN_LOG_SCREENSHOT_IDENTITY_MISMATCH");
            }
            const [bundleId, artifactId] = association.data.split(":");
            const artifact = captures.payload.artifacts.find(capture => capture.artifact.artifactId === artifactId);
            const origins = artifact?.origins.filter(origin => origin.bundleId === bundleId
              && origin.browserCapture?.nodeId === node && origin.browserCapture.attempt === note.attempt
              && origin.browserCapture.sessionId === note.action?.physicalSessionId);
            if (artifact?.artifact.mediaKind !== "image" || origins?.length !== 1) {
              throw new LogIdentityRefusedError("RUN_LOG_SCREENSHOT_IDENTITY_MISMATCH");
            }
            return [{ node, attempt: note.attempt, sessionId: note.action.physicalSessionId, bundleId, artifactId }];
          });
        })();
        const common = {
          runAttempt: run.envelope.attempt,
          reachedNodeIds: reachedNodes(
            database,
            run.envelope.workflow,
            runId,
            descriptor,
            failure?.nodeId,
          ),
          checkpoints,
          gateResults,
          writeSafetyAfter: database.authority.writeIntents.countDryRunEvidenceByRun(runId),
          receipt: receiptEvidence,
          ...(screenshots === undefined ? {} : { screenshots }),
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
