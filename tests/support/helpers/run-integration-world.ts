import { jsonLeafPaths } from "../../../src/backend/runs/provenance/task-provenance.js";
import { createBoundProfileFixture } from "./admission-fixture.js";
import { buildRunResult } from "../../../src/backend/runs/lifecycle/run-result.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../../src/models/workflow/checkpoint.js";
import { ReadResolvedIdentity } from "../../../src/models/workflows/person-lookup/read-resolved-identity.js";
import { ReadActiveStatus } from "../../../src/models/workflows/person-lookup/read-active-status.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { PersonLookupCanonicalInput } from "../../../src/workflows/person-lookup/workflow.js";
import { HASH_B, HASH_C, LATER, NOW, UUID_6 } from "../fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, RUN_ID, WORKFLOW_ID } from "../fixtures/phase1f-run-fixtures.js";
import { testWorkerLifetime, testWorkerPorts } from "../fixtures/run-lifecycle-fixtures.js";
import { personLookupDescriptor } from "./registered-workflows.js";
import { type AuthorityTerminalizationHooks, AuthorityDatabase } from "./synthetic-storage-admission.js";





export const PERSON_LOOKUP_ACTIVE = ReadActiveStatus.output.parse({
  state: "active", ucpathSelection: "resolved", reason: "UCPath reports an active HDH appointment", code: null, datesEid: null, hdh: true, candidateEids: ["10873698"],
  details: { search: "10873698", name: "Fixture, Person", eid: "10873698", department: "Housing", hrStatus: "Active",
    ucpath: "Found", crm: "Not found", startDate: null, endDate: null, terminationReason: null,
    foundInUcpath: null, matchedEid: null, matchedName: null },
});

const TERMINAL_IDENTITY = ReadResolvedIdentity.output.parse({ unselectedCrmRecords: null, shouldCheckCrm: true, ucpathFound: true, crmErrorCode: null,
    state: "resolved", crmIdentity: null, selected: { emplId: "10873698", name: "Fixture, Person", department: "Housing", jobTitle: "Assistant",
      employeeStatus: "active", hrStatus: "Active", startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "", hdh: true },
    crmRecord: null, candidateEids: ["10873698"], recoveryEid: null, crmState: "Not found", method: "ucpath" });
const TERMINAL_IDENTITY_HASH = deriveSchemaHash(ReadResolvedIdentity.output, "output");
const TERMINAL_IDENTITY_PATHS = jsonLeafPaths(TERMINAL_IDENTITY);

export function personLookupTerminalIdentityEvidence(run: import("../../../src/models/run/record.js").RunRecord) {
  const observedAt = run.updatedAt;

  return [
    ...["search-identity", "crm-identity"].map(nodeId => ({ state: "resolved" as const, nodeId,
      checkpoint: RunCheckpointRecordSchema.parse({ workflowId: run.envelope.workflow, itemId: run.envelope.itemId, runId: run.envelope.runId,
        nodeId, attempt: run.envelope.attempt, claimGeneration: run.claimGeneration,
        output: { schemaHash: TERMINAL_IDENTITY_HASH, value: TERMINAL_IDENTITY },
        descriptorVersion: run.envelope.descriptorVersion, contractFingerprint: run.envelope.contractFingerprint, implFingerprint: HASH_B,
        provenance: TERMINAL_IDENTITY_PATHS.map(path => ({ path, source: "derived", observedAt, originalObservedAt: observedAt })), writtenAt: observedAt }) })),
    { state: "not-run" as const, nodeId: "matching", reason: "condition-false" },
    { state: "not-run" as const, nodeId: "crm-selected-record", reason: "condition-false" },
    { state: "not-run" as const, nodeId: "crm-results", reason: "condition-false" },
  ];
}

export function createRunIntegrationTestWorld(CLOCK = manualClock(new Date(LATER))) {

  const roots: string[] = [];
  const profiles: Awaited<ReturnType<typeof createBoundProfileFixture>>[] = [];

  const databases: AuthorityDatabase[] = [];

  const WORKER_ID = "person-lookup-worker-1";

  const CLAIM = { workerId: WORKER_ID, claimGeneration: 1 };

  const ACTIVE = PERSON_LOOKUP_ACTIVE;

  async function openDatabase(hooks?: AuthorityTerminalizationHooks): Promise<AuthorityDatabase> {
    const profile = await createBoundProfileFixture(); profiles.push(profile);
    roots.push(profile.stateRoot);
    const database = AuthorityDatabase.open(
      { path: profile.path, busyTimeoutMs: 250, migrationOwner: "unit-test" },
      CLOCK,
      undefined,
      hooks,
    );
    testWorkerPorts(database, CLOCK, { path: profile.path, descriptor: personLookupDescriptor, poolIndex: 1 });
    databases.push(database);
    return database;
  }

  function startRunning(database: AuthorityDatabase, nodeId = "crm-dates") {
    database.authority.runs.enqueue({
      ...QUEUED_RUN,
      envelope: {
        ...QUEUED_RUN.envelope,
        descriptorVersion: personLookupDescriptor.version,
        contractFingerprint: personLookupDescriptor.contractFingerprint,
      },
      input: {
        ...QUEUED_RUN.input,
        parsed: {
          ...QUEUED_RUN.input.parsed,
          schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"),
          value: { mode: "search", emplId: "10873698", crmCheck: true, keepNonHdh: false, includeCrmDates: false },
        },
      },
    });
    const claimMember1 = database.authority.workerSlots.get(WORKER_ID);
    if (claimMember1 === undefined) throw new Error("fixture-claim-member-required");
    const claimed = database.authority.runs.claimNext({ workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, claimMember1.poolIndex).workerLifetime, workflow: WORKFLOW_ID, workerId: WORKER_ID, now: NOW });
    if (claimed.state !== "claimed") throw new Error("run was not claimed");
    const validating = database.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: claimed.run.version,
      claim: CLAIM,
      lifecycle: { state: "validating", workerId: WORKER_ID, workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, claimMember1.poolIndex).workerLifetime, claimedAt: NOW, heartbeatAt: NOW },
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
        workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, claimMember1.poolIndex).workerLifetime,
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
    const identityEvidence = personLookupTerminalIdentityEvidence(run);
    for (const evidence of identityEvidence) if ("checkpoint" in evidence) database.authority.runCheckpoints.insert(evidence.checkpoint);
    const built = buildRunResult(
      personLookupDescriptor,
      run,
      [
        ...identityEvidence,
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
  function failure(run: ReturnType<typeof startRunning>) {
    return {
      failureId: UUID_6,
      fingerprint: HASH_C,
      runId: run.envelope.runId,
      traceId: run.envelope.traceId,
      attempt: run.envelope.attempt,
      workflowId: run.envelope.workflow,
      nodeId: "crm-dates",
      taskId: "crm/read-onboarding-dates",
      code: "CRM_UNAVAILABLE",
      summary: "CRM onboarding dates were unavailable",
      transient: true,
      writeState: "not-attempted",
      causeChain: [{
        code: "CRM_UNAVAILABLE",
        summary: "CRM returned an unavailable response",
        role: "primary",
        transient: true,
      }],
      remediation: [{ kind: "retry-when-served", message: "Retry after CRM is available" }],
      occurredAt: LATER,
    } as const;
  }

  function failureAuthorization(run: ReturnType<typeof startRunning>) {
    return {
      kind: "failed" as const,
      runId: run.envelope.runId,
      workflowId: run.envelope.workflow,
      attempt: run.envelope.attempt,
      descriptorVersion: run.envelope.descriptorVersion,
      contractFingerprint: run.envelope.contractFingerprint,
      expectedVersion: run.version,
      claim: CLAIM,
      authorizedAt: LATER,
      failureId: UUID_6,
    };
  }
  const cleanup = async () => {
    for (const database of databases.splice(0)) database.close();
    for (const profile of profiles.splice(0)) await profile.close();
    roots.splice(0);
  };
  return { roots, databases, CLAIM, ACTIVE, openDatabase, startRunning, resultRequest, WORKER_ID, failure, failureAuthorization, cleanup };
}
