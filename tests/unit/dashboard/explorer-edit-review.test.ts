/**
 * DCC5 review identity — an Explorer validation is usable only for the exact
 * editor draft and bases that asked for it.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  acceptsExplorerEditValidationTicket,
  explorerPresentationChange,
  explorerPresentationDraft,
  explorerPresentationValue,
  makeExplorerEditValidationTicket,
  matchesExplorerAppliedReadback,
  matchesExplorerApplyAcknowledgement,
  matchesExplorerCommandResultId,
} from "../../../src/dashboard/surfaces/explorer-model.js";
import { ExplorerProposedWorkflowOverrideSchema, ExplorerWorkflowWireSchema } from "../../../src/domain/dashboard/explorer.js";
import { CommandResultSchema } from "../../../src/domain/commands.js";
import { manualClock } from "../../../src/domain/clock.js";
import { FingerprintSchema } from "../../../src/domain/ids.js";
import { buildWorkflowExplorer } from "../../../src/server/dashboard/queries/explorer.js";
import { explorerQueryDeps } from "../../fixtures/explorer-seams.js";

const CLOCK = manualClock(new Date("2026-08-28T18:00:00.000Z"));
const HASH = FingerprintSchema.parse("e".repeat(64));

function workflows() {
  const served = buildWorkflowExplorer(explorerQueryDeps(CLOCK, HASH)).workflows;
  const first = served[0];
  const second = served[1];
  if (first === undefined || second === undefined) throw new Error("fixture needs two Explorer workflows");
  return { first, second };
}

describe("DCC5 Explorer validation review identity", () => {
  it("builds icon and category drafts from their served initial values", () => {
    const { first } = workflows();
    for (const field of ["workflow-icon", "workflow-category"] as const) {
      const value = explorerPresentationValue(first, field);
      const change = explorerPresentationChange(first, field, value);
      const draft = explorerPresentationDraft(first, change);
      assert.deepEqual(draft.changes, [{ kind: field, value }]);
    }
  });

  it("rejects a validation result after its editor generation was invalidated", () => {
    const { first } = workflows();
    const draft = explorerPresentationDraft(
      first,
      explorerPresentationChange(first, "workflow-label", `${first.label} reviewed`),
    );
    const ticket = makeExplorerEditValidationTicket(4, draft, "Correct display wording");

    assert.equal(acceptsExplorerEditValidationTicket(ticket, 5, draft, "Correct display wording"), false);
  });

  it("rejects a ready validation after a target or command reason changed", () => {
    const { first, second } = workflows();
    const firstDraft = explorerPresentationDraft(
      first,
      explorerPresentationChange(first, "workflow-label", `${first.label} reviewed`),
    );
    const targetSwitchedDraft = explorerPresentationDraft(
      second,
      explorerPresentationChange(second, "workflow-label", `${second.label} reviewed`),
    );
    const ticket = makeExplorerEditValidationTicket(4, firstDraft, "Correct display wording");

    assert.equal(acceptsExplorerEditValidationTicket(ticket, 4, targetSwitchedDraft, "Correct display wording"), false);
    assert.equal(acceptsExplorerEditValidationTicket(ticket, 4, firstDraft, "A different reason"), false);
  });

  it("requires the exact acknowledged command id and Explorer target revision", () => {
    const { first } = workflows();
    const commandId = "11111111-1111-4111-8111-111111111111";
    const result = CommandResultSchema.parse({
      state: "applied",
      commandId,
      affectedTargets: [{ family: "explorer", workflowId: first.id, revision: first.edit.overrideRevision + 1 }],
    });
    if (result.state !== "applied" && result.state !== "already-applied") {
      throw new Error("test fixture did not parse as an applied Explorer command");
    }

    assert.equal(matchesExplorerApplyAcknowledgement(result, commandId, String(first.id), first.edit.overrideRevision + 1), true);
    assert.equal(matchesExplorerApplyAcknowledgement(result, "22222222-2222-4222-8222-222222222222", String(first.id), first.edit.overrideRevision + 1), false);
    assert.equal(matchesExplorerApplyAcknowledgement(result, commandId, String(first.id), first.edit.overrideRevision + 2), false);
  });

  it("requires the generated command id for applied, conflict, and rejected result arms", () => {
    const commandId = "11111111-1111-4111-8111-111111111111";
    const foreignCommandId = "22222222-2222-4222-8222-222222222222";
    const results = [
      CommandResultSchema.parse({
        state: "applied",
        commandId,
        affectedTargets: [{ family: "explorer", workflowId: workflows().first.id, revision: 2 }],
      }),
      CommandResultSchema.parse({
        state: "conflict",
        commandId,
        currentVersion: 2,
        message: "a newer revision exists",
      }),
      CommandResultSchema.parse({
        state: "rejected",
        commandId,
        code: "policy-refused",
        message: "the edit is refused",
      }),
    ];

    for (const result of results) {
      assert.equal(matchesExplorerCommandResultId(result, commandId), true);
      assert.equal(matchesExplorerCommandResultId(result, foreignCommandId), false);
    }
  });

  it("requires readback descriptor bases as well as the reviewed presentation", () => {
    const { first } = workflows();
    const value = `${first.label} reviewed`;
    const draft = explorerPresentationDraft(first, explorerPresentationChange(first, "workflow-label", value));
    const reviewed = ExplorerProposedWorkflowOverrideSchema.parse({
      overrideVersion: 1,
      workflowId: first.id,
      descriptorVersion: first.version,
      contractFingerprint: first.contractFingerprint,
      revision: first.edit.overrideRevision + 1,
      presentation: { label: value },
    });
    const readback = ExplorerWorkflowWireSchema.parse({
      ...first,
      label: value,
      edit: { ...first.edit, overrideRevision: reviewed.revision },
    });
    const descriptorChanged = ExplorerWorkflowWireSchema.parse({ ...readback, version: readback.version + 1 });

    assert.equal(matchesExplorerAppliedReadback(first, draft, reviewed, readback), true);
    assert.equal(matchesExplorerAppliedReadback(first, draft, reviewed, descriptorChanged), false);
  });
});
