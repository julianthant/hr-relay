import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import type { Page } from "playwright";
import { EidSchema } from "../../../src/rules/identity/ids.js";
const EID = EidSchema.parse("10203262");
function timeoutError(message: string): Error { const error = new Error(message); error.name = "TimeoutError"; return error; }
export function singleResultAutoDrillPage(
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
    rowEid?: string;
    detailName?: string;
    submittedAt?: string;
    reportedCount?: number;
    initialVisibleCount?: number;
    expansionStalls?: boolean;
    delayedExpansion?: boolean;
    events?: string[];
    returnListMissing?: boolean;
    mutateOnReturn?: boolean;
    counterChangesOnReturn?: boolean;
    hiddenCell?: boolean;
    missingCell?: boolean;
    counterText?: string;
    counterCount?: number;
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
  let returnedToList = false;
  let expanded = false;
  const visibleCount = () => expanded ? resultRowTexts.length : (options.initialVisibleCount ?? resultRowTexts.length);
  const present = (state: "row" | "empty" | "detail"): boolean =>
    preExisting === state
    || (clicked && (returnedToList ? state === "row" : state === "detail" ? receiptCount > 0 : coPresent === state));
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
      click: async () => {
        if (selector === '[id="#ICList"]') { if (options.returnListMissing === true) throw new Error("fixture return list unavailable"); returnedToList = true; detailRequest = undefined; return; }
        const drill = /PTS_CFG_CL_RSLT_PTS_DRILLIN\$40\$\$(\d+)/u.exec(selector);
        if (drill !== null) {
          const text = resultRowTexts[Number(drill[1])] ?? "";
          detailRequest = text.replace(/^Transaction (T\d+)$/u, "$1");
          options.events?.push(`drill:${detailRequest}`);
          returnedToList = false;
          return;
        }
        clicked = true;
      },
      count: async () => {
        if (options.missingCell === true && selector.includes("SRCH3")) return 0;
        if (selector === "#UC_SS_TRANSACT_UC_TRANSACT_ID") {
          return currentReceiptCount();
        }
        if (selector.startsWith('tr[id^="trPTS_CFG_CL_STD_RSL"]')) {
          return present("row") ? visibleCount() : 0;
        }
        return 1;
      },
      isVisible: async () => {
        if (selector === "#UC_SS_TRANSACT_UC_TRANSACT_ID") {
          return currentReceiptVisible();
        }
        if (selector.startsWith('tr[id^="trPTS_CFG_CL_STD_RSL"]')) return present("row");
        return !(options.hiddenCell === true && selector.includes("SRCH3"));
      },
      waitFor: async () => {
        if (selector === "#UC_SS_TRANSACT_DTTM_CREATED") options.events?.push("wait-detail-ready");
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
        ? resultRowTexts.slice(0, visibleCount()).map((text, index) => ({
          innerText: async () => text,
          locator,
          isVisible: async () => resultRowVisibilities[index] ?? false,
        }))
        : [],
      evaluate: async () => false,
      innerText: async () => {
        const cell = /PTS_CFG_CL_RSLT_NUI_SRCH([023])\$\d+\$\$(\d+)/u.exec(selector);
        if (cell !== null) {
          const id = (resultRowTexts[Number(cell[2])] ?? "").replace(/^Transaction (T\d+)$/u, "$1");
          if (cell[1] === "0") return options.mutateOnReturn === true && returnedToList ? "T999999999" : id;
          if (cell[1] === "3") return options.rowEid ?? EID;
          return options.detailFacts?.[id]?.displayedName ?? defaultDetailFacts.displayedName;
        }
        if (selector.includes("PTS_CFG_CL_RSLT_PTS_DRILLIN")) return "Details";
        if (selector === "#UC_SS_TRANSACT_DTTM_CREATED") return options.submittedAt ?? "06/10/26 9:12:34.123456AM";
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
        if (selector === '[id="NAME$span$0"]') return options.detailName ?? detailFacts.displayedName;
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
    getByRole: (_role: string, recipe: { name: string }) => {
      assert.equal(recipe.name, "View All");
      return { ...locator("fixture-view-all"), click: async () => {
        if (options.delayedExpansion === true) options.events?.push("expansion-pending");
        else if (options.expansionStalls !== true) expanded = true;
      } };
    },
    getByText: (pattern: RegExp | string) => {
      if (pattern instanceof RegExp && /^\^1-\d+ of \d+\$$/u.test(pattern.source)) {
        const counter = locator("fixture-full-counter");
        return { ...counter, waitFor: async (waitOptions: { state: string; timeout: number }) => {
          assert.equal(waitOptions.state, "visible");
          assert.ok(waitOptions.timeout <= 45_000 && waitOptions.timeout > 0);
          options.events?.push("wait-full-counter");
          if (options.expansionStalls === true) throw timeoutError("fixture expansion wait expired");
          assert.equal(pattern.test(`1-${String(resultRowTexts.length)} of ${String(options.reportedCount ?? resultRowTexts.length)}`), true);
          expanded = true;
          options.events?.push("expansion-settled");
        } };
      }
      if (pattern instanceof RegExp && pattern.test("1-1 of 1")) {
        const counter = locator("fixture-counter");
        return { ...counter, waitFor: async () => {
          options.events?.push("wait-list-ready");
          if (options.counterCount === 0) throw timeoutError("fixture counter unavailable");
        }, count: async () => options.counterCount ?? 1, innerText: async () => options.counterText ?? `1-${String(visibleCount())} of ${String((options.reportedCount ?? resultRowTexts.length) + (options.counterChangesOnReturn === true && returnedToList ? 1 : 0))}` };
      }
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
