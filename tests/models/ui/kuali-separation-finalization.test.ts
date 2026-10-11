
import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { describe as describe_m0,describe as describe_m1,it as it_m0,it as it_m1 } from "vitest";
import { saveSeparationFinalizationTask as saveSeparationFinalizationTask_m1 } from "../../../src/backend/systems/kuali/tasks/save-separation-finalization.js";
import { stageSeparationFinalizationTask as stageSeparationFinalizationTask_m1 } from "../../../src/backend/systems/kuali/tasks/stage-separation-finalization.js";
import {
KualiMatchSeparationFinalization as KualiMatchSeparationFinalization_m1
} from "../../../src/models/systems/kuali/match-separation-finalization.js";
import type { MutationCapability as MutationCapability_m1 } from "../../../src/models/ui/driver.js";
import type { KualiRrssDocumentDriver as KualiRrssDocumentDriver_m1 } from "../../../src/models/ui/kuali-rrss-document.js";
import { KUALI_RRSS_SAVE_BUTTON as KUALI_RRSS_SAVE_BUTTON_m1 } from "../../../src/models/ui/kuali-rrss-document.js";
import type {
KualiFinalizationVariables as KualiFinalizationVariables_m0,
KualiObservedFinalizationFields as KualiObservedFinalizationFields_m0
} from "../../../src/models/ui/kuali-separation-finalization.js";
import {
KUALI_FINALIZATION_ASSERTIONS as KUALI_FINALIZATION_ASSERTIONS_m0,
KUALI_FINALIZATION_FIELD_NAMES as KUALI_FINALIZATION_FIELD_NAMES_m0,
KUALI_RRSS_FINALIZATION_FORM_KEYS as KUALI_RRSS_FINALIZATION_FORM_KEYS_m0,
KUALI_RRSS_FINALIZATION_WIRE_ASSERTED as KUALI_RRSS_FINALIZATION_WIRE_ASSERTED_m0,
KualiDepartmentOptionNotOfferedError as KualiDepartmentOptionNotOfferedError_m1,
KualiFinalizationTargetSchema as KualiFinalizationTargetSchema_m1,
KualiFinalizationVariablesSchema as KualiFinalizationVariablesSchema_m0,
KualiSaveRefusedError as KualiSaveRefusedError_m1,
compareKualiFinalizationFields as compareKualiFinalizationFields_m0,
kualiFinalizationFields as kualiFinalizationFields_m0,
kualiFinalizationFormKeysMissing as kualiFinalizationFormKeysMissing_m0,
kualiFinalizationWireUnasserted as kualiFinalizationWireUnasserted_m0,
type KualiFinalizationTarget as KualiFinalizationTarget_m1
} from "../../../src/models/ui/kuali-separation-finalization.js";
import type { DataPoint as DataPoint_m1 } from "../../../src/rules/workflow/task-provenance.js";
import { TaskError as TaskError_m1 } from "../../../src/workflow-kit/errors.js";
import { taskFailer as taskFailer_m1,type AnyTask as AnyTask_m1 } from "../../../src/workflow-kit/task.js";


{


const VARIABLES: KualiFinalizationVariables_m0 = KualiFinalizationVariablesSchema_m0.parse({
  department: "000412 - Housing/Dining/Hospitality",
  payrollTitleCode: "004921",
  payrollTitle: "STDT 2",
  timekeeperName: "Julian Zaw",
  lastDayWorked: "06/09/2026",
  separationDate: "06/10/2026",
  terminationEffectiveDate: "06/11/2026",
  transactionNumber: "T002209631",
  timekeeperComments: "Termination effective date set from the reconciled separation date.",
  observedExistingComments: "",
});


const UNFINALIZED: KualiObservedFinalizationFields_m0 = Object.freeze({
  department: "- - -",
  payrollTitleCode: "",
  payrollTitle: "",
  requestAcknowledged: false,
  timekeeperName: "",
  lastDayWorked: "",
  separationDate: "",
  terminationEffectiveDate: "",
  submittedTerminationTemplate: false,
  transactionNumber: "",
  finalPay: null,
  timekeeperComments: "",
});

describe_m0("Kuali separation finalization — the staged-variables fold", () => {
  it_m0("composes the twelve written fields from nine variables and three ratified assertions", () => {
    const fields = kualiFinalizationFields_m0(VARIABLES);
    assert_m0.deepEqual(Object.keys(fields).sort(), [...KUALI_FINALIZATION_FIELD_NAMES_m0].sort());

    assert_m0.equal(fields.finalPay, "does-not-need-final-pay-student");
    assert_m0.equal(KUALI_FINALIZATION_ASSERTIONS_m0.finalPay, "does-not-need-final-pay-student");
    assert_m0.equal(fields.requestAcknowledged, true);
    assert_m0.equal(fields.submittedTerminationTemplate, true);
    // The variables pass through untouched — nothing is recomputed at fill time.
    assert_m0.equal(fields.department, VARIABLES.department);
    assert_m0.equal(fields.transactionNumber, VARIABLES.transactionNumber);
    assert_m0.equal(fields.timekeeperComments, VARIABLES.timekeeperComments);
    // `observedExistingComments` is a REFUSAL input, never a written value.
    assert_m0.ok(!Object.keys(fields).includes("observedExistingComments"));
  });

  it_m0("refuses a variable set that could only produce a plausible-but-wrong document", () => {
    const bad = (patch: Record<string, unknown>): boolean =>
      !KualiFinalizationVariablesSchema_m0.safeParse({ ...VARIABLES, ...patch }).success;
    // Kuali's blank sentinel is an unset field, never a department.
    assert_m0.ok(bad({ department: "- - -" }));
    // A padded value would make "what we staged" and "what the page reads back"
    // unequal by construction, because every read trims.
    assert_m0.ok(bad({ payrollTitle: " STDT 2" }));
    // Empty or malformed transaction numbers are refused before the page.
    assert_m0.ok(bad({ transactionNumber: "" }));
    assert_m0.ok(bad({ transactionNumber: "pending" }));
    assert_m0.ok(bad({ terminationEffectiveDate: "2026-06-11" }));
    assert_m0.ok(bad({ timekeeperComments: "" }));

    assert_m0.ok(bad({ lastDayWorked: "2026-06-09" }));
    assert_m0.ok(bad({ separationDate: "" }));
    assert_m0.ok(bad({ separationDate: "6/10/2026" }));
  });

  it_m0("stages the two date write-backs UNCONDITIONALLY, from the reconciled variables", () => {

    const moved = kualiFinalizationFields_m0(VARIABLES);
    assert_m0.equal(moved.lastDayWorked, VARIABLES.lastDayWorked);
    assert_m0.equal(moved.separationDate, VARIABLES.separationDate);


    const unmoved = kualiFinalizationFields_m0(KualiFinalizationVariablesSchema_m0.parse({
      ...VARIABLES,
      lastDayWorked: "06/10/2026",
      separationDate: "06/10/2026",
    }));
    assert_m0.deepEqual(Object.keys(unmoved), Object.keys(moved));
    assert_m0.equal(unmoved.lastDayWorked, "06/10/2026");
    assert_m0.equal(unmoved.separationDate, "06/10/2026");


    assert_m0.deepEqual(
      compareKualiFinalizationFields_m0(moved, unmoved).map((entry) => entry.field),
      ["lastDayWorked"],
    );
  });
});

describe_m0("Kuali separation finalization — the read-back comparison", () => {
  it_m0("is exact on every field and has no tolerance arm", () => {
    const expected = kualiFinalizationFields_m0(VARIABLES);
    const landed: KualiObservedFinalizationFields_m0 = {
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
    assert_m0.deepEqual(compareKualiFinalizationFields_m0(expected, landed), []);


    const nearMisses = compareKualiFinalizationFields_m0(expected, {
      ...landed,
      department: "000412",
      timekeeperComments: expected.timekeeperComments.slice(0, 20),
    });
    assert_m0.deepEqual(nearMisses.map((entry) => entry.field), ["department", "timekeeperComments"]);
  });

  it_m0("names a stale date write-back — §9.14's doc 4524, where the separation date genuinely moved", () => {

    const expected = kualiFinalizationFields_m0(KualiFinalizationVariablesSchema_m0.parse({
      ...VARIABLES,
      lastDayWorked: "06/18/2026",
      separationDate: "07/03/2026",
      terminationEffectiveDate: "07/04/2026",
    }));
    const stillStale = compareKualiFinalizationFields_m0(expected, {
      ...UNFINALIZED,
      department: expected.department,
      payrollTitleCode: expected.payrollTitleCode,
      payrollTitle: expected.payrollTitle,
      requestAcknowledged: expected.requestAcknowledged,
      timekeeperName: expected.timekeeperName,
      lastDayWorked: "06/18/2026",
      // What the document still holds — the value the write-back replaces.
      separationDate: "06/18/2026",
      terminationEffectiveDate: expected.terminationEffectiveDate,
      submittedTerminationTemplate: expected.submittedTerminationTemplate,
      transactionNumber: expected.transactionNumber,
      finalPay: expected.finalPay,
      timekeeperComments: expected.timekeeperComments,
    });
    assert_m0.deepEqual(stillStale, [
      { field: "separationDate", expected: "07/03/2026", observed: "06/18/2026" },
    ]);
    // A blank date control is `<empty>`, distinguishable from a wrong one.
    const blank = compareKualiFinalizationFields_m0(expected, UNFINALIZED)
      .filter((entry) => entry.field === "lastDayWorked" || entry.field === "separationDate");
    assert_m0.deepEqual(blank.map((entry) => entry.observed), ["<empty>", "<empty>"]);
  });

  it_m0("names every disagreeing field, in declaration order, and renders each state distinguishably", () => {
    const expected = kualiFinalizationFields_m0(VARIABLES);
    const mismatches = compareKualiFinalizationFields_m0(expected, UNFINALIZED);
    assert_m0.deepEqual(mismatches.map((entry) => entry.field), [...KUALI_FINALIZATION_FIELD_NAMES_m0]);
    const byField = new Map(mismatches.map((entry) => [entry.field, entry]));
    // An empty control, an unchecked box and an unselected radio are three
    // different observations and must not all render as "".
    assert_m0.equal(byField.get("payrollTitle")?.observed, "<empty>");
    assert_m0.equal(byField.get("requestAcknowledged")?.observed, "unchecked");
    assert_m0.equal(byField.get("requestAcknowledged")?.expected, "checked");
    assert_m0.equal(byField.get("finalPay")?.observed, "<none selected>");
    assert_m0.equal(byField.get("department")?.observed, "- - -");
  });
});

describe_m0("Kuali separation finalization — the permanent key and the formKey table", () => {

  it_m0("pins all TWELVE formKeys captured live, and the five the wire check may assert", () => {

    assert_m0.deepEqual({ ...KUALI_RRSS_FINALIZATION_FORM_KEYS_m0 }, {
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
    // The to-do list is empty, and it stays DERIVED — a hand-written second list
    // is one that can disagree with the table it describes.
    assert_m0.deepEqual(kualiFinalizationFormKeysMissing_m0(), []);

    for (const field of kualiFinalizationFormKeysMissing_m0()) {
      assert_m0.ok(!KUALI_RRSS_FINALIZATION_WIRE_ASSERTED_m0.includes(field));
    }
    // A date key is not a matching wire value: epoch milliseconds and MM/DD/YYYY need separate assertions.
    for (const field of ["lastDayWorked", "separationDate"] as const) {
      assert_m0.ok(!KUALI_RRSS_FINALIZATION_WIRE_ASSERTED_m0.includes(field), field);
    }

    assert_m0.equal(KUALI_RRSS_FINALIZATION_FORM_KEYS_m0.timekeeperName, "QGJ63YrCom");
    assert_m0.notEqual(KUALI_RRSS_FINALIZATION_FORM_KEYS_m0.timekeeperName, "BWmkKqx40");
    // Every key is distinct: two fields sharing one key would silently make the
    // wire check assert one field twice and the other never.
    const keys = Object.values(KUALI_RRSS_FINALIZATION_FORM_KEYS_m0)
      .filter((key): key is string => key !== null);
    assert_m0.equal(new Set(keys).size, keys.length);


    assert_m0.deepEqual([...KUALI_RRSS_FINALIZATION_WIRE_ASSERTED_m0], [
      "payrollTitleCode",
      "payrollTitle",
      "timekeeperName",
      "transactionNumber",
      "timekeeperComments",
    ]);
    assert_m0.deepEqual(kualiFinalizationWireUnasserted_m0(), [
      "department",
      "requestAcknowledged",
      "lastDayWorked",
      "separationDate",
      "terminationEffectiveDate",
      "submittedTerminationTemplate",
      "finalPay",
    ]);
    // The two halves partition the field set — a field in neither would be
    // silently unchecked with nothing naming it.
    assert_m0.equal(
      KUALI_RRSS_FINALIZATION_WIRE_ASSERTED_m0.length + kualiFinalizationWireUnasserted_m0().length,
      Object.keys(KUALI_RRSS_FINALIZATION_FORM_KEYS_m0).length,
    );
  });
});
}

{

const TARGET: KualiFinalizationTarget_m1 = KualiFinalizationTargetSchema_m1.parse({
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

const MATCH_EXAMPLE = KualiMatchSeparationFinalization_m1.example;
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
  } as unknown as KualiRrssDocumentDriver_m1;

  return { driver, calls };
}

function invocation(
  task: AnyTask_m1,
  input: unknown,
  driver: KualiRrssDocumentDriver_m1,
  mutation?: MutationCapability_m1,
) {
  const points: DataPoint_m1[] = [];
  const ctx = {
    signal: new AbortController().signal,
    log: { debug: () => undefined, info: () => undefined, warn: () => undefined },
    fail: taskFailer_m1(task.contract),
    recordData: (point: DataPoint_m1 | readonly DataPoint_m1[]) => {
      if (Array.isArray(point)) points.push(...point as readonly DataPoint_m1[]);
      else points.push(point as DataPoint_m1);
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

function _point(direction: "read" | "write", field: string, value: unknown): DataPoint_m1 {
  return { direction, field, value };
}

describe_m1("Kuali task wrappers at their semantic-driver boundary", () => {

  describe_m1("stageSeparationFinalizationTask", () => {

    it_m1("keeps the typed department-option refusal distinct and does not commit", async () => {
      const refusal = new KualiDepartmentOptionNotOfferedError_m1({
        documentNumber: TARGET.documentNumber,
        requested: TARGET.variables.department,
        observedOptions: ["- - -", "000413 - Library"],
      });
      const { driver, calls } = recordingDriver({
        stageSeparationFinalization: async () => { throw refusal; },
      });
      const call = invocation(stageSeparationFinalizationTask_m1, TARGET, driver);

      await assert_m1.rejects(call.run(), (error: unknown) => error instanceof TaskError_m1
        && error.code === "department-option-not-offered"
        && error.cause === refusal);
      assert_m1.deepEqual(calls, [{ operation: "stageSeparationFinalization", args: [TARGET] }]);
      assert_m1.deepEqual(call.points, []);
    });
  });

  describe_m1("saveSeparationFinalizationTask", () => {

    it_m1("maps Kuali's typed save refusal to the named task refusal", async () => {
      const refusal = new KualiSaveRefusedError_m1({ documentNumber: TARGET.documentNumber, refusal: "validation error" });
      const mutationSentinel = Object.freeze({ marker: "unchanged-mutation-capability" }) as unknown as MutationCapability_m1;
      const { driver, calls } = recordingDriver({ commit: async () => { throw refusal; } });
      const call = invocation(saveSeparationFinalizationTask_m1, TARGET, driver, mutationSentinel);

      await assert_m1.rejects(call.run(), (error: unknown) => error instanceof TaskError_m1
        && error.code === "save-refused"
        && error.cause === refusal);
      assert_m1.deepEqual(calls, [{
        operation: "commit",
        args: [KUALI_RRSS_SAVE_BUTTON_m1, mutationSentinel],
      }]);
      assert_m1.equal(calls[0]?.args[1], mutationSentinel);
      assert_m1.deepEqual(call.points, []);
    });
  });
});
}
