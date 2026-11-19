// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { Button, Chip, IconButton, Kbd } from "../../../../src/dashboard/ds/primitives/primitives-core.js";
import { Input, SearchInput, SecretField } from "../../../../src/dashboard/ds/primitives/primitives-form.js";
import { NavRow } from "../../../../src/dashboard/ds/primitives/nav-row.js";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from "../../../../src/dashboard/ds/primitives/primitives-overlay.js";
import { DS_STATUS, StatusPill } from "../../../../src/dashboard/ds/primitives/primitives-status.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

describe("Button and IconButton", () => {
  it("offers 28px and 32px with the 8px corner and no movement on press", () => {
    const md = html(createElement(Button, null, "Save"));
    const lg = html(createElement(Button, { size: "lg" }, "Save"));
    assert.match(md, /h-\[var\(--ds-h-md\)\]/u);
    assert.match(lg, /h-\[var\(--ds-h-lg\)\]/u);
    assert.match(lg, /rounded-\[8px\]/u);
    assert.doesNotMatch(md + lg, /translate-y/u);
    assert.match(md, /active:bg-/u);
  });

  it("draws icon controls at 28px/8px and 24px/6px with a darker press tint", () => {
    const icon = createElement("svg");
    const md = html(createElement(IconButton, { label: "Close", icon }));
    const sm = html(createElement(IconButton, { label: "Close", icon, size: "sm" }));
    assert.match(md, /size-\[var\(--ds-h-md\)\]/u);
    assert.match(md, /rounded-\[8px\]/u);
    assert.match(sm, /rounded-\[6px\]/u);
    assert.match(md, /aria-label="Close"/u);
    assert.match(md, /active:bg-/u);
    assert.doesNotMatch(md + sm, /translate-y/u);
  });
});

describe("Input, SecretField and SearchInput", () => {
  it("sizes Input at 28px or 32px", () => {
    assert.match(html(createElement(Input, { "aria-label": "Name" })), /h-\[var\(--ds-h-md\)\]/u);
    assert.match(html(createElement(Input, { "aria-label": "Name", size: "lg" })), /h-\[var\(--ds-h-lg\)\]/u);
  });

  it("reveals a secret with the eye icon button and keeps the 32px size", () => {
    const out = html(createElement(SecretField, { label: "Password", size: "lg" }));
    assert.match(out, /<button[^>]*aria-label="Show Password"/u);
    assert.match(out, /type="password"/u);
    assert.match(out, /h-\[var\(--ds-h-lg\)\]/u);
    assert.doesNotMatch(out, />Show</u);
  });

  it("marks only the sidebar search as the filled pill", () => {
    assert.match(html(createElement(SearchInput, { variant: "sidebar", "aria-label": "Find" })), /ds-search-field--sidebar/u);
    assert.doesNotMatch(html(createElement(SearchInput, { "aria-label": "Find" })), /ds-search-field--sidebar/u);
  });
});

describe("Chip, Kbd, NavRow and StatusPill", () => {
  it("names a chip's remove button after its text", () => {
    const out = html(createElement(Chip, { onRemove: () => undefined }, "UCPath"));
    assert.match(out, /aria-label="Remove UCPath"/u);
  });

  it("draws a keycap with a border and a corner under the pill radius", () => {
    const out = html(createElement(Kbd, null, "⌘J"));
    assert.match(out, /border/u);
    assert.doesNotMatch(out, /rounded-full/u);
  });

  it("renders NavRow as a 32px button or a link and marks the selected row", () => {
    const button = html(createElement(NavRow, { label: "General", icon: createElement("i"), trailing: "2", selected: true }));
    assert.match(button, /^<button[^>]*aria-current="page"/u);
    assert.match(button, /h-8/u);
    assert.match(button, />General</u);
    assert.match(button, />2</u);
    const link = html(createElement(NavRow, { label: "Account", href: "?settings=account" }));
    assert.match(link, /^<a[^>]*href="\?settings=account"/u);
    assert.doesNotMatch(link, /aria-current/u);
  });

  it("tints the cancelled pill neutral instead of filling it", () => {
    assert.equal(DS_STATUS.cancelled.tier, "tinted");
    const out = html(createElement(StatusPill, { status: "cancelled" }));
    assert.match(out, /--ds-status-cancelled-bg/u);
    assert.doesNotMatch(out, /cancelled-solid/u);
  });
});

describe("Dialog and ConfirmDialog", () => {
  async function mount(node: ReturnType<typeof createElement>) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(node));
    return async () => { await act(async () => root.unmount()); host.remove(); };
  }
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

  it("sizes sm 400, md 560, lg 880 and always shows a close X", async () => {
    for (const [size, width] of [["sm", 400], ["md", 560], ["lg", 880]] as const) {
      const unmount = await mount(createElement(Dialog, { open: true },
        createElement(DialogContent, { size, title: "Title", hideClose: true }, createElement(DialogFooter, null, "x"))));
      const surface = dialog();
      assert.ok(surface, size);
      assert.ok(surface.className.includes(`max-w-[${width}px]`), `${size}: ${surface.className}`);
      assert.ok(surface.querySelector('button[aria-label="Close"]'), `${size} has no close X`);
      assert.match(surface.querySelector("h2")?.className ?? "", /font-medium/u);
      await unmount();
    }
  });

  it("gives lg the Start run header and footer measures", async () => {
    const unmount = await mount(createElement(Dialog, { open: true },
      createElement(DialogContent, { size: "lg", title: "Start run" }, createElement(DialogFooter, null, "x"))));
    const surface = dialog();
    assert.ok(surface);
    assert.equal(surface.getAttribute("data-band"), "true");
    assert.match(surface.querySelector("header")?.className ?? "", /group-data-\[size=lg\]\/dialog:h-\[73px\]/u);
    assert.match(surface.querySelector("footer")?.className ?? "", /group-data-\[size=lg\]\/dialog:h-\[57px\]/u);
    await unmount();
  });

  it("asks a plain question, focuses Cancel first and names the red button for the action", async () => {
    let confirmed = 0;
    function Harness() {
      const [open, setOpen] = useState(true);
      return createElement(ConfirmDialog, {
        open, onOpenChange: setOpen, destructive: true, title: "Delete this run?",
        description: "Its log is removed.", confirmLabel: "Delete run", onConfirm: () => { confirmed += 1; },
      });
    }
    const unmount = await mount(createElement(Harness));
    const surface = dialog();
    assert.ok(surface);
    assert.match(surface.className, /max-w-\[400px\]/u);
    assert.equal(surface.querySelector("h2")?.textContent, "Delete this run?");
    assert.equal(surface.querySelector("p")?.textContent, "Its log is removed.");
    assert.ok(surface.querySelector('button[aria-label="Close"]'));
    const buttons = [...surface.querySelectorAll<HTMLButtonElement>("footer button")];
    assert.deepEqual(buttons.map(button => button.textContent), ["Cancel", "Delete run"]);
    assert.equal(document.activeElement, buttons[0]);
    assert.match(buttons[1]!.className, /--ds-danger/u);
    assert.doesNotMatch(buttons[0]!.className, /--ds-danger/u);
    await act(async () => buttons[1]!.click());
    assert.equal(confirmed, 1);
    await unmount();
  });
});
