
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { Locator, Page } from "playwright";
import { manualClock } from "../../../../../../../src/rules/time/clock.js";
import {
  NEW_KRONOS_NO_RESULTS_SENTINEL,
  NEW_KRONOS_SEARCH_QUERY_LABEL,
} from "../../../../../../../src/models/ui/new-kronos-timecard.js";
import { createNewKronosTimecardDriver } from "../../../../../../../src/backend/systems/new-kronos/driver/interpreter.js";

/** The card the identity text lives in — driver-internal, asserted by the fake. */
const TABULAR_DATA_SELECTOR = "krn-slats-tabular-data";
const SLAT_SELECTOR = "[role='menuitemradio']";
/** Playwright 1.61.1, `queryArrayInMainWorld` — verbatim, measured (see the header). */
const FRAME_NOT_FOUND = `Failed to find frame for selector "iframe[name^=\\"portal-frame-\\"] >> internal:control=enter-frame >> ${SLAT_SELECTOR}"`;

/** One rendered row as the DOM holds it, before `readSlatFacts` interprets it. */
interface FakeSlat {

  readonly ariaLabel: string | null;
  readonly text: string;
  /** Whether the `krn-slats-tabular-data` card has been transcluded (stage 3). */
  readonly card: boolean;
}

interface FakeSearchScript {
  /** Is the `portal-frame-*` iframe on the page at all? After a timecard navigation: no. */
  readonly portalFrame: boolean;
  /** Which root hosts the panel and its rows. */
  readonly panelRoot: "frame" | "top";
  /** The rows visible at each poll of the search loop; the LAST entry repeats forever. */
  readonly polls: readonly (readonly FakeSlat[])[];
  /** Monotonic ms the clock advances per poll — the bound is spent here, not in real time. */
  readonly advanceMsPerPoll: number;
  readonly totalsCounters: readonly string[];
  readonly totalsAfterSelect: readonly string[];
}

const HOST_ONLY: FakeSlat = Object.freeze({ ariaLabel: null, text: "", card: false });
const CARD_RAW_BINDINGS: FakeSlat = Object.freeze({
  ariaLabel: null,
  text: "{{::row.label ? row.label : row.name}} {{context.data[slatIndex][row.name]}}",
  card: true,
});
const COMPLETE: FakeSlat = Object.freeze({
  ariaLabel: null,
  text: "\n  Name  Kou, Nathan\n  ID  10776990\n",
  card: true,
});

/** The element surface the driver's `evaluateAll` callback actually touches. */
function fakeElement(slat: FakeSlat): unknown {
  return {
    getAttribute: (name: string): string | null => (name === "aria-label" ? slat.ariaLabel : null),
    textContent: slat.text,
    querySelector: (selector: string): unknown => {
      if (selector !== TABULAR_DATA_SELECTOR) {
        throw new Error(
          `fake new-kronos page: readSlatFacts asked for ${JSON.stringify(selector)}, not the `
          + `${JSON.stringify(TABULAR_DATA_SELECTOR)} card this fake models — refusing to answer `
          + "`not rendered` for a selector nobody scripted",
        );
      }
      return slat.card ? {} : null;
    },
  };
}

interface FakePage {
  readonly page: Page;
  readonly polls: () => number;
}


function fakeSearchPage(script: FakeSearchScript, clock: ReturnType<typeof manualClock>): FakePage {
  let pollIndex = -1;
  let frameSlatCounted = false;

  const beginPoll = (): void => {
    pollIndex += 1;
    clock.advanceMonotonic(script.advanceMsPerPoll);
  };
  // Advance the clock on each frame-root slat read, matching the loop polling boundary.
  const frameSlatCount = (): void => { beginPoll(); frameSlatCounted = true; };
  const frameSlatEvaluate = (): void => {
    if (!frameSlatCounted) beginPoll();
    frameSlatCounted = false;
  };

  const rowsNow = (root: "frame" | "top"): readonly FakeSlat[] => {
    if (root !== script.panelRoot) return [];
    const step = pollIndex < 0 ? 0 : Math.min(pollIndex, script.polls.length - 1);
    return script.polls[step] ?? [];
  };

  const frameMissing = (root: "frame" | "top"): boolean => root === "frame" && !script.portalFrame;

  /** Controls the panel publishes, by root, with their live count. */
  const controlCount = (root: "frame" | "top", key: string): number => {
    if (frameMissing(root)) return 0;
    if (key === `role:button:Employee Search`) return root === "top" ? 1 : 0;
    if (root !== script.panelRoot) return 0;
    if (key === `role:textbox:${NEW_KRONOS_SEARCH_QUERY_LABEL}`) return 1;
    if (key === "role:button:Search") return 1;
    if (key === "css:#goToDropdownButton") return 1;
    // The panel is not open when the driver's opening `closeSearchPanel` probes for the
    // close button, and WFD's sentinel never renders in any scenario scripted here.
    return 0;
  };

  let selectionRegistered = false;

  const locatorFor = (root: "frame" | "top", key: string, index: number | null): Locator => {
    const isFrameSlat = key === `css:${SLAT_SELECTOR}` && root === "frame";
    const isSlat = key === `css:${SLAT_SELECTOR}`;
    const guardFrame = (method: string): void => {
      if (!frameMissing(root)) return;
      throw new Error(`locator.${method}: ${FRAME_NOT_FOUND}`);
    };

    const locator = {
      count: (): Promise<number> => {
        if (isFrameSlat) frameSlatCount();
        // `Locator.count()` answers 0 for a frame that is not on the page (measured).
        if (frameMissing(root)) return Promise.resolve(0);
        return Promise.resolve(isSlat ? rowsNow(root).length : controlCount(root, key));
      },
      evaluateAll: (
        fn: (elements: readonly unknown[], arg: unknown) => unknown,
        arg: unknown,
      ): Promise<unknown> => {
        if (isFrameSlat) frameSlatEvaluate();
        guardFrame("evaluateAll");
        return Promise.resolve(fn(rowsNow(root).map(fakeElement), arg));
      },
      allTextContents: (): Promise<readonly string[]> => {
        guardFrame("allTextContents");
        if (key !== "css:p.totals-counter") return Promise.resolve([]);
        return Promise.resolve(selectionRegistered ? script.totalsAfterSelect : script.totalsCounters);
      },
      // Angular enables Go To only once a slat selection is registered.
      isEnabled: (): Promise<boolean> => {
        guardFrame("isEnabled");
        return Promise.resolve(selectionRegistered);
      },
      click: (): Promise<void> => { guardFrame("click"); return Promise.resolve(); },
      fill: (): Promise<void> => { guardFrame("fill"); return Promise.resolve(); },
      check: (): Promise<void> => {
        guardFrame("check");
        if (index === null || rowsNow(root)[index] === undefined) {
          throw new Error(
            `fake new-kronos page: checked row index ${String(index)}, which is not rendered — `
            + "the driver picked a slat this script never put on the page",
          );
        }
        selectionRegistered = true;
        return Promise.resolve();
      },
      nth: (at: number): Locator => locatorFor(root, key, at),
      getByRole: (role: string, options: Readonly<{ name?: string }>): Locator =>
        locatorFor(root, `role:${role}:${options.name ?? ""}`, index),
    };
    return locator as unknown as Locator;
  };

  const rootSurface = (root: "frame" | "top") => ({
    getByRole: (role: string, options: Readonly<{ name?: string }>): Locator =>
      locatorFor(root, `role:${role}:${options.name ?? ""}`, null),
    getByText: (text: string): Locator => locatorFor(root, `text:${text}`, null),
    locator: (selector: string): Locator => locatorFor(root, `css:${selector}`, null),
  });

  const page = { ...rootSurface("top"), frameLocator: () => rootSurface("frame") };

  return { page: page as unknown as Page, polls: () => pollIndex + 1 };
}

const RESOLVED_COUNTERS = Object.freeze(["Total [1]", "Selected [0]"]);
const SELECTED_COUNTERS = Object.freeze(["Total [1]", "Selected [1]"]);

function driverFor(script: FakeSearchScript): {
  search: (searchTimeoutMs: number) => Promise<unknown>;
  polls: () => number;
} {
  const clock = manualClock(new Date("2026-08-27T18:00:00.000Z"));
  const fake = fakeSearchPage(script, clock);
  const driver = createNewKronosTimecardDriver(fake.page, clock);
  return {
    search: (searchTimeoutMs) => driver.searchEmployee({ employeeId: "10776990", searchTimeoutMs }),
    polls: fake.polls,
  };
}

describe("the Employee Search poll — the interpreter half of the render-complete read (§9.28)", () => {
  it("(d) reads the TOP-LEVEL rows when the portal frame is absent, instead of dying on evaluateAll", async () => {

    const { search, polls } = driverFor({
      portalFrame: false,
      panelRoot: "top",
      polls: [[COMPLETE]],
      advanceMsPerPoll: 300,
      totalsCounters: RESOLVED_COUNTERS,
      totalsAfterSelect: SELECTED_COUNTERS,
    });

    const read = await search(20_000);

    assert.deepEqual(read, {
      state: "resolved",
      query: "10776990",
      totalCount: 1,
      candidates: [{ displayName: "Kou, Nathan", employeeId: "10776990" }],
      matched: { displayName: "Kou, Nathan", employeeId: "10776990" },
      selectedCount: 1,
      panelContext: "top-level",
      observedAt: "2026-08-27T18:00:00.000Z",
    });
    assert.equal(polls(), 1, "the completed row is accepted on the first poll");
  });

  it("(a) keeps polling through the mid-render stages and resolves the row once it completes", async () => {
    const { search, polls } = driverFor({
      portalFrame: true,
      panelRoot: "frame",
      polls: [[HOST_ONLY], [CARD_RAW_BINDINGS], [COMPLETE]],
      advanceMsPerPoll: 300,
      totalsCounters: RESOLVED_COUNTERS,
      totalsAfterSelect: SELECTED_COUNTERS,
    });

    const read = await search(20_000);

    assert.deepEqual(read, {
      state: "resolved",
      query: "10776990",
      totalCount: 1,
      candidates: [{ displayName: "Kou, Nathan", employeeId: "10776990" }],
      matched: { displayName: "Kou, Nathan", employeeId: "10776990" },
      selectedCount: 1,
      panelContext: "portal-frame",
      observedAt: "2026-08-27T18:00:00.000Z",
    });
    assert.equal(polls(), 3, "two hydrating polls, then the completed read");
  });

  it("(b) refuses BY NAME when the bound elapses with rows still mid-render", async () => {
    const { search } = driverFor({
      portalFrame: true,
      panelRoot: "frame",
      polls: [[COMPLETE, HOST_ONLY]],
      advanceMsPerPoll: 300,
      totalsCounters: RESOLVED_COUNTERS,
      totalsAfterSelect: SELECTED_COUNTERS,
    });

    await assert.rejects(
      search(1_000),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, "NewKronosDriverError");

        assert.match(error.message, /rendered 2 result row\(s\) but 1 of them never completed/u);
        assert.match(error.message, /krn-slats-tabular-data/u);
        assert.match(error.message, /last observed \[""\]/u);
        assert.match(error.message, /refusing to read rows whose subjects are unknown/u);
        // Never `no-signal`: the search DID answer.
        assert.doesNotMatch(error.message, /no-signal/u);
        return true;
      },
    );
  });

  it("(c) rows that vanish again leave nothing hydrating, so the elapsed bound is `no-signal`", async () => {
    const { search } = driverFor({
      portalFrame: true,
      panelRoot: "frame",
      polls: [[HOST_ONLY], [HOST_ONLY], []],
      advanceMsPerPoll: 300,
      totalsCounters: RESOLVED_COUNTERS,
      totalsAfterSelect: SELECTED_COUNTERS,
    });

    const read = await search(1_000);

    assert.deepEqual(read, {
      state: "no-signal",
      query: "10776990",
      reason: "neither an Employee Search result row nor WFD's own "
        + `"${NEW_KRONOS_NO_RESULTS_SENTINEL}" sentinel surfaced in either render context `
        + "— the search did not answer",
      waitedMs: 1_200,
      observedAt: "2026-08-27T18:00:00.000Z",
    });
  });
});
