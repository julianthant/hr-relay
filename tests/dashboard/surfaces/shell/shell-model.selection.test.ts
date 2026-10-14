// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { useSelectedWorkflow } from "../../../../src/dashboard/surfaces/shell/shell-model.js";

it("clears an unavailable selection on catalog replacement without selecting a substitute", async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const seen: ReturnType<typeof useSelectedWorkflow>[] = [];
  function Probe({ workflows }: { workflows: readonly { id: string }[] }) { seen.push(useSelectedWorkflow(workflows)); return null; }
  const root = createRoot(document.createElement("div"));
  const render = async (ids: string[]) => { await act(async () => root.render(createElement(Probe, { workflows: ids.map(id => ({ id })) }))); };
  try {
    await render(["a", "b"]);
    const preference = localStorage.getItem("hr-dashboard.selected-workflow");
    assert.equal(seen.at(-1)?.canSelectWorkflowId("b"), true);
    assert.equal(seen.at(-1)?.canSelectWorkflowId("missing"), false);
    assert.equal(localStorage.getItem("hr-dashboard.selected-workflow"), preference);
    assert.equal(seen.at(-1)?.selectedWorkflowId, "a");
    await act(async () => seen.at(-1)?.setSelectedWorkflowId("b"));
    const start = seen.length;
    await render(["a"]);
    assert.ok(seen.slice(start).every(value => value.selectedWorkflowId === ""));
    assert.equal(localStorage.getItem("hr-dashboard.selected-workflow"), "");
    await render(["a", "b"]);
    assert.equal(seen.at(-1)?.selectedWorkflowId, "");
    assert.equal(seen.at(-1)?.canSelectWorkflowId("b"), true);
    assert.equal(seen.at(-1)?.canSelectWorkflowId("missing"), false);
    assert.equal(seen.at(-1)?.setSelectedWorkflowId("missing"), false);
    assert.equal(seen.at(-1)?.selectedWorkflowId, "");
  } finally { await act(async () => root.unmount()); localStorage.clear(); }
});
