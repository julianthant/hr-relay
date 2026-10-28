import { createSeparationTaskFixtures, TaskRefusal } from "../../../support/helpers/separation-task-fixtures.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { noSeparationWritePlan } from "../../../../src/rules/separations/write-plan.js";
import type { DataPoint } from "../../../../src/rules/workflow/task-provenance.js";
import { matchIdentityTask } from "../../../../src/workflows/separations/tasks/match-identity.js";

const { DOCUMENT, EID, NAME, NOW, taskContext, jobRow, jobSummary, nameSelection } = createSeparationTaskFixtures();

const OTHER_EID = EidSchema.parse("10800001");

function assertRecordedOutput(records: readonly DataPoint[], output: object): void {
  const entries = Object.entries(output);
  assert.deepEqual(records.map(({ direction, field }) => ({ direction, field })), entries.map(([field]) => ({
    direction: "read",
    field,
  })));
  assert.deepEqual(Object.fromEntries(records.map(({ field, value }) => [field, value])), output);
}

const writePlan = noSeparationWritePlan("this focused unit composes no separation write plan");

function identityInput() {
  return {
    documentNumber: DOCUMENT,
    documentName: NAME,
    documentEid: { state: "present" as const, value: EID },
    emplId: EID,
    emplIdSource: "document-eid" as const,
    jobSummary: jobSummary(),
    nameSelection,
    plan: writePlan,
  };
}

async function expectRefusal(run: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(run, (error: unknown) => error instanceof TaskRefusal && error.code === code);
}

describe("separations workflow task wrappers", () => {

  it("records the identity packet and names both wrapper refusals", async () => {
    const success = taskContext();
    const output = await matchIdentityTask.impl.run({
      input: identityInput(),
      ctx: success.ctx,
    });
    assert.deepEqual({
      documentNumber: output.packet.documentNumber,
      emplId: output.packet.emplId,
      emplIdSource: output.packet.emplIdSource,
      documentEidText: output.packet.documentEidText,
      documentName: output.packet.documentName,
      ucpathName: output.packet.ucpathName,
      nameTier: output.packet.nameTier,
      nameSearch: output.packet.nameSearch,
      jobs: output.packet.jobs,
      plan: output.packet.plan,
      approvableEids: output.packet.approvableEids,
      approvalShape: output.packet.approvalShape,
      observedAt: output.packet.observedAt,
      comparisonDecisions: output.packet.comparisons.map(({ field, agrees }) => [field, agrees]),
    }, {
      documentNumber: DOCUMENT,
      emplId: EID,
      emplIdSource: "document-eid",
      documentEidText: EID,
      documentName: NAME,
      ucpathName: NAME,
      nameTier: "same",
      nameSearch: {
        status: "resolved",
        candidate: {
          eid: EID,
          name: NAME,
          department: "Housing Dining Hospitality",
          jobTitle: "STDT 2",
          employeeStatus: "active",
        },
        candidateEids: [EID],
      },
      jobs: {
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
          department: "HOUSING/DINING/HOSPITALITY",
          jobTitle: "STDT 2",
          effectiveDate: "07/01/2025",
        }],
        unreadableCells: ["row 0 (empl record 0): Expected Job End Date"],
      },
      plan: writePlan,
      approvableEids: [EID],
      approvalShape: "one-click",
      observedAt: NOW,
      comparisonDecisions: [["name", true], ["eid", true], ["employment", true], ["name-search", true]],
    });
    assert.match(output.evidenceDigest, /^[0-9a-f]{64}$/u);
    assertRecordedOutput(success.records, output);

    const subjectMismatch = taskContext();
    await expectRefusal(() => matchIdentityTask.impl.run({
      input: { ...identityInput(), jobSummary: jobSummary([jobRow()], OTHER_EID) },
      ctx: subjectMismatch.ctx,
    }), "identity-subject-mismatch");
    assert.deepEqual(subjectMismatch.records, []);

    const sourceMismatch = taskContext();
    await expectRefusal(() => matchIdentityTask.impl.run({
      input: { ...identityInput(), emplIdSource: "name-resolved" },
      ctx: sourceMismatch.ctx,
    }), "identity-source-inconsistent");
    assert.deepEqual(sourceMismatch.records, []);
  });
});

describe("operator-entered identity", () => {
  for (const documentEid of [{ state: "present" as const, value: OTHER_EID }, { state: "absent" as const, reason: "blank on the document" }]) {
    it(`reads the exact entered subject and preserves the ${documentEid.state} document observation`, async () => {
      const success = taskContext();
      const output = await matchIdentityTask.impl.run({ input: { ...identityInput(), documentEid, emplIdSource: "operator-entered" }, ctx: success.ctx });
      assert.equal(output.approvalRequired, true);
      assert.equal(output.packet.emplIdSource, "operator-entered");
      assert.equal(output.packet.documentEidText, documentEid.state === "present" ? OTHER_EID : "blank (blank on the document)");
      assert.equal(output.packet.comparisons.find(row => row.field === "eid")?.agrees, false);
      assertRecordedOutput(success.records, output);
    });
  }
  it("still refuses a different UCPath read-back", async () => {
    const context = taskContext();
    await expectRefusal(() => matchIdentityTask.impl.run({ input: { ...identityInput(), emplIdSource: "operator-entered", emplId: OTHER_EID }, ctx: context.ctx }), "identity-subject-mismatch");
    assert.deepEqual(context.records, []);
  });
});
