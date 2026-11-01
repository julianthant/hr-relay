import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import type { Page } from "playwright";
import { describe, it, vi } from "vitest";
import { scanTerminationTransactionsOnPage } from "../../../../../src/backend/systems/ucpath/driver/smart-hr-operation.js";
import { EidSchema, IsoInstantSchema } from "../../../../../src/rules/identity/ids.js";
import { createDeterministicUcpathDriverRow } from "../../../../support/helpers/ucpath-pending-row-fixtures.js";

const EID = EidSchema.parse("10203262");
const OBSERVED_AT = IsoInstantSchema.parse("2026-08-28T19:00:00.000Z");
const { transactionRow } = createDeterministicUcpathDriverRow(EID);

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
      count: async () => 0,
      isVisible: async () => false,
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
        count: async () => 0,
        isVisible: async () => false,
        waitFor: async () => { throw settlementFailure(); },
      };
      return value;
    },
    evaluate,
    waitForFunction: async () => { throw settlementFailure(); },
  } as unknown as Page;
}

function singleResultAutoDrillPage(
  transactionId = "T009000001",
  receiptCount = 1,
  rereadTransactionId = transactionId,
  coPresent: "none" | "row" | "empty" = "none",
  preExisting: "none" | "row" | "empty" | "detail" = "none",
  resultRowTexts: readonly string[] = [transactionId],
  bodyText = resultRowTexts.join(" "),
  resultRowVisibilities: readonly boolean[] = resultRowTexts.map(() => true),
  options: Readonly<{
    browserPredicateSource?: string;
    noResultsCount?: number;
    noResultsVisible?: boolean;
    keyedReceiptPresent?: boolean;
    keyedReceiptVisible?: boolean;
    autoReceiptVisible?: boolean;
    detailFacts?: Readonly<Record<string, Readonly<{
      approvalStatus: string;
      startDate: string;
      action: string;
      displayedName: string;
    }>>>;
  }> = {},
): Page {
  const noResultsCount = options.noResultsCount ?? 1;
  const noResultsVisible = options.noResultsVisible ?? true;
  const keyedReceiptPresent = options.keyedReceiptPresent ?? true;
  const keyedReceiptVisible = options.keyedReceiptVisible ?? true;
  const autoReceiptVisible = options.autoReceiptVisible ?? true;
  const defaultDetailFacts = {
    approvalStatus: "Pending",
    startDate: "06/11/2026",
    action: "TER",
    displayedName: "Person, Deterministic",
  } as const;
  let clicked = false;
  let detailRequest: string | undefined;
  const present = (state: "row" | "empty" | "detail"): boolean =>
    preExisting === state
    || (clicked && (state === "detail" ? receiptCount > 0 : coPresent === state));
  const currentReceiptCount = (): number => detailRequest === undefined
    ? (present("detail") ? receiptCount : 0)
    : (keyedReceiptPresent ? 1 : 0);
  const currentReceiptVisible = (): boolean => currentReceiptCount() > 0
    && (detailRequest === undefined ? autoReceiptVisible : keyedReceiptVisible);
  const locator = (selector: string) => {
    const value = {
      first: () => value,
      fill: async () => undefined,
      selectOption: async () => [],
      click: async () => { clicked = true; },
      count: async () => {
        if (selector === "#UC_SS_TRANSACT_UC_TRANSACT_ID") {
          return currentReceiptCount();
        }
        if (selector.startsWith('tr[id^="trPTS_CFG_CL_STD_RSL"]')) {
          return present("row") ? resultRowTexts.length : 0;
        }
        return 1;
      },
      isVisible: async () => {
        if (selector === "#UC_SS_TRANSACT_UC_TRANSACT_ID") {
          return currentReceiptVisible();
        }
        if (selector.startsWith('tr[id^="trPTS_CFG_CL_STD_RSL"]')) return present("row");
        return true;
      },
      waitFor: async () => {
        if (selector === "#UC_SS_TRANSACT_UC_TRANSACT_ID") {
          if (currentReceiptCount() === 1 && currentReceiptVisible()) return;
          throw timeoutError("fixture keyed detail receipt unavailable");
        }
        if (selector.startsWith('tr[id^="trPTS_CFG_CL_STD_RSL"]')) {
          if (present("row")) return;
          await new Promise<never>(() => undefined);
        }
      },
      all: async () => selector.startsWith('tr[id^="trPTS_CFG_CL_STD_RSL"]')
        ? resultRowTexts.map((text, index) => ({
          innerText: async () => text,
          isVisible: async () => resultRowVisibilities[index] ?? false,
        }))
        : [],
      evaluate: async () => false,
      innerText: async () => {
        if (selector === "body") return present("row") ? bodyText : "";
        if (selector === "#UC_SS_TRANSACT_UC_TRANSACT_ID") {
          if (detailRequest === undefined) return transactionId;
          return detailRequest === transactionId ? rereadTransactionId : detailRequest;
        }
        const detailFacts = detailRequest === undefined
          ? defaultDetailFacts
          : (options.detailFacts?.[detailRequest] ?? defaultDetailFacts);
        if (selector === "#UC_SS_TRANSACT_APPR_STATUS") return detailFacts.approvalStatus;
        if (selector === '[id="UC_SS_TBH_VW_START_DT$0"]') return detailFacts.startDate;
        if (selector === '[id="UC_SS_TBH_VW_ACTION$0"]') return detailFacts.action;
        if (selector === '[id="NAME$0"]') return detailFacts.displayedName;
        return "";
      },
    };
    return value;
  };
  return {
    goto: async (url: string) => {
      detailRequest = new URL(url).searchParams.get("UC_TRANSACT_ID") ?? undefined;
      return null;
    },
    locator,
    getByText: (pattern: RegExp | string) => {
      const markerMatches = pattern instanceof RegExp
        ? pattern.test("No matching values were found")
        : pattern === "No matching values were found";
      const value = {
        first: () => value,
        count: async () => markerMatches && present("empty") ? noResultsCount : 0,
        isVisible: async () => markerMatches && present("empty") && noResultsVisible,
        waitFor: async () => {
          if (markerMatches && present("empty") && noResultsVisible) return;
          await new Promise<never>(() => undefined);
        },
      };
      return value;
    },
    waitForFunction: async (
      predicate: unknown,
      argument: unknown,
      waitOptions: Readonly<{ timeout?: number; polling?: number }>,
    ) => {
      assert.equal(typeof predicate, "function");
      const selectors = argument as Readonly<{
        resultRow: string;
        receipt: string;
        noResultsText: string;
      }>;
      assert.deepEqual(selectors, {
        resultRow: 'tr[id^="trPTS_CFG_CL_STD_RSL"]',
        receipt: "#UC_SS_TRANSACT_UC_TRANSACT_ID",
        noResultsText: "no matching values were found",
      });
      assert.deepEqual(waitOptions, { timeout: 45_000, polling: 50 });
      const fixtureNode = (visible: boolean) => ({
        fixtureVisible: visible,
        getBoundingClientRect: () => ({
          width: visible ? 10 : 0,
          height: visible ? 10 : 0,
        }),
      });
      const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
      const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
          body: {
            innerText: present("empty") && noResultsVisible
              ? "No matching values were found"
              : bodyText,
          },
          querySelectorAll: (selector: string) => {
            if (selector === selectors.resultRow && present("row")) {
              return resultRowVisibilities.map(fixtureNode);
            }
            if (selector === selectors.receipt) {
              return Array.from(
                { length: currentReceiptCount() },
                () => fixtureNode(currentReceiptVisible()),
              );
            }
            return [];
          },
        },
      });
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
          getComputedStyle: (node: Readonly<{ fixtureVisible: boolean }>) => ({
            visibility: node.fixtureVisible ? "visible" : "hidden",
            display: node.fixtureVisible ? "block" : "none",
          }),
        },
      });
      try {
        // Playwright serializes the callback into a realm without Node/tsx helpers.
        const visible = options.browserPredicateSource === undefined
          ? (predicate as (value: typeof selectors) => unknown)(selectors)
          : runInNewContext(`(${options.browserPredicateSource})(selectors)`, {
            document: globalThis.document, window: globalThis.window, selectors,
          }) as unknown;
        if (visible !== true) throw timeoutError("fixture settlement wait expired");
      } finally {
        if (previousDocument === undefined) Reflect.deleteProperty(globalThis, "document");
        else Object.defineProperty(globalThis, "document", previousDocument);
        if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
        else Object.defineProperty(globalThis, "window", previousWindow);
      }
    },
  } as unknown as Page;
}

describe("SS Smart HR transaction scan", () => {
  it("settles visible rows, auto-detail and empty states after tsx browser serialization, but rejects hidden signals", async () => {
    const root = fileURLToPath(new URL("../../../../..", import.meta.url));
    // Import through the real CLI compiler, capture its actual callback, then
    // exercise it in a fresh browser-like realm with no __name helper.
    const browserPredicateSource = JSON.parse(execFileSync(process.execPath, [
      "--import", "tsx", "--input-type=module", "-e", `
        import { scanTerminationTransactionsOnPage } from "./src/backend/systems/ucpath/driver/smart-hr-operation.ts";
        let captured;
        const locator = {
          first() { return this; }, async waitFor() {}, async fill() {},
          async selectOption() {}, async click() {}, async count() { return 0; },
          async isVisible() { return false; },
        };
        await scanTerminationTransactionsOnPage(() => undefined, {
          async goto() {}, locator() { return locator; }, getByText() { return locator; },
          async waitForFunction(callback) { captured = callback.toString(); throw Error("captured"); },
        }, { emplId: "10800000" }, "2026-09-07T00:00:00.000Z");
        if (captured === undefined) throw Error("settlement callback was not reached");
        process.stdout.write(JSON.stringify(captured));
      `,
    ], { cwd: root, encoding: "utf8" })) as string;
    for (const [label, page, expected] of [
      ["detail", singleResultAutoDrillPage(undefined, 1, undefined, "none", "none", undefined, undefined,
        undefined, { browserPredicateSource }), "read"],
      ["rows", singleResultAutoDrillPage(undefined, 0, undefined, "row", "none", undefined, undefined,
        undefined, { browserPredicateSource }), "read"],
      ["empty", singleResultAutoDrillPage(undefined, 0, undefined, "empty", "none", undefined, undefined,
        undefined, { browserPredicateSource }), "read"],
      ["hidden detail", singleResultAutoDrillPage(undefined, 1, undefined, "none", "none", undefined, undefined,
        undefined, { browserPredicateSource, autoReceiptVisible: false }), "unreadable"],
    ] as const) {
      const scan = await scanTerminationTransactionsOnPage(() => undefined, page, { emplId: EID }, OBSERVED_AT);
      assert.equal(scan.state, expected, scan.state === "unreadable" ? `${label}: ${scan.reason}` : label);
    }
  });

  it("reads the one transaction when PeopleSoft auto-drills a single search result", async () => {
    const scan = await scanTerminationTransactionsOnPage(() => undefined,
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
    const scan = await scanTerminationTransactionsOnPage(() => undefined,
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
    const scan = await scanTerminationTransactionsOnPage(() => undefined,
      singleResultAutoDrillPage("T009000001", 2),
      { emplId: EID },
      OBSERVED_AT,
    );

    assert.equal(scan.state, "unreadable");
    if (scan.state !== "unreadable") return;
    assert.match(scan.reason, /auto-drilled detail exposed 2 transaction-id controls/u);
    assert.doesNotMatch(scan.reason, /rendered neither a result row/u);
  });

  it("retains transaction ids in the refusal when the keyed auto-drill reread resolves another transaction", async () => {
    const requestedId = "T009000001";
    const renderedId = "T009000999";
    const scan = await scanTerminationTransactionsOnPage(() => undefined,
      singleResultAutoDrillPage(requestedId, 1, renderedId),
      { emplId: EID },
      OBSERVED_AT,
    );

    assert.equal(scan.state, "unreadable");
    if (scan.state !== "unreadable") return;
    assert.match(scan.reason, /refusing to read one transaction as another/u);
    assert.ok(scan.reason.includes(requestedId));
    assert.ok(scan.reason.includes(renderedId));
  });

  it("refuses a co-present result row and auto-drilled detail as an ambiguous settlement", async () => {
    const scan = await scanTerminationTransactionsOnPage(() => undefined,
      singleResultAutoDrillPage("T009000001", 1, "T009000001", "row"),
      { emplId: EID },
      OBSERVED_AT,
    );

    assert.equal(scan.state, "unreadable");
    if (scan.state !== "unreadable") return;
    assert.match(scan.reason, /settled in 2 states/u);
  });

  it("refuses a co-present no-results marker and detail rather than manufacturing absence", async () => {
    const scan = await scanTerminationTransactionsOnPage(() => undefined,
      singleResultAutoDrillPage("T009000001", 1, "T009000001", "empty"),
      { emplId: EID },
      OBSERVED_AT,
    );

    assert.equal(scan.state, "unreadable");
    if (scan.state !== "unreadable") return;
    assert.match(scan.reason, /settled in 2 states/u);
  });

  it("returns an empty read only for one visible current no-results marker", async () => {
    const scan = await scanTerminationTransactionsOnPage(() => undefined,
      singleResultAutoDrillPage("", 0, "", "empty"),
      { emplId: EID },
      OBSERVED_AT,
    );

    assert.deepEqual(scan, {
      state: "read",
      emplId: EID,
      rows: [],
      scannedRowCount: 0,
      observedAt: OBSERVED_AT,
    });
  });

  it("refuses duplicate no-results markers", async () => {
    const scan = await scanTerminationTransactionsOnPage(() => undefined,
      singleResultAutoDrillPage(
        "",
        0,
        "",
        "empty",
        "none",
        [""],
        "",
        [true],
        { noResultsCount: 2 },
      ),
      { emplId: EID },
      OBSERVED_AT,
    );

    assert.equal(scan.state, "unreadable");
    if (scan.state !== "unreadable") return;
    assert.match(scan.reason, /exposed 2 no-results markers/u);
  });

  it("refuses a hidden no-results marker rather than manufacturing absence", async () => {
    const scan = await scanTerminationTransactionsOnPage(() => undefined,
      singleResultAutoDrillPage(
        "",
        0,
        "",
        "empty",
        "none",
        [""],
        "",
        [true],
        { noResultsVisible: false },
      ),
      { emplId: EID },
      OBSERVED_AT,
    );

    assert.equal(scan.state, "unreadable");
    if (scan.state !== "unreadable") return;
    assert.match(scan.reason, /rendered neither a result row/u);
  });

  it("refuses a populated result grid whose rows expose no stable transaction id", async () => {
    const scan = await scanTerminationTransactionsOnPage(() => undefined,
      singleResultAutoDrillPage("", 0, "", "row"),
      { emplId: EID },
      OBSERVED_AT,
    );

    assert.equal(scan.state, "unreadable");
    if (scan.state !== "unreadable") return;
    assert.match(scan.reason, /result row 1 exposed 0 distinct stable transaction ids/u);
  });

  for (const staleState of ["row", "empty", "detail"] as const) {
    it(`refuses a stale ${staleState} marker present before the current search`, async () => {
      const transactionId = staleState === "detail" ? "T009000001" : "";
      const scan = await scanTerminationTransactionsOnPage(() => undefined,
        singleResultAutoDrillPage(
          transactionId,
          staleState === "detail" ? 1 : 0,
          transactionId,
          "none",
          staleState,
        ),
        { emplId: EID },
        OBSERVED_AT,
      );

      assert.equal(scan.state, "unreadable");
      if (scan.state !== "unreadable") return;
      assert.match(scan.reason, /before the current search was submitted/u);
    });
  }

  it("reads one stable transaction id from each populated result row", async () => {
    const firstId = "T009000001";
    const secondId = "T009000002";
    const firstFacts = {
      approvalStatus: "Pending",
      startDate: "06/11/2026",
      action: "TER",
      displayedName: "Person, First",
    } as const;
    const secondFacts = {
      approvalStatus: "Approved",
      startDate: "06/12/2026",
      action: "HIR",
      displayedName: "Person, Second",
    } as const;
    const scan = await scanTerminationTransactionsOnPage(() => undefined,
      singleResultAutoDrillPage(
        firstId,
        0,
        firstId,
        "row",
        "none",
        [`Transaction ${firstId}`, `Transaction ${secondId}`],
        `${firstId} ${secondId}`,
        [true, true],
        { detailFacts: { [firstId]: firstFacts, [secondId]: secondFacts } },
      ),
      { emplId: EID },
      OBSERVED_AT,
    );

    assert.equal(scan.state, "read");
    if (scan.state !== "read") return;
    assert.deepEqual(scan, {
      state: "read",
      emplId: EID,
      rows: [
        transactionRow({ transactionId: firstId, ...firstFacts }),
        transactionRow({ transactionId: secondId, ...secondFacts }),
      ],
      scannedRowCount: 2,
      observedAt: OBSERVED_AT,
    });
  });

  it("reads only the requested transaction detail from the employee's exact search results", async () => {
    const firstId = "T009000001", secondId = "T009000002";
    const page = singleResultAutoDrillPage(firstId, 0, firstId, "row", "none", [firstId, secondId]);
    const opened = vi.spyOn(page, "goto");
    const scan = await scanTerminationTransactionsOnPage(() => undefined, page, { emplId: EID, transactionId: secondId }, OBSERVED_AT);
    assert.equal(scan.state, "read"); if (scan.state !== "read") throw new Error("read required");
    assert.deepEqual(scan.rows.map(row => row.transactionId), [secondId]);
    assert.equal(scan.scannedRowCount, 1);
    assert.deepEqual(opened.mock.calls.map(([url]) => url).filter(url => url.includes("UC_TRANSACT_ID=")),
      [opened.mock.calls.map(([url]) => url).find(url => url.endsWith(`UC_TRANSACT_ID=${secondId}`))]);
  });

  it("does not open another transaction detail when the requested ID is missing", async () => {
    const firstId = "T009000001";
    const page = singleResultAutoDrillPage(firstId);
    const opened = vi.spyOn(page, "goto");
    const scan = await scanTerminationTransactionsOnPage(() => undefined, page, { emplId: EID, transactionId: "T999999999" }, OBSERVED_AT);
    assert.equal(scan.state, "read"); if (scan.state !== "read") throw new Error("read required");
    assert.deepEqual(scan.rows, []);
    assert.equal(opened.mock.calls.some(([url]) => url.includes("UC_TRANSACT_ID=")), false);
  });

  it("refuses a keyed result-row reread whose receipt is absent", async () => {
    const transactionId = "T009000001";
    const scan = await scanTerminationTransactionsOnPage(() => undefined,
      singleResultAutoDrillPage(
        transactionId,
        0,
        transactionId,
        "row",
        "none",
        [transactionId],
        transactionId,
        [true],
        { keyedReceiptPresent: false },
      ),
      { emplId: EID },
      OBSERVED_AT,
    );

    assert.equal(scan.state, "unreadable");
    if (scan.state !== "unreadable") return;
    assert.match(scan.reason, /fixture keyed detail receipt unavailable/u);
  });

  it("refuses a keyed result-row reread whose receipt is present but hidden", async () => {
    const transactionId = "T009000001";
    const scan = await scanTerminationTransactionsOnPage(() => undefined,
      singleResultAutoDrillPage(
        transactionId,
        0,
        transactionId,
        "row",
        "none",
        [transactionId],
        transactionId,
        [true],
        { keyedReceiptVisible: false },
      ),
      { emplId: EID },
      OBSERVED_AT,
    );

    assert.equal(scan.state, "unreadable");
    if (scan.state !== "unreadable") return;
    assert.match(scan.reason, /fixture keyed detail receipt unavailable/u);
  });

  it("refuses a row with no id even when an unrelated body id masks the count", async () => {
    const unrelatedId = "T009000002";
    const scan = await scanTerminationTransactionsOnPage(() => undefined,
      singleResultAutoDrillPage(
        unrelatedId,
        0,
        unrelatedId,
        "row",
        "none",
        ["Transaction identity unavailable"],
        unrelatedId,
      ),
      { emplId: EID },
      OBSERVED_AT,
    );

    assert.equal(scan.state, "unreadable");
    if (scan.state !== "unreadable") return;
    assert.match(scan.reason, /result row 1 exposed 0 distinct stable transaction ids/u);
  });

  it("refuses duplicate transaction ids across distinct result rows", async () => {
    const duplicateId = "T009000001";
    const scan = await scanTerminationTransactionsOnPage(() => undefined,
      singleResultAutoDrillPage(
        duplicateId,
        0,
        duplicateId,
        "row",
        "none",
        [duplicateId, duplicateId],
        `${duplicateId} T009000002`,
      ),
      { emplId: EID },
      OBSERVED_AT,
    );

    assert.equal(scan.state, "unreadable");
    if (scan.state !== "unreadable") return;
    assert.match(scan.reason, /result rows repeated one stable transaction id/u);
  });

  it("refuses a result set containing a hidden row", async () => {
    const firstId = "T009000001";
    const secondId = "T009000002";
    const scan = await scanTerminationTransactionsOnPage(() => undefined,
      singleResultAutoDrillPage(
        firstId,
        0,
        firstId,
        "row",
        "none",
        [firstId, secondId],
        `${firstId} ${secondId}`,
        [true, false],
      ),
      { emplId: EID },
      OBSERVED_AT,
    );

    assert.equal(scan.state, "unreadable");
    if (scan.state !== "unreadable") return;
    assert.match(scan.reason, /result row 2 was not visible/u);
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

    const scan = await scanTerminationTransactionsOnPage(() => undefined, page, { emplId: EID }, OBSERVED_AT);

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

    const scan = await scanTerminationTransactionsOnPage(() => undefined, page, { emplId: EID }, OBSERVED_AT);

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

    const scan = await scanTerminationTransactionsOnPage(() => undefined, page, { emplId: EID }, OBSERVED_AT);

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
      const scanPromise = scanTerminationTransactionsOnPage(() => undefined, page, { emplId: EID }, OBSERVED_AT);
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
      goto: async () => { throw new Error(`search page navigation failed for ${EID}, suffix ${String(EID).slice(-4)}, transaction T1234567`); },
    } as unknown as Page;

    const scan = await scanTerminationTransactionsOnPage(() => undefined, page, { emplId: EID }, OBSERVED_AT);

    assert.equal(scan.state, "unreadable");
    if (scan.state !== "unreadable") return;
    assert.match(scan.reason, /search page navigation failed/u);
    assert.ok(scan.reason.includes(String(EID)));
    assert.ok(scan.reason.includes("transaction T1234567"));
    assert.deepEqual(scan.diagnostic, {
      state: "not-attempted",
      cause: "not-indeterminate-settlement",
    });
  });
});
