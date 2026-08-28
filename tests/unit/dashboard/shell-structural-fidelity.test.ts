/**
 * DCF2 — the five shell-fidelity rows need guards that can actually go red.
 *
 * A81/A82 are exact legacy spacing, while A168–A170 are a single containment
 * contract: `ToastProvider` renders the fixed viewport as a sibling of its
 * children, so the root that supplies its floor must contain the provider.
 * These are source-level assertions on purpose. The affected components have
 * no independently renderable public seam, and a markup-only render cannot
 * create a toast from the provider's state. The browser proof measures the
 * resulting rectangles; this unit test keeps a local class or nesting edit
 * from silently severing that proof between browser runs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

const SHELL = readFileSync(new URL("../../../src/dashboard/surfaces/shell.tsx", import.meta.url), "utf8");
const APP = readFileSync(new URL("../../../src/dashboard/app/dashboard-app.tsx", import.meta.url), "utf8");
const OVERLAY = readFileSync(new URL("../../../src/dashboard/ds/primitives-overlay.tsx", import.meta.url), "utf8");

function sourceSlice(source: string, start: string, end: string, label: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `could not read ${label} from its source boundary`);
  return source.slice(from, to);
}

function classTokensFor(source: string, label: string): ReadonlySet<string> {
  const match = /<span className="([^"]+)">\s*<span className=\{cn\(dsText\.ui, "truncate", labelWeight\)\}>\{workflow\.label\}<\/span>/u.exec(source);
  assert.ok(match !== null, `could not read ${label}'s class tokens`);
  return new Set(match[1].split(/\s+/u));
}

describe("DCF2 shell and queue structural fidelity", () => {
  const workflowEntry = sourceSlice(SHELL, "function WorkflowEntryList", "function WorkflowPanelHeader", "WorkflowEntryList");

  it("A81 — gives the one-child workflow label no invented gap", () => {
    const tokens = classTokensFor(workflowEntry, "workflow label wrapper");
    for (const token of ["flex", "min-w-0", "flex-1", "items-center"]) {
      assert.ok(tokens.has(token), `the workflow label wrapper must retain ${token}`);
    }
    assert.equal(
      [...tokens].some((token) => token.startsWith("gap-")),
      false,
      "a gap on a one-child label wrapper is unrecorded rail spacing",
    );
  });

  it("A82 — lets the row gap, rather than a second left pad, separate label and count", () => {
    const countCluster = sourceSlice(
      workflowEntry,
      "title={`${workflow.label}: ${active} active",
      "</span>\n      </button>",
      "the workflow count cluster",
    );
    assert.match(countCluster, /gap-\[var\(--ds-space-hair\)\]/u);
    assert.doesNotMatch(
      countCluster,
      /pl-\[var\(--ds-space-base\)\]/u,
      "the row's gap-base is the only label/count separation",
    );
  });

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
      /bottom-\[var\(--ds-toast-inset-bottom,var\(--ds-space-loose\)\)\]/u,
      "the fixed toast viewport must consume the shell-owned floor",
    );
  });

  it("A170 — restores the demo root's horizontal shrink and viewport clip without re-adding min-h", () => {
    const root = sourceSlice(APP, "<div\n      data-app-root=\"\"", ">\n    <TooltipProvider", "the app root opening tag");
    assert.match(root, /flex h-screen min-w-0 flex-col overflow-hidden/u);
    assert.doesNotMatch(root, /min-h-0/u, "min-h-0 belongs to the root's flex child, not the demo root");
  });
});
