import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { planStart } from "../../../../src/backend/runs/start/plan.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { compileWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { workStudyWorkflow } from "../../../../src/workflows/work-study/workflow.js";
import { CONFIG_SNAPSHOT, NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";

const workStudy = compileWorkflow(workStudyWorkflow).descriptor;
const deps = () => ({ authority: { authority: { runs: { listByItem: () => [] } } }, clock: manualClock(new Date(NOW)),
  ids: sequentialIdFactory(), planTtlMs: 600_000 });
const plan = (submissions: readonly unknown[]) => planStart(deps(), { descriptor: workStudy, submissions, dryRun: true,
  priority: "bulk", shape: "single", configFingerprint: CONFIG_SNAPSHOT.fingerprint, configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId,
  plannedBy: "local-operator" });

describe("a start with a declared date control", () => {
  it("gives every planned run the one typed effective date as an ISO date, keeping what the operator typed", () => {
    const record = plan([{ emplId: "10000001", effectiveDate: "08/03/2026" }, { emplId: "10000002", effectiveDate: "08/03/2026" }]);
    assert.deepEqual(record.refused, []);
    assert.deepEqual(record.planned.map(run => run.input.value), [
      { emplId: "10000001", effectiveDate: "2026-08-03" }, { emplId: "10000002", effectiveDate: "2026-08-03" }]);
    assert.deepEqual(record.planned.map(run => run.matchKey), ["10000001:2026-08-03", "10000002:2026-08-03"]);
    assert.deepEqual(record.planned.map(run => run.rawInput), [
      { emplId: "10000001", effectiveDate: "08/03/2026" }, { emplId: "10000002", effectiveDate: "08/03/2026" }]);
  });

  it.each([
    ["no date", undefined],
    ["a blank date", ""],
    ["an ISO date", "2026-08-03"],
    ["a day the month does not have", "02/30/2026"],
    ["a number", 20260803],
  ])("refuses every entry before planning any run when the start carries %s", (_name, effectiveDate) => {
    const typed = effectiveDate === undefined ? {} : { effectiveDate };
    const record = plan([{ emplId: "10000001", ...typed }, { emplId: "10000002", ...typed }]);
    assert.deepEqual(record.planned, []);
    assert.deepEqual(record.refused.map(({ entry, code, message }) => [entry, code, message]), [
      [1, "input-invalid", "Choose a valid effective date."], [2, "input-invalid", "Choose a valid effective date."]]);
  });

  it("refuses every entry when one entry lacks the date the others carry", () => {
    const record = plan([{ emplId: "10000001", effectiveDate: "08/03/2026" }, { emplId: "10000002" }]);
    assert.deepEqual(record.planned, []);
    assert.deepEqual(record.refused.map(({ message }) => message), ["Choose a valid effective date.", "Choose a valid effective date."]);
  });

  it("refuses every entry when the entries carry different dates, since one start has one effective date", () => {
    const record = plan([{ emplId: "10000001", effectiveDate: "08/03/2026" }, { emplId: "10000002", effectiveDate: "08/04/2026" }]);
    assert.deepEqual(record.planned, []);
    assert.deepEqual(record.refused.map(({ entry, code, message }) => [entry, code, message]), [
      [1, "input-invalid", "Effective date must be one date for every entry in this start."],
      [2, "input-invalid", "Effective date must be one date for every entry in this start."]]);
  });
});
