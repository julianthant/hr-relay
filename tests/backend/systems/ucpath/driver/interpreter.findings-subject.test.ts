import assert from "node:assert/strict";
import type { Page } from "playwright";
import { describe, it } from "vitest";
import { createUcpathPersonOrgDriver } from "../../../../../src/backend/systems/ucpath/driver/interpreter.js";
import { UCPATH_SS_SMART_HR_DISPLAYED_NAME } from "../../../../../src/models/ui/ucpath-smart-hr-termination.js";

function driver(count: number, visible: boolean, name: string | null) {
  const page = { locator: (selector: string) => {
    assert.equal(selector, '[id="NAME$span$0"]');
    return { count: async () => count, isVisible: async () => visible, textContent: async () => name };
  } } as unknown as Page;
  return createUcpathPersonOrgDriver(() => {}, page);
}

describe("UCPath finding subject observation", () => {
  it("reads the supplied detail-name anchor rather than the search input or old name ID", async () => {
    assert.equal(await driver(1, true, "  Synthetic, Findings  ").read(UCPATH_SS_SMART_HR_DISPLAYED_NAME), "Synthetic, Findings");
  });

  it("refuses absent, duplicated or hidden detail names", async () => {
    for (const [count, visible] of [[0, true], [2, true], [1, false]] as const) {
      await assert.rejects(driver(count, visible, "Synthetic, Findings").read(UCPATH_SS_SMART_HR_DISPLAYED_NAME), /exactly one visible detail name/u);
    }
  });

  it("refuses an empty detail subject", async () => {
    for (const name of [null, "   "]) {
      await assert.rejects(driver(1, true, name).read(UCPATH_SS_SMART_HR_DISPLAYED_NAME), /rendered no text/u);
    }
  });
});
