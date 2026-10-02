// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import { RankedList, type DsRankedItem } from "../../../../../src/dashboard/ds/primitives-data.js";
import { Checkbox, RadioGroup, SecretField } from "../../../../../src/dashboard/ds/primitives-form.js";
import { Disclosure, DsBodyScope } from "../../../../../src/dashboard/ds/primitives-layout.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  document.body.replaceChildren();
});

function mount(element: ReturnType<typeof createElement>): void {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(element));
}

function SecretHarness() {
  const [secret, setSecret] = useState({ identity: "primary", value: "secret-primary" });
  return createElement(DsBodyScope, null,
    createElement(SecretField, {
      identity: secret.identity,
      label: "Provider key",
      value: secret.value,
      onChange: (event) => setSecret((current) => ({ ...current, value: event.currentTarget.value })),
      onRemove: () => undefined,
      disabled: false,
    }),
    createElement("button", {
      type: "button",
      onClick: () => setSecret({ identity: "fallback", value: "secret-fallback" }),
    }, "Change identity"),
    createElement("button", {
      type: "button",
      onClick: () => setSecret((current) => ({ ...current, value: "secret-rotated" })),
    }, "Change value"),
  );
}

function currentSecret(): HTMLInputElement {
  const field = host?.querySelector<HTMLInputElement>("input");
  assert.ok(field);
  return field;
}

function revealButton(): HTMLButtonElement {
  const button = host?.querySelector<HTMLButtonElement>('button[aria-label="Show Provider key"]');
  assert.ok(button);
  return button;
}

function handleNamed(name: string): HTMLButtonElement {
  const button = [...(host?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
    .find((entry) => entry.getAttribute("aria-label")?.startsWith(`Move ${name}.`));
  assert.ok(button, `missing handle for ${name}`);
  return button;
}

function listOrder(): string[] {
  return [...(host?.querySelectorAll<HTMLElement>(".ds-ranked-item") ?? [])]
    .map((item) => item.querySelector(".ds-ranked-label")?.textContent ?? "");
}

const DATA_TRANSFER = () => ({
  effectAllowed: "none",
  data: "",
  setData(_format: string, value: string) { this.data = value; },
  getData() { return this.data; },
});

function dragEvent(type: string, dataTransfer: ReturnType<typeof DATA_TRANSFER>, clientY: number): Event {
  return Object.assign(new Event(type, { bubbles: true, cancelable: true }), { dataTransfer, clientY });
}

function RankedHarness({ disabled = false }: { disabled?: boolean }) {
  const [items, setItems] = useState<DsRankedItem[]>([
    { id: "a", label: "A", role: "Primary" },
    { id: "b", label: "B", role: "Fallback" },
    { id: "c", label: "C", role: "Fallback" },
  ]);
  return createElement(DsBodyScope, null,
    createElement(RankedList, { label: "Provider priority", items, onReorder: setItems, disabled }),
  );
}

function DisclosureHarness() {
  const [open, setOpen] = useState(false);
  return createElement(DsBodyScope, null,
    createElement(Disclosure, {
      summary: "Fallback keys",
      description: "Secondary connections",
      meta: "1",
      variant: "body",
      open,
      onOpenChange: setOpen,
      children: createElement("div", null, "Backup key"),
    }),
  );
}

function RadioHarness() {
  const [mode, setMode] = useState("dry");
  return createElement(DsBodyScope, null,
    createElement(RadioGroup, {
      label: "Run mode",
      name: "test-run-mode",
      value: mode,
      onValueChange: setMode,
      options: [
        { value: "dry", label: "Dry run", description: "No transaction" },
        { value: "live", label: "Live", description: "Submit transaction" },
        { value: "locked", label: "Locked", disabled: true },
      ],
    }),
  );
}

function CheckboxHarness() {
  const [checked, setChecked] = useState<boolean | "indeterminate">("indeterminate");
  return createElement(DsBodyScope, null,
    createElement(Checkbox, {
      label: "Select all rows",
      description: "Only some are checked",
      checked,
      onCheckedChange: setChecked,
    }),
    createElement(Checkbox, {
      label: "Unavailable choice",
      checked: false,
      disabled: true,
    }),
  );
}

describe("shared body interactions", () => {
  it("keeps checkbox naming and advances indeterminate selection by its label", async () => {
    mount(createElement(CheckboxHarness));
    const boxes = [...(host?.querySelectorAll<HTMLButtonElement>('.ds-checkbox-control[role="checkbox"]') ?? [])];
    assert.equal(boxes.length, 2);
    assert.equal(boxes[0]?.getAttribute("aria-checked"), "mixed");
    assert.equal(boxes[0]?.getAttribute("aria-labelledby"), host?.querySelector(".ds-checkbox-label")?.id);
    const label = host?.querySelector<HTMLLabelElement>(".ds-checkbox-copy");
    assert.ok(label);
    await act(async () => label.click());
    assert.equal(boxes[0]?.getAttribute("aria-checked"), "true");
    assert.equal(boxes[1]?.disabled, true);
    assert.equal(boxes[1]?.getAttribute("aria-checked"), "false");
  });

  it("selects a radio by its label, follows arrow keys and ignores disabled options", async () => {
    mount(createElement(RadioHarness));
    const inputs = [...(host?.querySelectorAll<HTMLInputElement>('.ds-radio-option input[type="radio"]') ?? [])];
    assert.equal(inputs.length, 3);
    assert.equal(inputs[0]?.checked, true);
    assert.equal(inputs[2]?.disabled, true);
    const liveLabel = host?.querySelectorAll<HTMLElement>(".ds-radio-copy")[1];
    assert.ok(liveLabel);
    await act(async () => liveLabel.click());
    assert.equal(inputs[1]?.checked, true);
    await act(async () => inputs[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    assert.equal(inputs[0]?.checked, true);
    const lockedLabel = host?.querySelectorAll<HTMLElement>(".ds-radio-copy")[2];
    assert.ok(lockedLabel);
    await act(async () => lockedLabel.click());
    assert.equal(inputs[0]?.checked, true);
  });

  it("opens and closes a controlled body disclosure with its detail", async () => {
    mount(createElement(DisclosureHarness));
    const trigger = host?.querySelector<HTMLButtonElement>(".ds-disclosure-trigger");
    assert.ok(trigger);
    assert.equal(trigger.getAttribute("data-state"), "closed");
    await act(async () => trigger.click());
    assert.equal(trigger.getAttribute("data-state"), "open");
    assert.match(host?.textContent ?? "", /Backup key/u);
    await act(async () => trigger.click());
    assert.equal(trigger.getAttribute("data-state"), "closed");
  });

  it("hides a revealed value as soon as its identity or externally supplied value changes", async () => {
    mount(createElement(SecretHarness));
    await act(async () => revealButton().click());
    assert.equal(currentSecret().type, "text");
    const changeIdentity = [...(host?.querySelectorAll("button") ?? [])].find((button) => button.textContent === "Change identity");
    assert.ok(changeIdentity);
    await act(async () => changeIdentity.click());
    assert.equal(currentSecret().value, "secret-fallback");
    assert.equal(currentSecret().type, "password");

    await act(async () => revealButton().click());
    const changeValue = [...(host?.querySelectorAll("button") ?? [])].find((button) => button.textContent === "Change value");
    assert.ok(changeValue);
    await act(async () => changeValue.click());
    assert.equal(currentSecret().value, "secret-rotated");
    assert.equal(currentSecret().type, "password");
  });

  it("moves ranked entries by keyboard and drag to adjacent and final positions", async () => {
    mount(createElement(RankedHarness));
    await act(async () => {
      handleNamed("A").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    assert.deepEqual(listOrder(), ["B", "A", "C"]);

    const transfer = DATA_TRANSFER();
    const source = handleNamed("B");
    const adjacentTarget = host?.querySelectorAll<HTMLElement>(".ds-ranked-item")[1];
    assert.ok(adjacentTarget);
    adjacentTarget.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, right: 100, bottom: 40, left: 0, width: 100, height: 40, toJSON: () => ({}) });
    await act(async () => source.dispatchEvent(dragEvent("dragstart", transfer, 0)));
    await act(async () => adjacentTarget.dispatchEvent(dragEvent("dragover", transfer, 35)));
    await act(async () => adjacentTarget.dispatchEvent(dragEvent("drop", transfer, 35)));
    assert.deepEqual(listOrder(), ["A", "B", "C"]);

    const lastTarget = host?.querySelectorAll<HTMLElement>(".ds-ranked-item")[2];
    assert.ok(lastTarget);
    lastTarget.getBoundingClientRect = () => ({ x: 0, y: 80, top: 80, right: 100, bottom: 120, left: 0, width: 100, height: 40, toJSON: () => ({}) });
    const lastTransfer = DATA_TRANSFER();
    await act(async () => handleNamed("A").dispatchEvent(dragEvent("dragstart", lastTransfer, 0)));
    await act(async () => lastTarget.dispatchEvent(dragEvent("dragover", lastTransfer, 115)));
    await act(async () => lastTarget.dispatchEvent(dragEvent("drop", lastTransfer, 115)));
    assert.deepEqual(listOrder(), ["B", "C", "A"]);
  });

  it("keeps the ranking readable while its handles are disabled", async () => {
    mount(createElement(RankedHarness, { disabled: true }));
    const handle = handleNamed("A");
    assert.equal(handle.disabled, true);
    assert.equal(host?.querySelector("ol")?.getAttribute("aria-disabled"), "true");
    await act(async () => handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    assert.deepEqual(listOrder(), ["A", "B", "C"]);

    const transfer = DATA_TRANSFER();
    const start = dragEvent("dragstart", transfer, 0);
    await act(async () => handle.dispatchEvent(start));
    assert.equal(start.defaultPrevented, true);
    const lastTarget = host?.querySelectorAll<HTMLElement>(".ds-ranked-item")[2];
    assert.ok(lastTarget);
    await act(async () => lastTarget.dispatchEvent(dragEvent("drop", transfer, 40)));
    assert.deepEqual(listOrder(), ["A", "B", "C"]);
  });
});
