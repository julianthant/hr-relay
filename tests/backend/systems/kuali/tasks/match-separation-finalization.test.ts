import { createKualiTaskTestWorld } from "../../../../support/helpers/backend/kuali-task-world.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { matchSeparationFinalizationTask } from "../../../../../src/backend/systems/kuali/tasks/match-separation-finalization.js";
import { readSeparationDocumentTask } from "../../../../../src/backend/systems/kuali/tasks/read-separation-document.js";
import { saveSeparationFinalizationTask } from "../../../../../src/backend/systems/kuali/tasks/save-separation-finalization.js";
import { searchSeparationActionTask } from "../../../../../src/backend/systems/kuali/tasks/search-separation-action.js";
import { stageSeparationFinalizationTask } from "../../../../../src/backend/systems/kuali/tasks/stage-separation-finalization.js";
import { verifySeparationFinalizationTask } from "../../../../../src/backend/systems/kuali/tasks/verify-separation-finalization.js";
import { KualiFinalizationVerdictSchema } from "../../../../../src/models/systems/kuali/match-separation-finalization.js";
import type { MutationCapability, UiActionProof } from "../../../../../src/models/ui/driver.js";
import { KUALI_RRSS_SAVE_BUTTON } from "../../../../../src/models/ui/kuali-rrss-document.js";
import { KualiFinalizationFieldsSchema, KualiSavedFinalizationProofSchema, type KualiFinalizationReadBack } from "../../../../../src/models/ui/kuali-separation-finalization.js";
import { TaskError } from "../../../../../src/workflow-kit/errors.js";

const { NOW, TARGET, MATCH_EXAMPLE, STAGING, READ_INPUT, recordingDriver, invocation, point } = createKualiTaskTestWorld();

if (MATCH_EXAMPLE.state !== "present") throw new Error("Kuali match example must carry a present proof");
const FINALIZATION_PROOF = KualiSavedFinalizationProofSchema.parse(MATCH_EXAMPLE.proof);
const FINALIZATION_FIELDS = KualiFinalizationFieldsSchema.parse(FINALIZATION_PROOF.fields);

function presentReadBack(): KualiFinalizationReadBack {
  return { state: "present", proof: FINALIZATION_PROOF, observedAt: NOW };
}

function unfinalizedReadBack(): KualiFinalizationReadBack {
  return {
    state: "absent",
    actionId: TARGET.actionId,
    documentNumber: TARGET.documentNumber,
    observedEid: TARGET.emplId,
    observedFields: STAGING.previousFields,
    mismatches: [{ field: "department", expected: TARGET.variables.department, observed: "- - -" }],
    observedAt: NOW,
  };
}

describe("Kuali task wrappers at their semantic-driver boundary", () => {
  describe("searchSeparationActionTask", () => {

    it("names a missing Action List action and retains the neighboring numbers shown", async () => {
      const observation = {
        pageStateId: "kuali.action-list.ready",
        space: "5e47518b90adda9474c14adb",
        requestedDocumentNumber: TARGET.documentNumber,
        matchedLinks: [],
        listedDocumentNumbers: ["44440", "4439"],
        observedAt: NOW,
      };
      const { driver, calls } = recordingDriver({ readActionListForDocument: async () => observation });
      const call = invocation(searchSeparationActionTask, { documentNumber: TARGET.documentNumber }, driver);

      await assert.rejects(call.run(), (error: unknown) => error instanceof TaskError
        && error.code === "document-not-in-action-list"
        && error.message.includes("44440, 4439"));
      assert.deepEqual(calls, [{
        operation: "readActionListForDocument",
        args: [{ documentNumber: TARGET.documentNumber }],
      }]);
      assert.deepEqual(call.points, []);
    });

    it("refuses an Action List observation for a different requested document", async () => {
      const observation = {
        pageStateId: "kuali.action-list.ready",
        space: "5e47518b90adda9474c14adb",
        requestedDocumentNumber: "4445",
        matchedLinks: [],
        listedDocumentNumbers: [],
        observedAt: NOW,
      };
      const { driver, calls } = recordingDriver({ readActionListForDocument: async () => observation });
      const call = invocation(searchSeparationActionTask, { documentNumber: TARGET.documentNumber }, driver);

      await assert.rejects(call.run(), (error: unknown) => error instanceof TaskError
        && error.code === "unexpected-page-state");
      assert.deepEqual(calls.map(({ operation, args }) => ({ operation, args })), [{
        operation: "readActionListForDocument",
        args: [{ documentNumber: TARGET.documentNumber }],
      }]);
    });
  });

  describe("readSeparationDocumentTask", () => {

    it("refuses a named non-separation form without reaching a write operation", async () => {
      const refusal = {
        state: "not-a-separation-document",
        actionId: TARGET.actionId,
        documentNumber: TARGET.documentNumber,
        observedFormType: "Payroll Adjustment Request",
        observedAt: NOW,
      };
      const { driver, calls } = recordingDriver({ readSeparationDocument: async () => refusal });
      const call = invocation(readSeparationDocumentTask, READ_INPUT, driver);

      await assert.rejects(call.run(), (error: unknown) => error instanceof TaskError
        && error.code === "not-a-separation-document"
        && error.message.includes("Payroll Adjustment Request"));
      assert.deepEqual(calls, [{ operation: "readSeparationDocument", args: [READ_INPUT] }]);
      assert.deepEqual(call.points, []);
    });
  });

  describe("matchSeparationFinalizationTask", () => {
    it("returns the present probe verdict and records the transaction identity", async () => {
      const { driver, calls } = recordingDriver({
        readSavedSeparationFinalization: async () => presentReadBack(),
      });
      const call = invocation(matchSeparationFinalizationTask, TARGET, driver);

      const result = await call.run();

      assert.deepEqual(KualiFinalizationVerdictSchema.parse(result), {
        state: "present",
        proof: FINALIZATION_PROOF,
      });
      assert.deepEqual(calls, [{
        operation: "readSavedSeparationFinalization",
        args: [TARGET],
      }]);
      assert.deepEqual(call.points, [
        point("read", "state", "present"),
        point("read", "documentNumber", TARGET.documentNumber),
        point("read", "transactionNumber", TARGET.variables.transactionNumber),
      ]);
    });

    it("refuses a probe that identifies another employee", async () => {
      const wrongSubject = KualiSavedFinalizationProofSchema.parse({
        ...FINALIZATION_PROOF,
        observedEid: "10800001",
      });
      const { driver, calls } = recordingDriver({
        readSavedSeparationFinalization: async () => ({
          state: "present",
          proof: wrongSubject,
          observedAt: NOW,
        }),
      });
      const call = invocation(matchSeparationFinalizationTask, TARGET, driver);

      await assert.rejects(call.run(), (error: unknown) => error instanceof TaskError
        && error.code === "subject-mismatch");
      assert.deepEqual(calls, [{ operation: "readSavedSeparationFinalization", args: [TARGET] }]);
      assert.deepEqual(call.points, []);
    });

    it("refuses a probe that returned another document", async () => {
      const wrongDocument = KualiSavedFinalizationProofSchema.parse({
        ...FINALIZATION_PROOF,
        documentNumber: "4445",
      });
      const { driver, calls } = recordingDriver({
        readSavedSeparationFinalization: async () => ({
          state: "present",
          proof: wrongDocument,
          observedAt: NOW,
        }),
      });
      const call = invocation(matchSeparationFinalizationTask, TARGET, driver);

      await assert.rejects(call.run(), (error: unknown) => error instanceof TaskError
        && error.code === "unexpected-page-state");
      assert.deepEqual(calls, [{ operation: "readSavedSeparationFinalization", args: [TARGET] }]);
      assert.deepEqual(call.points, []);
    });

    it("keeps an inconclusive probe unknown rather than treating it as absence", async () => {
      const unknown: KualiFinalizationReadBack = { state: "unknown", reason: "reload timed out", observedAt: NOW };
      const { driver, calls } = recordingDriver({ readSavedSeparationFinalization: async () => unknown });
      const call = invocation(matchSeparationFinalizationTask, TARGET, driver);

      const result = await call.run();

      assert.deepEqual(result, { state: "unknown", reason: "reload timed out", observedAt: NOW });
      assert.deepEqual(calls, [{ operation: "readSavedSeparationFinalization", args: [TARGET] }]);
      assert.deepEqual(call.points, [
        point("read", "state", "unknown"),
        point("read", "documentNumber", TARGET.documentNumber),
        point("read", "transactionNumber", TARGET.variables.transactionNumber),
      ]);
    });
  });

  describe("stageSeparationFinalizationTask", () => {

    it("refuses staging facts bound to another employee", async () => {
      const wrongSubject = { ...STAGING, observedEid: "10800001" };
      const { driver, calls } = recordingDriver({ stageSeparationFinalization: async () => wrongSubject });
      const call = invocation(stageSeparationFinalizationTask, TARGET, driver);

      await assert.rejects(call.run(), (error: unknown) => error instanceof TaskError
        && error.code === "subject-mismatch");
      assert.deepEqual(calls, [{ operation: "stageSeparationFinalization", args: [TARGET] }]);
      assert.deepEqual(call.points, []);
    });
  });

  describe("saveSeparationFinalizationTask", () => {
    it("forwards the exact Save operation and mutation capability, returning only the task claim", async () => {
      const mutationSentinel = Object.freeze({ marker: "unchanged-mutation-capability" }) as unknown as MutationCapability;
      const commit: UiActionProof = {
        elementId: KUALI_RRSS_SAVE_BUTTON,
        effect: "external-commit",
        performed: true,
      };
      const { driver, calls } = recordingDriver({ commit: async () => commit });
      const call = invocation(saveSeparationFinalizationTask, TARGET, driver, mutationSentinel);

      const result = await call.run() as { savedState: { kind: string; actionId: string; documentNumber: string; observedEid: string; fields: unknown } };

      assert.equal(result.savedState.kind, "kuali-saved-finalization");
      assert.equal(result.savedState.actionId, TARGET.actionId);
      assert.equal(result.savedState.documentNumber, TARGET.documentNumber);
      assert.equal(result.savedState.observedEid, TARGET.emplId);
      assert.deepEqual(result.savedState.fields, FINALIZATION_FIELDS);
      assert.deepEqual(calls, [{
        operation: "commit",
        args: [KUALI_RRSS_SAVE_BUTTON, mutationSentinel],
      }]);
      assert.equal(calls[0]?.args[1], mutationSentinel);
      assert.deepEqual(call.points, [
        point("write", "savedState.documentNumber", TARGET.documentNumber),
        point("write", "savedState.fields", FINALIZATION_FIELDS),
      ]);
    });

    it("refuses a commit result that does not report the declared external-commit effect", async () => {
      const { driver, calls } = recordingDriver({
        commit: async () => ({ elementId: KUALI_RRSS_SAVE_BUTTON, effect: "prepare", performed: true }),
      });
      const call = invocation(saveSeparationFinalizationTask, TARGET, driver, {} as MutationCapability);

      await assert.rejects(call.run(), (error: unknown) => error instanceof TaskError
        && error.code === "save-refused");
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.operation, "commit");
      assert.equal(calls[0]?.args[0], KUALI_RRSS_SAVE_BUTTON);
      assert.deepEqual(call.points, []);
    });

    it("propagates an unexpected driver failure without converting it to a Kuali refusal", async () => {
      const failure = new Error("transport disconnected before a Kuali answer");
      const { driver, calls } = recordingDriver({ commit: async () => { throw failure; } });
      const call = invocation(saveSeparationFinalizationTask, TARGET, driver, {} as MutationCapability);

      await assert.rejects(call.run(), failure);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.operation, "commit");
      assert.equal(calls[0]?.args[0], KUALI_RRSS_SAVE_BUTTON);
      assert.deepEqual(call.points, []);
    });
  });

  describe("verifySeparationFinalizationTask", () => {
    it("maps a reload-present read-back to the present verdict", async () => {
      const { driver, calls } = recordingDriver({
        readSavedSeparationFinalization: async () => presentReadBack(),
      });
      const call = invocation(verifySeparationFinalizationTask, TARGET, driver);

      const result = await call.run();

      assert.deepEqual(KualiFinalizationVerdictSchema.parse(result), {
        state: "present",
        proof: FINALIZATION_PROOF,
      });
      assert.deepEqual(calls, [{ operation: "readSavedSeparationFinalization", args: [TARGET] }]);
      assert.deepEqual(call.points, [
        point("read", "state", "present"),
        point("read", "documentNumber", TARGET.documentNumber),
        point("read", "transactionNumber", TARGET.variables.transactionNumber),
      ]);
    });

    it("preserves absent and unknown as separate post-save outcomes", async () => {
      for (const readBack of [
        unfinalizedReadBack(),
        { state: "unknown" as const, reason: "reload could not be read", observedAt: NOW },
      ]) {
        const { driver, calls } = recordingDriver({ readSavedSeparationFinalization: async () => readBack });
        const call = invocation(verifySeparationFinalizationTask, TARGET, driver);

        const result = KualiFinalizationVerdictSchema.parse(await call.run());

        assert.equal(result.state, readBack.state);
        assert.deepEqual(calls, [{ operation: "readSavedSeparationFinalization", args: [TARGET] }]);
        assert.deepEqual(call.points, [
          point("read", "state", readBack.state),
          point("read", "documentNumber", TARGET.documentNumber),
          point("read", "transactionNumber", TARGET.variables.transactionNumber),
        ]);
      }
    });

    it("refuses read-back for another document or employee", async () => {
      const mismatches = [
        {
          proof: KualiSavedFinalizationProofSchema.parse({
            ...FINALIZATION_PROOF,
            observedEid: "10800001",
          }),
          code: "subject-mismatch",
        },
        {
          proof: KualiSavedFinalizationProofSchema.parse({
            ...FINALIZATION_PROOF,
            documentNumber: "4445",
          }),
          code: "unexpected-page-state",
        },
      ] as const;
      for (const { proof, code } of mismatches) {
        const { driver, calls } = recordingDriver({
          readSavedSeparationFinalization: async () => ({ state: "present", proof, observedAt: NOW }),
        });
        const call = invocation(verifySeparationFinalizationTask, TARGET, driver);

        await assert.rejects(call.run(), (error: unknown) => error instanceof TaskError
          && error.code === code);
        assert.deepEqual(calls, [{ operation: "readSavedSeparationFinalization", args: [TARGET] }]);
        assert.deepEqual(call.points, []);
      }
    });
  });
});
