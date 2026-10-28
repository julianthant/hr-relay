import { NodeIdSchema, FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { createPersonLookupProvenanceCheckpoint } from "../../../support/helpers/backend/person-lookup-provenance-checkpoint.js";
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { z } from "zod";
import type { RecordedDataBatch } from "../../../../src/backend/runs/provenance/task-provenance.js";
import { createTaskProvenanceCollector } from "../../../../src/backend/runs/provenance/task-provenance.js";
import {
CrmReadOnboardingRecord,
ReadOnboardingRecordOutputSchema,
} from "../../../../src/models/systems/crm/read-onboarding-record.js";
import {
SearchPersonOrg,
SearchPersonOrgOutputSchema,
UcpathCandidateSchema,
} from "../../../../src/models/systems/ucpath/search-person-org.js";
import { ContractFieldPathSchema,ProvenancePolicySchema } from "../../../../src/models/task/task-contract.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import type {
RunCheckpointRecord,
} from "../../../../src/models/workflow/checkpoint.js";
import {
FactProvenanceSchema,
RunCheckpointRecordSchema,
} from "../../../../src/models/workflow/checkpoint.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { ReadResolvedIdentity } from "../../../../src/models/workflows/person-lookup/read-resolved-identity.js";
import { resolvePersonLookupIdentity } from "../../../../src/rules/matching/person-lookup.js";
import { CrmSearchOnboardingRecords } from "../../../../src/models/systems/crm/search-onboarding-records.js";
import { PersonLookupInput } from "../../../../src/models/workflows/person-lookup/input.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { MatchIdentityOutputSchema } from "../../../../src/models/workflows/separations/match-identity.js";
import { SeparationsVerifyIdentityApproval } from "../../../../src/models/workflows/separations/verify-identity-approval.js";
import {
buildIdentityEvidencePacket,
deriveIdentityEvidenceDigest,
} from "../../../../src/rules/separations/identity-evidence.js";
import { noSeparationWritePlan } from "../../../../src/rules/separations/write-plan.js";
import type { Clock } from "../../../../src/rules/time/clock.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { JsonValueSchema } from "../../../../src/rules/validation/canonical-json.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { descriptorRuntimeNodes, defineWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import {
FixtureStage,
fixtureDescriptor,
} from "../../../support/fixtures/descriptor-fixtures.js";
import { personLookupDescriptor,separationsIdentityCheckDescriptor } from "../../../support/helpers/registered-workflows.js";

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
  hrStatus: 'Active', startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "",
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


/* ── the gated-descriptor fixture (separations chunk 3) ──────────────────── */

const IDENTITY_PACKET = buildIdentityEvidencePacket({
  documentNumber: "4510",
  documentName: "Battistessa, Johnnie",
  documentEidText: "10873698",
  emplIdSource: "document-eid",
  documentEidConflicts: false,
  jobSummary: {
    pageStateId: "ucpath.person-org.detail-ready",
    emplId: candidate.emplId,
    displayedName: "Battistessa, Johnnie",
    jobRows: [{
      rowIndex: 0,
      emplRecord: "0",
      hrStatus: "Active",
      businessUnit: "SDCMP",
      effectiveDate: { state: "present", value: "07/01/2025" },
      positionNumber: { state: "present", value: "40012345" },
      deptId: { state: "present", value: "000414" },
      department: { state: "present", value: "Housing Dining Hospitality" },
      jobCode: { state: "present", value: "004920" },
      jobTitle: { state: "present", value: "Dining Assistant" },
      expectedJobEndDate: { state: "absent", reason: "the grid rendered this cell empty" },
      fte: { state: "present", value: "0.500000" },
      emplClass: { state: "present", value: "Career" },
    }],
    rowCount: 1,
    renderContext: { entry: "auto-detail", searchResultRows: 0, employmentInstances: "already-complete" },
    observedAt: EARLIER,
  } as never,
  nameSelection: person.selection,
  plan: noSeparationWritePlan("this fixture composes no separation write plan"),
});

const UnconditionalInput = z.strictObject({ name: z.string().min(1) });
const UnconditionalCanonicalInput = defineCanonicalInput(UnconditionalInput, UnconditionalInput, [{ name: "Fixture Person" }]);
const unconditionalGateDescriptor = defineWorkflowDescriptor({
  id: "unconditional-gate-provenance-fixture",
  version: 1,
  contractFingerprint: HASH_A,
  code: "ugp",
  label: "Unconditional gate provenance fixture",
  icon: "ShieldCheck",
  category: "operations",
  canonicalInput: UnconditionalCanonicalInput,
  inputSubject: "name",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {},
  details: [],
  identity: { matchKey: (input) => `name:${input.name}` },
  presentation: { title: (input) => input.name },
  scenarios: ["unconditional-gate-provenance-fixture/happy"],
  flow: flow(UnconditionalInput)
    .gate("approval", {
      dependsOn: [],
      label: "Approval",
      resolvedBy: "operator",
      result: z.strictObject({ approved: z.boolean() }),
    })
    .step("searching", SearchPersonOrg, {
      dependsOn: ["approval"],
      replay: "checkpoint",
      bind: ({ input }) => ({ kind: "by-name" as const, name: input.name, keepNonHdh: true }),
    })
    .build({ schema: SearchPersonOrg.output, dependsOn: ["searching"], derive: ({ outputs }) => outputs.searching }),
});

const IDENTITY_JOBS = {
  disposition: "single-active-job",
  rowCount: 1,
  activeRowCount: 1,
  inactiveRowCount: 0,
  unknownRowCount: 0,
  rows: [{
    rowIndex: 0,
    emplRecord: "0",
    hrStatus: "Active",
    tier: "active",
    department: "Housing Dining Hospitality",
    jobTitle: "Dining Assistant",
    effectiveDate: "07/01/2025",
  }],
  unreadableCells: [],
} as const;


function identityComparisonCheckpoint(): RunCheckpointRecord {
  const value = JsonValueSchema.parse(MatchIdentityOutputSchema.parse({
    packet: IDENTITY_PACKET,
    approvalRequired: IDENTITY_PACKET.emplIdSource === "name-resolved" || IDENTITY_PACKET.emplIdSource === "operator-entered",
    evidenceDigest: deriveIdentityEvidenceDigest(IDENTITY_PACKET),
  }));
  const leaves = (node: unknown, prefix: string): string[] => {
    if (Array.isArray(node) || node === null || typeof node !== "object") return [prefix];
    const entries = Object.entries(node as Record<string, unknown>);
    if (entries.length === 0) return [prefix];
    return entries.flatMap(([key, child]) => leaves(child, prefix.length === 0 ? key : `${prefix}.${key}`));
  };
  return RunCheckpointRecordSchema.parse({
    ...checkpointFrom(
      "comparison",
      MatchIdentityOutputSchema,
      value,
      leaves(value, "").map((path) => FactProvenanceSchema.parse({
        path: ContractFieldPathSchema.parse(path),
        source: "derived",
        observedAt: EARLIER,
        originalObservedAt: EARLIER,
      })),
      EARLIER,
    ),
    workflowId: separationsIdentityCheckDescriptor.id,
    descriptorVersion: separationsIdentityCheckDescriptor.version,
    contractFingerprint: separationsIdentityCheckDescriptor.contractFingerprint,
  });
}


const observedBatches: RecordedDataBatch[] = [];
const recordBatch = (batch: RecordedDataBatch): void => { observedBatches.push(batch); };

function collector(
  nodeId: string,
  taskId: string,
  checkpoints: readonly RunCheckpointRecord[],
  now = NOW,
) {
  return createTaskProvenanceCollector({
    descriptor: personLookupDescriptor,
    execution: execution(nodeId, taskId),
    canonicalInput: PersonLookupInput.parse({ emplId: candidate.emplId }),
    upstreamEvidence: { checkpoints: [...checkpoints], skippedTasks: nodeId === "searching" ? [] : ["matching"] },
    clock: manualClock(new Date(now)),
    onRecord: recordBatch,
  });
}

const { checkpointFrom } = createPersonLookupProvenanceCheckpoint({
  itemId: ITEM_ID,
  runId: RUN_ID,
  contractFingerprint: personLookupDescriptor.contractFingerprint,
  descriptorVersion: personLookupDescriptor.version,
  implFingerprint: HASH_B,
  now: NOW,
});

function dependencyCheckpoints(): Readonly<{
  search: RunCheckpointRecord;
  crm: RunCheckpointRecord;
  initial: RunCheckpointRecord;
}> {
  const searchCollector = collector("searching", SearchPersonOrg.id, []);
  searchCollector.recordData([
    { direction: "read", field: "results", value: person.results },
    { direction: "read", field: "selection", value: person.selection },
  ]);
  const searchEvidence = searchCollector.finalizeRead(person);
  const search = checkpointFrom("searching", SearchPersonOrg.output, person, searchEvidence.provenance);

  const input = PersonLookupInput.parse({ emplId: candidate.emplId });
  const identity = resolvePersonLookupIdentity({ input, person });
  const initialCollector = collector("search-identity", ReadResolvedIdentity.id, [search]);
  initialCollector.recordData(Object.entries(identity).map(([field,value]) => ({ direction: "read" as const, field, value })));
  const initial = checkpointFrom("search-identity", ReadResolvedIdentity.output, identity, initialCollector.finalizeRead(identity).provenance);
  const discovery = { state: "checked" as const, records: [{ recordId: "ONB-40213", recordUrl: "https://example.invalid/record", emplId: candidate.emplId, name: candidate.name, department: candidate.department, firstDayOfService: "", dateSigned: "" }] };
  const crmCollector = collector("cross-verify", CrmSearchOnboardingRecords.id, [initial, search], EARLIER);
  crmCollector.recordData(Object.entries(discovery).map(([field,value]) => ({ direction: "read" as const, field, value })));
  const crm = checkpointFrom("cross-verify", CrmSearchOnboardingRecords.output, discovery, crmCollector.finalizeRead(discovery).provenance, EARLIER);
  return Object.freeze({ search, crm, initial });
}

describe("task provenance collector", () => {
  it("hands each recordData CALL to the sink at record time, under ONE shared instant", () => {
    observedBatches.length = 0;
    const baseClock = manualClock(new Date(NOW));
    let clockReads = 0;
    const advancingClock: Clock = Object.freeze({
      ...baseClock,
      now(): Date {
        const instant = baseClock.now();
        clockReads += 1;
        baseClock.advanceWall(1_000);
        return instant;
      },
    });
    const provenance = createTaskProvenanceCollector({
      descriptor: personLookupDescriptor,
      execution: execution("searching", SearchPersonOrg.id),
      upstreamEvidence: { checkpoints: [] },
      clock: advancingClock,
      onRecord: recordBatch,
    });
    // A batch is one observation of the page, so it is one sink call...
    provenance.recordData([
      { direction: "read", field: "results", value: person.results },
      { direction: "read", field: "selection", value: person.selection },
    ]);
    assert.equal(observedBatches.length, 1);
    assert.equal(observedBatches[0]?.points.length, 2);
    assert.equal(clockReads, 1);
    // ...stamped ONCE, so the emitted event carries an honest `observedAt`
    // rather than one derived from whichever point happened to be first.
    assert.deepEqual([...new Set(observedBatches[0]?.points.map((point) => point.recordedAt))],
      [NOW]);
    assert.equal(observedBatches[0]?.recordedAt, NOW);

    // The sink is called BEFORE finalization, which is the whole point: a task
    // that throws after reading the page has still read the page.
    assert.equal(observedBatches.length, 1);
    provenance.finalizeRead(person);
    assert.equal(observedBatches.length, 1);
    assert.equal(clockReads, 1);
  });

  it("calls the sink once per CALL, not once per task", () => {
    observedBatches.length = 0;
    const provenance = collector("searching", SearchPersonOrg.id, []);
    provenance.recordData({ direction: "read", field: "results", value: person.results });
    provenance.recordData({ direction: "read", field: "selection", value: person.selection });
    assert.deepEqual(observedBatches.map((batch) => batch.points.map((point) => point.field)),
      [["results"], ["selection"]]);
  });

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

  // Gate evidence lives in gate_results, never in a checkpoint row.
  it("accepts a gate result as a declared dependency's upstream evidence, and only a declared one", () => {
    const gateNow = "2026-08-02T19:00:00.000Z";
    const identityGate = descriptorRuntimeNodes(separationsIdentityCheckDescriptor).find(node => String(node.id) === "identity-approval");
    assert.ok(identityGate?.kind === "gate");
    const gateResult = {
      runId: RUN_ID,
      gateId: "identity-approval", nodeId: "approval",
      commandId: "cccccccc-0001-4000-8000-000100000000",
      expectedVersion: 3,
      resolvedBy: "local-operator",
      resolvedAt: gateNow,
      checkpointFingerprint: HASH_B,
      result: { schemaHash: deriveSchemaHash(identityGate.result, "output"), value: { decision: "rejected", reason: "n/a", evidenceDigest: HASH_A } },
    };
    const comparison = identityComparisonCheckpoint();
    const gatedExecution = {
      runId: RUN_ID,
      traceId: "si-000001-aaaa",
      attempt: 1,
      workflowId: separationsIdentityCheckDescriptor.id,
      nodeId: "approval",
      taskId: SeparationsVerifyIdentityApproval.id,
    };
    const gated = createTaskProvenanceCollector({
      descriptor: separationsIdentityCheckDescriptor,
      execution: gatedExecution,
      upstreamEvidence: { checkpoints: [comparison], gateResults: [gateResult] },
      clock: manualClock(new Date(NOW)),
      onRecord: recordBatch,
    });
    const output = {
      documentNumber: "4510",
      approved: {
        authority: "operator-approval",
        emplId: "10873698",
        chosenFrom: "checked",
        evidenceDigest: HASH_A,
        ucpathName: "Battistessa, Johnnie",
        nameTier: "same",
        approvalShape: "one-click",
      },
      jobs: IDENTITY_JOBS,
    };
    gated.recordData([
      { direction: "read", field: "documentNumber", value: output.documentNumber },
      { direction: "read", field: "approved", value: output.approved },
      { direction: "read", field: "jobs", value: output.jobs },
    ]);
    const result = gated.finalizeRead(output);

    assert.equal(result.provenance.every(({ originalObservedAt }) => originalObservedAt === EARLIER), true);

    // Without the gate row the node is unrunnable — which is exactly the live
    // failure, kept as the negative control.
    assert.throws(() => createTaskProvenanceCollector({
      descriptor: separationsIdentityCheckDescriptor,
      execution: gatedExecution,
      upstreamEvidence: { checkpoints: [comparison], gateResults: [] },
      clock: manualClock(new Date(NOW)),
      onRecord: recordBatch,
    }), /declared dependency identity-approval has no upstream provenance/);

    assert.throws(() => createTaskProvenanceCollector({
      descriptor: separationsIdentityCheckDescriptor,
      execution: gatedExecution,
      upstreamEvidence: {
        checkpoints: [comparison],
        gateResults: [gateResult, { ...gateResult, gateId: "not-declared" }],
      },
      clock: manualClock(new Date(NOW)),
      onRecord: recordBatch,
    }), /received undeclared upstream gate result not-declared/);
  });


  it("accepts only an inapplicable conditional gate as machine provenance", () => {
    const comparison = identityComparisonCheckpoint();
    const canonicalInput = {
      documentNumber: "4510",
      employeeName: "Battistessa, Johnnie",
      emplId: candidate.emplId,
      emplIdSource: "document-eid",
      documentEid: { state: "present", value: candidate.emplId },
    };
    const executionIdentity = {
      runId: RUN_ID,
      traceId: "si-000001-aaaa",
      attempt: 1,
      workflowId: separationsIdentityCheckDescriptor.id,
      nodeId: "approval",
      taskId: SeparationsVerifyIdentityApproval.id,
    };
    const machine = createTaskProvenanceCollector({
      descriptor: separationsIdentityCheckDescriptor,
      execution: executionIdentity,
      canonicalInput,
      upstreamEvidence: { checkpoints: [comparison], skippedGates: ["identity-approval"] },
      clock: manualClock(new Date(NOW)),
      onRecord: recordBatch,
    });
    for (const changed of [
      { ...comparison, output: { ...comparison.output, schemaHash: HASH_A } },
      { ...comparison, descriptorVersion: comparison.descriptorVersion + 1 },
      { ...comparison, contractFingerprint: HASH_A },
      { ...comparison, output: { ...comparison.output, value: { wrong: true } } },
    ]) {
      assert.throws(() => createTaskProvenanceCollector({
        descriptor: separationsIdentityCheckDescriptor, execution: executionIdentity, canonicalInput,
        upstreamEvidence: { checkpoints: [changed], skippedGates: ["identity-approval"] },
        clock: manualClock(new Date(NOW)), onRecord: recordBatch,
      }));
    }
    assert.throws(() => createTaskProvenanceCollector({
      descriptor: separationsIdentityCheckDescriptor, execution: executionIdentity, canonicalInput,
      upstreamEvidence: { checkpoints: [comparison], skippedTasks: ["identity-approval"] },
      clock: manualClock(new Date(NOW)), onRecord: recordBatch,
    }), /invalid skipped task/);
    assert.throws(() => createTaskProvenanceCollector({
      descriptor: separationsIdentityCheckDescriptor, execution: executionIdentity, canonicalInput,
      upstreamEvidence: { checkpoints: [comparison], skippedGates: ["identity-approval"], conditionEvidence: { checkpoints: [comparison], gateResults: [], skippedTasks: [], skippedGates: [] } },
      clock: manualClock(new Date(NOW)), onRecord: recordBatch,
    }), /overlapping condition evidence/);
    const output = SeparationsVerifyIdentityApproval.output.parse({
      documentNumber: "4510",
      approved: {
        authority: "machine-verification",
        source: "document-eid",
        emplId: candidate.emplId,
        evidenceDigest: deriveIdentityEvidenceDigest(IDENTITY_PACKET),
        ucpathName: "Battistessa, Johnnie",
        nameTier: "same",
      },
      jobs: IDENTITY_JOBS,
    });
    machine.recordData([
      { direction: "read", field: "documentNumber", value: output.documentNumber },
      { direction: "read", field: "approved", value: output.approved },
      { direction: "read", field: "jobs", value: output.jobs },
    ]);
    assert.equal(machine.finalizeRead(output).provenance.every(({ source }) => source === "derived"), true);

    const gateResult = {
      runId: RUN_ID,
      gateId: "identity-approval", nodeId: "approval",
      commandId: "cccccccc-0001-4000-8000-000100000000",
      expectedVersion: 3,
      resolvedBy: "local-operator",
      resolvedAt: NOW,
      checkpointFingerprint: HASH_B,
      result: { schemaHash: HASH_A, value: { decision: "approved", eid: candidate.emplId, chosenFrom: "checked", evidenceDigest: HASH_A } },
    };
    assert.throws(() => createTaskProvenanceCollector({
      descriptor: separationsIdentityCheckDescriptor,
      execution: executionIdentity,
      canonicalInput,
      upstreamEvidence: { checkpoints: [comparison], skippedGates: ["identity-approval"], gateResults: [gateResult] },
      clock: manualClock(new Date(NOW)),
      onRecord: recordBatch,
    }), /duplicate upstream evidence/);

    const namePacket = { ...IDENTITY_PACKET, emplIdSource: "name-resolved" as const };
    const nameValue = JsonValueSchema.parse(MatchIdentityOutputSchema.parse({
      packet: namePacket,
      approvalRequired: namePacket.emplIdSource === "name-resolved" || namePacket.emplIdSource === "operator-entered",
      evidenceDigest: deriveIdentityEvidenceDigest(namePacket),
    }));
    const nameComparison = RunCheckpointRecordSchema.parse({
      ...comparison,
      output: { ...comparison.output, value: nameValue },
    });
    assert.throws(() => createTaskProvenanceCollector({
      descriptor: separationsIdentityCheckDescriptor,
      execution: executionIdentity,
      canonicalInput: {
        ...canonicalInput,
        emplIdSource: "name-resolved",
        documentEid: { state: "absent", reason: "name-only test" },
      },
      upstreamEvidence: { checkpoints: [nameComparison], skippedGates: ["identity-approval"] },
      clock: manualClock(new Date(NOW)),
      onRecord: recordBatch,
    }), /cannot skip required gate/);

    assert.throws(() => createTaskProvenanceCollector({
      descriptor: unconditionalGateDescriptor,
      execution: {
        ...execution("searching", SearchPersonOrg.id),
        workflowId: unconditionalGateDescriptor.id,
      },
      canonicalInput: { name: "Fixture Person" },
      upstreamEvidence: { checkpoints: [], skippedGates: ["approval"] },
      clock: manualClock(new Date(NOW)),
      onRecord: recordBatch,
    }), /cannot skip unconditional gate/);
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

  it("derives dependency authority from resolved identity and retains the oldest complete union", () => {
    const dependencies = dependencyCheckpoints();
    const provenance = collector(
      "crm-identity",
      ReadResolvedIdentity.id,
      [dependencies.search, dependencies.initial, dependencies.crm],
    );
    const output = resolvePersonLookupIdentity({ input: PersonLookupInput.parse({ emplId: candidate.emplId }), person, crm: CrmSearchOnboardingRecords.output.parse(dependencies.crm.output.value) });
    provenance.recordData(Object.entries(output).map(([field,value]) => ({ direction: "read" as const, field, value })));
    const result = provenance.finalizeRead(output);
    assert.equal(result.provenance.every(({ source }) => source === "derived"), true);
    assert.equal(result.provenance.every(({ originalObservedAt }) => originalObservedAt === EARLIER), true);

    assert.throws(() => collector(
      "crm-identity",
      ReadResolvedIdentity.id,
      [dependencies.search, dependencies.initial],
    ), /declared dependency cross-verify has no upstream provenance/);

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
      onRecord: recordBatch,
    }), /exact object returned by defineWorkflowDescriptor/);

    assert.throws(() => createTaskProvenanceCollector({
      descriptor: personLookupDescriptor,
      execution: { ...execution("searching", SearchPersonOrg.id), workflowId: "fixture-graph" },
      upstreamEvidence: { checkpoints: [] },
      clock: manualClock(new Date(NOW)),
      onRecord: recordBatch,
    }), /execution workflow fixture-graph does not match descriptor person-lookup/);

    assert.throws(() => createTaskProvenanceCollector({
      descriptor: personLookupDescriptor,
      execution: execution("searching", CrmReadOnboardingRecord.id),
      upstreamEvidence: { checkpoints: [] },
      clock: manualClock(new Date(NOW)),
      onRecord: recordBatch,
    }), /node searching uses task ucpath\/search-person-org, not crm\/read-onboarding-record/);

    assert.throws(() => createTaskProvenanceCollector({
      descriptor: personLookupDescriptor,
      execution: execution("missing-node", SearchPersonOrg.id),
      upstreamEvidence: { checkpoints: [] },
      clock: manualClock(new Date(NOW)),
      onRecord: recordBatch,
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
      onRecord: recordBatch,
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
      "crm-identity",
      ReadResolvedIdentity.id,
      [incompleteSearch, dependencies.initial, dependencies.crm],
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
      "crm-identity",
      ReadResolvedIdentity.id,
      [extraSearch, dependencies.initial, dependencies.crm],
    ), /upstream checkpoint searching has provenance for undeclared output field unrelated/);
  });
});


describe("transitive skipped condition evidence", () => {
  const schema = z.strictObject({ emplId: z.string() });
  const canonical = defineCanonicalInput(schema, schema, [{ emplId: candidate.emplId }]);
  const descriptor = defineWorkflowDescriptor({
    id: "transitive-condition-evidence", version: 1, code: "tc", contractFingerprint: HASH_A,
    label: "Transitive condition evidence", icon: "Search", category: "search", canonicalInput: canonical,
    surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
    inputSubject: "eid", surfaces: {}, details: [], identity: { matchKey: input => `eid:${input.emplId}` }, presentation: { title: input => input.emplId },
    scenarios: ["transitive-condition-evidence/happy"],
    flow: flow(schema)
      .step("source", SearchPersonOrg, { dependsOn: [], replay: "checkpoint", bind: () => ({ kind: "by-eid" as const, emplId: candidate.emplId }) })
      .step("skipped", SearchPersonOrg, { dependsOn: ["source"], replay: "checkpoint", when: { kind: "is-absent", of: { from: "node", nodeId: "source", path: "selection.selected" } }, bind: () => ({ kind: "by-eid" as const, emplId: candidate.emplId }) })
      .step("consumer", SearchPersonOrg, { dependsOn: ["skipped"], replay: "checkpoint", bind: () => ({ kind: "by-eid" as const, emplId: candidate.emplId }) })
      .build({ schema: SearchPersonOrg.output, dependsOn: ["consumer"], derive: ({ outputs }) => outputs.consumer }),
  });
  const source = RunCheckpointRecordSchema.parse({ ...dependencyCheckpoints().search, workflowId: descriptor.id, nodeId: "source", descriptorVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint });
  const make = (conditionEvidence: { checkpoints: readonly RunCheckpointRecord[]; skippedTasks?: readonly string[] } = { checkpoints: [source] }) => createTaskProvenanceCollector({ descriptor,
    execution: { ...execution("consumer", SearchPersonOrg.id), workflowId: descriptor.id }, canonicalInput: { emplId: candidate.emplId },
    upstreamEvidence: { checkpoints: [], skippedTasks: ["skipped"], conditionEvidence: { checkpoints: [...conditionEvidence.checkpoints], gateResults: [], skippedTasks: [...conditionEvidence.skippedTasks ?? []], skippedGates: [] } },
    clock: manualClock(new Date(NOW)), onRecord: recordBatch });
  it("authenticates the exact transitive source without contributing it as a direct dependency", () => {
    const collector = make();
    collector.recordData([{ direction: "read", field: "results", value: person.results }, { direction: "read", field: "selection", value: person.selection }]);
    assert.ok(collector.finalizeRead(person).provenance.every(row => row.source === "live" && row.originalObservedAt === NOW));
  });
  it("refuses missing, duplicate, unknown, corrupt, and true-skip sources", () => {
    const absent = SearchPersonOrg.output.parse({ results: [], selection: { status: "not-found", selected: null, candidateEids: [], searchName: candidate.name } });
    for (const checkpoints of [[], [source,source], [{ ...source, nodeId: NodeIdSchema.parse("unknown") }],
      [{ ...source, output: { ...source.output, schemaHash: FingerprintSchema.parse(HASH_A) } }],
      [{ ...source, output: { ...source.output, value: absent } }]]) assert.throws(() => make({ checkpoints }));
  });
});
