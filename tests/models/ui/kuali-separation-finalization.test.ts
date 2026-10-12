import { kualiFinalizationVariablesInput, unfinalizedKualiFieldsInput } from "../../support/helpers/kuali-finalization-input-fixtures.js";
import { default as assert } from "node:assert/strict";
import { describe } from "vitest";
import { it } from "vitest";
import { saveSeparationFinalizationTask } from "../../../src/backend/systems/kuali/tasks/save-separation-finalization.js";
import { stageSeparationFinalizationTask } from "../../../src/backend/systems/kuali/tasks/stage-separation-finalization.js";
import { KualiMatchSeparationFinalization } from "../../../src/models/systems/kuali/match-separation-finalization.js";
import type { MutationCapability } from "../../../src/models/ui/driver.js";
import type { KualiRrssDocumentDriver } from "../../../src/models/ui/kuali-rrss-document.js";
import { KUALI_RRSS_SAVE_BUTTON } from "../../../src/models/ui/kuali-rrss-document.js";
import type { KualiFinalizationVariables } from "../../../src/models/ui/kuali-separation-finalization.js";
import type { KualiObservedFinalizationFields } from "../../../src/models/ui/kuali-separation-finalization.js";
import { KUALI_FINALIZATION_ASSERTIONS } from "../../../src/models/ui/kuali-separation-finalization.js";
import { KUALI_FINALIZATION_FIELD_NAMES } from "../../../src/models/ui/kuali-separation-finalization.js";
import { KUALI_RRSS_FINALIZATION_FORM_KEYS } from "../../../src/models/ui/kuali-separation-finalization.js";
import { KUALI_RRSS_FINALIZATION_WIRE_ASSERTED } from "../../../src/models/ui/kuali-separation-finalization.js";
import { KualiDepartmentOptionNotOfferedError } from "../../../src/models/ui/kuali-separation-finalization.js";
import { KualiFinalizationTargetSchema } from "../../../src/models/ui/kuali-separation-finalization.js";
import { KualiFinalizationVariablesSchema } from "../../../src/models/ui/kuali-separation-finalization.js";
import { KualiSaveRefusedError } from "../../../src/models/ui/kuali-separation-finalization.js";
import { compareKualiFinalizationFields } from "../../../src/models/ui/kuali-separation-finalization.js";
import { kualiFinalizationFields } from "../../../src/models/ui/kuali-separation-finalization.js";
import { kualiFinalizationFormKeysMissing } from "../../../src/models/ui/kuali-separation-finalization.js";
import { kualiFinalizationWireUnasserted } from "../../../src/models/ui/kuali-separation-finalization.js";
import type { KualiFinalizationTarget } from "../../../src/models/ui/kuali-separation-finalization.js";
import type { DataPoint } from "../../../src/rules/workflow/task-provenance.js";
import { TaskError } from "../../../src/workflow-kit/errors.js";
import { taskFailer } from "../../../src/workflow-kit/task.js";
import type { AnyTask } from "../../../src/workflow-kit/task.js";

{

const VARIABLES: KualiFinalizationVariables = KualiFinalizationVariablesSchema.parse(kualiFinalizationVariablesInput());

const UNFINALIZED: KualiObservedFinalizationFields = Object.freeze(unfinalizedKualiFieldsInput());

describe("Kuali separation finalization — the staged-variables fold", () => {
  it("composes the twelve written fields from nine variables and three ratified assertions", () => {
    const fields = kualiFinalizationFields(VARIABLES);
    assert.deepEqual(Object.keys(fields).sort(), [...KUALI_FINALIZATION_FIELD_NAMES].sort());

    assert.equal(fields.finalPay, "does-not-need-final-pay-student");
    assert.equal(KUALI_FINALIZATION_ASSERTIONS.finalPay, "does-not-need-final-pay-student");
    assert.equal(fields.requestAcknowledged, true);
    assert.equal(fields.submittedTerminationTemplate, true);

    assert.equal(fields.department, VARIABLES.department);
    assert.equal(fields.transactionNumber, VARIABLES.transactionNumber);
    assert.equal(fields.timekeeperComments, VARIABLES.timekeeperComments);

    assert.ok(!Object.keys(fields).includes("observedExistingComments"));
  });

  it("refuses a variable set that could only produce a plausible-but-wrong document", () => {
    const bad = (patch: Record<string, unknown>): boolean =>
      !KualiFinalizationVariablesSchema.safeParse({ ...VARIABLES, ...patch }).success;

    assert.ok(bad({ department: "- - -" }));


    assert.ok(bad({ payrollTitle: " STDT 2" }));

    assert.ok(bad({ transactionNumber: "" }));
    assert.ok(bad({ transactionNumber: "pending" }));
    assert.ok(bad({ terminationEffectiveDate: "2026-06-11" }));
    assert.ok(bad({ timekeeperComments: "" }));

    assert.ok(bad({ lastDayWorked: "2026-06-09" }));
    assert.ok(bad({ separationDate: "" }));
    assert.ok(bad({ separationDate: "6/10/2026" }));
  });

  it("stages the two date write-backs UNCONDITIONALLY, from the reconciled variables", () => {

    const moved = kualiFinalizationFields(VARIABLES);
    assert.equal(moved.lastDayWorked, VARIABLES.lastDayWorked);
    assert.equal(moved.separationDate, VARIABLES.separationDate);

    const unmoved = kualiFinalizationFields(KualiFinalizationVariablesSchema.parse({
      ...VARIABLES,
      lastDayWorked: "06/10/2026",
      separationDate: "06/10/2026",
    }));
    assert.deepEqual(Object.keys(unmoved), Object.keys(moved));
    assert.equal(unmoved.lastDayWorked, "06/10/2026");
    assert.equal(unmoved.separationDate, "06/10/2026");

    assert.deepEqual(
      compareKualiFinalizationFields(moved, unmoved).map((entry) => entry.field),
      ["lastDayWorked"],
    );
  });
});

describe("Kuali separation finalization — the read-back comparison", () => {
  it("is exact on every field and has no tolerance arm", () => {
    const expected = kualiFinalizationFields(VARIABLES);
    const landed: KualiObservedFinalizationFields = {
      department: expected.department,
      payrollTitleCode: expected.payrollTitleCode,
      payrollTitle: expected.payrollTitle,
      requestAcknowledged: expected.requestAcknowledged,
      timekeeperName: expected.timekeeperName,
      lastDayWorked: expected.lastDayWorked,
      separationDate: expected.separationDate,
      terminationEffectiveDate: expected.terminationEffectiveDate,
      submittedTerminationTemplate: expected.submittedTerminationTemplate,
      transactionNumber: expected.transactionNumber,
      finalPay: expected.finalPay,
      timekeeperComments: expected.timekeeperComments,
    };
    assert.deepEqual(compareKualiFinalizationFields(expected, landed), []);

    const nearMisses = compareKualiFinalizationFields(expected, {
      ...landed,
      department: "000412",
      timekeeperComments: expected.timekeeperComments.slice(0, 20),
    });
    assert.deepEqual(nearMisses.map((entry) => entry.field), ["department", "timekeeperComments"]);
  });

  it("names a stale date write-back — §9.14's doc 4524, where the separation date genuinely moved", () => {

    const expected = kualiFinalizationFields(KualiFinalizationVariablesSchema.parse({
      ...VARIABLES,
      lastDayWorked: "06/18/2026",
      separationDate: "07/03/2026",
      terminationEffectiveDate: "07/04/2026",
    }));
    const stillStale = compareKualiFinalizationFields(expected, {
      ...UNFINALIZED,
      department: expected.department,
      payrollTitleCode: expected.payrollTitleCode,
      payrollTitle: expected.payrollTitle,
      requestAcknowledged: expected.requestAcknowledged,
      timekeeperName: expected.timekeeperName,
      lastDayWorked: "06/18/2026",

      separationDate: "06/18/2026",
      terminationEffectiveDate: expected.terminationEffectiveDate,
      submittedTerminationTemplate: expected.submittedTerminationTemplate,
      transactionNumber: expected.transactionNumber,
      finalPay: expected.finalPay,
      timekeeperComments: expected.timekeeperComments,
    });
    assert.deepEqual(stillStale, [
      { field: "separationDate", expected: "07/03/2026", observed: "06/18/2026" },
    ]);

    const blank = compareKualiFinalizationFields(expected, UNFINALIZED)
      .filter((entry) => entry.field === "lastDayWorked" || entry.field === "separationDate");
    assert.deepEqual(blank.map((entry) => entry.observed), ["<empty>", "<empty>"]);
  });

  it("names every disagreeing field, in declaration order, and renders each state distinguishably", () => {
    const expected = kualiFinalizationFields(VARIABLES);
    const mismatches = compareKualiFinalizationFields(expected, UNFINALIZED);
    assert.deepEqual(mismatches.map((entry) => entry.field), [...KUALI_FINALIZATION_FIELD_NAMES]);
    const byField = new Map(mismatches.map((entry) => [entry.field, entry]));


    assert.equal(byField.get("payrollTitle")?.observed, "<empty>");
    assert.equal(byField.get("requestAcknowledged")?.observed, "unchecked");
    assert.equal(byField.get("requestAcknowledged")?.expected, "checked");
    assert.equal(byField.get("finalPay")?.observed, "<none selected>");
    assert.equal(byField.get("department")?.observed, "- - -");
  });
});

describe("Kuali separation finalization — the permanent key and the formKey table", () => {

  it("pins all TWELVE formKeys captured live, and the five the wire check may assert", () => {

    assert.deepEqual({ ...KUALI_RRSS_FINALIZATION_FORM_KEYS }, {
      department: "JPYGckVxcf",
      payrollTitleCode: "2FlOeR5pd9",
      payrollTitle: "sVmpq6tG9X",
      requestAcknowledged: "xKRU6vmYSY",
      timekeeperName: "QGJ63YrCom",
      lastDayWorked: "ER1WhBzjcm",
      separationDate: "oEcp1xtQkj",
      terminationEffectiveDate: "DoWSfJhpRm",
      submittedTerminationTemplate: "6Ejy-1rfQJ",
      transactionNumber: "wPyuyY0wT0",
      finalPay: "8CXaCSIvx5",
      timekeeperComments: "J_upFRq074",
    });


    assert.deepEqual(kualiFinalizationFormKeysMissing(), []);

    for (const field of kualiFinalizationFormKeysMissing()) {
      assert.ok(!KUALI_RRSS_FINALIZATION_WIRE_ASSERTED.includes(field));
    }

    for (const field of ["lastDayWorked", "separationDate"] as const) {
      assert.ok(!KUALI_RRSS_FINALIZATION_WIRE_ASSERTED.includes(field), field);
    }

    assert.equal(KUALI_RRSS_FINALIZATION_FORM_KEYS.timekeeperName, "QGJ63YrCom");
    assert.notEqual(KUALI_RRSS_FINALIZATION_FORM_KEYS.timekeeperName, "BWmkKqx40");


    const keys = Object.values(KUALI_RRSS_FINALIZATION_FORM_KEYS)
      .filter((key): key is string => key !== null);
    assert.equal(new Set(keys).size, keys.length);

    assert.deepEqual([...KUALI_RRSS_FINALIZATION_WIRE_ASSERTED], [
      "payrollTitleCode",
      "payrollTitle",
      "timekeeperName",
      "transactionNumber",
      "timekeeperComments",
    ]);
    assert.deepEqual(kualiFinalizationWireUnasserted(), [
      "department",
      "requestAcknowledged",
      "lastDayWorked",
      "separationDate",
      "terminationEffectiveDate",
      "submittedTerminationTemplate",
      "finalPay",
    ]);


    assert.equal(
      KUALI_RRSS_FINALIZATION_WIRE_ASSERTED.length + kualiFinalizationWireUnasserted().length,
      Object.keys(KUALI_RRSS_FINALIZATION_FORM_KEYS).length,
    );
  });
});
}

{

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

const MATCH_EXAMPLE = KualiMatchSeparationFinalization.example;
if (MATCH_EXAMPLE.state !== "present") throw new Error("Kuali match example must carry a present proof");

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

describe("Kuali task wrappers at their semantic-driver boundary", () => {

  describe("stageSeparationFinalizationTask", () => {

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
  });

  describe("saveSeparationFinalizationTask", () => {

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
  });
});
}
