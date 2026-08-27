/**
 * u21 — `setRangeField` must clear the range field PROVABLY before typing into
 * it, and refuse by name if the field will not clear.
 *
 * Live finding (board `docs/plans/03b-board.md` §Residue): `setRangeField` read
 * back `"11/20/2626"` for a requested `6/1/2026` — the field was typed into
 * WITHOUT being cleared first: `ControlOrMeta+a` never actually selected
 * anything live (WFD's Angular digest ignores it), so `pressSequentially`
 * appended the typed keystrokes onto the pre-filled value instead of replacing
 * it. This file pins the fix: `fill("")` is a CLEAR, proven by a read-back
 * exactly like the typed value is, and refused by name — never silently
 * typed-into anyway — when the field will not clear.
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
 * A scripted stand-in for one range-date `<input>`: real keystrokes always
 * APPEND at the cursor (live-verified, `driver/interpreter.ts:559-566`), so
 * whether the typed value replaces or corrupts the field depends entirely on
 * whether `fill("")` actually cleared it first — `allowClear: false` models
 * WFD's Angular digest reverting the clear, the same way it reverts `fill(value)`.
 */
class FakeField {
  value: string;
  readonly allowClear: boolean;
  readonly log: string[] = [];
  readonly pressSequentiallyCalls: string[] = [];
  private clock: ReturnType<typeof manualClock> | null = null;

  constructor(initial: string, allowClear: boolean) {
    this.value = initial;
    this.allowClear = allowClear;
  }

  /**
   * Bound once the driver's clock exists. `inputValue()` is every settle/clear
   * poll's own check, so advancing it there — well past any bound this file or
   * the driver defines — means a field that never converges refuses after
   * exactly ONE poll instead of the test spending real wall-clock ticks
   * waiting out an 8s (or longer) bound. A converging read is unaffected:
   * `pollUntil` accepts a matching value before it ever looks at elapsed time.
   */
  bindClock(clock: ReturnType<typeof manualClock>): void {
    this.clock = clock;
  }

  count(): Promise<number> {
    return Promise.resolve(1);
  }

  click(): Promise<void> {
    return Promise.resolve();
  }

  fill(value: string): Promise<void> {
    if (value !== "") {
      throw new Error(
        `fake range field: fill(${JSON.stringify(value)}) called with a non-empty value — `
        + "this fake only permits fill('') as a clear; a typed value must go through pressSequentially",
      );
    }
    this.log.push("clear");
    if (this.allowClear) this.value = "";
    // else: the digest reverts the clear, exactly as it reverts fill(VALUE).
    return Promise.resolve();
  }

  pressSequentially(value: string): Promise<void> {
    this.log.push(`type:${value}`);
    this.pressSequentiallyCalls.push(value);
    // Real keystrokes append at the cursor — never a replace.
    this.value = this.value + value;
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
      // `ControlOrMeta+a` select-all never actually selects anything live
      // (WFD's Angular ignores it) — a genuine no-op both at HEAD (where it
      // is still called) and after the fix (where it is dropped).
      press: () => Promise.resolve(),
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

describe("setRangeField — the clear is proven by read-back, or refused by name (u21)", () => {
  it("(a) a pre-filled field is cleared before typing, and the read-back equals the wanted date", async () => {
    const startField = new FakeField("11/20/2026", true);
    const endField = new FakeField("11/20/2026", true);

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
    assert.deepEqual(startField.log, ["clear", "type:6/1/2026", "clear", "type:6/1/2026"], "cleared before every type, including the re-proof");
    assert.deepEqual(endField.log, ["clear", "type:8/12/2026"]);
  });

  it("(b) a field that will not clear is refused BY NAME, and is never typed into", async () => {
    const startField = new FakeField("11/20/2026", false);
    const endField = new FakeField("11/20/2026", true);

    await assert.rejects(
      driveTimecardRead({ startField, endField }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, "NewKronosDriverError");
        assert.match(error.message, /start/u);
        assert.match(error.message, /"11\/20\/2026"/u);
        assert.match(error.message, /will not clear/u);
        return true;
      },
    );

    assert.equal(startField.pressSequentiallyCalls.length, 0, "a field that will not clear must never be typed into");
    assert.equal(endField.pressSequentiallyCalls.length, 0, "the start field refused before the end field was ever reached");
  });

  it("(c) an already-empty field clears trivially, types, and settles", async () => {
    const startField = new FakeField("", true);
    const endField = new FakeField("", true);

    await assert.rejects(
      driveTimecardRead({ startField, endField }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, APPLY_BOUNDARY_MARKER);
        return true;
      },
    );

    assert.equal(startField.value, "6/1/2026");
    assert.equal(endField.value, "8/12/2026");
  });
});
