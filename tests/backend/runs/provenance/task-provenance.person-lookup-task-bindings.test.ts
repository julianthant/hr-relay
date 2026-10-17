import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createTaskProvenanceCollector } from "../../../../src/backend/runs/provenance/task-provenance.js";
import { createDeterministicCrmOnboardingDriver } from "../../../../src/backend/systems/crm/driver/fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../src/backend/systems/ucpath/driver/fake.js";
import { searchPersonOrgTask } from "../../../../src/backend/systems/ucpath/tasks/search-person-org.js";
import { searchOnboardingRecordsTask } from "../../../../src/backend/systems/crm/tasks/search-onboarding-records.js";
import { verifyOnboardingRecordTask } from "../../../../src/backend/systems/crm/tasks/verify-onboarding-record.js";
import { readOnboardingDatesTask } from "../../../../src/backend/systems/crm/tasks/read-onboarding-dates.js";
import { readResolvedIdentityTask } from "../../../../src/workflows/person-lookup/tasks/read-resolved-identity.js";
import { readActiveStatusTask } from "../../../../src/workflows/person-lookup/tasks/read-active-status.js";
import { SearchPersonOrg, SearchPersonOrgOutputSchema, UcpathCandidateSchema } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { CrmVerifyOnboardingRecord } from "../../../../src/models/systems/crm/verify-onboarding-record.js";
import { CrmSearchOnboardingRecords } from "../../../../src/models/systems/crm/search-onboarding-records.js";
import { ReadOnboardingRecordOutputSchema } from "../../../../src/models/systems/crm/read-onboarding-record.js";
import { CrmReadOnboardingDates, ReadOnboardingDatesOutputSchema } from "../../../../src/models/systems/crm/read-onboarding-dates.js";
import { ReadResolvedIdentity } from "../../../../src/models/workflows/person-lookup/read-resolved-identity.js";
import { ReadActiveStatus } from "../../../../src/models/workflows/person-lookup/read-active-status.js";
import { PersonLookupInput } from "../../../../src/models/workflows/person-lookup/input.js";
import { RunCheckpointRecordSchema, type RunCheckpointRecord } from "../../../../src/models/workflow/checkpoint.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import type { z } from "zod";

const NOW = "2026-08-02T18:00:00.000Z";
const RUN_ID = "aaaaaaaa-0001-4000-8000-000100000000";
const input = PersonLookupInput.parse({ emplId: "10873698", includeCrmDates: true });
const candidate = UcpathCandidateSchema.parse({ emplId: "10873698", name: "Battistessa, Johnnie", department: "Housing Dining Hospitality", jobTitle: "Dining Assistant", employeeStatus: "active", hrStatus: "Active", startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "", hdh: true });
const person = SearchPersonOrgOutputSchema.parse({ results: [candidate], selection: { status: "resolved", selected: candidate, candidateEids: [candidate.emplId] } });
const crmRecord = ReadOnboardingRecordOutputSchema.parse({ state: "found", record: { recordId: "ONB-40213", emplId: candidate.emplId, fullName: candidate.name, rawStage: "Completed" } });
const crmDates = ReadOnboardingDatesOutputSchema.parse({ emplId: candidate.emplId, state: "read", employmentDate: "2026-07-15", oathDate: "2026-06-25", reason: "" });
const crm = createDeterministicCrmOnboardingDriver({ record: crmRecord, dates: crmDates, discovery: [{ recordId: "ONB-40213", recordUrl: "https://example.invalid/record", emplId: candidate.emplId, name: candidate.name, department: candidate.department, firstDayOfService: "07/15/2026", dateSigned: "06/25/2026" }] });
const commonCtx = { captureScreenshot: async () => {}, signal: new AbortController().signal, log: { debug: () => undefined, info: () => undefined, warn: () => undefined }, fail: (_code: string, message: string): never => { throw new Error(message); } };

function collector(nodeId: string, taskId: string, checkpoints: readonly RunCheckpointRecord[], skippedTasks: readonly string[] = []) {
  return createTaskProvenanceCollector({ descriptor: personLookupDescriptor, canonicalInput: input,
    execution: { runId: RUN_ID, traceId: "pl-180000-aaaa", attempt: 1, workflowId: personLookupDescriptor.id, nodeId, taskId },
    upstreamEvidence: { checkpoints: [...checkpoints], skippedTasks: [...skippedTasks] }, clock: manualClock(new Date(NOW)), onRecord: () => undefined });
}
function checkpoint(nodeId: string, schema: z.ZodType, output: unknown, evidence: ReturnType<ReturnType<typeof collector>["finalizeRead"]>) {
  return RunCheckpointRecordSchema.parse({ workflowId: personLookupDescriptor.id, itemId: "33333333-3333-4333-8333-333333333333", runId: RUN_ID, nodeId, attempt: 1, claimGeneration: 1,
    output: { schemaHash: deriveSchemaHash(schema, "output"), value: output }, descriptorVersion: personLookupDescriptor.version, contractFingerprint: personLookupDescriptor.contractFingerprint,
    implFingerprint: "b".repeat(64), provenance: evidence.provenance, writtenAt: NOW });
}
async function readChain() {
  const searchCollector = collector("searching", SearchPersonOrg.id, []);
  const searched = await searchPersonOrgTask.impl.run({ input: { kind: "by-eid", emplId: candidate.emplId }, ctx: { ...commonCtx, recordData: searchCollector.recordData, driver: createDeterministicUcpathPersonOrgDriver(person) } });
  const searchEvidence = searchCollector.finalizeRead(searched);
  const searchCheckpoint = checkpoint("searching", SearchPersonOrg.output, searched, searchEvidence);
  const initialCollector = collector("search-identity", ReadResolvedIdentity.id, [searchCheckpoint], ["matching"]);
  const initial = await readResolvedIdentityTask.impl.run({ input: { input, person: SearchPersonOrg.output.parse(searched) }, ctx: { ...commonCtx, recordData: initialCollector.recordData } });
  const initialCheckpoint = checkpoint("search-identity", ReadResolvedIdentity.output, initial, initialCollector.finalizeRead(initial));
  const discoveryCollector = collector("cross-verify", CrmSearchOnboardingRecords.id, [initialCheckpoint, searchCheckpoint], ["matching"]);
  const discovery = await searchOnboardingRecordsTask.impl.run({ input: { eid: candidate.emplId, name: candidate.name }, ctx: { ...commonCtx, recordData: discoveryCollector.recordData, driver: crm } });
  const discoveryCheckpoint = checkpoint("cross-verify", CrmSearchOnboardingRecords.output, discovery, discoveryCollector.finalizeRead(discovery));
  const identityCollector = collector("crm-identity", ReadResolvedIdentity.id, [initialCheckpoint, discoveryCheckpoint, searchCheckpoint], ["matching"]);
  const identity = await readResolvedIdentityTask.impl.run({ input: { input, person: SearchPersonOrg.output.parse(searched), crm: CrmSearchOnboardingRecords.output.parse(discovery) }, ctx: { ...commonCtx, recordData: identityCollector.recordData } });
  const identityCheckpoint = checkpoint("crm-identity", ReadResolvedIdentity.output, identity, identityCollector.finalizeRead(identity));
  const recordCollector = collector("crm-selected-record", CrmVerifyOnboardingRecord.id, [identityCheckpoint]);
  const record = await verifyOnboardingRecordTask.impl.run({ input: CrmVerifyOnboardingRecord.input.parse(identity.crmRecord), ctx: { ...commonCtx, recordData: recordCollector.recordData, driver: crm } });
  const recordEvidence = recordCollector.finalizeRead(record);
  const recordCheckpoint = checkpoint("crm-selected-record", CrmVerifyOnboardingRecord.output, record, recordEvidence);
  const activeCollector = collector("active-status", ReadActiveStatus.id, [initialCheckpoint, identityCheckpoint, recordCheckpoint], ["crm-only-recovery"]);
  const active = await readActiveStatusTask.impl.run({ input: { input, identity: ReadResolvedIdentity.output.parse(identity) }, ctx: { ...commonCtx, recordData: activeCollector.recordData } });
  const activeEvidence = activeCollector.finalizeRead(active);
  const activeCheckpoint = checkpoint("active-status", ReadActiveStatus.output, active, activeEvidence);
  const datesCollector = collector("crm-dates", CrmReadOnboardingDates.id, [activeCheckpoint]);
  const dates = await readOnboardingDatesTask.impl.run({ input: { eid: candidate.emplId, name: candidate.name }, ctx: { ...commonCtx, recordData: datesCollector.recordData, driver: crm } });
  const datesEvidence = datesCollector.finalizeRead(dates);
  return { searched, searchEvidence, record, recordEvidence, active, activeEvidence, dates, datesEvidence, identity: ReadResolvedIdentity.output.parse(identity) };
}

describe("Person Lookup task implementations", () => {
  it("executes UCPath and CRM reads only through their typed semantic drivers", async () => {
    const result = await readChain();
    assert.deepEqual(result.searched, person);
    assert.deepEqual(result.searchEvidence.points.map(({ direction, field, value }) => ({ direction, field, value })), [{ direction: "read", field: "results", value: person.results }, { direction: "read", field: "selection", value: person.selection }]);
    assert.equal(result.searchEvidence.provenance.some(({ path }) => path === "results"), true);
    assert.equal(result.searchEvidence.provenance.some(({ path }) => path === "selection.candidateEids"), true);
    assert.ok(result.record.state === "checked");
    assert.equal(result.record.records[0]?.emplId, candidate.emplId);
    assert.ok(crmRecord.state === "found");
    assert.deepEqual(result.recordEvidence.points.map(({ direction, field, value }) => ({ direction, field, value })), Object.entries(result.record).map(([field, value]) => ({ direction: "read", field, value })));
    assert.deepEqual(result.dates, crmDates);
    assert.deepEqual(result.datesEvidence.points.map(({ direction, field, value }) => ({ direction, field, value })), Object.entries(crmDates).map(([field, value]) => ({ direction: "read", field, value })));
  });
  it("derives active status and fails loud when UCPath and CRM identities disagree", async () => {
    const result = await readChain();
    assert.equal(result.active.state, "active");
    assert.deepEqual(result.activeEvidence.points.map(({ direction, field, value }) => ({ direction, field, value })), Object.entries(result.active).map(([field, value]) => ({ direction: "read", field, value })));
    assert.equal(result.activeEvidence.provenance.every(({ source }) => source === "derived"), true);
    assert.ok(result.identity.crmRecord);
    const recorded: unknown[] = [];
    await assert.rejects(readActiveStatusTask.impl.run({ input: { input, identity: { ...result.identity, crmRecord: { ...result.identity.crmRecord, emplId: EidSchema.parse("10101010") } } },
      ctx: { ...commonCtx, recordData: (point) => { recorded.push(point); } } }), /inconsistent UCPath and CRM identities/);
    assert.deepEqual(recorded, []);
  });
});

it("refuses forged skipped task evidence before deriving facts", () => {
  for (const skippedTasks of [["searching", "matching"], ["matching", "matching"], ["unknown"], []]) {
    assert.throws(() => collector("search-identity", ReadResolvedIdentity.id, [], skippedTasks));
  }
  assert.throws(() => createTaskProvenanceCollector({ descriptor: personLookupDescriptor, canonicalInput: input,
    execution: { runId: RUN_ID, traceId: "pl-180000-aaaa", attempt: 1, workflowId: personLookupDescriptor.id, nodeId: "search-identity", taskId: ReadResolvedIdentity.id },
    upstreamEvidence: { checkpoints: [], skippedTasks: ["searching", "matching"] }, clock: manualClock(new Date(NOW)), onRecord() {} }), /cannot skip required task searching/);
});
