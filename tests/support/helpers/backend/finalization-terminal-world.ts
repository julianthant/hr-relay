import { testRunLifecycle } from "../../fixtures/run-lifecycle-fixtures.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { deriveGateResultCheckpointFingerprint } from "../../../../src/backend/runs/commands/command-kernel.js";
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

  function harness(): FinalizationHarness {
    const created = finalizationHarness();
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
    const gateInsert = value.database.authority.gateResults.insert({ nodeId: GATE_NODE,
      runId: FINALIZATION_RUN_ID,
      gateId: GATE_NODE,
      commandId: UUID_7,
      expectedVersion: parkedRun.version,
      resolvedBy: "local-operator",
      resolvedAt: value.clock.now().toISOString(),
      checkpointFingerprint: deriveGateResultCheckpointFingerprint(result),
      result,
    });
    if (gateInsert.state !== "inserted")
      throw new Error(`gate insert outcome was ${gateInsert.state}`);
    const resumed = value.database.authority.runs.resume({
      runId: FINALIZATION_RUN_ID,
      expectedVersion: parkedRun.version,
      startAt: parkedRun.lifecycle.resumeAt,
      now: value.clock.now().toISOString(),
    });
    if (resumed.state !== "applied")
      throw new Error(`resume outcome was ${resumed.state}`);

    return claimQueued(value);
  }
  return { open, signal, harness, executorDependencies, enqueueFromComparison, parkApproveAndReclaim };
}
