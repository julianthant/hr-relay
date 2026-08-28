import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { Page } from "playwright";
import { EidSchema, IsoInstantSchema } from "../../src/domain/ids.js";
import { scanTerminationTransactionsOnPage } from "../../src/stores/ucpath/driver/smart-hr-operation.js";

const EID = EidSchema.parse("10001799");
const OBSERVED_AT = IsoInstantSchema.parse("2026-08-28T19:00:00.000Z");

function timeoutError(message: string): Error {
  const error = new Error(message);
  error.name = "TimeoutError";
  return error;
}

function indeterminateSearchPage(
  evaluate: () => Promise<unknown>,
  settlementFailure: () => Error = () => timeoutError("fixture settlement wait expired"),
): Page {
  const locator = (selector: string) => {
    const value = {
      first: () => value,
      fill: async () => undefined,
      selectOption: async () => [],
      click: async () => undefined,
      waitFor: async () => {
        if (selector.startsWith('tr[id^="trPTS_CFG_CL_STD_RSL"]')) {
          throw settlementFailure();
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
        waitFor: async () => { throw settlementFailure(); },
      };
      return value;
    },
    evaluate,
  } as unknown as Page;
}

describe("SS Smart HR transaction scan", () => {
  it("preserves an early settlement failure without attempting diagnostic capture", async () => {
    let evaluationCount = 0;
    const page = indeterminateSearchPage(
      async () => {
        evaluationCount += 1;
        throw new Error("diagnostic evaluation must not run");
      },
      () => new Error("fixture page closed during settlement"),
    );

    const scan = await scanTerminationTransactionsOnPage(page, { emplId: EID }, OBSERVED_AT);

    assert.equal(scan.state, "unreadable");
    if (scan.state !== "unreadable") return;
    assert.equal(
      scan.reason,
      "the SS Smart HR transaction scan failed: fixture page closed during settlement",
    );
    assert.deepEqual(scan.diagnostic, {
      state: "not-attempted",
      cause: "not-indeterminate-settlement",
    });
    assert.equal(evaluationCount, 0);
  });

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
    assert.doesNotMatch(scan.reason, new RegExp(String(EID), "u"));
    assert.doesNotMatch(scan.reason, new RegExp(String(EID).slice(-4), "u"));
    assert.match(scan.reason, /SS Smart HR transaction scan/u);
    assert.match(
      scan.reason,
      /SS Smart HR search rendered neither a result row nor PeopleSoft's no-results marker/u,
    );
    assert.match(scan.reason, /45000ms/u);
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
      "the SS Smart HR transaction scan failed: the SS Smart HR search "
      + "rendered neither a result row nor PeopleSoft's no-results marker within 45000ms",
    );
    assert.deepEqual(Reflect.get(scan, "diagnostic"), {
      state: "capture-failed",
      cause: "page-evaluation-failed",
    });
    assert.equal(JSON.stringify(scan).includes("raw evaluation failure"), false);
  });

  it("returns capture-failed when diagnostic evaluation does not settle", async () => {
    vi.useFakeTimers();
    try {
      const page = indeterminateSearchPage(
        async () => await new Promise<never>(() => undefined),
      );
      const scanPromise = scanTerminationTransactionsOnPage(page, { emplId: EID }, OBSERVED_AT);
      await vi.advanceTimersByTimeAsync(0);
      const outcomePromise = Promise.race([
        scanPromise.then((scan) => ({ state: "settled" as const, scan })),
        new Promise<{ readonly state: "still-pending" }>((resolve) => {
          setTimeout(() => { resolve({ state: "still-pending" }); }, 2_000);
        }),
      ]);

      await vi.advanceTimersByTimeAsync(2_000);
      const outcome = await outcomePromise;

      assert.equal(outcome.state, "settled");
      if (outcome.state !== "settled") return;
      assert.equal(outcome.scan.state, "unreadable");
      if (outcome.scan.state !== "unreadable") return;
      assert.equal(
        outcome.scan.reason,
        "the SS Smart HR transaction scan failed: the SS Smart HR search "
        + "rendered neither a result row nor PeopleSoft's no-results marker within 45000ms",
      );
      assert.deepEqual(outcome.scan.diagnostic, {
        state: "capture-failed",
        cause: "page-evaluation-failed",
      });
    } finally {
      vi.useRealTimers();
    }
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
