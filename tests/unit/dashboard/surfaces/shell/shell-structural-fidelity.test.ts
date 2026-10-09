import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
const APP = readFileSync(new URL("../../../../../src/dashboard/app/dashboard-app.tsx", import.meta.url), "utf8");
const OVERLAY = readFileSync(new URL("../../../../../src/dashboard/ds/primitives/base-toast.tsx", import.meta.url), "utf8");

function sourceSlice(source: string, start: string, end: string, label: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `could not read ${label} from its source boundary`);
  return source.slice(from, to);
}

describe("DCF2 shell and queue structural fidelity", () => {

  it("A168/A169 — places the floor-bearing root outside both providers", () => {
    const rootStart = APP.indexOf("<div\n      data-app-root=\"\"");
    const tooltipStart = APP.indexOf("<TooltipProvider delayDuration={200}>", rootStart);
    const toastStart = APP.indexOf("<ToastProvider>", tooltipStart);
    const toastEnd = APP.indexOf("</ToastProvider>", toastStart);
    const tooltipEnd = APP.indexOf("</TooltipProvider>", toastEnd);
    const rootEnd = APP.indexOf("</div>", tooltipEnd);

    assert.ok(rootStart >= 0, "the app root must be a real outer DOM node");
    assert.ok(rootStart < tooltipStart && tooltipStart < toastStart, "providers must be descendants of the root");
    assert.ok(toastEnd < tooltipEnd && tooltipEnd < rootEnd, "the root must close after both providers");
    assert.match(
      APP.slice(rootStart, tooltipStart),
      /"--ds-toast-inset-bottom": "calc\(var\(--ds-h-bar\) \+ var\(--ds-space-loose\)\)"/u,
      "the outer root is the one place that sets the Session-bar toast floor",
    );
    assert.match(
      OVERLAY,
      /bottom-\[var\(--ds-toast-inset-bottom,16px\)\]/u,
      "the fixed toast viewport must consume the shell-owned floor",
    );
  });

  it("A170 / D340 — retains the desktop canvas floor and internal viewport clip", () => {
    const root = sourceSlice(APP, "<div\n      data-app-root=\"\"", ">\n    <TooltipProvider", "the app root opening tag");
    for (const token of ["h-screen", "min-h-[var(--ds-h-desktop-min)]", "min-w-[var(--ds-w-desktop-min)]", "overflow-hidden"]) {
      assert.ok(root.includes(token), `the desktop canvas must retain ${token}`);
    }
    assert.doesNotMatch(root, /min-h-0/u, "min-h-0 belongs to the root's flex child, not the demo root");
  });
});
