import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { EidSchema,FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { IdentityEvidencePacketSchema } from "../../../../src/rules/separations/identity-evidence.js";
import type { DataPoint } from "../../../../src/rules/workflow/task-provenance.js";
import { verifyIdentityApprovalTask } from "../../../../src/workflows/separations/tasks/verify-identity-approval.js";

class TaskRefusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function taskContext() {
  const records: DataPoint[] = [];
  const ctx = {
    signal: new AbortController().signal,
    log: Object.freeze({ debug: () => undefined, info: () => undefined, warn: () => undefined }),
    fail: (code: string, message: string): never => {
      throw new TaskRefusal(code, message);
    },
    recordData(input: DataPoint | readonly DataPoint[]): void {
      records.push(...(Array.isArray(input) ? input : [input]) as DataPoint[]);
    },
  };
  return { ctx: ctx as never, records };
}

function assertRecordedOutput(records: readonly DataPoint[], output: object): void {
  const entries = Object.entries(output);
  assert.deepEqual(records.map(({ direction, field }) => ({ direction, field })), entries.map(([field]) => ({
    direction: "read",
    field,
  })));
  assert.deepEqual(Object.fromEntries(records.map(({ field, value }) => [field, value])), output);
}

function assertExpectedOutput(
  records: readonly DataPoint[],
  output: object,
  expected: object,
): void {
  assert.deepEqual(output, expected);
  assertRecordedOutput(records, expected);
}

const APPROVAL_EID = EidSchema.parse("10873698");
const APPROVAL_PACKET_JOBS = {
  disposition: "single-active-job" as const,
  rowCount: 1,
  activeRowCount: 1,
  inactiveRowCount: 0,
  unknownRowCount: 0,
  rows: [{
    rowIndex: 0,
    emplRecord: "0",
    hrStatus: "Active",
    tier: "active" as const,
    department: "Housing Dining Hospitality",
    jobTitle: "Dining Assistant",
    effectiveDate: "07/01/2025",
  }],
  unreadableCells: [],
};
const APPROVAL_PACKET = IdentityEvidencePacketSchema.parse({
  documentNumber: "4510",
  emplId: APPROVAL_EID,
  emplIdSource: "document-eid",
  documentEidText: "10873698",
  documentName: "Battistessa, Johnnie",
  ucpathName: "Battistessa, Johnnie",
  nameTier: "same",
  comparisons: [{
    field: "name",
    documentValue: "Battistessa, Johnnie",
    ucpathValue: "Battistessa, Johnnie",
    agrees: true,
    note: "the fixture names agree",
  }],
  nameSearch: {
    status: "resolved",
    candidate: {
      eid: APPROVAL_EID,
      name: "Battistessa, Johnnie",
      department: "Housing Dining Hospitality",
      jobTitle: "Dining Assistant",
      employeeStatus: "active",
    },
    candidateEids: [APPROVAL_EID],
  },
  jobs: APPROVAL_PACKET_JOBS,
  plan: { state: "not-composed", reason: "the sealed approval fixture composes no separation write plan" },
  approvableEids: [APPROVAL_EID],
  approvalShape: "one-click",
  observedAt: "2026-08-14T19:00:00.000Z",
});
// Fixed from this packet fixture's canonical JSON and SHA-256, not derived from a task output.
const APPROVAL_PACKET_DIGEST = FingerprintSchema.parse(
  "0377fa1d08d77585e03e2f6d9b5f2e8e312d849db69e5ffa18925a7beb8c5797",
);

async function expectRefusal(run: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(run, (error: unknown) => error instanceof TaskRefusal && error.code === code);
}

describe("separations workflow task wrappers", () => {

  it("verifies a sealed supplied-EID packet and refuses a moved digest", async () => {
    const success = taskContext();
    const output = await verifyIdentityApprovalTask.impl.run({
      input: { packet: APPROVAL_PACKET, evidenceDigest: APPROVAL_PACKET_DIGEST },
      ctx: success.ctx,
    });
    assertExpectedOutput(success.records, output, {
      documentNumber: "4510",
      approved: {
        authority: "machine-verification",
        source: "document-eid",
        emplId: APPROVAL_EID,
        evidenceDigest: APPROVAL_PACKET_DIGEST,
        ucpathName: "Battistessa, Johnnie",
        nameTier: "same",
      },
      jobs: APPROVAL_PACKET_JOBS,
    });

    const refusal = taskContext();
    await expectRefusal(() => verifyIdentityApprovalTask.impl.run({
      input: {
        packet: APPROVAL_PACKET,
        evidenceDigest: FingerprintSchema.parse("f".repeat(64)),
      },
      ctx: refusal.ctx,
    }), "identity-approval-evidence-moved");
    assert.deepEqual(refusal.records, []);
  });
});
