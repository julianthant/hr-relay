
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement,type ReactElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,describe,it,onTestFinished,vi } from "vitest";
import { DateInput,DateRangeInput } from "../../../../src/dashboard/ds/primitives/primitives-date.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => { unmount(); });

/** The one root this file owns: unmounted inside `act` before it is replaced. */
function mount(element: ReactElement): void {
  unmount();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => { root?.render(element); });
}

function unmount(): void {
  if (root !== undefined) act(() => { root?.unmount(); });
  root = undefined;
  host?.remove();
  host = undefined;
  document.body.replaceChildren();
}

/** The named refusal a bound the component cannot read produces. */
const BOUND_REFUSAL = /^DS_DATE_BOUND_INVALID: (?:min|max)=".*" is not a calendar date$/u;

/** Mounts an element the component is expected to refuse, and returns the message. */
function refusalOf(element: ReactElement): string {
  const reported = console.error;
  console.error = () => undefined;
  try {
    mount(element);
    return assert.fail("a bound this component cannot read rendered anyway");
  } catch (error) {
    assert.ok(error instanceof Error, `expected an Error, got ${String(error)}`);
    return error.message;
  } finally {
    console.error = reported;
    unmount();
  }
}

const WEEKDAY: Readonly<Record<number, string>> = {
  17: "Saturday", 18: "Sunday", 19: "Monday", 20: "Tuesday", 21: "Wednesday", 26: "Monday",
};

/** The one calendar that is open, so no cell is read out of another calendar. */
function openCalendar(): HTMLElement {
  const calendars = document.body.querySelectorAll<HTMLElement>('[data-slot="calendar"], [data-slot="range-calendar"]');
  assert.equal(calendars.length, 1, `expected exactly one open calendar, found ${calendars.length}`);
  const found = calendars[0];
  assert.ok(found, "the open calendar is missing");
  return found;
}

/** One day cell of that calendar; a range endpoint's label carries the whole range. */
function cell(day: number): HTMLElement {
  const label = `${WEEKDAY[day]}, October ${day}, 2026`;
  const matches = Array.from(openCalendar().querySelectorAll<HTMLElement>("[aria-label]"))
    .filter((element) => element.getAttribute("aria-label")?.includes(label) === true
      && element.textContent?.trim() === String(day));
  assert.equal(matches.length, 1, `expected one cell for "${label}", found ${matches.length}`);
  const found = matches[0];
  assert.ok(found, `no cell for "${label}"`);
  return found;
}

function isDisabled(day: number): boolean {
  return cell(day).dataset.disabled === "true";
}

/** How a bound day is announced: react-aria names the reachable endpoints. */
function isAnnouncedAsEndpoint(day: number, endpoint: "First" | "Last"): boolean {
  return cell(day).getAttribute("aria-label")?.includes(`${endpoint} available date`) === true;
}

function openCalendarTrigger(triggerLabel: string): void {
  const trigger = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${triggerLabel}"]`);
  assert.ok(trigger, `no calendar trigger named "${triggerLabel}"`);
  act(() => { trigger?.click(); });
}

/** `DateInput` in one of its two input forms, with a value inside the bounds. */
function dateInput(textEntry: boolean, min: string | undefined, max: string | undefined, value?: string) {
  return createElement(DateInput, {
    label: "Effective date",
    value: value ?? (textEntry ? "10/19/2026" : "2026-10-19"),
    onChange: () => undefined,
    min,
    max,
    ...(textEntry ? { textEntry: true } : {}),
  });
}

function rangeInput(min: string | undefined, max: string | undefined, value?: { from: string; to: string }) {
  return createElement(DateRangeInput, {
    label: "Report dates",
    value: value ?? { from: "2026-10-19", to: "2026-10-20" },
    onChange: () => undefined,
    min,
    max,
  });
}

/** The four choosability answers the readable pair of bounds must produce. */
function boundedAnswer(): boolean[] {
  return [isDisabled(20), isDisabled(21), isDisabled(18), isDisabled(17)];
}

describe("ds date bounds — a readable bound reaches every picker the component feeds", () => {
  it("DateInput's calendar closes off days past `max` and before `min`", () => {
    mount(dateInput(false, "2026-10-18", "2026-10-20"));
    openCalendarTrigger("Choose effective date");
    assert.deepEqual(boundedAnswer(), [false, true, false, true]);
    assert.equal(isAnnouncedAsEndpoint(18, "First"), true, "the reachable lower endpoint is named");
    assert.equal(isAnnouncedAsEndpoint(20, "Last"), true, "the reachable upper endpoint is named");
  });

  it("DateInput's text-entry form feeds its picker and calendar the same bounds", () => {
    mount(dateInput(true, "2026-10-18", "2026-10-20"));
    openCalendarTrigger("Choose effective date");
    assert.deepEqual(boundedAnswer(), [false, true, false, true]);
    assert.equal(isAnnouncedAsEndpoint(18, "First"), true, "the reachable lower endpoint is named");
    assert.equal(isAnnouncedAsEndpoint(20, "Last"), true, "the reachable upper endpoint is named");
  });

  it("DateRangeInput's RangeCalendar is closed off by the same bounds", () => {
    mount(rangeInput("2026-10-18", "2026-10-20"));
    openCalendarTrigger("Choose start date range");
    assert.deepEqual(boundedAnswer(), [false, true, false, true]);
    assert.equal(isAnnouncedAsEndpoint(18, "First"), true, "the reachable lower endpoint is named");
    assert.equal(isAnnouncedAsEndpoint(20, "Last"), true, "the reachable upper endpoint is named");
  });

  it("one bound alone closes only its own side", () => {
    mount(dateInput(false, "2026-10-18", undefined));
    openCalendarTrigger("Choose effective date");
    assert.equal(isDisabled(17), true, "a day before `min` must not be choosable");
    assert.equal(isDisabled(21), false, "`max` absent means no upper limit");
  });

  it("an absent bound leaves the visible month choosable on both sides", () => {
    mount(dateInput(false, undefined, undefined));
    openCalendarTrigger("Choose effective date");
    assert.equal(isDisabled(17), false, "`min` absent means no lower limit");
    assert.equal(isDisabled(21), false, "`max` absent means no upper limit");
    assert.equal(isAnnouncedAsEndpoint(18, "First"), false, "no bound means no named endpoint");
    assert.equal(isAnnouncedAsEndpoint(20, "Last"), false, "no bound means no named endpoint");

    mount(rangeInput(undefined, undefined));
    openCalendarTrigger("Choose start date range");
    assert.equal(isDisabled(17), false, "`min` absent means no lower limit");
    assert.equal(isDisabled(26), false, "`max` absent means no upper limit");
  });
});

describe("ds date bounds — a bound the component cannot read refuses by name", () => {
  const unreadable: ReadonlyArray<readonly [string, string]> = [
    ["a non-date string", "not-a-date"],
    ["the empty string", ""],
    ["a partial ISO date", "2026-10"],
    ["unpadded ISO parts", "2026-1-2"],
    ["an ISO instant", "2026-10-10T00:00:00"],
    ["an out-of-range month", "2026-13-01"],
    ["an out-of-range day", "2026-02-30"],
  ];

  for (const [caseName, value] of unreadable) {
    it(`DateInput refuses ${caseName} as either bound`, () => {
      assert.match(refusalOf(dateInput(false, value, undefined)), BOUND_REFUSAL);
      assert.match(refusalOf(dateInput(false, undefined, value)), BOUND_REFUSAL);
    });

    it(`DateInput's text-entry form refuses ${caseName} as either bound`, () => {
      assert.match(refusalOf(dateInput(true, value, undefined)), BOUND_REFUSAL);
      assert.match(refusalOf(dateInput(true, undefined, value)), BOUND_REFUSAL);
    });

    it(`DateRangeInput refuses ${caseName} as either bound`, () => {
      assert.match(refusalOf(rangeInput(value, undefined)), BOUND_REFUSAL);
      assert.match(refusalOf(rangeInput(undefined, value)), BOUND_REFUSAL);
    });
  }

  it("names which bound was unreadable", () => {
    assert.equal(
      refusalOf(rangeInput("not-a-date", "2026-12-31")),
      'DS_DATE_BOUND_INVALID: min="not-a-date" is not a calendar date',
    );
    assert.equal(
      refusalOf(dateInput(false, undefined, "2026-99-99")),
      'DS_DATE_BOUND_INVALID: max="2026-99-99" is not a calendar date',
    );
  });

  it("refuses with the value it could not read, not a bare class name", () => {
    assert.equal(refusalOf(dateInput(false, "", undefined)), 'DS_DATE_BOUND_INVALID: min="" is not a calendar date');
  });

  it("keeps one readable bound working beside an unreadable one, so the refusal is the bound's own", () => {
    assert.match(refusalOf(dateInput(false, "2026-10-18", "not-a-date")), BOUND_REFUSAL);
  });
});

describe("ds date drafts — an unreadable draft stays editable instead of refusing", () => {
  const drafts: ReadonlyArray<readonly [string, string]> = [
    ["an empty value", ""],
    ["an incomplete text-entry value", "10/2/"],
    ["a value no calendar date parses", "not-a-date"],
  ];

  for (const [caseName, value] of drafts) {
    it(`DateInput keeps ${caseName} as a draft`, () => {
      mount(dateInput(false, undefined, undefined, value));
      const picker = document.body.querySelector<HTMLElement>('[data-slot="date-picker"]');
      assert.ok(picker, "no DateInput picker was drawn");
      assert.equal(picker.dataset.invalid, value === "" ? undefined : "true", "an unreadable non-empty draft is marked invalid");
    });

    it(`DateInput's text-entry form keeps ${caseName} as a draft`, () => {
      mount(dateInput(true, undefined, undefined, value));
      const input = document.body.querySelector<HTMLInputElement>("input");
      assert.ok(input, "no text-entry field was drawn");
      assert.equal(input.value, value, "the operator's own text is still in the field");
    });
  }

  it("a readable bound beside an unreadable draft does not refuse on the draft's account", () => {
    mount(dateInput(false, "2026-10-18", "2026-10-20", "not-a-date"));
    assert.equal(document.body.querySelector<HTMLElement>('[data-slot="date-picker"]')?.dataset.invalid, "true");
  });

  it("DateRangeInput keeps an unreadable endpoint as a draft and marks only that endpoint", () => {
    mount(rangeInput(undefined, undefined, { from: "not-a-date", to: "2026-10-20" }));
    const pickers = Array.from(document.body.querySelectorAll<HTMLElement>('[data-slot="date-picker"]'));
    assert.equal(pickers.length, 2, "both endpoints were drawn");
    assert.equal(pickers[0]?.dataset.invalid, "true", "the unreadable endpoint is marked invalid");
    assert.equal(pickers[1]?.dataset.invalid, undefined, "the readable endpoint is not");
  });

  it("DateRangeInput keeps an in-flight order (start after end) as a draft", () => {
    mount(rangeInput(undefined, undefined, { from: "2026-10-20", to: "2026-10-19" }));
    const pickers = Array.from(document.body.querySelectorAll<HTMLElement>('[data-slot="date-picker"]'));
    assert.equal(pickers[0]?.dataset.invalid, "true", "a reversed range is marked invalid");
    assert.equal(pickers[1]?.dataset.invalid, "true", "a reversed range is marked invalid");
  });

  it("a text-entry draft still publishes what the operator types", () => {
    const published: string[] = [];
    mount(createElement(DateInput, {
      label: "Effective date", value: "", textEntry: true, onChange: next => published.push(next),
    }));
    const input = document.body.querySelector<HTMLInputElement>("input");
    assert.ok(input, "no text-entry field was drawn");
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.bind(input);
    assert.ok(setValue, "no HTMLInputElement value setter");
    act(() => {
      setValue("10/2/2026");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.deepEqual(published, ["10/2/2026"]);
  });

  it("DateRangeInput still publishes a chosen range", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 15));
    onTestFinished(() => { vi.useRealTimers(); });
    const published: Array<{ from: string; to: string }> = [];
    mount(createElement(DateRangeInput, {
      label: "Report dates",
      value: { from: "", to: "" },
      onChange: next => published.push(next),
    }));
    openCalendarTrigger("Choose start date range");
    for (const day of [19, 20]) {
      act(() => {
        for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"] as const) {
          cell(day).dispatchEvent(new MouseEvent(type, { bubbles: true }));
        }
      });
    }
    assert.deepEqual(published, [{ from: "2026-10-19", to: "2026-10-20" }]);
  });
});

describe("ds date drafts — a year with fewer than four digits is held back", () => {
  it("holds the chosen value until the operator leaves the field", () => {
    const published: string[] = [];
    mount(createElement(DateInput, {
      label: "Effective date",
      value: "2026-10-19",
      onChange: next => published.push(next),
      footer: choose => createElement("button", { type: "button", onClick: () => choose("0999-05-06") }, "Pick partial year"),
    }));
    openCalendarTrigger("Choose effective date");
    const pick = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Pick partial year");
    assert.ok(pick, "the footer control was not drawn");
    act(() => { pick?.click(); });
    assert.deepEqual(published, [], "a year still being entered is not published");
    assert.equal(
      document.body.querySelector<HTMLElement>('[data-slot="date-input-group"]')?.textContent?.trim(),
      "05/06/999",
      "the held year stays in the field for the operator to finish",
    );
  });

  it("publishes a complete endpoint chosen from the footer", () => {
    const published: string[] = [];
    mount(createElement(DateInput, {
      label: "Effective date",
      value: "2026-10-19",
      onChange: next => published.push(next),
      footer: choose => createElement("button", { type: "button", onClick: () => choose("2026-10-20") }, "Pick endpoint"),
    }));
    openCalendarTrigger("Choose effective date");
    const pick = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Pick endpoint");
    assert.ok(pick, "the footer control was not drawn");
    act(() => { pick?.click(); });
    assert.deepEqual(published, ["2026-10-20"]);
  });
});
