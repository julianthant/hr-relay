
import assert from "node:assert/strict";
import { type Locator, type Page } from "playwright";
import { describe, it } from "vitest";
import { createNewKronosTimecardDriver } from "../../../../../src/backend/systems/new-kronos/driver/interpreter.js";
import { NEW_KRONOS_SEARCH_QUERY_LABEL } from "../../../../../src/models/ui/new-kronos-timecard.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";

import { NEW_KRONOS_NO_RESULTS_SENTINEL } from "../../../../../src/models/ui/new-kronos-timecard.js";

{

const EMPLOYEE_ID = "10776990";
const DISPLAY_NAME = "Kou, Nathan";
const SLAT_SELECTOR = "[role='menuitemradio']";
const APPLY_BOUNDARY_MARKER =
  "TEST BOUNDARY: Apply button intentionally unscripted for the u29 range-field seam";

/** One `Name <name> ID <eid>` row, already fully rendered — search rendering fidelity is not this seam's concern. */
const COMPLETE_SLAT_TEXT = `\n  Name  ${DISPLAY_NAME}\n  ID  ${EMPLOYEE_ID}\n`;

class FakeField {
  value: string;
  readonly selectAllSilentlyFails: boolean;
  readonly log: string[] = [];
  readonly pressSequentiallyCalls: string[] = [];
  readonly maskTransitions: Array<Readonly<{
    requested: string;
    before: string;
    afterMonth: string;
    afterDay: string;
    afterYear: string;
  }>> = [];
  private clock: ReturnType<typeof manualClock> | null = null;
  private selectionStart = 0;
  private selectionEnd = 0;

  constructor(initial: string, selectAllSilentlyFails = false) {
    if (initial.length === 0) {
      throw new Error("fake range field: WFD's Select range field must start with its non-empty default");
    }
    this.value = initial;
    this.selectAllSilentlyFails = selectAllSilentlyFails;
  }

  // Advance test time past the settle bound so wrong readback refuses without wall-clock delay.
  bindClock(clock: ReturnType<typeof manualClock>): void {
    this.clock = clock;
  }

  count(): Promise<number> {
    return Promise.resolve(1);
  }

  click(): Promise<void> {
    if (this.selectAllSilentlyFails) {
      this.selectionStart = 7;
      this.selectionEnd = 8;
    } else {
      this.selectionStart = 0;
      this.selectionEnd = 2;
    }
    return Promise.resolve();
  }

  fill(value: string): Promise<void> {
    throw new Error(
      `fake range field: fill(${JSON.stringify(value)}) is not a valid operation on WFD's masked range field`,
    );
  }

  pressSequentially(value: string): Promise<void> {
    this.log.push(`type:${value}`);
    this.pressSequentiallyCalls.push(value);
    if (!this.selectAllSilentlyFails && this.selectionStart === 0 && this.selectionEnd === 2) {
      const current = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(this.value);
      const requested = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u.exec(value);
      if (current === null || requested === null) {
        throw new Error(
          `fake range field: masked overtype requires MM/DD/YYYY current and M/D/YYYY requested dates; `
          + `received ${JSON.stringify(this.value)} and ${JSON.stringify(value)}`,
        );
      }
      const wantedMonth = requested[1].padStart(2, "0");
      const wantedDay = requested[2].padStart(2, "0");
      const wantedYear = requested[3];
      const afterMonth = `${wantedMonth}/${current[2]}/${current[3]}`;
      const afterDay = `${wantedMonth}/${wantedDay}/${current[3]}`;
      const afterYear = `${wantedMonth}/${wantedDay}/${wantedYear}`;
      this.maskTransitions.push({ requested: value, before: this.value, afterMonth, afterDay, afterYear });
      this.value = afterYear;
    } else if (this.selectAllSilentlyFails) {
      const firstTypedDigit = /\d/u.exec(value)?.[0];
      if (firstTypedDigit === undefined) {
        throw new Error("fake range field: the silently-failed select-all case requires a typed digit");
      }

      this.value = `${this.value.slice(0, this.selectionStart)}${firstTypedDigit}${this.value.slice(this.selectionEnd)}`;
    } else {
      throw new Error(
        `fake range field: typing began from unmodeled selection ${String(this.selectionStart)}..${String(this.selectionEnd)}`,
      );
    }
    this.selectionStart = this.value.length;
    this.selectionEnd = this.value.length;
    return Promise.resolve();
  }

  press(key: string): Promise<void> {
    if (key !== "ControlOrMeta+a") {
      throw new Error(`fake range field: unexpected key ${JSON.stringify(key)}`);
    }
    this.log.push("select-all");
    return Promise.resolve();
  }

  inputValue(): Promise<string> {
    this.clock?.advanceMonotonic(600_000);
    return Promise.resolve(this.value);
  }
}

interface Handler {
  readonly count?: () => Promise<number>;
  readonly click?: () => Promise<void>;
  readonly isEnabled?: () => Promise<boolean>;
  readonly textContent?: () => Promise<string | null>;
  readonly getAttribute?: (name: string) => Promise<string | null>;
  readonly fill?: (value: string) => Promise<void>;
  readonly allTextContents?: () => Promise<readonly string[]>;
  readonly evaluateAll?: (fn: (elements: readonly unknown[], arg: unknown) => unknown, arg: unknown) => Promise<unknown>;
}

function unscripted(key: string, method: string): never {
  throw new Error(
    `fake new-kronos page: ${JSON.stringify(key)} does not implement ${method}() — this script never `
    + "anticipated that call, and a stub that hit an unexpected call must refuse rather than guess",
  );
}

function genericLocator(key: string, handler: Handler | undefined): Locator {
  const h = handler ?? {};
  const locator = {
    count: () => (h.count ? h.count() : unscripted(key, "count")),
    click: () => (h.click ? h.click() : unscripted(key, "click")),
    isEnabled: () => (h.isEnabled ? h.isEnabled() : unscripted(key, "isEnabled")),
    textContent: () => (h.textContent ? h.textContent() : unscripted(key, "textContent")),
    getAttribute: (name: string) => (h.getAttribute ? h.getAttribute(name) : unscripted(key, "getAttribute")),
    fill: (value: string) => (h.fill ? h.fill(value) : unscripted(key, "fill")),
    allTextContents: () => (h.allTextContents ? h.allTextContents() : unscripted(key, "allTextContents")),
    evaluateAll: (fn: (elements: readonly unknown[], arg: unknown) => unknown, arg: unknown) =>
      (h.evaluateAll ? h.evaluateAll(fn, arg) : unscripted(key, "evaluateAll")),
  };
  return locator as unknown as Locator;
}

/** A frame root that is simply never present: every count() is 0, nothing else is ever called on it. */
function emptyFrameRoot() {
  const empty = (key: string): Locator => genericLocator(key, { count: () => Promise.resolve(0) });
  return {
    getByRole: (role: string, options: Readonly<{ name?: string }>): Locator => empty(`role:${role}:${options.name ?? ""}`),
    getByText: (text: string): Locator => empty(`text:${text}`),
    locator: (selector: string): Locator => empty(`css:${selector}`),
  };
}

interface Script {
  readonly startField: FakeField;
  readonly endField: FakeField;
  readonly gridHarvests?: readonly Readonly<{
    headers: readonly string[];
    rows: readonly Readonly<{ month: number; day: number; rawDateCell: string; cells: readonly string[] }>[];
    dateRowCount: number;
    dataRowCount: number;
  }>[];
}

function fakeTimecardPage(script: Script, clock: ReturnType<typeof manualClock>): Page {
  script.startField.bindClock(clock);
  script.endField.bindClock(clock);
  let selectionRegistered = false;
  let harvestIndex = 0;

  const fieldFor = (key: string): FakeField | undefined => {
    if (key === "css:#startDateTimeInput") return script.startField;
    if (key === "css:#endDateTimeInput") return script.endField;
    return undefined;
  };

  const handlers = new Map<string, Handler>([
    ["role:button:Employee Search", { count: () => Promise.resolve(1), click: () => Promise.resolve() }],
    [`role:textbox:${NEW_KRONOS_SEARCH_QUERY_LABEL}`, {
      count: () => Promise.resolve(1),
      fill: () => Promise.resolve(),
    }],
    ["role:button:Search", { count: () => Promise.resolve(1), click: () => Promise.resolve() }],
    ["role:button:Employee Search Close", { count: () => Promise.resolve(0) }],
    ["css:p.totals-counter", {
      allTextContents: () => Promise.resolve(selectionRegistered ? ["Total [1]", "Selected [1]"] : ["Total [1]", "Selected [0]"]),
    }],
    ["css:#goToDropdownButton", {
      count: () => Promise.resolve(1),
      isEnabled: () => Promise.resolve(selectionRegistered),
      click: () => Promise.resolve(),
    }],
    ["role:option:Timecard", { count: () => Promise.resolve(1), click: () => Promise.resolve() }],
    ["css:.emp-nav-id", { count: () => Promise.resolve(1), textContent: () => Promise.resolve(EMPLOYEE_ID) }],
    ["css:#combo_inptxt", { count: () => Promise.resolve(1), getAttribute: () => Promise.resolve(DISPLAY_NAME) }],
    ["css:button.select-timeframe-button", { count: () => Promise.resolve(1), click: () => Promise.resolve() }],
    ["role:button:Select range", { count: () => Promise.resolve(1), click: () => Promise.resolve() }],
    ["css:#_timeFrame", { count: () => Promise.resolve(1), textContent: () => Promise.resolve("06/01/2026 - 06/02/2026") }],
    ["role:button:Apply", {
      count: () => Promise.resolve(1),
      click: () => { if (script.gridHarvests === undefined) throw new Error(APPLY_BOUNDARY_MARKER); return Promise.resolve(); },
    }],
  ]);

  /** The single search-result slat: always fully rendered, on the FIRST poll. */
  const slatLocator = (): Locator => {
    const base = genericLocator(`css:${SLAT_SELECTOR}`, {
      count: () => Promise.resolve(1),
      evaluateAll: (fn, arg) => Promise.resolve(fn([{
        getAttribute: (name: string): string | null => (name === "aria-label" ? null : null),
        textContent: COMPLETE_SLAT_TEXT,
        querySelector: () => ({}),
      }], arg)),
    });
    const slat = {
      ...base,
      nth: (): Locator => slat,
      getByRole: (role: string, options: Readonly<{ name?: string }>): Locator => {
        if (role !== "checkbox" || options.name !== "Select Item") {
          unscripted(`slat.getByRole(${role})`, "getByRole");
        }
        return {
          check: () => { selectionRegistered = true; return Promise.resolve(); },
        } as unknown as Locator;
      },
    } as unknown as Locator;
    return slat;
  };

  const fieldLocator = (key: string): Locator => {
    const field = fieldFor(key);
    if (field === undefined) unscripted(key, "resolve");
    return {
      count: () => field.count(),
      click: () => field.click(),
      fill: (value: string) => field.fill(value),
      pressSequentially: (value: string) => field.pressSequentially(value),
      inputValue: () => field.inputValue(),
      press: (key: string) => field.press(key),
    } as unknown as Locator;
  };

  const rootSurface = () => ({
    getByRole: (role: string, options: Readonly<{ name?: string }>): Locator => {
      const key = `role:${role}:${options.name ?? ""}`;
      if (role === "option" && options.name === "Timecard") return genericLocator(key, handlers.get(key));
      if (role === "button" || role === "textbox") return genericLocator(key, handlers.get(key));
      unscripted(key, "getByRole");
    },
    getByText: (text: string): Locator => unscripted(`text:${text}`, "getByText"),
    locator: (selector: string): Locator => {
      const key = `css:${selector}`;
      if (selector === SLAT_SELECTOR) return slatLocator();
      if (selector === "#startDateTimeInput" || selector === "#endDateTimeInput") return fieldLocator(key);
      return genericLocator(key, handlers.get(key));
    },
  });

  const page = {
    ...rootSurface(),
    frameLocator: () => emptyFrameRoot(),
    url: () => "https://ucsd-sso.prd.mykronos.com/wfd/timekeeping#/timecard",
    evaluate: (_fn: unknown, position?: number) => {
      const geometry = { scrollTop: position ?? 0, scrollHeight: 60, clientHeight: 60 };
      if (position !== undefined) return Promise.resolve(geometry);
      const harvest = script.gridHarvests?.[Math.min(harvestIndex++, script.gridHarvests.length - 1)];
      if (harvest === undefined) throw new Error("unscripted grid harvest");
      return Promise.resolve({ ...geometry, ...harvest, viewportCount: 2, topRow: "Mon 6/1" });
    },
  };
  return page as unknown as Page;
}

function driveTimecardRead(script: Script): Promise<unknown> {
  const clock = manualClock(new Date("2026-08-27T18:00:00.000Z"));
  const page = fakeTimecardPage(script, clock);
  const driver = createNewKronosTimecardDriver(() => undefined, page, clock);
  return driver.readSeparationTimecard({
    employeeId: EMPLOYEE_ID,
    rangeStart: "6/1/2026",
    rangeEnd: script.gridHarvests === undefined ? "8/12/2026" : "6/2/2026",
  });
}

describe("timecard grid structural completeness", () => {
  const headers = ["Schedule", "In", "Out", "Transfer", "Pay code", "Amount", "Shift", "Daily", "Period", "Absence"];
  const row = (day: number, cells: readonly string[]) => ({ month: 6, day, rawDateCell: `Mon 6/${String(day)}`, cells });
  for (const cells of [[], ["", "08:00"]]) {
    it(`refuses a later date row with ${String(cells.length)} data cells`, async () => {
      const harvest = { headers, dateRowCount: 2, dataRowCount: cells.length === 0 ? 1 : 2, rows: [row(1, ["", "08:00", "17:00", "", "", "", "", "", "", ""]), row(2, cells)] };
      await assert.rejects(driveTimecardRead({ startField: new FakeField("08/27/2026"), endField: new FakeField("08/27/2026"), gridHarvests: [harvest] }), /date\/data row counts|cell\(s\) against/u);
    });
  }
  it("refuses headers that change on a grid repaint", async () => {
    const rows = [row(1, ["", "08:00", "17:00", "", "", "", "", "", "", ""]), row(2, Array<string>(10).fill(""))];
    const opening = { headers, rows, dateRowCount: 2, dataRowCount: 2 };
    const repaint = { ...opening, headers: ["In", "Schedule", ...headers.slice(2)] };
    await assert.rejects(driveTimecardRead({ startField: new FakeField("08/27/2026"), endField: new FakeField("08/27/2026"), gridHarvests: [opening, repaint] }), /headers changed/u);
  });
});

describe("setRangeField — only the final calendar-day read-back proves the masked overtype (u29)", () => {
  it("types the start/end/start re-proof through the whole public visit", async () => {
    const startField = new FakeField("08/27/2026");
    const endField = new FakeField("08/27/2026");

    await assert.rejects(
      driveTimecardRead({ startField, endField }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        // Reaching the Apply-button marker proves start, end, and the start
        // re-proof all completed — never a "could not set" range-field refusal.
        assert.equal(error.message, APPLY_BOUNDARY_MARKER);
        return true;
      },
    );

    assert.equal(startField.value, "06/01/2026", "the start field settles on exactly the wanted calendar day");
    assert.equal(endField.value, "08/12/2026", "the end field settles on exactly the wanted calendar day");
    assert.deepEqual(startField.maskTransitions, [
      {
        requested: "6/1/2026",
        before: "08/27/2026",
        afterMonth: "06/27/2026",
        afterDay: "06/01/2026",
        afterYear: "06/01/2026",
      },
      {
        requested: "6/1/2026",
        before: "06/01/2026",
        afterMonth: "06/01/2026",
        afterDay: "06/01/2026",
        afterYear: "06/01/2026",
      },
    ], "the live 0..2 mask path sets start and then re-proves it after end");
    assert.deepEqual(endField.maskTransitions, [{
      requested: "8/12/2026",
      before: "08/27/2026",
      afterMonth: "08/27/2026",
      afterDay: "08/12/2026",
      afterYear: "08/12/2026",
    }]);
    assert.deepEqual(
      startField.log,
      ["select-all", "type:6/1/2026", "select-all", "type:6/1/2026"],
      "the start field is set once and then re-proved after the end field",
    );
    assert.deepEqual(endField.log, ["select-all", "type:8/12/2026"]);
  });

  it("refuses a silently failed select-all by the final read-back with its prior value", async () => {
    const startField = new FakeField("11/20/2026", true);
    const endField = new FakeField("11/20/2026");

    await assert.rejects(
      driveTimecardRead({ startField, endField }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, "NewKronosDriverError");
        assert.equal(
          error.message,
          "[new-kronos] could not set the timecard start date to 6/1/2026 — prior value "
          + '"11/20/2026"; the field last read "11/20/2626" after 8000ms; '
          + "refusing to apply a wrong timecard window",
        );
        return true;
      },
    );

    assert.deepEqual(startField.pressSequentiallyCalls, ["6/1/2026"]);
    assert.equal(endField.pressSequentiallyCalls.length, 0, "the final start refusal stops before the end field");
  });
});
}

{

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
  const driver = createNewKronosTimecardDriver(() => undefined, fake.page, clock);
  return {
    search: (searchTimeoutMs) => driver.searchEmployee({ employeeId: "10776990", searchTimeoutMs }),
    polls: fake.polls,
  };
}

describe("employee search candidate completeness", () => {
  for (const rendered of [COMPLETE, { ...COMPLETE, text: "Name Other, Person ID 10800000" }]) {
    it(`refuses Total [2] with one rendered ${rendered === COMPLETE ? "matching" : "nonmatching"} candidate`, async () => {
      const { search } = driverFor({ portalFrame: true, panelRoot: "frame", polls: [[rendered]], advanceMsPerPoll: 300, totalsCounters: ["Total [2]", "Selected [0]"], totalsAfterSelect: ["Total [2]", "Selected [1]"] });
      await assert.rejects(search(1_000), /rendered 1 candidate.*Total.*2.*incomplete/u);
    });
  }
});

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
}
