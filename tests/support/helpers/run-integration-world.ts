import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRunResult } from "../../../src/backend/runs/lifecycle/run-result.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../../src/models/workflow/checkpoint.js";
import { ReadActiveStatus } from "../../../src/models/workflows/person-lookup/read-active-status.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { PersonLookupCanonicalInput } from "../../../src/workflows/person-lookup/workflow.js";
import { HASH_B, LATER, NOW } from "../fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, RUN_ID, WORKFLOW_ID } from "../fixtures/phase1f-run-fixtures.js";
import { testWorkerPorts } from "../fixtures/run-lifecycle-fixtures.js";
import { personLookupDescriptor } from "./registered-workflows.js";
import { type AuthorityTerminalizationHooks, AuthorityDatabase } from "./synthetic-storage-admission.js";





export function createRunIntegrationTestWorld(CLOCK = manualClock(new Date(LATER))) {

  const roots: string[] = [];

  const databases: AuthorityDatabase[] = [];

  const WORKER_ID = "person-lookup-worker-1";

  const CLAIM = { workerId: WORKER_ID, claimGeneration: 1 };

  const ACTIVE = {
    state: "active" as const,
    reason: "UCPath reports an active HDH appointment and CRM onboarding is complete",
    hdh: true,
  };

  function openDatabase(hooks?: AuthorityTerminalizationHooks): AuthorityDatabase {
    const root = mkdtempSync(join(tmpdir(), "hrauto-run-terminal-"));
    roots.push(root);
    const database = AuthorityDatabase.open(
      { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
      CLOCK,
      undefined,
      hooks,
    );
    testWorkerPorts(database, CLOCK, { path: join(root, "authority.sqlite"), descriptor: personLookupDescriptor, poolIndex: 1 });
    databases.push(database);
    return database;
  }

  function startRunning(database: AuthorityDatabase, nodeId = "crm-dates") {
    database.authority.runs.enqueue({
      ...QUEUED_RUN,
      envelope: {
        ...QUEUED_RUN.envelope,
        contractFingerprint: personLookupDescriptor.contractFingerprint,
      },
      input: {
        ...QUEUED_RUN.input,
        parsed: {
          ...QUEUED_RUN.input.parsed,
          schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"),
          value: { emplId: "10873698", keepNonHdh: false, includeCrmDates: false },
        },
      },
    });
    const claimed = database.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId: WORKER_ID, now: NOW });
    if (claimed.state !== "claimed") throw new Error("run was not claimed");
    const validating = database.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: claimed.run.version,
      claim: CLAIM,
      lifecycle: { state: "validating", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW },
      now: NOW,
    });
    if (validating.state !== "applied") throw new Error("run did not enter validating");
    const running = database.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: validating.run.version,
      claim: CLAIM,
      lifecycle: {
        state: "running",
        workerId: WORKER_ID,
        claimedAt: NOW,
        heartbeatAt: NOW,
        currentNodeId: nodeId,
      },
      now: NOW,
    });
    if (running.state !== "applied") throw new Error("run did not enter running");
    return running.run;
  }

  function resultRequest(database: AuthorityDatabase, run: ReturnType<typeof startRunning>) {
    const activeCheckpoint = RunCheckpointRecordSchema.parse({
      workflowId: run.envelope.workflow,
      itemId: run.envelope.itemId,
      nodeId: "active-status",
      attempt: run.envelope.attempt,
      claimGeneration: 1,
      runId: run.envelope.runId,
      output: { schemaHash: deriveSchemaHash(ReadActiveStatus.output, "output"), value: ACTIVE },
      descriptorVersion: run.envelope.descriptorVersion,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
      implFingerprint: HASH_B,
      provenance: [{ path: "state", source: "derived", observedAt: NOW, originalObservedAt: NOW }],
      writtenAt: NOW,
    });
    database.authority.runCheckpoints.insert(activeCheckpoint);
    const built = buildRunResult(
      personLookupDescriptor,
      run,
      [
        { state: "resolved", nodeId: "active-status", checkpoint: activeCheckpoint },
        { state: "not-run", nodeId: "crm-dates", reason: "condition-false" },
      ],
      CLOCK,
    );
    const result = built.record;
    const authorization = {
      kind: "done" as const,
      runId: result.runId,
      workflowId: result.workflowId,
      attempt: result.attempt,
      descriptorVersion: result.descriptorVersion,
      contractFingerprint: result.contractFingerprint,
      expectedVersion: run.version,
      claim: CLAIM,
      authorizedAt: LATER,
      resultDigest: result.resultDigest,
    };
    return { result, authorization, factoryAuthorization: built.authorization };
  }
  return { roots, databases, CLAIM, ACTIVE, openDatabase, startRunning, resultRequest, WORKER_ID };
}
