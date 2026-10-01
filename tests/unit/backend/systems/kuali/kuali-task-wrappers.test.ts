import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { TaskError } from "../../../../../src/base/errors.js";
import { taskFailer, type AnyTask } from "../../../../../src/base/task.js";
import type { DataPoint } from "../../../../../src/domain/task-provenance.js";
import { KUALI_RRSS_SAVE_BUTTON } from "../../../../../src/domain/ui/kuali-rrss-document.js";
import type { MutationCapability, UiActionProof } from "../../../../../src/domain/ui/driver.js";
import {
  KualiFinalizationFieldsSchema,
  KualiFinalizationStagingSchema,
  KualiSavedFinalizationProofSchema,
  KualiDepartmentOptionNotOfferedError,
  KualiSaveRefusedError,
  KualiFinalizationTargetSchema,
  type KualiFinalizationReadBack,
  type KualiFinalizationTarget,
} from "../../../../../src/domain/ui/kuali-separation-finalization.js";
import type { KualiRrssDocumentDriver } from "../../../../../src/domain/ui/kuali-rrss-document.js";
import {
  KualiReadSeparationDocument,
  ReadSeparationDocumentOutputSchema,
} from "../../../../../src/domain/contracts/kuali/read-separation-document.js";
import { KualiStageSeparationFinalization } from "../../../../../src/domain/contracts/kuali/stage-separation-finalization.js";
import {
  KualiFinalizationVerdictSchema,
  KualiMatchSeparationFinalization,
} from "../../../../../src/domain/contracts/kuali/match-separation-finalization.js";
import { matchSeparationFinalizationTask } from "../../../../../src/stores/kuali/tasks/match-separation-finalization.js";
import { readSeparationDocumentTask } from "../../../../../src/stores/kuali/tasks/read-separation-document.js";
import { saveSeparationFinalizationTask } from "../../../../../src/stores/kuali/tasks/save-separation-finalization.js";
import { searchSeparationActionTask } from "../../../../../src/stores/kuali/tasks/search-separation-action.js";
import { stageSeparationFinalizationTask } from "../../../../../src/stores/kuali/tasks/stage-separation-finalization.js";
import { verifySeparationFinalizationTask } from "../../../../../src/stores/kuali/tasks/verify-separation-finalization.js";

const NOW = "2026-08-20T17:24:11.000Z";
const TARGET: KualiFinalizationTarget = KualiFinalizationTargetSchema.parse({
  actionId: "0123456789abcdef01234567",
  documentNumber: "4444",
  emplId: "10800000",
  variables: {
    department: "000412 - Housing/Dining/Hospitality",
    payrollTitleCode: "004921",
    payrollTitle: "STDT 2",
    timekeeperName: "Deterministic Timekeeper",
    lastDayWorked: "06/09/2026",
    separationDate: "06/10/2026",
    terminationEffectiveDate: "06/11/2026",
    transactionNumber: "T002209631",
    timekeeperComments: "Termination effective date set from the reconciled separation date.",
    observedExistingComments: "",
  },
});

const FINALIZATION_PROOF = KualiSavedFinalizationProofSchema.parse(
  KualiMatchSeparationFinalization.example.proof,
);
const FINALIZATION_FIELDS = KualiFinalizationFieldsSchema.parse(FINALIZATION_PROOF.fields);
const STAGING = KualiFinalizationStagingSchema.parse(KualiStageSeparationFinalization.example);
const DOCUMENT = ReadSeparationDocumentOutputSchema.parse(KualiReadSeparationDocument.example);
const READ_INPUT = { actionId: DOCUMENT.actionId, documentNumber: DOCUMENT.documentNumber };

type KualiOperation =
  | "read"
  | "readActionListForDocument"
  | "readSeparationDocument"
  | "stageSeparationFinalization"
  | "readSavedSeparationFinalization"
  | "commit";
type OperationHandler = (...args: readonly unknown[]) => unknown;
type DriverCall = Readonly<{ operation: KualiOperation; args: readonly unknown[] }>;

function recordingDriver(handlers: Partial<Record<KualiOperation, OperationHandler>>) {
  const calls: DriverCall[] = [];
  const invoke = async (operation: KualiOperation, args: readonly unknown[]): Promise<unknown> => {
    calls.push({ operation, args });
    const handler = handlers[operation];
    if (handler === undefined) throw new Error(`unexpected Kuali semantic operation: ${operation}`);
    return handler(...args);
  };

  const driver = {
    system: "kuali",
    read: (id: unknown) => invoke("read", [id]),
    readActionListForDocument: (input: unknown) => invoke("readActionListForDocument", [input]),
    readSeparationDocument: (input: unknown) => invoke("readSeparationDocument", [input]),
    stageSeparationFinalization: (input: unknown) => invoke("stageSeparationFinalization", [input]),
    readSavedSeparationFinalization: (input: unknown) => invoke("readSavedSeparationFinalization", [input]),
    commit: (id: unknown, capability: unknown) => invoke("commit", [id, capability]),
  } as unknown as KualiRrssDocumentDriver;

  return { driver, calls };
}

function invocation(
  task: AnyTask,
  input: unknown,
  driver: KualiRrssDocumentDriver,
  mutation?: MutationCapability,
) {
  const points: DataPoint[] = [];
  const ctx = {
    signal: new AbortController().signal,
    log: { debug: () => undefined, info: () => undefined, warn: () => undefined },
    fail: taskFailer(task.contract),
    recordData: (point: DataPoint | readonly DataPoint[]) => {
      if (Array.isArray(point)) points.push(...point as readonly DataPoint[]);
      else points.push(point as DataPoint);
    },
    driver,
    ...(mutation === undefined ? {} : { mutation }),
  };
  const parsedInput = task.contract.input.parse(input);
  return {
    points,
    run: () => task.impl.run({ input: parsedInput, ctx } as never),
  };
}

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

function point(direction: "read" | "write", field: string, value: unknown): DataPoint {
  return { direction, field, value };
}

describe("Kuali task wrappers at their semantic-driver boundary", () => {
  describe("searchSeparationActionTask", () => {
    it("returns the uniquely resolved document and records the observed Action List facts", async () => {
      const actionHref = "/build/space/5e47518b90adda9474c14adb/actions/0123456789abcdef01234567";
      const observation = {
        pageStateId: "kuali.action-list.ready",
        space: "5e47518b90adda9474c14adb",
        requestedDocumentNumber: TARGET.documentNumber,
        matchedLinks: [
          { name: TARGET.documentNumber, href: actionHref },
          { name: TARGET.documentNumber, href: actionHref },
        ],
        listedDocumentNumbers: [TARGET.documentNumber],
        observedAt: NOW,
      };
      const { driver, calls } = recordingDriver({
        readActionListForDocument: async () => observation,
      });
      const call = invocation(searchSeparationActionTask, { documentNumber: TARGET.documentNumber }, driver);

      const result = await call.run();

      assert.deepEqual(result, {
        pageStateId: "kuali.action-list.ready",
        documentNumber: TARGET.documentNumber,
        actionId: TARGET.actionId,
        actionHref,
        matchedLinkCount: 2,
        observedAt: NOW,
      });
      assert.deepEqual(calls, [{
        operation: "readActionListForDocument",
        args: [{ documentNumber: TARGET.documentNumber }],
      }]);
      assert.deepEqual(call.points, [
        point("read", "documentNumber", TARGET.documentNumber),
        point("read", "actionId", TARGET.actionId),
        point("read", "actionHref", actionHref),
        point("read", "matchedLinkCount", 2),
        point("read", "pageStateId", "kuali.action-list.ready"),
        point("read", "observedAt", NOW),
      ]);
    });

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
    it("returns the RRSS document facts from one read-only operation", async () => {
      const { driver, calls } = recordingDriver({
        readSeparationDocument: async () => ({ state: "read", document: DOCUMENT }),
      });
      const call = invocation(readSeparationDocumentTask, READ_INPUT, driver);

      const result = await call.run() as typeof DOCUMENT;

      assert.equal(result.documentNumber, "4510");
      assert.equal(result.actionId, DOCUMENT.actionId);
      assert.deepEqual(result.employee.eid, DOCUMENT.employee.eid);
      assert.deepEqual(result.options, DOCUMENT.options);
      assert.deepEqual(calls, [{
        operation: "readSeparationDocument",
        args: [READ_INPUT],
      }]);
      assert.deepEqual(call.points, [
        point("read", "pageStateId", DOCUMENT.pageStateId),
        point("read", "actionId", DOCUMENT.actionId),
        point("read", "documentNumber", DOCUMENT.documentNumber),
        point("read", "formType", DOCUMENT.formType),
        point("read", "employee", DOCUMENT.employee),
        point("read", "separation", DOCUMENT.separation),
        point("read", "timekeeper", DOCUMENT.timekeeper),
        point("read", "finalTransactions", DOCUMENT.finalTransactions),
        point("read", "options", DOCUMENT.options),
        point("read", "observedAt", DOCUMENT.observedAt),
      ]);
    });

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
    it("returns the staged identity and fields without committing", async () => {
      const { driver, calls } = recordingDriver({
        stageSeparationFinalization: async () => STAGING,
      });
      const call = invocation(stageSeparationFinalizationTask, TARGET, driver);

      const result = await call.run();

      assert.deepEqual(result, STAGING);
      assert.deepEqual(calls, [{ operation: "stageSeparationFinalization", args: [TARGET] }]);
      assert.deepEqual(call.points, [
        point("read", "stagedPageState", STAGING.stagedPageState),
        point("read", "actionId", STAGING.actionId),
        point("read", "documentNumber", STAGING.documentNumber),
        point("read", "observedEid", STAGING.observedEid),
        point("read", "previousFields", STAGING.previousFields),
        point("write", "stagedFields", STAGING.stagedFields),
        point("read", "observedDepartmentOptions", STAGING.observedDepartmentOptions),
        point("read", "observedAt", STAGING.observedAt),
      ]);
    });

    it("keeps the typed department-option refusal distinct and does not commit", async () => {
      const refusal = new KualiDepartmentOptionNotOfferedError({
        documentNumber: TARGET.documentNumber,
        requested: TARGET.variables.department,
        observedOptions: ["- - -", "000413 - Library"],
      });
      const { driver, calls } = recordingDriver({
        stageSeparationFinalization: async () => { throw refusal; },
      });
      const call = invocation(stageSeparationFinalizationTask, TARGET, driver);

      await assert.rejects(call.run(), (error: unknown) => error instanceof TaskError
        && error.code === "department-option-not-offered"
        && error.cause === refusal);
      assert.deepEqual(calls, [{ operation: "stageSeparationFinalization", args: [TARGET] }]);
      assert.deepEqual(call.points, []);
    });

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

    it("maps Kuali's typed save refusal to the named task refusal", async () => {
      const refusal = new KualiSaveRefusedError({ documentNumber: TARGET.documentNumber, refusal: "validation error" });
      const mutationSentinel = Object.freeze({ marker: "unchanged-mutation-capability" }) as unknown as MutationCapability;
      const { driver, calls } = recordingDriver({ commit: async () => { throw refusal; } });
      const call = invocation(saveSeparationFinalizationTask, TARGET, driver, mutationSentinel);

      await assert.rejects(call.run(), (error: unknown) => error instanceof TaskError
        && error.code === "save-refused"
        && error.cause === refusal);
      assert.deepEqual(calls, [{
        operation: "commit",
        args: [KUALI_RRSS_SAVE_BUTTON, mutationSentinel],
      }]);
      assert.equal(calls[0]?.args[1], mutationSentinel);
      assert.deepEqual(call.points, []);
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
