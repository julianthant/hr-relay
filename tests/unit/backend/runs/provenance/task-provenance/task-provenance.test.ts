import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { flow } from "../../../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor } from "../../../../../../src/workflow-kit/workflow.js";
import { createTaskProvenanceCollector } from "../../../../../../src/backend/runs/provenance/task-provenance.js";
import type { RecordedDataBatch } from "../../../../../../src/backend/runs/provenance/task-provenance.js";
import { JsonValueSchema } from "../../../../../../src/rules/validation/canonical-json.js";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import type { Clock } from "../../../../../../src/rules/time/clock.js";
import { ContractFieldPathSchema, ProvenancePolicySchema } from "../../../../../../src/models/task/task-contract.js";
import {
  CrmReadOnboardingRecord,
  ReadOnboardingRecordOutputSchema,
} from "../../../../../../src/models/systems/crm/read-onboarding-record.js";
import { ReadActiveStatus } from "../../../../../../src/models/workflows/person-lookup/read-active-status.js";
import {
  SearchPersonOrg,
  SearchPersonOrgOutputSchema,
  UcpathCandidateSchema,
} from "../../../../../../src/models/systems/ucpath/search-person-org.js";
import { deriveSchemaHash } from "../../../../../../src/models/validation/schema-bound-value.js";
import {
  FactProvenanceSchema,
  RunCheckpointRecordSchema,
} from "../../../../../../src/models/workflow/checkpoint.js";
import type {
  FactProvenance,
  RunCheckpointRecord,
} from "../../../../../../src/models/workflow/checkpoint.js";
import { MatchIdentityOutputSchema } from "../../../../../../src/models/workflows/separations/match-identity.js";
import { SeparationsVerifyIdentityApproval } from "../../../../../../src/models/workflows/separations/verify-identity-approval.js";
import {
  buildIdentityEvidencePacket,
  deriveIdentityEvidenceDigest,
} from "../../../../../../src/rules/separations/identity-evidence.js";
import { separationsIdentityCheckDescriptor } from "../../../../../support/helpers/registered-workflows.js";
import {
  FixtureStage,
  fixtureDescriptor,
} from "../../../../../support/fixtures/descriptor-fixtures.js";
import { noSeparationWritePlan } from "../../../../../../src/rules/separations/write-plan.js";
import { defineCanonicalInput } from "../../../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../../../src/models/workflow/presentation.js";
import { personLookupDescriptor } from "../../../../../support/helpers/registered-workflows.js";

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

/**
 * The comparison node's checkpoint, with provenance for every output leaf.
 *
 * The leaf rule is the collector's own (an array is a leaf, an object recurses),
 * so the provenance is DERIVED from the value rather than hand-listed — a
 * hand-listed table would drift on the first field the packet gained.
 */
function identityComparisonCheckpoint(): RunCheckpointRecord {
  const value = JsonValueSchema.parse(MatchIdentityOutputSchema.parse({
    packet: IDENTITY_PACKET,
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
  });
}

/**
 * D270 — the collector's record-time sink. An explicit recording fake, never a
 * no-op: a missing runtime sink must not be able to hide behind one.
 */
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
    upstreamEvidence: { checkpoints: [...checkpoints] },
    clock: manualClock(new Date(now)),
    onRecord: recordBatch,
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
  it("hands each recordData CALL to the sink at record time, under ONE shared instant (D270)", () => {
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

  it("calls the sink once per CALL, not once per task (D270)", () => {
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

  /**
   * A GATE dependency's evidence is a `gate_results` row, and there is no
   * checkpoint for it — ever. The first live chunk-3 run found that the hard
   * way: the post-gate node refused with "declared dependency has no checkpoint
   * record", a true statement about a record that cannot exist. The collector
   * now admits the gate row as its own kind of upstream evidence, and this runs
   * against the REAL gated descriptor rather than a fixture, because the shape
   * that broke is a real descriptor's shape.
   */
  it("accepts a gate result as a declared dependency's upstream evidence, and only a declared one", () => {
    const gateNow = "2026-08-02T19:00:00.000Z";
    const gateResult = {
      runId: RUN_ID,
      gateId: "identity-approval",
      commandId: "cccccccc-0001-4000-8000-000100000000",
      expectedVersion: 3,
      resolvedBy: "local-operator",
      resolvedAt: gateNow,
      checkpointFingerprint: HASH_B,
      result: { schemaHash: HASH_A, value: { decision: "rejected", reason: "n/a", evidenceDigest: HASH_A } },
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
    // The derived leaves keep the OLDEST original observation, which is the
    // comparison's live read — an approval is always at least as new as the
    // evidence it was granted on, so a gate can never make an output look
    // fresher than the facts under it.
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
      gateId: "identity-approval",
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
