import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { Page } from "playwright";
import { EidSchema, IsoInstantSchema } from "../../src/domain/ids.js";
import { scanTerminationTransactionsOnPage } from "../../src/stores/ucpath/driver/smart-hr-operation.js";

const EID = EidSchema.parse("10001799");
const OBSERVED_AT = IsoInstantSchema.parse("2026-08-28T19:00:00.000Z");

function indeterminateSearchPage(evaluate: () => Promise<unknown>): Page {
  const locator = (selector: string) => {
    const value = {
      first: () => value,
      fill: async () => undefined,
      selectOption: async () => [],
      click: async () => undefined,
      waitFor: async () => {
        if (selector.startsWith('tr[id^="trPTS_CFG_CL_STD_RSL"]')) {
          throw new Error("fixture result-row wait expired");
        }
      },
    };
    return value;
  };
  return {
    goto: async () => null,
    locator,
    getByText: () => {
      const value = {
        first: () => value,
        waitFor: async () => { throw new Error("fixture no-results wait expired"); },
      };
      return value;
    },
    evaluate,
  } as unknown as Page;
}

describe("SS Smart HR transaction scan", () => {
  it("retains the settlement timeout and returns only redacted diagnostic facts", async () => {
    const page = indeterminateSearchPage(async () => ({
      state: "captured",
      banner: "positive-count",
      oldRowCount: 2,
      route: "ss-smart-hr-search",
      iframeCount: 0,
      errorRegionCount: 0,
      searchVisible: true,
      searchEnabled: true,
    }));

    const scan = await scanTerminationTransactionsOnPage(page, { emplId: EID }, OBSERVED_AT);

    assert.equal(scan.state, "unreadable");
    if (scan.state !== "unreadable") return;
    assert.equal(
      scan.reason,
      `the SS Smart HR transaction scan for ${EID} failed: the SS Smart HR search for ${EID} `
      + "rendered neither a result row nor PeopleSoft's no-results marker within 45000ms",
    );
    assert.deepEqual(Reflect.get(scan, "diagnostic"), {
      state: "captured",
      banner: "positive-count",
      oldRowCount: 2,
      route: "ss-smart-hr-search",
      iframeCount: 0,
      errorRegionCount: 0,
      searchVisible: true,
      searchEnabled: true,
    });
  });

  it("keeps the settlement timeout primary when diagnostic evaluation fails", async () => {
    const page = indeterminateSearchPage(async () => {
      throw new Error("raw evaluation failure that must not escape");
    });

    const scan = await scanTerminationTransactionsOnPage(page, { emplId: EID }, OBSERVED_AT);

    assert.equal(scan.state, "unreadable");
    if (scan.state !== "unreadable") return;
    assert.equal(
      scan.reason,
      `the SS Smart HR transaction scan for ${EID} failed: the SS Smart HR search for ${EID} `
      + "rendered neither a result row nor PeopleSoft's no-results marker within 45000ms",
    );
    assert.deepEqual(Reflect.get(scan, "diagnostic"), {
      state: "capture-failed",
      cause: "page-evaluation-failed",
    });
    assert.equal(JSON.stringify(scan).includes("raw evaluation failure"), false);
  });

  it("marks unreadable failures outside settlement as diagnostic capture not attempted", async () => {
    const page = {
      goto: async () => { throw new Error("search page navigation failed"); },
    } as unknown as Page;

    const scan = await scanTerminationTransactionsOnPage(page, { emplId: EID }, OBSERVED_AT);

    assert.equal(scan.state, "unreadable");
    if (scan.state !== "unreadable") return;
    assert.match(scan.reason, /search page navigation failed/u);
    assert.deepEqual(scan.diagnostic, {
      state: "not-attempted",
      cause: "not-indeterminate-settlement",
    });
  });
});
