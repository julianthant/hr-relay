// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import { TooltipProvider } from "../../../../../src/dashboard/ds/ui.js";
import { ClickLine } from "../../../../../src/dashboard/surfaces/shared/steps/click-line.js";
import { FieldRow, FieldRows } from "../../../../../src/dashboard/surfaces/shared/steps/field-row.js";
import { PageCard, ResultLine } from "../../../../../src/dashboard/surfaces/shared/steps/page-card.js";
import { StepFrame } from "../../../../../src/dashboard/surfaces/shared/steps/step-frame.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
class ResizeObserverStub { observe() {} disconnect() {} unobserve() {} }
Reflect.set(globalThis, "ResizeObserver", ResizeObserverStub);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });
const render = async (node: Parameters<Root["render"]>[0]) => { const host = document.body.appendChild(document.createElement("div")); root = createRoot(host); await act(async () => root?.render(createElement(TooltipProvider, null, node))); return host; };

it("draws a step with its frame, page card, fill and read rows, result and click line from plain values", async () => {
  const rows = createElement(FieldRows, { padded: true, children: [
    createElement(FieldRow, { key: "fill", kind: "fill", label: "Document number", value: "SIM-48216" }),
    createElement(FieldRow, { key: "read", kind: "read", label: "Matching action", value: "Found" })] });
  const card = createElement(PageCard, { key: "card", title: "Action List", mode: "Fill", children: [rows, createElement(ResultLine, { key: "result", value: "Verified" })] });
  const host = await render(createElement(StepFrame, { leading: "09:31:00", title: "Find the Kuali action", system: "Kuali", titleId: "s1",
    children: [card, createElement(ClickLine, { key: "click", label: "Go" })] }));
  assert.equal(host.querySelector("h3")?.textContent, "Find the Kuali action");
  assert.match(host.textContent ?? "", /Kuali/u);
  assert.equal(host.querySelector('[data-log-field="fill"] dd')?.textContent, "SIM-48216");
  assert.equal(host.querySelector('[data-log-field="read"] dt')?.textContent, "Matching action");
  assert.match(host.textContent ?? "", /Fill.*Read result.*Verified.*Go/su);
});
