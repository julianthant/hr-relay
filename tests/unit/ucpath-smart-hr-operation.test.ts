import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { Page } from "playwright";
import { EidSchema, IsoInstantSchema } from "../../src/domain/ids.js";
import {
  joinPendingSweepGridRows,
  readInProgressSubjectOnPage,
  scanTerminationTransactionsOnPage,
} from "../../src/stores/ucpath/driver/smart-hr-operation.js";
import type {
  UcpathPendingSweepTarget,
  UcpathTransactionRow,
} from "../../src/domain/ui/ucpath-smart-hr-termination.js";

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
        if (
          selector.startsWith('tr[id^="trPTS_CFG_CL_STD_RSL"]')
          || selector === "#UC_SS_TRANSACT_UC_TRANSACT_ID"
        ) {
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

function singleResultAutoDrillPage(
  transactionId = "T009000001",
  receiptCount = 1,
  rereadTransactionId = transactionId,
  coPresent: "none" | "row" | "empty" = "none",
): Page {
  const textBySelector = new Map<string, string>([
    ["#UC_SS_TRANSACT_UC_TRANSACT_ID", transactionId],
    ["#UC_SS_TRANSACT_APPR_STATUS", "Pending"],
    ['[id="UC_SS_TBH_VW_START_DT$0"]', "06/11/2026"],
    ['[id="UC_SS_TBH_VW_ACTION$0"]', "TER"],
    ['[id="NAME$0"]', "Person, Deterministic"],
  ]);
  let receiptReadCount = 0;
  const locator = (selector: string) => {
    const value = {
      first: () => value,
      fill: async () => undefined,
      selectOption: async () => [],
      click: async () => undefined,
      count: async () => {
        if (selector === "#UC_SS_TRANSACT_UC_TRANSACT_ID") return receiptCount;
        if (selector.startsWith('tr[id^="trPTS_CFG_CL_STD_RSL"]')) {
          return coPresent === "row" ? 1 : 0;
        }
        return 1;
      },
      waitFor: async () => {
        if (selector.startsWith('tr[id^="trPTS_CFG_CL_STD_RSL"]')) {
          if (coPresent === "row") return;
          await new Promise<never>(() => undefined);
        }
      },
      evaluate: async () => false,
      innerText: async () => {
        if (selector === "body") return coPresent === "row" ? transactionId : "";
        if (selector === "#UC_SS_TRANSACT_UC_TRANSACT_ID") {
          receiptReadCount += 1;
          return receiptReadCount === 1 ? transactionId : rereadTransactionId;
        }
        return textBySelector.get(selector) ?? "";
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
        count: async () => coPresent === "empty" ? 1 : 0,
        waitFor: async () => {
          if (coPresent === "empty") return;
          await new Promise<never>(() => undefined);
        },
      };
      return value;
    },
  } as unknown as Page;
}

describe("SS Smart HR transaction scan", () => {
  it("reads the one transaction when PeopleSoft auto-drills a single search result", async () => {
    const scan = await scanTerminationTransactionsOnPage(
      singleResultAutoDrillPage(),
      { emplId: EID },
      OBSERVED_AT,
    );

    assert.deepEqual(scan, {
      state: "read",
      emplId: EID,
      rows: [transactionRow()],
      scannedRowCount: 1,
      observedAt: OBSERVED_AT,
    });
  });

  it("refuses an auto-drilled detail page without one stable transaction id", async () => {
    const scan = await scanTerminationTransactionsOnPage(
      singleResultAutoDrillPage("not-a-transaction"),
      { emplId: EID },
      OBSERVED_AT,
    );

    assert.equal(scan.state, "unreadable");
    if (scan.state !== "unreadable") return;
    assert.match(scan.reason, /auto-drilled detail rendered no stable T transaction id/u);
    assert.doesNotMatch(scan.reason, /rendered neither a result row/u);
  });

  it("refuses ambiguous transaction-id controls on an auto-drilled detail page", async () => {
    const scan = await scanTerminationTransactionsOnPage(
      singleResultAutoDrillPage("T009000001", 2),
      { emplId: EID },
      OBSERVED_AT,
    );

    assert.equal(scan.state, "unreadable");
    if (scan.state !== "unreadable") return;
    assert.match(scan.reason, /auto-drilled detail exposed 2 transaction-id controls/u);
    assert.doesNotMatch(scan.reason, /rendered neither a result row/u);
  });

  it("redacts transaction ids when the keyed auto-drill reread resolves another transaction", async () => {
    const requestedId = "T009000001";
    const renderedId = "T009000999";
    const scan = await scanTerminationTransactionsOnPage(
      singleResultAutoDrillPage(requestedId, 1, renderedId),
      { emplId: EID },
      OBSERVED_AT,
    );

    assert.equal(scan.state, "unreadable");
    if (scan.state !== "unreadable") return;
    assert.match(scan.reason, /\[transaction identifier removed\]/u);
    assert.doesNotMatch(scan.reason, new RegExp(requestedId, "u"));
    assert.doesNotMatch(scan.reason, new RegExp(renderedId, "u"));
  });

  it("refuses a co-present result row and auto-drilled detail as an ambiguous settlement", async () => {
    const scan = await scanTerminationTransactionsOnPage(
      singleResultAutoDrillPage("T009000001", 1, "T009000001", "row"),
      { emplId: EID },
      OBSERVED_AT,
    );

    assert.equal(scan.state, "unreadable");
    if (scan.state !== "unreadable") return;
    assert.match(scan.reason, /settled in 2 states/u);
  });

  it("refuses a co-present no-results marker and detail rather than manufacturing absence", async () => {
    const scan = await scanTerminationTransactionsOnPage(
      singleResultAutoDrillPage("T009000001", 1, "T009000001", "empty"),
      { emplId: EID },
      OBSERVED_AT,
    );

    assert.equal(scan.state, "unreadable");
    if (scan.state !== "unreadable") return;
    assert.match(scan.reason, /settled in 2 states/u);
  });

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
      /SS Smart HR search rendered neither a result row, an auto-drilled transaction detail, nor PeopleSoft's no-results marker/u,
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
      + "rendered neither a result row, an auto-drilled transaction detail, nor PeopleSoft's "
      + "no-results marker within 45000ms",
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
        + "rendered neither a result row, an auto-drilled transaction detail, nor PeopleSoft's "
        + "no-results marker within 45000ms",
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

function transactionRow(overrides: Partial<UcpathTransactionRow> = {}): UcpathTransactionRow {
  return {
    transactionId: "T009000001",
    emplId: EID,
    action: "TER",
    approvalStatus: "Pending",
    startDate: "06/11/2026",
    displayedName: "Person, Deterministic",
    ...overrides,
  };
}

function sweepTarget(
  eligible: readonly UcpathTransactionRow[],
  protectedRows: readonly UcpathTransactionRow[] = [],
): UcpathPendingSweepTarget {
  return {
    emplId: EID,
    expectedName: "Deterministic Person",
    observedSet: {
      kind: "ucpath-pending-termination-set",
      emplId: EID,
      eligible: [...eligible],
      protected: [...protectedRows],
      observedAt: OBSERVED_AT,
      source: "ss-smart-hr-detail-read",
    },
  };
}

function gridRow(overrides: Partial<Readonly<{
  transactionType: string;
  effectiveDate: string;
  displayedName: string;
  emplId: typeof EID;
  action: string;
  country: string;
}>> = {}) {
  return {
    transactionType: "Termination",
    effectiveDate: "06/11/2026",
    displayedName: "Deterministic Person",
    emplId: EID,
    action: "Terminatn",
    country: "USA",
    ...overrides,
  };
}

describe("Transactions in Progress exact-set join", () => {
  it("joins the stable T id through the complete shared facts and excludes protected filings", () => {
    const eligible = transactionRow();
    const protectedFiling = transactionRow({
      transactionId: "T009000002",
      approvalStatus: "Approved",
    });
    assert.deepEqual(
      joinPendingSweepGridRows(sweepTarget([eligible], [protectedFiling]), [gridRow()]),
      [{ candidateIndex: 0, selected: { ...gridRow(), transactionId: eligible.transactionId } }],
    );
  });

  it("refuses changed, newly appeared and ambiguous rows before selection", () => {
    const first = transactionRow();
    const second = transactionRow({ transactionId: "T009000002" });
    assert.throws(
      () => joinPendingSweepGridRows(sweepTarget([first]), [gridRow({ effectiveDate: "06/12/2026" })]),
      /joined 0 Transactions in Progress rows/u,
    );
    assert.throws(
      () => joinPendingSweepGridRows(sweepTarget([first]), [gridRow(), gridRow({ effectiveDate: "06/12/2026" })]),
      /exposed 2 eligible rows/u,
    );
    assert.throws(
      () => joinPendingSweepGridRows(sweepTarget([first, second]), [gridRow(), gridRow()]),
      /joined 2 Transactions in Progress rows/u,
    );
  });

  it("reads the staged subject through named row controls and refuses conflicting names", async () => {
    const page = (rows: readonly Readonly<{ eid: string; name: string }>[]): Page => ({
      locator: () => ({
        all: async () => rows.map((row) => ({
          locator: (selector: string) => ({
            count: async () => 1,
            innerText: async () => selector.includes("EMPLID") ? row.eid : row.name,
          }),
        })),
      }),
    }) as unknown as Page;

    assert.equal(
      await readInProgressSubjectOnPage(page([
        { eid: EID, name: "Person, Deterministic" },
        { eid: EID, name: "Deterministic Person" },
      ]), EID),
      "Person, Deterministic",
    );
    await assert.rejects(
      readInProgressSubjectOnPage(page([
        { eid: EID, name: "Person, Deterministic" },
        { eid: EID, name: "Somebody Else" },
      ]), EID),
      /2 distinct names/u,
    );
  });
});
