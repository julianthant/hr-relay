/**
 * u29 — `setRangeField` drives WFD's never-empty masked date input with real
 * keystrokes and accepts it only when the FINAL read-back is the requested
 * calendar day. Select-all is a gesture, not proof: the widget may keep a
 * whole-value selection or only its current segment, and the live mask advances
 * valid digits in the fresh-range state either way (§9.30).
 *
 * A stale mid-year caret is the refusal case: if select-all silently fails,
 * requested `6/1/2026` can become `11/20/2626`. The final refusal must name
 * both the prior and observed values so the masked overtype diagnoses itself.
 *
 * The fake below drives the WHOLE `readSeparationTimecard` visit (the only
 * public method that reaches `setRangeField`), because the driver reaches the
 * range fields through one continuous page visit: search -> Go To -> Timecard
 * -> subject proof -> period trigger -> Select range -> the three
 * `setRangeField` calls (start, end, start re-proof). Every step ahead of the
 * range fields is scripted to succeed deterministically and immediately (one
 * poll, no hydrating stages) — none of that machinery is what this unit is
 * about. The step AFTER the three range-field calls — the Apply button — is
 * deliberately stubbed to throw a named TEST BOUNDARY marker instead of
 * simulating the applied-range poll and the virtualized grid read: reaching
 * that marker is itself the proof that all three `setRangeField` calls
 * completed, which is what this seam is responsible for. A stub that is asked
 * for anything this script did not anticipate throws by name too — it never
 * returns a default.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { Locator, Page } from "playwright";
import { manualClock } from "../../src/domain/clock.js";
import { NEW_KRONOS_SEARCH_QUERY_LABEL } from "../../src/domain/ui/new-kronos-timecard.js";
import { createNewKronosTimecardDriver } from "../../src/stores/new-kronos/driver/interpreter.js";

const EMPLOYEE_ID = "10776990";
const DISPLAY_NAME = "Kou, Nathan";
const SLAT_SELECTOR = "[role='menuitemradio']";
const APPLY_BOUNDARY_MARKER =
  "TEST BOUNDARY: Apply button intentionally unscripted for the u21 range-field seam";

/** One `Name <name> ID <eid>` row, already fully rendered — search rendering fidelity is not this seam's concern. */
const COMPLETE_SLAT_TEXT = `\n  Name  ${DISPLAY_NAME}\n  ID  ${EMPLOYEE_ID}\n`;

/**
 * A scripted stand-in for one never-empty range-date `<input>`. The happy arm
 * models a whole-value selection; the failure arm models the observed mid-year
 * segment surviving a silently failed select-all and corrupting only that
 * segment before the public visit's final read-back refuses it.
 */
class FakeField {
  value: string;
  readonly selectAllSilentlyFails: boolean;
  readonly log: string[] = [];
  readonly pressSequentiallyCalls: string[] = [];
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

  /**
   * Bound once the driver's clock exists. `inputValue()` advances past the
   * settle bound so a wrong final value refuses immediately in test time. A
   * matching value is accepted by `pollUntil` before elapsed time is consulted.
   */
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
    if (this.selectionStart === 0 && this.selectionEnd === this.value.length) {
      this.value = value;
    } else if (this.selectAllSilentlyFails) {
      const firstTypedDigit = /\d/u.exec(value)?.[0];
      if (firstTypedDigit === undefined) {
        throw new Error("fake range field: the silently-failed select-all case requires a typed digit");
      }
      // The live mid-year caret replaced only the second year digit; the rest
      // of the masked keystrokes were ignored, yielding 11/20/2626.
      this.value = `${this.value.slice(0, this.selectionStart)}${firstTypedDigit}${this.value.slice(this.selectionEnd)}`;
    } else {
      throw new Error("fake range field: typing began without the expected whole-value selection");
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
    if (!this.selectAllSilentlyFails) {
      this.selectionStart = 0;
      this.selectionEnd = this.value.length;
    }
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
}

function fakeTimecardPage(script: Script, clock: ReturnType<typeof manualClock>): Page {
  script.startField.bindClock(clock);
  script.endField.bindClock(clock);
  let selectionRegistered = false;

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
    ["role:button:Apply", {
      count: () => Promise.resolve(1),
      click: () => { throw new Error(APPLY_BOUNDARY_MARKER); },
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
  };
  return page as unknown as Page;
}

function driveTimecardRead(script: Script): Promise<unknown> {
  const clock = manualClock(new Date("2026-08-27T18:00:00.000Z"));
  const page = fakeTimecardPage(script, clock);
  const driver = createNewKronosTimecardDriver(page, clock);
  return driver.readSeparationTimecard({
    employeeId: EMPLOYEE_ID,
    rangeStart: "6/1/2026",
    rangeEnd: "8/12/2026",
  });
}

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

    assert.equal(startField.value, "6/1/2026", "the start field settles on exactly the wanted date, not an appended one");
    assert.equal(endField.value, "8/12/2026", "the end field settles on exactly the wanted date, not an appended one");
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
