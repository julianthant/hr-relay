import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { createTaskProvenanceCollector } from "../../src/backend/runs/task-provenance.js";
import type { RecordedDataBatch } from "../../src/backend/runs/task-provenance.js";
import { JsonValueSchema } from "../../src/domain/canonical-json.js";
import { manualClock } from "../../src/domain/clock.js";
import {
  CrmReadOnboardingDates,
  ReadOnboardingDatesOutputSchema,
} from "../../src/domain/contracts/crm/read-onboarding-dates.js";
import {
  CrmReadOnboardingRecord,
  ReadOnboardingRecordOutputSchema,
} from "../../src/domain/contracts/crm/read-onboarding-record.js";
import { ReadActiveStatus } from "../../src/domain/contracts/person-lookup/read-active-status.js";
import {
  SearchPersonOrg,
  SearchPersonOrgOutputSchema,
  UcpathCandidateSchema,
} from "../../src/domain/contracts/ucpath/search-person-org.js";
import { EidSchema } from "../../src/domain/ids.js";
import { directIdentifierDisplay } from "../../src/domain/redaction.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { DataPointSchema } from "../../src/domain/task-provenance.js";
import type { DataPoint } from "../../src/domain/task-provenance.js";
import { RunCheckpointRecordSchema } from "../../src/domain/workflow/checkpoint.js";
import type { FactProvenance, RunCheckpointRecord } from "../../src/domain/workflow/checkpoint.js";
import { readOnboardingDatesTask } from "../../src/stores/crm/tasks/read-onboarding-dates.js";
import { readOnboardingRecordTask } from "../../src/stores/crm/tasks/read-onboarding-record.js";
import { readActiveStatusTask } from "../../src/stores/person-lookup/tasks/read-active-status.js";
import { searchPersonOrgTask } from "../../src/stores/ucpath/tasks/search-person-org.js";
import { taskStoreRegistry } from "../../src/backend/app/task-registry.js";
import { createDeterministicCrmOnboardingDriver } from "../../src/stores/crm/driver/fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../src/stores/ucpath/driver/fake.js";
import { personLookupDescriptor } from "../helpers/registered-workflows.js";

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
    // D270 — an explicit recording sink; the collector has no no-op default.
    onRecord: (batch) => { observedBatches.push(batch); },
  });
}

function checkpointFrom(
  nodeId: string,
  outputSchema: z.ZodType,
  output: unknown,
  provenance: readonly FactProvenance[],
): RunCheckpointRecord {
  return RunCheckpointRecordSchema.parse({
    workflowId: "person-lookup",
    itemId: "33333333-3333-4333-8333-333333333333",
    nodeId,
    attempt: 1,
    claimGeneration: 1,
    runId: "aaaaaaaa-0001-4000-8000-000100000000",
    output: {
      schemaHash: deriveSchemaHash(outputSchema, "output"),
      value: JsonValueSchema.parse(outputSchema.parse(output)),
    },
    descriptorVersion: 1,
    contractFingerprint: HASH_A,
    implFingerprint: HASH_B,
    provenance,
    writtenAt: NOW,
  });
}

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

describe("Phase 1f Person Lookup task implementations", () => {
  it("binds every descriptor task into the one runtime task-store index", () => {
    assert.deepEqual(
      taskStoreRegistry.stores
        .flatMap((store) => Object.values(store.tasks).map((task) => String(task.contract.id)))
        .sort(),
      [
        "crm/read-onboarding-dates",
        "crm/read-onboarding-record",
        // The extraction service store lands before any descriptor consumes it.
        "extraction/extract-pdf-pages",
        "extraction/extract-spreadsheet",
        // Separations chunk 5's finalization family shares the SAME driver
        // declaration as the separation form read.
        "kuali/match-separation-finalization",
        // Separations chunk 2's Kuali passage: ONE task for the whole
        // separation form (D194), a sibling of the write family on the SAME
        // driver declaration rather than a second store.
        "kuali/read-separation-document",
        "kuali/save-separation-finalization",
        "kuali/search-separation-action",
        "kuali/stage-separation-finalization",
        "kuali/verify-separation-finalization",
        // Separations chunk 1's New Kronos passage: one task per PAGE VISIT
        // (D194), which is why the timecard's navigate/subject/range/read are
        // one entry and not four.
        "new-kronos/read-separation-timecard",
        "new-kronos/search-employee",
        // The normalization service store (D165) lands before any descriptor
        // consumes it.
        "normalization/read-contact-advice",
        // Route 1 of D151; a peer of the `cli ocr` routes, not a
        // privileged path.
        "ocr/extract-form-page",
        // The roster service store (D163) lands before any descriptor consumes it.
        "roster/match-spreadsheet",
        // D194's rich Person Org read: the whole Employment Instances grid,
        // one page visit (separations chunk 3).
        // Separations chunk 4's UCPath termination write: TWO transactions
        // (the date-agnostic pending sweep, then the filing) with ref write-safety §5's
        // two probe kinds and a verifier each, all on the SAME `ucpath` driver
        // declaration as the Person Org reads (D197 rule 1).
        "ucpath/create-termination",
        "ucpath/delete-pending-terminations",
        "ucpath/match-existing-termination",
        "ucpath/match-pending-terminations",
        "ucpath/read-job-summary",
        "ucpath/read-pending-termination-set",
        "ucpath/search-person-org",
        "ucpath/stage-pending-termination-sweep",
        "ucpath/stage-termination",
        "ucpath/verify-pending-terminations-cleared",
        "ucpath/verify-termination",
        "ucpath/verify-termination-filing-present",
        "workflow:person-lookup/read-active-status",
        // The `separations` pure workflow mini-store, complete as of chunk 6:
        // §4a's termination-type refusal, chunk 3's identity comparison and
        // post-gate check, chunk 5's department fold, and the five decisions
        // only a graph holding ALL of the reads can make — the document's own
        // plan (S7's future refusal and the Kronos window), S18/S19's subject
        // fork, S23/S24's employment selection, the date reconciliation that is
        // the write's payload, and D130's receipt-pair check. Every one of them
        // is sessionless and browser-free.
        "workflow:separations/match-active-employment",
        "workflow:separations/match-department-option",
        "workflow:separations/match-identity",
        "workflow:separations/match-separation-subject",
        "workflow:separations/match-termination-type",
        "workflow:separations/read-separation-dates",
        "workflow:separations/read-separation-plan",
        "workflow:separations/verify-identity-approval",
        "workflow:separations/verify-termination-receipt",
      ],
    );
  });

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
  });

  it("fails CRM reads when the displayed subject or extracted output EID differs", async () => {
    const observedWrong = createDeterministicCrmOnboardingDriver({
      record: crmRecord,
      dates: crmDates,
      recordObservedEid: "10001573",
      datesObservedEid: "10001573",
    });
    await assert.rejects(
      readOnboardingRecordTask.impl.run({
        input: { eid: candidate.emplId, name: candidate.name },
        ctx: { ...commonCtx, driver: observedWrong },
      }),
      new RegExp(`expected EID ${directIdentifierDisplay("10873698")} but bound ${directIdentifierDisplay("10001573")}`),
    );
    await assert.rejects(
      readOnboardingDatesTask.impl.run({
        input: { eid: candidate.emplId },
        ctx: { ...commonCtx, driver: observedWrong },
      }),
      new RegExp(`expected EID ${directIdentifierDisplay("10873698")} but bound ${directIdentifierDisplay("10001573")}`),
    );

    const mismatchedOutputs = createDeterministicCrmOnboardingDriver({
      record: {
        state: "absent",
        queriedEid: EidSchema.parse("10001573"),
        reason: "no record for the wrong displayed person",
      },
      dates: { ...crmDates, emplId: EidSchema.parse("10001573") },
    });
    await assert.rejects(
      readOnboardingRecordTask.impl.run({
        input: { eid: candidate.emplId, name: candidate.name },
        ctx: { ...commonCtx, driver: mismatchedOutputs },
      }),
      new RegExp(`returned output for ${directIdentifierDisplay("10001573")}`),
    );
    await assert.rejects(
      readOnboardingDatesTask.impl.run({
        input: { eid: candidate.emplId },
        ctx: { ...commonCtx, driver: mismatchedOutputs },
      }),
      new RegExp(`returned output for ${directIdentifierDisplay("10001573")}`),
    );
  });

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
  });

  it("keeps genuine unresolved and inactive outcomes distinct", async () => {
    const unresolved = await readActiveStatusTask.impl.run({
      input: {
        person: {
          results: [],
          selection: {
            status: "not-found",
            selected: null,
            candidateEids: [],
            searchName: "Nobody, Missing",
          },
        },
        crm: { state: "absent", queriedEid: candidate.emplId, reason: "no matching record" },
        keepNonHdh: false,
      },
      ctx: commonCtx,
    });
    assert.equal(unresolved.state, "undetermined");

    const terminated = UcpathCandidateSchema.parse({ ...candidate, employeeStatus: "terminated" });
    const inactive = await readActiveStatusTask.impl.run({
      input: {
        person: {
          results: [terminated],
          selection: {
            status: "resolved",
            selected: terminated,
            candidateEids: [candidate.emplId],
          },
        },
        crm: crmRecord,
        keepNonHdh: false,
      },
      ctx: commonCtx,
    });
    assert.equal(inactive.state, "inactive");
  });

  it("checks an absent CRM EID before returning the non-HDH outcome", async () => {
    const nonHdh = UcpathCandidateSchema.parse({ ...candidate, hdh: false });
    await assert.rejects(
      readActiveStatusTask.impl.run({
        input: {
          person: {
            results: [nonHdh],
            selection: {
              status: "resolved",
              selected: nonHdh,
              candidateEids: [nonHdh.emplId],
            },
          },
          crm: {
            state: "absent",
            queriedEid: EidSchema.parse("10001573"),
            reason: "no record for the wrong person",
          },
          keepNonHdh: false,
        },
        ctx: commonCtx,
      }),
      new RegExp(`UCPath EID ${directIdentifierDisplay("10873698")} but CRM EID ${directIdentifierDisplay("10001573")}`),
    );
  });
});
