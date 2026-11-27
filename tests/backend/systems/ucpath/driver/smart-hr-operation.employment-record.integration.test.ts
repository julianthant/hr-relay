import assert from "node:assert/strict";
import type { Page } from "playwright";
import { describe, it } from "vitest";
import { WriteParkedError } from "../../../../../src/backend/runtime/writes/write-sequencer.js";
import { ucpathSmartHrOperations } from "../../../../../src/backend/systems/ucpath/driver/smart-hr-operation.js";
import { ucpathElementById } from "../../../../../src/backend/systems/ucpath/driver/registry-locators.js";
import { ucpathTerminationFilingPresence, ucpathTerminationVerdict } from "../../../../../src/backend/systems/ucpath/termination-verdict.js";
import {
  UCPATH_SMART_HR_CONTINUE_BUTTON, UCPATH_SMART_HR_LAST_DATE_WORKED_INPUT,
  UCPATH_SMART_HR_REASON_CODE_SELECT, UcpathTerminationTargetSchema,
} from "../../../../../src/models/ui/ucpath-smart-hr-termination.js";
import { IsoInstantSchema, type ElementId } from "../../../../../src/rules/identity/ids.js";
import { assertTerminationReceipt } from "../../../../../src/rules/separations/termination-receipt.js";
import {
  TERMINATION_IDEMPOTENCY_KEY,
  TERMINATION_NODE,
  compositionClaimRunning,
  compositionContext,
  compositionHarness,
  compositionQueuedRun,
} from "../../../../support/helpers/separations-composition-fixtures.js";
import { createDeterministicUcpathDriverRow } from "../../../../support/helpers/ucpath-pending-row-fixtures.js";

const input = UcpathTerminationTargetSchema.parse({ emplId: "10800000", expectedName: "Deterministic Person",
  emplRecord: "4", effectiveDate: "06/11/2026", template: "UC_VOL_TERM", reasonCode: "Resign - No Reason Given",
  lastDateWorked: "06/10/2026", initiatorComments: "Synthetic approved separation" });
const observedAt = "2026-08-13T10:18:00.000Z";

function selector(id: ElementId): string {
  const recipe = ucpathElementById(id).locator;
  assert.equal(recipe.kind, "css");
  if (recipe.kind !== "css") throw new Error("fixture expects the registered CSS control");
  return recipe.selector;
}

function wizard(observedRecord: string) {
  const events: string[] = [];
  const values = new Map<string, string>([
    ["#HR_TBH_WRK_EMPL_RCD_CHAR", observedRecord],
    ["#HR_TBH_WRK_JOB_EFFDT", input.effectiveDate],
    ["#UC_SS_TRANSACT_UC_TRANSACT_ID", "NEW"],
  ]);
  let checked = false;
  function locator(key: string) {
    return {
      waitFor: async () => undefined,
      fill: async (value: string) => { events.push(`fill:${key}`); values.set(key, value); },
      inputValue: async () => {
        const value = values.get(key);
        if (value === undefined) throw new Error(`fixture has no value for ${key}`);
        return value;
      },
      innerText: async () => "Deterministic Person",
      evaluate: async () => key === selector(UCPATH_SMART_HR_REASON_CODE_SELECT)
        ? [{ value: "RES", label: input.reasonCode }] : true,
      selectOption: async () => { events.push(`select:${key}`); return ["RES"]; },
      click: async () => { events.push(`click:${key}`); },
      isChecked: async () => checked,
      check: async () => { checked = true; },
      blur: async () => undefined,
    };
  }
  const page = { locator, goto: async () => null, keyboard: { press: async () => undefined } } as unknown as Page;
  return { page, events };
}

describe("actual termination staging employment record", () => {
  for (const record of ["0", "", "   "]) {
    it(`refuses observed record ${JSON.stringify(record)} before continuing the wizard`, async () => {
      const w = wizard(record);
      await assert.rejects(ucpathSmartHrOperations.stageTermination(() => undefined, w.page, input, observedAt), /employment record/iu);
      assert.equal(w.events.includes(`click:${selector(UCPATH_SMART_HR_CONTINUE_BUTTON)}`), false);
      assert.equal(w.events.includes(`fill:${selector(UCPATH_SMART_HR_LAST_DATE_WORKED_INPUT)}`), false);
      assert.equal(w.events.includes("fill:#HR_TBH_WRK_EMPL_RCD_CHAR"), false);
    });
  }
  it("retains the matching observed record without selecting a record", async () => {
    const w = wizard("4");
    const staging = await ucpathSmartHrOperations.stageTermination(() => undefined, w.page, input, observedAt);
    assert.equal(staging.observedEmplRecord, "4");
    assert.equal(w.events.includes(`click:${selector(UCPATH_SMART_HR_CONTINUE_BUTTON)}`), true);
    assert.equal(w.events.includes("fill:#HR_TBH_WRK_EMPL_RCD_CHAR"), false);
  });
});

it("parks a submitted termination whose read-back cannot prove the employment record", async () => {
  const harness = await compositionHarness();
  try {
    harness.ucpath.employmentRecordsReadable = false;
    const { run, claim } = compositionClaimRunning(harness.database, harness.clock, compositionQueuedRun(), TERMINATION_NODE);
    await assert.rejects(
      harness.bound(() => harness.sequencer.executeTransaction(compositionContext(run, claim, TERMINATION_NODE))),
      WriteParkedError,
    );
    const intent = harness.database.authority.writeIntents.findByPermanentKey("ucpath", TERMINATION_IDEMPOTENCY_KEY);
    assert.equal(intent?.status, "parked");
    assert.equal(harness.ucpath.rows.length, 1);
    assert.equal(harness.ucpath.events.filter((event) => event.startsWith("commit:")).length, 1);
    assert.deepEqual(harness.kuali.events, []);
  } finally {
    await harness.dispose();
  }
});

describe("termination verification for a specific employment record", () => {
  const target = { ...input, emplRecord: "0" };
  const { transactionRow } = createDeterministicUcpathDriverRow(target.emplId);
  const row = transactionRow({ approvalStatus: "Approved" });
  const scan = {
    state: "read" as const,
    emplId: target.emplId,
    rows: [row],
    scannedRowCount: 1,
    observedAt: IsoInstantSchema.parse(observedAt),
  };
  const receipt = assertTerminationReceipt({
    transactionNumber: row.transactionId,
    approvalStatus: row.approvalStatus,
    approvedEmplId: target.emplId,
    approvedName: target.expectedName,
    effectiveDate: target.effectiveDate,
  });

  const exactObservation = { transactionId: row.transactionId, emplRecord: "0" };
  for (const [label, employmentRecords] of [
    ["missing record evidence", []],
    ["an unreadable record on the exact T-number", [{ ...exactObservation, emplRecord: "" }]],
    ["record 1 on the exact T-number", [{ ...exactObservation, emplRecord: "1" }]],
    ["record 0 bound to another T-number", [{ ...exactObservation, transactionId: "T009000002" }]],
    ["conflicting records on the exact T-number", [exactObservation, { ...exactObservation, emplRecord: "1" }]],
  ] as const) {
    it(`returns unknown at both checks with ${label}`, () => {
      const observed = { ...scan, employmentRecords: [...employmentRecords] };
      const verdict = ucpathTerminationVerdict(target, observed);
      const filing = ucpathTerminationFilingPresence(receipt, observed, target.emplRecord);
      assert.deepEqual([verdict.state, filing.state], ["unknown", "unknown"]);
    });
  }

  it("accepts only a readable matching record independently observed for the exact filing", () => {
    const observed = { ...scan, employmentRecords: [exactObservation] };
    assert.equal(ucpathTerminationVerdict(target, observed).state, "present");
    assert.equal(ucpathTerminationFilingPresence(receipt, observed, target.emplRecord).state, "present");
  });

  it("returns unknown in the Kuali-only path without an independent expected record", () => {
    const observed = { ...scan, employmentRecords: [exactObservation] };
    assert.equal(ucpathTerminationFilingPresence(receipt, observed).state, "unknown");
  });
});
