import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { createTaskProvenanceCollector } from "../../src/core/task-provenance.js";
import { JsonValueSchema } from "../../src/domain/canonical-json.js";
import { manualClock } from "../../src/domain/clock.js";
import { ContractFieldPathSchema, ProvenancePolicySchema } from "../../src/domain/contracts/base.js";
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
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import {
  FactProvenanceSchema,
  RunCheckpointRecordSchema,
} from "../../src/domain/workflow/checkpoint.js";
import type {
  FactProvenance,
  RunCheckpointRecord,
} from "../../src/domain/workflow/checkpoint.js";
import { personLookupDescriptor } from "../../src/workflows/person-lookup/descriptor.js";
import {
  FixtureStage,
  fixtureDescriptor,
} from "./architecture/helpers/descriptor-fixtures.js";

const NOW = "2026-08-02T18:00:00.000Z";
const EARLIER = "2026-08-02T16:00:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const RUN_ID = "aaaaaaaa-0001-4000-8000-000100000000";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";

const candidate = UcpathCandidateSchema.parse({
  emplId: "10873698",
  name: "Battistessa, Johnnie",
  department: "Housing Dining Hospitality",
  jobTitle: "Dining Assistant",
  employeeStatus: "active",
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
if (crmRecord.state !== "found") throw new Error("CRM provenance fixture did not parse as found");
const crmFoundRecord = crmRecord.record;

function execution(nodeId: string, taskId: string) {
  return {
    runId: RUN_ID,
    traceId: "pl-180000-aaaa",
    attempt: 1,
    workflowId: "person-lookup",
    nodeId,
    taskId,
  };
}

function collector(
  nodeId: string,
  taskId: string,
  checkpoints: readonly RunCheckpointRecord[],
  now = NOW,
) {
  return createTaskProvenanceCollector({
    descriptor: personLookupDescriptor,
    execution: execution(nodeId, taskId),
    upstreamEvidence: { checkpoints: [...checkpoints] },
    clock: manualClock(new Date(now)),
  });
}

function checkpointFrom(
  nodeId: string,
  outputSchema: z.ZodType,
  output: unknown,
  provenance: readonly FactProvenance[],
  writtenAt = NOW,
): RunCheckpointRecord {
  return RunCheckpointRecordSchema.parse({
    workflowId: "person-lookup",
    itemId: ITEM_ID,
    nodeId,
    attempt: 1,
    runId: RUN_ID,
    output: {
      schemaHash: deriveSchemaHash(outputSchema, "output"),
      value: JsonValueSchema.parse(outputSchema.parse(output)),
    },
    descriptorVersion: 1,
    contractFingerprint: HASH_A,
    implFingerprint: HASH_B,
    provenance,
    writtenAt,
  });
}

function dependencyCheckpoints(): Readonly<{
  search: RunCheckpointRecord;
  crm: RunCheckpointRecord;
}> {
  const searchCollector = collector("searching", SearchPersonOrg.id, []);
  searchCollector.recordData([
    { direction: "read", field: "results", value: person.results },
    { direction: "read", field: "selection", value: person.selection },
  ]);
  const searchEvidence = searchCollector.finalizeRead(person);
  const search = checkpointFrom("searching", SearchPersonOrg.output, person, searchEvidence.provenance);

  const crmCollector = collector("cross-verify", CrmReadOnboardingRecord.id, [search], EARLIER);
  crmCollector.recordData([
    { direction: "read", field: "state", value: crmRecord.state },
    { direction: "read", field: "record", value: crmFoundRecord },
  ]);
  const crmEvidence = crmCollector.finalizeRead(crmRecord);
  const crm = checkpointFrom(
    "cross-verify",
    CrmReadOnboardingRecord.output,
    crmRecord,
    crmEvidence.provenance,
    EARLIER,
  );
  return Object.freeze({ search, crm });
}

describe("task provenance collector", () => {
  it("authenticates the descriptor node and covers nested/array live output", () => {
    const provenance = collector("searching", SearchPersonOrg.id, []);
    provenance.recordData([
      { direction: "read", field: "results", value: person.results },
      { direction: "read", field: "selection", value: person.selection },
    ]);
    const result = provenance.finalizeRead(person);
    assert.equal(result.provenance.some(({ path }) => path === "results"), true);
    assert.equal(result.provenance.some(({ path }) => path === "selection.selected.emplId"), true);
    assert.equal(result.provenance.some(({ path }) => path === "selection.candidateEids"), true);
    assert.equal(result.provenance.every(({ source }) => source === "live"), true);
    assert.equal(result.provenance.every(({ originalObservedAt }) => originalObservedAt === NOW), true);
    assert.deepEqual(result.points[0]?.execution, execution("searching", SearchPersonOrg.id));
  });

  it("refuses missing, duplicate, wrong-direction, contradictory, and extra points", () => {
    const contradictory = collector("searching", SearchPersonOrg.id, []);
    contradictory.recordData({ direction: "read", field: "results", value: [] });
    assert.throws(
      () => contradictory.recordData({ direction: "read", field: "results", value: [] }),
      /recorded field results twice/,
    );
    assert.throws(() => contradictory.finalizeRead(person), /contradicts its parsed output/);

    const missing = collector("searching", SearchPersonOrg.id, []);
    missing.recordData({ direction: "read", field: "results", value: person.results });
    assert.throws(() => missing.finalizeRead(person), /no recorded provenance for output field selection\.status/);

    const extra = collector("searching", SearchPersonOrg.id, []);
    extra.recordData([
      { direction: "read", field: "results", value: person.results },
      { direction: "read", field: "selection", value: person.selection },
      { direction: "read", field: "secret", value: "must-not-be-retained" },
    ]);
    assert.throws(() => extra.finalizeRead(person), /provenance path secret does not exist in the output/);

    const wrongDirection = collector("searching", SearchPersonOrg.id, []);
    wrongDirection.recordData([
      { direction: "write", field: "results", value: person.results },
      { direction: "read", field: "selection", value: person.selection },
    ]);
    assert.throws(() => wrongDirection.finalizeRead(person), /covered by a write point/);
  });

  it("derives dependency authority from active-status and retains the oldest complete union", () => {
    const dependencies = dependencyCheckpoints();
    const provenance = collector(
      "active-status",
      ReadActiveStatus.id,
      [dependencies.search, dependencies.crm],
    );
    const output = { state: "active", reason: "matched both dependencies", hdh: true };
    provenance.recordData([
      { direction: "read", field: "state", value: output.state },
      { direction: "read", field: "reason", value: output.reason },
      { direction: "read", field: "hdh", value: output.hdh },
    ]);
    const result = provenance.finalizeRead(output);
    assert.equal(result.provenance.every(({ source }) => source === "derived"), true);
    assert.equal(result.provenance.every(({ originalObservedAt }) => originalObservedAt === EARLIER), true);

    assert.throws(() => collector(
      "active-status",
      ReadActiveStatus.id,
      [dependencies.search],
    ), /declared dependency cross-verify has no checkpoint provenance/);

    assert.throws(() => collector(
      "searching",
      SearchPersonOrg.id,
      [dependencies.crm],
    ), /received undeclared upstream checkpoint cross-verify/);
  });

  it("rejects forged descriptors, workflow ids, task identities, and non-task roles", () => {
    const copiedDescriptor = { ...personLookupDescriptor };
    assert.throws(() => createTaskProvenanceCollector({
      descriptor: copiedDescriptor,
      execution: execution("searching", SearchPersonOrg.id),
      upstreamEvidence: { checkpoints: [] },
      clock: manualClock(new Date(NOW)),
    }), /exact object returned by defineWorkflowDescriptor/);

    assert.throws(() => createTaskProvenanceCollector({
      descriptor: personLookupDescriptor,
      execution: { ...execution("searching", SearchPersonOrg.id), workflowId: "fixture-graph" },
      upstreamEvidence: { checkpoints: [] },
      clock: manualClock(new Date(NOW)),
    }), /execution workflow fixture-graph does not match descriptor person-lookup/);

    assert.throws(() => createTaskProvenanceCollector({
      descriptor: personLookupDescriptor,
      execution: execution("searching", CrmReadOnboardingRecord.id),
      upstreamEvidence: { checkpoints: [] },
      clock: manualClock(new Date(NOW)),
    }), /node searching uses task ucpath\/search-person-org, not crm\/read-onboarding-record/);

    assert.throws(() => createTaskProvenanceCollector({
      descriptor: personLookupDescriptor,
      execution: execution("missing-node", SearchPersonOrg.id),
      upstreamEvidence: { checkpoints: [] },
      clock: manualClock(new Date(NOW)),
    }), /has no execution node missing-node/);

    assert.throws(() => createTaskProvenanceCollector({
      descriptor: fixtureDescriptor,
      execution: {
        runId: RUN_ID,
        traceId: "fx-180000-aaaa",
        attempt: 1,
        workflowId: "fixture-graph",
        nodeId: "submit",
        taskId: FixtureStage.id,
      },
      upstreamEvidence: { checkpoints: [] },
      clock: manualClock(new Date(NOW)),
    }), /transaction prepare\/commit roles require a role-specific non-read collector/);
  });

  it("rejects duplicate policies, overlapping points, and pre-finalization point exposure", () => {
    assert.throws(() => ProvenancePolicySchema.parse({
      default: "live",
      byField: [{ path: "state", source: "live" }, { path: "state", source: "live" }],
    }), /duplicate provenance rule for state/);
    assert.throws(() => ProvenancePolicySchema.parse({
      default: "live",
      byField: [{ path: "state", source: "live" }, { path: "state", source: "derived" }],
    }), /conflicting provenance rules for state/);

    const ancestorFirst = collector("searching", SearchPersonOrg.id, []);
    assert.equal(Object.hasOwn(ancestorFirst, "recordedPoints"), false);
    ancestorFirst.recordData({ direction: "read", field: "selection", value: person.selection });
    assert.throws(
      () => ancestorFirst.recordData({ direction: "read", field: "selection.status", value: "resolved" }),
      /recorded overlapping fields selection and selection\.status/,
    );

    const descendantFirst = collector("searching", SearchPersonOrg.id, []);
    descendantFirst.recordData({ direction: "read", field: "selection.status", value: "resolved" });
    assert.throws(
      () => descendantFirst.recordData({ direction: "read", field: "selection", value: person.selection }),
      /recorded overlapping fields selection\.status and selection/,
    );
  });

  it("rejects incomplete or malformed authority checkpoint fact sets", () => {
    const dependencies = dependencyCheckpoints();
    const incompleteSearch = RunCheckpointRecordSchema.parse({
      ...dependencies.search,
      provenance: dependencies.search.provenance.slice(0, -1),
    });
    assert.throws(() => collector(
      "active-status",
      ReadActiveStatus.id,
      [incompleteSearch, dependencies.crm],
    ), /upstream checkpoint searching has no provenance for output field/);

    const extraFact = FactProvenanceSchema.parse({
      path: ContractFieldPathSchema.parse("unrelated"),
      source: "live",
      observedAt: NOW,
      originalObservedAt: NOW,
    });
    const extraSearch = RunCheckpointRecordSchema.parse({
      ...dependencies.search,
      provenance: [...dependencies.search.provenance, extraFact],
    });
    assert.throws(() => collector(
      "active-status",
      ReadActiveStatus.id,
      [extraSearch, dependencies.crm],
    ), /upstream checkpoint searching has provenance for undeclared output field unrelated/);
  });
});
