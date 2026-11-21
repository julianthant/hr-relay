import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { expect, it, vi } from "vitest";

interface Worker {
  install(): void;
  receive(message: { type: string }, sender: unknown): Promise<unknown>;
  next(): Promise<{ id: string; request: { requestId: string } } | null>;
  assertContext(id: string): Promise<void>;
  reply(id: string, result: unknown): Promise<void>;
  stop(): void;
}

const { createWorkflowWorker } = await vi.importActual<{ createWorkflowWorker(api: unknown): Worker }>(
  "../../../fast-duo/src/workflow-background.js");

function world(abortDeliveryFails: boolean) {
  const origin = "https://test.duosecurity.com";
  const sender = { id: "owned", url: `${origin}/login`, origin, tab: { id: 7 }, frameId: 0,
    documentId: "a".repeat(32), documentLifecycle: "active" };
  const pageListeners = new Map<string, (event: unknown) => Promise<void> | void>();
  let observe: ((message: unknown, sender: unknown, reply: (observation: unknown) => void) => void) | undefined;
  const posted = vi.fn();
  const worker = createWorkflowWorker({
    runtime: { id: sender.id },
    tabs: {
      get: async () => ({ id: sender.tab.id, url: sender.url }),
      sendMessage: async (_tab: number, message: unknown) => {
        let observation: unknown;
        observe?.(message, { id: sender.id }, value => { observation = value; });
        return observation;
      },
    },
    webNavigation: { getFrame: async () => sender },
  });
  worker.install();
  const scope = {
    location: { href: sender.url, origin }, document: { documentElement: {}, querySelectorAll: () => [] },
    DuoUsername: { findUsernames: () => ["alex"] }, MutationObserver: class { observe() {} }, setTimeout: vi.fn(),
    addEventListener: (type: string, listener: (event: unknown) => Promise<void> | void) => { pageListeners.set(type, listener); },
    postMessage: posted,
    chrome: { runtime: {
      id: sender.id,
      onMessage: { addListener: (listener: typeof observe) => { observe = listener; } },
      sendMessage: async (message: { type: string }) => {
        if (abortDeliveryFails && message.type === "DUO_WORKFLOW_ABORT") throw new Error("message channel closed");
        return worker.receive(message, sender).then(result => ({ success: true, result }));
      },
    } },
  };
  const context = createContext(scope);
  const window: unknown = runInContext("globalThis.window = globalThis", context);
  runInContext(readFileSync("fast-duo/src/workflow-content.js", "utf8"), context);
  const post = (data: unknown) => pageListeners.get("message")?.({ source: window, origin, data });
  const sign = (id: string) => post({ type: "DUO_WORKFLOW_REQUEST", id,
    request: { requestId: id, origin, rpId: "duosecurity.com", challenge: "AQID", allowCredentials: ["BAUG"] } });
  const abort = (id: string) => post({ type: "DUO_WORKFLOW_ABORT", id });
  return { worker, posted, sign, abort, hide: () => pageListeners.get("pagehide")?.({}) };
}

it.each(["explicit abort", "pagehide"])("revokes workflow requests when runtime delivery fails after %s", async action => {
  const w = world(true);
  try {
    const id = randomUUID();
    const completed = w.sign(id);
    const request = await w.worker.next();
    if (!request) throw new Error("Workflow request was never queued");
    if (action === "pagehide") await w.hide();
    else await w.abort(id);
    await expect(w.worker.assertContext(request.id)).rejects.toThrow();
    await expect(w.worker.reply(request.id, { ok: true, value: { passThrough: true } })).rejects.toThrow();
    await completed;
    expect(w.posted).toHaveBeenCalledExactlyOnceWith({ type: "DUO_WORKFLOW_RESPONSE", id, success: false }, expect.any(String));
  } finally {
    w.worker.stop();
  }
});

it("accepts another request after queued requests are aborted without a consumer", async () => {
  const w = world(false);
  try {
    for (let index = 0; index < 101; index++) {
      const id = randomUUID();
      const completed = w.sign(id);
      await new Promise<void>(resolve => setImmediate(resolve));
      await w.abort(id);
      await completed;
    }
    const id = randomUUID();
    const completed = w.sign(id);
    const request = await w.worker.next();
    if (!request) throw new Error("Workflow request was never queued");
    expect(request.request.requestId).toBe(id);
    await w.worker.reply(request.id, { ok: true, value: { passThrough: true } });
    await completed;
    expect(w.posted).toHaveBeenLastCalledWith({ type: "DUO_WORKFLOW_RESPONSE", id, success: true,
      result: { passThrough: true } }, expect.any(String));
  } finally {
    w.worker.stop();
  }
});
