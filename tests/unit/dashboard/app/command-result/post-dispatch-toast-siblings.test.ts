// @vitest-environment jsdom
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, vi } from "vitest";
import { useSessionPreviewCommands, type SessionPreviewCommandPort, type SessionPreviewRequest } from "../../../../../src/dashboard/surfaces/sessions/session-preview-command-model.js";
import { sessionsSample } from "../../../../../src/dashboard/surfaces/sessions/sessions-fixture.js";
import { commandFailureToast } from "../../../../../src/dashboard/app/commands/command-result.js";

const DASHBOARD_APP = resolve(import.meta.dirname, "../../../../../src/dashboard/app/dashboard-app.tsx");

function sliceBetween(source: string, openMarker: string, closeMarker: string, label: string): string {
  const opens = source.indexOf(openMarker);
  if (opens === -1) {
    throw new Error(`${label}: dashboard-app.tsx no longer contains the opening landmark ${JSON.stringify(openMarker)}`);
  }
  const closes = source.indexOf(closeMarker, opens);
  if (closes === -1) {
    throw new Error(`${label}: dashboard-app.tsx no longer contains the closing landmark ${JSON.stringify(closeMarker)}`);
  }
  return source.slice(opens, closes);
}

function bulkDispatchRejectionArm(): string {
  const source = readFileSync(DASHBOARD_APP, "utf8");
  return sliceBetween(
    source,
    "const dispatchBulk = useCallback(",
    "const runAction = useCallback(",
    "dispatchBulk",
  );
}

function stopWorkerRejectionArm(): string {
  const source = readFileSync(resolve(import.meta.dirname, "../../../../../src/dashboard/surfaces/sessions/session-preview-command-model.ts"), "utf8");
  return sliceBetween(source, "const perform = useCallback(", "const keepAlive = useIdleSessionRefresh(", "session control");
}

describe("dispatchBulk's rejection arm (the selection band's bulk post)", () => {
  it("no longer claims Nothing was recorded from a post-dispatch throw", () => {
    const arm = bulkDispatchRejectionArm();
    assert.doesNotMatch(
      arm,
      /\(caught: unknown\) => \{\s*toast\(\{\s*tone: "danger",\s*title: "Nothing was recorded"/u,
      "the rejection handler still hardcodes the negative this client is not entitled to make",
    );
    assert.match(
      arm,
      /\(caught: unknown\) => \{[\s\S]*?commandFailureToast\(\{\s*stage: "after-dispatch",\s*caught\s*\}\)/u,
      "the rejection handler must settle through the same honest fold dispatchCommand uses",
    );
  });

  it("— driven, the honest fold titles it Result unknown, never Nothing was recorded", () => {
    const recorded: { tone: string; title: string; description: string }[] = [];
    const toast = (input: { tone: string; title: string; description: string }): string => {
      recorded.push(input);
      return "toast-id";
    };
    const onRejected = (caught: unknown): void => {
      toast(commandFailureToast({ stage: "after-dispatch", caught }));
    };
    return Promise.reject(new Error("the bulk POST never reached the BFF"))
      .then(undefined, onRejected)
      .then(() => {
        assert.equal(recorded.length, 1);
        const [only] = recorded;
        assert.equal(only?.title, "Result unknown — check the run");
        assert.notEqual(only?.title, "Nothing was recorded");
        assert.ok(only?.description.includes("the bulk POST never reached the BFF"));
      });
  });
});

describe("Session Panel Stop's rejection arm", () => {
  it("retains uncertainty instead of claiming Nothing was recorded from a post-dispatch throw", () => {
    const arm = stopWorkerRejectionArm();
    assert.match(arm, /port\.send\(request\)/u);
    assert.match(arm, /catch \{ result = \{ id: request\.id, state: 'uncertain', message: 'Response unavailable\. Check this command before another action\.'/u);
    assert.match(arm, /retain\(\{ request, state: result\.state,/u);
    assert.doesNotMatch(arm, /Nothing was recorded/u);
  });

  it("keeps a rejected Stop unknown, blocks resubmission, and checks the same command", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const sent: SessionPreviewRequest[] = [], checked: SessionPreviewRequest[] = [];
    const port: SessionPreviewCommandPort = {
      send: async request => { sent.push(request); throw new Error("Stop response unavailable"); },
      check: async request => { checked.push(request); return { id: request.id, state: "confirmed" }; },
    };
    const initial = sessionsSample("active"), catalog: never[] = [];
    assert.equal(initial.state, "ready");
    if (initial.state !== "ready") throw new Error("expected active workers");
    const worker = initial.workers.find(entry => entry.state === "running");
    assert.ok(worker);
    let commands: ReturnType<typeof useSessionPreviewCommands> | undefined;
    function Harness() { commands = useSessionPreviewCommands(initial, catalog, port); return null; }
    const host = document.createElement("div"), root = createRoot(host);
    try {
      await act(async () => root.render(createElement(Harness)));
      assert.ok(commands);
      await act(async () => commands!.control(worker.id, "stop"));
      const operation = commands.operations[worker.id];
      assert.equal(sent.length, 1);
      assert.equal(operation.state, "uncertain");
      assert.equal(operation.message, "Response unavailable. Check this command before another action.");
      assert.doesNotMatch(operation.message, /Nothing was recorded/u);
      assert.deepEqual(commands.data, initial);
      await act(async () => commands!.control(worker.id, "stop"));
      assert.equal(sent.length, 1);
      await act(async () => commands!.check(worker.id));
      assert.deepEqual(checked, sent);
      assert.equal(commands.operations[worker.id].state, "confirmed");
      assert.equal(commands.data.state, "ready");
      if (commands.data.state !== "ready") throw new Error("expected workers after readback");
      assert.equal(commands.data.workers.find(entry => entry.id === worker.id)?.state, "idle");
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });
});
