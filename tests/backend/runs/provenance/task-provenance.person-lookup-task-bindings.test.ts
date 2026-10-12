import { createPersonLookupProvenanceCheckpoint } from "../../../support/helpers/backend/person-lookup-provenance-checkpoint.js";
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import type { RecordedDataBatch } from "../../../../src/backend/runs/provenance/task-provenance.js";
import { createTaskProvenanceCollector } from "../../../../src/backend/runs/provenance/task-provenance.js";
import { createDeterministicCrmOnboardingDriver } from "../../../../src/backend/systems/crm/driver/fake.js";
import { readOnboardingDatesTask } from "../../../../src/backend/systems/crm/tasks/read-onboarding-dates.js";
import { readOnboardingRecordTask } from "../../../../src/backend/systems/crm/tasks/read-onboarding-record.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../src/backend/systems/ucpath/driver/fake.js";
import { searchPersonOrgTask } from "../../../../src/backend/systems/ucpath/tasks/search-person-org.js";
import { CrmReadOnboardingDates,ReadOnboardingDatesOutputSchema } from "../../../../src/models/systems/crm/read-onboarding-dates.js";
import { CrmReadOnboardingRecord,ReadOnboardingRecordOutputSchema } from "../../../../src/models/systems/crm/read-onboarding-record.js";
import { SearchPersonOrg,SearchPersonOrgOutputSchema,UcpathCandidateSchema } from "../../../../src/models/systems/ucpath/search-person-org.js";
import type { RunCheckpointRecord } from "../../../../src/models/workflow/checkpoint.js";
import { ReadActiveStatus } from "../../../../src/models/workflows/person-lookup/read-active-status.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { directIdentifierDisplay } from "../../../../src/rules/redaction/redaction.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import type { DataPoint } from "../../../../src/rules/workflow/task-provenance.js";
import { DataPointSchema } from "../../../../src/rules/workflow/task-provenance.js";
import { readActiveStatusTask } from "../../../../src/workflows/person-lookup/tasks/read-active-status.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

const signal = new AbortController().signal;

const NOW = "2026-08-02T18:00:00.000Z";

const HASH_A = "a".repeat(64);

const HASH_B = "b".repeat(64);

const log = Object.freeze({
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
});

const fail = (_code: string, message: string): never => {
  throw new Error(message);
};

const failedTaskDataPoints: DataPoint[] = [];

const recordData = (input: DataPoint | readonly DataPoint[]): void => {
  for (const point of Array.isArray(input) ? input : [input]) {
    failedTaskDataPoints.push(DataPointSchema.parse(point));
  }
};

const commonCtx = { signal, log, fail, recordData };

const observedBatches: RecordedDataBatch[] = [];

function collectorFor(
  taskId: string,
  nodeId: string,
  checkpoints: readonly RunCheckpointRecord[],
) {
  return createTaskProvenanceCollector({
    descriptor: personLookupDescriptor,
    execution: {
      runId: "aaaaaaaa-0001-4000-8000-000100000000",
      traceId: "pl-180000-aaaa",
      attempt: 1,
      workflowId: "person-lookup",
      nodeId,
      taskId,
    },
    upstreamEvidence: {
      checkpoints: [...checkpoints],
    },
    clock: manualClock(new Date(NOW)),

    onRecord: (batch) => { observedBatches.push(batch); },
  });
}

const { checkpointFrom } = createPersonLookupProvenanceCheckpoint({
  itemId: "33333333-3333-4333-8333-333333333333",
  runId: "aaaaaaaa-0001-4000-8000-000100000000",
  contractFingerprint: HASH_A,
  implFingerprint: HASH_B,
  now: NOW,
});

const candidate = UcpathCandidateSchema.parse({
  emplId: "10873698",
  name: "Battistessa, Johnnie",
  department: "Housing Dining Hospitality",
  jobTitle: "Dining Assistant",
  employeeStatus: "active" as const,
  hdh: true,
});

const person = SearchPersonOrgOutputSchema.parse({
  results: [candidate],
  selection: { status: "resolved", selected: candidate, candidateEids: [candidate.emplId] },
});

const crmRecord = ReadOnboardingRecordOutputSchema.parse({
  state: "found",
  record: {
    recordId: "ONB-40213",
    emplId: candidate.emplId,
    fullName: candidate.name,
    rawStage: "Completed",
  },
});

if (crmRecord.state !== "found") throw new Error("CRM found-record fixture did not parse as found");

const crmDates = ReadOnboardingDatesOutputSchema.parse({
  emplId: candidate.emplId,
  invitedOn: { state: "present", value: "2026-06-01" },
  startsOn: { state: "present", value: "2026-07-15" },
  completedOn: { state: "absent", reason: "CRM history has no Completed transition" },
});

describe("Person Lookup task implementations", () => {
  it("executes UCPath and CRM reads only through their typed semantic drivers", async () => {
    const ucpath = createDeterministicUcpathPersonOrgDriver(person);
    const crm = createDeterministicCrmOnboardingDriver({ record: crmRecord, dates: crmDates });
    const searchCollector = collectorFor(
      SearchPersonOrg.id,
      "searching",
      [],
    );
    const searched = await searchPersonOrgTask.impl.run({
      input: { kind: "by-eid", emplId: candidate.emplId },
      ctx: { ...commonCtx, recordData: searchCollector.recordData, driver: ucpath },
    });
    assert.deepEqual(searched, person);
    const searchEvidence = searchCollector.finalizeRead(searched);
    assert.deepEqual(
      searchEvidence.points.map(({ direction, field, value }) => ({ direction, field, value })),
      [
        { direction: "read", field: "results", value: person.results },
        { direction: "read", field: "selection", value: person.selection },
      ],
    );
    assert.equal(searchEvidence.provenance.some(({ path }) => path === "results"), true);
    assert.equal(searchEvidence.provenance.some(({ path }) => path === "selection.candidateEids"), true);
    const searchCheckpoint = checkpointFrom(
      "searching",
      SearchPersonOrg.output,
      searched,
      searchEvidence.provenance,
    );

    const recordCollector = collectorFor(
      CrmReadOnboardingRecord.id,
      "cross-verify",
      [searchCheckpoint],
    );
    const record = await readOnboardingRecordTask.impl.run({
      input: { eid: candidate.emplId, name: candidate.name },
      ctx: { ...commonCtx, recordData: recordCollector.recordData, driver: crm },
    });
    assert.deepEqual(record, crmRecord);
    const recordEvidence = recordCollector.finalizeRead(record);
    assert.deepEqual(
      recordEvidence.points.map(({ direction, field, value }) => ({ direction, field, value })),
      [
        { direction: "read", field: "state", value: crmRecord.state },
        { direction: "read", field: "record", value: crmRecord.record },
      ],
    );

    const datesCollector = collectorFor(
      CrmReadOnboardingDates.id,
      "crm-dates",
      [searchCheckpoint],
    );
    const dates = await readOnboardingDatesTask.impl.run({
      input: { eid: candidate.emplId },
      ctx: { ...commonCtx, recordData: datesCollector.recordData, driver: crm },
    });
    assert.deepEqual(dates, crmDates);
    const datesEvidence = datesCollector.finalizeRead(dates);
    assert.deepEqual(
      datesEvidence.points.map(({ direction, field, value }) => ({ direction, field, value })),
      [
        { direction: "read", field: "emplId", value: crmDates.emplId },
        { direction: "read", field: "invitedOn", value: crmDates.invitedOn },
        { direction: "read", field: "startsOn", value: crmDates.startsOn },
        { direction: "read", field: "completedOn", value: crmDates.completedOn },
      ],
    );
  })

  it("derives active status and fails loud when UCPath and CRM identities disagree", async () => {
    const searchCollector = collectorFor(
      SearchPersonOrg.id,
      "searching",
      [],
    );
    searchCollector.recordData([
      { direction: "read", field: "results", value: person.results },
      { direction: "read", field: "selection", value: person.selection },
    ]);
    const searchEvidence = searchCollector.finalizeRead(person);
    const searchCheckpoint = checkpointFrom(
      "searching",
      SearchPersonOrg.output,
      person,
      searchEvidence.provenance,
    );
    const recordCollector = collectorFor(
      CrmReadOnboardingRecord.id,
      "cross-verify",
      [searchCheckpoint],
    );
    recordCollector.recordData([
      { direction: "read", field: "state", value: crmRecord.state },
      { direction: "read", field: "record", value: crmRecord.record },
    ]);
    const recordEvidence = recordCollector.finalizeRead(crmRecord);
    const recordCheckpoint = checkpointFrom(
      "cross-verify",
      CrmReadOnboardingRecord.output,
      crmRecord,
      recordEvidence.provenance,
    );
    const activeCollector = collectorFor(
      ReadActiveStatus.id,
      "active-status",
      [searchCheckpoint, recordCheckpoint],
    );
    const active = await readActiveStatusTask.impl.run({
      input: { person, crm: crmRecord, keepNonHdh: false },
      ctx: { ...commonCtx, recordData: activeCollector.recordData },
    });
    assert.equal(active.state, "active");
    const activeEvidence = activeCollector.finalizeRead(active);
    assert.deepEqual(
      activeEvidence.points.map(({ direction, field, value }) => ({ direction, field, value })),
      [
        { direction: "read", field: "state", value: active.state },
        { direction: "read", field: "reason", value: active.reason },
        { direction: "read", field: "hdh", value: active.hdh },
      ],
    );
    assert.equal(activeEvidence.provenance.every(({ source }) => source === "derived"), true);
    await assert.rejects(
      readActiveStatusTask.impl.run({
        input: {
          person,
          crm: {
            ...crmRecord,
            record: { ...crmRecord.record, emplId: EidSchema.parse("10001573") },
          },
          keepNonHdh: false,
        },
        ctx: commonCtx,
      }),
      new RegExp(`UCPath EID ${directIdentifierDisplay("10873698")} but CRM EID ${directIdentifierDisplay("10001573")}`),
    );
  })
});
