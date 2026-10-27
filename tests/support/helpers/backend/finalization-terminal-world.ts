import { testRunService, testRunLifecycle } from "../../fixtures/run-lifecycle-fixtures.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { createCommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../fixtures/intake-kernel-seams.js";
import { executeClaimedRun, type RunExecutionAuthority, type RunExecutorDependencies } from "../../../../src/backend/runtime/execution/run-executor.js";
import { RunRecordSchema, type RunRecord } from "../../../../src/models/run/record.js";
import { UcpathReadJobSummary } from "../../../../src/models/systems/ucpath/read-job-summary.js";
import { SearchPersonOrg } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { type AnyTaskContract } from "../../../../src/models/task/task-contract.js";
import { evidenceLeaves } from "../../../../src/models/trust/evidence-classification.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { SeparationsMatchDepartmentOption } from "../../../../src/models/workflows/separations/match-department-option.js";
import { MatchIdentityOutputSchema } from "../../../../src/models/workflows/separations/match-identity.js";
import { IdentityApprovalResultSchema } from "../../../../src/rules/separations/identity-approval.js";
import { BUILD_MANIFEST, resolveTaskImplFingerprint } from "../../../../src/workflow-kit/validation/build-manifest.js";
import { COMPARISON_NODE, DEPARTMENT_NODE, GATE_NODE, JOB_SUMMARY_NODE, NAME_SEARCH_NODE } from "../../../../src/workflows/separations/workflow.js";
import { UUID_7 } from "../../fixtures/phase1c-contract-fixtures.js";
import { FINALIZATION_JOB_SUMMARY_READ, FINALIZATION_NAME_SEARCH_OUTPUT, FINALIZATION_NOW, FINALIZATION_RUN_ID, FINALIZATION_RUN_INPUT, FINALIZATION_SCOPE_OUTPUTS, FINALIZATION_WORKER_ID, finalizationHarness, finalizationQueuedRun, type FinalizationHarness } from "../kuali-finalization-fixtures.js";
import { ManualScheduler, recordingLogger } from "../phase1f-executor-harness.js";
import { separationsKualiFinalizationDescriptor } from "../registered-workflows.js";





export function createFinalizationTerminalTestWorld() {
  const open: FinalizationHarness[] = [];

  const signal = new AbortController().signal;

  async function harness(): Promise<FinalizationHarness> {
    const created = await finalizationHarness();
    open.push(created);
    return created;
  }

  function executorDependencies(
    value: FinalizationHarness,
    authority: RunExecutionAuthority = value.database,
  ): RunExecutorDependencies {
    return {
      lifecycle: testRunLifecycle(value.database, value.clock),
      descriptor: separationsKualiFinalizationDescriptor,
      stores: taskStoreRegistry,
      authority,
      sessions: value.sessions,
      emitter: value.emitter.emitter,
      clock: value.clock,
      ids: value.ids,
      scheduler: new ManualScheduler(value.clock),
      taskDeadlineMs: 60_000,
      log: recordingLogger().log,
      writeSequencer: value.sequencer,
    };
  }

  function claimQueued(value: FinalizationHarness) {
    const claimed = value.database.authority.runs.claimNext({
      workflow: separationsKualiFinalizationDescriptor.id,
      workerId: FINALIZATION_WORKER_ID,
      now: value.clock.now().toISOString(),
    });
    if (claimed.state !== "claimed")
      throw new Error(`claim outcome was ${claimed.state}`);
    return {
      run: claimed.run,
      claim: {
        workerId: FINALIZATION_WORKER_ID,
        claimGeneration: claimed.run.claimGeneration,
      },
    };
  }

  function insertReplayCheckpoint(
    value: FinalizationHarness,
    run: RunRecord,
    nodeId: string,
    contract: AnyTaskContract,
    output: unknown,
    source: "live" | "derived",
  ): void {
    const parsedOutput = contract.output.parse(output);
    const inserted = value.database.authority.runCheckpoints.insert(
      RunCheckpointRecordSchema.parse({
        workflowId: separationsKualiFinalizationDescriptor.id,
        itemId: run.envelope.itemId,
        nodeId,
        attempt: run.envelope.attempt,
        claimGeneration: run.claimGeneration,
        runId: run.envelope.runId,
        output: {
          schemaHash: deriveSchemaHash(contract.output, "output"),
          value: parsedOutput,
        },
        descriptorVersion: separationsKualiFinalizationDescriptor.version,
        contractFingerprint:
          separationsKualiFinalizationDescriptor.contractFingerprint,
        implFingerprint: resolveTaskImplFingerprint(BUILD_MANIFEST, contract.id),
        provenance: evidenceLeaves(parsedOutput).map(({ path }) => ({
          path,
          source,
          observedAt: FINALIZATION_NOW,
          originalObservedAt: FINALIZATION_NOW,
        })),
        writtenAt: FINALIZATION_NOW,
      }),
    );
    if (inserted.state !== "inserted") {
      throw new Error(
        `checkpoint ${nodeId} insert outcome was ${inserted.state}`,
      );
    }
  }

  function enqueueFromComparison(
    value: FinalizationHarness,
    suppliedEid = false,
    dryRun = false,
  ) {
    const raw = RunRecordSchema.parse(
      finalizationQueuedRun({ startAt: COMPARISON_NODE, dryRun }),
    );
    const canonical = suppliedEid
      ? FINALIZATION_RUN_INPUT
      : {
          ...FINALIZATION_RUN_INPUT,
          emplIdSource: "name-resolved",
          documentEid: { state: "absent", reason: "name-only fixture" },
        };
    const run = RunRecordSchema.parse({
      ...raw,
      input: {
        ...raw.input,
        raw: canonical,
        parsed: { ...raw.input.parsed, value: canonical },
      },
    });
    const inserted = value.database.authority.runs.enqueue(run);
    if (inserted.state !== "inserted")
      throw new Error(`enqueue outcome was ${inserted.state}`);
    const claimed = claimQueued(value);
    if (FINALIZATION_JOB_SUMMARY_READ.state !== "read") {
      throw new Error(
        "the finalization UCPath fixture must carry a readable job summary",
      );
    }
    insertReplayCheckpoint(
      value,
      claimed.run,
      JOB_SUMMARY_NODE,
      UcpathReadJobSummary,
      FINALIZATION_JOB_SUMMARY_READ.summary,
      "live",
    );
    insertReplayCheckpoint(
      value,
      claimed.run,
      NAME_SEARCH_NODE,
      SearchPersonOrg,
      FINALIZATION_NAME_SEARCH_OUTPUT,
      "live",
    );
    insertReplayCheckpoint(
      value,
      claimed.run,
      DEPARTMENT_NODE,
      SeparationsMatchDepartmentOption,
      FINALIZATION_SCOPE_OUTPUTS[DEPARTMENT_NODE],
      "derived",
    );
    return claimed;
  }

  async function parkApproveAndReclaim(value: FinalizationHarness) {
    const first = enqueueFromComparison(value);
    const parked = await value.bound(() =>
      executeClaimedRun(executorDependencies(value), {
        ...first,
        signal,
      }),
    );
    if (parked.state !== "parked-gate" || parked.gateId !== GATE_NODE) {
      const failure =
        parked.state === "failed"
          ? value.database.authority.failures.get(parked.failureId)
          : undefined;
      throw new Error(
        `expected ${GATE_NODE} park, received ${JSON.stringify(parked)}: ${failure?.summary ?? "no failure"}`,
      );
    }

    const parkedRun = value.database.authority.runs.get(FINALIZATION_RUN_ID);
    if (parkedRun?.lifecycle.state !== "parked-gate") {
      throw new Error(`run did not durably park at ${GATE_NODE}`);
    }
    const comparison = value.database.authority.runCheckpoints.latest(
      separationsKualiFinalizationDescriptor.id,
      parkedRun.envelope.itemId,
      COMPARISON_NODE,
    );
    if (comparison === undefined)
      throw new Error(`${COMPARISON_NODE} checkpoint is absent`);
    const compared = MatchIdentityOutputSchema.parse(comparison.output.value);
    const approval = IdentityApprovalResultSchema.parse({
      decision: "approved",
      eid: FINALIZATION_RUN_INPUT.emplId,
      chosenFrom: "checked",
      evidenceDigest: compared.evidenceDigest,
    });
    const result = {
      schemaHash: deriveSchemaHash(IdentityApprovalResultSchema, "output"),
      value: approval,
    };
    const active = value.database.authority.runtimeConfig.get();
    if (active === undefined) throw new Error("finalization fixture runtime identity missing");
    const unrelated = (): never => { throw new Error("gate command reached an unrelated effect"); };
    const kernel = createCommandKernel({ lifecycle: testRunService(value.database, value.clock), authority: value.database,
      clock: value.clock, ids: value.ids, appVersion: "0.1.0",
      descriptors: { resolve: id => id === separationsKualiFinalizationDescriptor.id ? separationsKualiFinalizationDescriptor : undefined },
      configIdentity: { configSnapshotId: active.configSnapshotId, configFingerprint: active.configFingerprint },
      intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
      writeResolution: { resolvePresent: unrelated, resolveAbsent: unrelated },
      workerRuntime: { pool: { planPoolWorkerCount: unrelated, spawnPoolWorker: unrelated, refreshPoolBrowser: unrelated,
        reopenPoolBrowser: unrelated, stopPoolWorker: unrelated, pausePoolWorker: unrelated, resumePoolWorker: unrelated } } });
    const resolved = kernel.execute({ commandId: UUID_7, requestedAt: value.clock.now().toISOString(),
      requestedBy: "local-operator", source: "dashboard", family: "gate", type: "resolve-gate",
      target: { runId: FINALIZATION_RUN_ID, gateId: GATE_NODE, expectedVersion: parkedRun.version }, payload: { result } });
    if (resolved.state !== "applied") throw new Error(`gate command outcome was ${resolved.state}`);

    return claimQueued(value);
  }
  const cleanup = async () => {
    for (const harness of open.splice(0)) await harness.dispose();
  };
  return { open, signal, harness, executorDependencies, enqueueFromComparison, parkApproveAndReclaim, cleanup };
}
