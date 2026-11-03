import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { CommandRequestSchema } from "../../../src/rules/commands/commands.js";
import { ActionDescriptorWireSchema } from "../../../src/models/dashboard/actions.js";
import { RunWorkbookWritesWireSchema } from "../../../src/models/dashboard/run-detail.js";
import { HASH_A, HASH_B, NOW, UUID_1, UUID_2, UUID_3 } from "../../support/fixtures/phase1c-contract-fixtures.js";

const target = { runId: UUID_1, expectedVersion: 4, libraryId: UUID_2, typeId: "onboarding-roster",
  referenceDigest: HASH_A, key: "hire@example.test", workbookVersion: 3, gateId: "roster-choice" };
const candidate = { sheetId: "people", rowId: "person", label: "People · Row 2",
  values: [{ fieldId: "email", value: target.key }, { fieldId: "firstName", value: "Fixture" }] };
const action = { kind: "command", command: "resolve-workbook-reference-row", key: "roster-choice",
  label: "Choose a row", intent: "primary", placement: ["review"], expectedVersion: target.expectedVersion,
  referenceTarget: target };
const choice = { libraryId: target.libraryId, typeId: target.typeId, referenceDigest: target.referenceDigest,
  key: target.key, reason: "row-ambiguous", resolution: { state: "available", target, action, candidates: [candidate] } };
const section = { runId: UUID_1, operations: [], referenceChoices: [choice] };
const command = { commandId: UUID_3, requestedAt: NOW, requestedBy: "local-operator", source: "dashboard",
  family: "run", type: "resolve-workbook-reference-row", target, payload: { sheetId: candidate.sheetId, rowId: candidate.rowId } };

describe("workbook reference row-choice wire", () => {
  it("admits an identity-only read choice without a write receipt", () => {
    assert.deepEqual(CommandRequestSchema.parse(command), command);
    assert.deepEqual(RunWorkbookWritesWireSchema.parse(section), section);
    assert.deepEqual(RunWorkbookWritesWireSchema.parse({ runId: UUID_1, operations: [] }), { runId: UUID_1, operations: [] });
    for (const payload of [
      { ...command.payload, values: candidate.values },
      { ...command.payload, firstName: "Replacement" },
    ]) assert.equal(CommandRequestSchema.safeParse({ ...command, payload }).success, false);
    for (const changed of [
      { ...target, operationId: UUID_3 }, { ...target, receiptDigest: HASH_B },
      { ...target, referenceDigest: "invalid" }, { ...target, workbookVersion: 0 },
    ]) assert.equal(CommandRequestSchema.safeParse({ ...command, target: changed }).success, false);
  });

  it("keeps missing references explicitly held with zero candidates", () => {
    const resolution = { state: "unavailable", code: "WORKBOOK_ROW_CHOICE_UNAVAILABLE", candidates: [] };
    assert.equal(RunWorkbookWritesWireSchema.safeParse({ ...section,
      referenceChoices: [{ ...choice, reason: "row-missing", resolution }] }).success, true);
    for (const changed of [
      { ...resolution, candidates: [candidate] }, { ...resolution, action },
      { ...choice.resolution, candidates: [] },
    ]) assert.equal(RunWorkbookWritesWireSchema.safeParse({ ...section,
      referenceChoices: [{ ...choice, resolution: changed }] }).success, false);
  });

  it("binds every choice to its run, type, key, reference and exact served action", () => {
    for (const changed of [
      { ...target, runId: UUID_3 }, { ...target, libraryId: UUID_3 },
      { ...target, typeId: "other" }, { ...target, referenceDigest: HASH_B }, { ...target, key: "other@example.test" },
    ]) assert.equal(RunWorkbookWritesWireSchema.safeParse({ ...section, referenceChoices: [{ ...choice,
      resolution: { ...choice.resolution, target: changed, action: { ...action, referenceTarget: changed } } }] }).success, false);
    for (const changed of [
      { ...action, expectedVersion: 3 }, { ...action, referenceTarget: { ...target, workbookVersion: 4 } },
      { ...action, referenceTarget: undefined }, { ...action, command: "resolve-workbook-row" },
    ]) assert.equal(RunWorkbookWritesWireSchema.safeParse({ ...section, referenceChoices: [{ ...choice,
      resolution: { ...choice.resolution, action: changed } }] }).success, false);
    assert.equal(RunWorkbookWritesWireSchema.safeParse({ ...section, referenceChoices: [choice, choice] }).success, false);
    assert.equal(ActionDescriptorWireSchema.safeParse({ ...action, command: "retry" }).success, false);
  });

  it("preserves unique candidate membership and typed chosen evidence after resolution", () => {
    for (const candidates of [[candidate, candidate], [{ ...candidate, values: [...candidate.values, candidate.values[0]] }]]) {
      assert.equal(RunWorkbookWritesWireSchema.safeParse({ ...section, referenceChoices: [{ ...choice,
        resolution: { ...choice.resolution, candidates } }] }).success, false);
    }
    const resolution = { state: "resolved", workbookVersion: 4, selected: candidate };
    assert.equal(RunWorkbookWritesWireSchema.safeParse({ ...section, referenceChoices: [{ ...choice, resolution }] }).success, true);
    assert.equal(RunWorkbookWritesWireSchema.safeParse({ ...section, referenceChoices: [{ ...choice,
      resolution: { ...resolution, action } }] }).success, false);
  });
});
