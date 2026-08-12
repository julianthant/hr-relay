/**
 * Executable scenarios for `separations-kuali-read` — separations chunk 2
 * (`docs/migrations/separations.md` §3), the Kuali separation-document read.
 *
 * Two of them walk the real descriptor's real bind/derive functions. The other
 * three are refusal arms, and those are NOT graph walks: S2's wrong form, S8's
 * unparseable date and §4a's unmapped type all fail INSIDE a task, so what they
 * falsify is the task's refusal — that the outcome is a distinct structured
 * failure naming what was found, and never a plausible default. Those run the
 * real task implementations against the deterministic driver, which is the only
 * way to observe "it refused" rather than "it returned something plausible".
 *
 * Every fixture value below is a value observed live, read-only, on 2026-08-12:
 * document 4510 (a fully processed separation) and document 4502 (an
 * unprocessed one whose Timekeeper Name, Termination Effective Date, Payroll
 * Title Code, Payroll Title and Transaction Number are all blank and whose
 * Department sits on Kuali's `- - -` sentinel). The second is why the absent
 * arms exist and why they are the common case rather than an edge.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { createDeterministicKualiDriver, createKualiFakeWorld } from "../../src/stores/kuali/driver/fake.js";
import type { KualiFakeSeparationForm } from "../../src/stores/kuali/driver/fake.js";
import { readSeparationDocumentTask } from "../../src/stores/kuali/tasks/read-separation-document.js";
import { matchTerminationTypeTask } from "../../src/stores/separations/tasks/match-termination-type.js";
import { KUALI_TERMINATION_TYPE_OPTIONS } from "../../src/domain/separations/termination-type.js";
import { separationsKualiReadDescriptor } from "../../src/workflows/separations-kuali-read/descriptor.js";
import { walkDescriptor } from "./helpers/pure-walk.js";

const taskCtx = Object.freeze({
  signal: new AbortController().signal,
  log: Object.freeze({ debug: () => undefined, info: () => undefined, warn: () => undefined }),
  fail: (code: string, message: string): never => { throw new Error(`${code}: ${message}`); },
  recordData: () => undefined,
});

const ACTION_ID = "6a7a33b2ac106d428b3217e0";
const DOCUMENT_NUMBER = "4510";
const RUN_INPUT = { actionId: ACTION_ID, documentNumber: DOCUMENT_NUMBER };

/** Live doc 4510, verbatim (2026-08-12). */
const PROCESSED_FORM: KualiFakeSeparationForm = {
  formType: "RRSS Separation Request Form",
  employeeName: "Clauckia, Drose",
  eid: "10001799",
  employeeType: "Student",
  studentTitleCode: "4921 - STDT 2",
  division: "Campus Dining and Retail",
  location: "THE BISTRO RESTAURANT",
  terminationType: "Graduated/No longer a Student",
  lastDayWorked: "06/10/2026",
  separationDate: "06/10/2026",
  additionalComments: "",
  requestAcknowledged: true,
  timekeeperName: "Julian Zaw",
  timekeeperComments: "",
  terminationEffectiveDate: "06/11/2026",
  department: "000412 - Housing/Dining/Hospitality",
  payrollTitleCode: "004921",
  payrollTitle: "STDT 2",
  submittedTerminationTemplate: true,
  transactionNumber: "T002209631",
  finalPay: "does-not-need-final-pay-student",
};

/** Live doc 4502, verbatim (2026-08-12) — the unprocessed shape. */
const UNPROCESSED_FORM: KualiFakeSeparationForm = {
  ...PROCESSED_FORM,
  employeeName: "Cramia, Dreitho",
  eid: "10001754",
  studentTitleCode: "4920 - STDT 3",
  location: "64 Degrees",
  terminationType: "Appointment Expired",
  lastDayWorked: "03/31/2026",
  separationDate: "03/31/2026",
  requestAcknowledged: false,
  timekeeperName: "",
  timekeeperComments: "Hold off entering this termination waiting for review by HDH HR as to leave status.",
  terminationEffectiveDate: "",
  department: "- - -",
  payrollTitleCode: "",
  payrollTitle: "",
  submittedTerminationTemplate: false,
  transactionNumber: "",
  finalPay: null,
};

function driverFor(form: KualiFakeSeparationForm, documentNumber = DOCUMENT_NUMBER) {
  const world = createKualiFakeWorld({
    actionId: ACTION_ID,
    documentNumber,
    displayedEid: "10001799",
  });
  world.separationForm = form;
  return { world, driver: createDeterministicKualiDriver(world, manualClock(new Date("2026-08-12T20:29:08.000Z"))) };
}

async function readDocument(form: KualiFakeSeparationForm): Promise<Record<string, unknown>> {
  const { driver } = driverFor(form);
  return await readSeparationDocumentTask.impl.run({
    input: RUN_INPUT,
    ctx: { ...taskCtx, driver },
  });
}

describe("separations-kuali-read scenarios", () => {
  it("separations-kuali-read/reads-a-real-separation-document — the whole form, then §4a's resolution", async () => {
    const document = await readDocument(PROCESSED_FORM);
    // The read touched no write path at all: S61's defect is that legacy's own
    // dry run fills the draft, so "it read nothing else" is the assertion.
    const { world } = driverFor(PROCESSED_FORM);
    assert.deepEqual(world.events, []);

    const termination = await matchTerminationTypeTask.impl.run({
      input: {
        terminationType: { state: "present", value: "Graduated/No longer a Student" },
        observedOptions: [...KUALI_TERMINATION_TYPE_OPTIONS],
        documentNumber: DOCUMENT_NUMBER,
      },
      ctx: taskCtx,
    });
    assert.deepEqual(termination, {
      terminationType: "Graduated/No longer a Student",
      classification: "involuntary",
      template: "UC_INVOL_TERM",
      reasonCode: "No Longer Student",
      observedOptionCount: 17,
    });

    const walk = walkDescriptor(separationsKualiReadDescriptor, RUN_INPUT, {
      outputs: { document, "termination-type": termination },
    });
    assert.deepEqual(walk.visited, ["document", "termination-type"]);
    assert.deepEqual(walk.skipped, []);
    // Zero coverage points is the correct answer for a branchless read graph.
    assert.deepEqual(walk.covered, []);
    const result = walk.result as { document: Record<string, unknown>; termination: unknown };
    assert.deepEqual(result.termination, termination);
    assert.deepEqual(result.document.formType, {
      observed: "RRSS Separation Request Form",
      matches: true,
    });
    assert.deepEqual(result.document.separation, {
      terminationType: { state: "present", value: "Graduated/No longer a Student" },
      lastDayWorked: { state: "present", raw: "06/10/2026", value: "2026-06-10" },
      separationDate: { state: "present", raw: "06/10/2026", value: "2026-06-10" },
      additionalComments: {
        state: "absent",
        reason: "the control is present on the form and holds no value",
      },
    });
    // The COMPLETE option list travels with the run — that is what makes §4a's
    // map checkable against the control the run actually stood in front of.
    assert.deepEqual(
      (result.document.options as { terminationType: readonly string[] }).terminationType,
      [...KUALI_TERMINATION_TYPE_OPTIONS],
    );
  });

  it("separations-kuali-read/unprocessed-document-absent-arms — blank is a REAL outcome, not a failure", async () => {
    const document = await readDocument(UNPROCESSED_FORM);
    assert.deepEqual(document.finalTransactions, {
      terminationEffectiveDate: {
        state: "absent",
        reason: "the date control is present on the form and holds no value",
      },
      department: {
        state: "absent",
        reason: "the select sits on Kuali's blank sentinel \"- - -\"",
      },
      payrollTitleCode: {
        state: "absent",
        reason: "the control is present on the form and holds no value",
      },
      payrollTitle: {
        state: "absent",
        reason: "the control is present on the form and holds no value",
      },
      submittedTerminationTemplate: false,
      transactionNumber: {
        state: "absent",
        reason: "the transaction-number control is present on the form and holds no value",
      },
      finalPay: { state: "absent", reason: "no Final Pay radio in the group is selected" },
    });
    const timekeeper = document.timekeeper as Record<string, unknown>;
    assert.deepEqual(timekeeper.name, {
      state: "absent",
      reason: "the control is present on the form and holds no value",
    });
    assert.equal(timekeeper.requestAcknowledged, false);

    // The walk still reaches a terminal result: an unprocessed document is a
    // document this workflow read successfully.
    const termination = await matchTerminationTypeTask.impl.run({
      input: {
        terminationType: { state: "present", value: "Appointment Expired" },
        observedOptions: [...KUALI_TERMINATION_TYPE_OPTIONS],
        documentNumber: DOCUMENT_NUMBER,
      },
      ctx: taskCtx,
    });
    const walk = walkDescriptor(separationsKualiReadDescriptor, RUN_INPUT, {
      outputs: { document, "termination-type": termination },
    });
    assert.deepEqual(walk.visited, ["document", "termination-type"]);
    assert.deepEqual(termination, {
      terminationType: "Appointment Expired",
      classification: "involuntary",
      template: "UC_INVOL_TERM",
      reasonCode: "Appointment Expired",
      observedOptionCount: 17,
    });
  });

  it("separations-kuali-read/non-separation-document — S2 refuses BY NAME before any field is read", async () => {
    const { driver } = driverFor({ ...PROCESSED_FORM, formType: "OMCP EHS iPad Loaner Request" });
    await assert.rejects(
      readSeparationDocumentTask.impl.run({ input: RUN_INPUT, ctx: { ...taskCtx, driver } }),
      /not-a-separation-document: .*"OMCP EHS iPad Loaner Request".*RRSS Separation Request Form/s,
    );
  });

  it("separations-kuali-read/unparseable-separation-date — S8 names the field and the value", async () => {
    const { driver } = driverFor({ ...PROCESSED_FORM, separationDate: "31/06/2026" });
    await assert.rejects(
      readSeparationDocumentTask.impl.run({ input: RUN_INPUT, ctx: { ...taskCtx, driver } }),
      /unparseable-date: .*"31\/06\/2026".*separationDate/s,
    );
  });

  it("separations-kuali-read/unmapped-termination-type — §4a refuses, naming the verbatim value", async () => {
    await assert.rejects(
      matchTerminationTypeTask.impl.run({
        input: {
          // A real, selectable live option that legacy misfiles: it is in the
          // involuntary deny-list but has NO reason-code entry, so legacy files
          // `UC_INVOL_TERM` with the voluntary default `Resign - No Reason Given`.
          terminationType: { state: "present", value: "Never Started Employment" },
          observedOptions: [...KUALI_TERMINATION_TYPE_OPTIONS],
          documentNumber: DOCUMENT_NUMBER,
        },
        ctx: taskCtx,
      }),
      /unmapped-termination-type: .*"Never Started Employment"/s,
    );
  });
});
