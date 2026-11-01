import assert from "node:assert/strict";
import type { Page } from "playwright";
import { describe, it } from "vitest";
import { ucpathSmartHrOperations } from "../../../../../src/backend/systems/ucpath/driver/smart-hr-operation.js";
import { ucpathElementById } from "../../../../../src/backend/systems/ucpath/driver/registry-locators.js";
import {
  UCPATH_SMART_HR_CONTINUE_BUTTON, UCPATH_SMART_HR_LAST_DATE_WORKED_INPUT,
  UCPATH_SMART_HR_REASON_CODE_SELECT, UcpathTerminationTargetSchema,
} from "../../../../../src/models/ui/ucpath-smart-hr-termination.js";
import type { ElementId } from "../../../../../src/rules/identity/ids.js";

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
