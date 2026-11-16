import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { describe, it } from "vitest";

interface Request { id: string; request: Record<string, unknown> }
interface WorkflowWorker {
  install(): void;
  receive(message: unknown, sender: unknown): Promise<Record<string, unknown>>;
  next(): Promise<Request | null>;
  assertContext(id: string): Promise<void>;
  reply(id: string, result: unknown): Promise<void>;
  stop(): void;
}
const { createWorkflowWorker } = await import(pathToFileURL(resolve("fast-duo/src/workflow-background.js")).href) as {
  createWorkflowWorker(this: void, api: unknown): WorkflowWorker;
};
const origin = "https://test.duosecurity.com";
const sender = { id: "owned", url: `${origin}/login`, origin, tab: { id: 7 }, frameId: 0,
  documentId: "a".repeat(32), documentLifecycle: "active" };
const sign = () => ({ type: "DUO_AUTOPILOT_SIGN", request: { requestId: randomUUID(), rpId: "duosecurity.com", origin,
  challenge: "AQID", allowCredentials: ["BAUG"] } });
function world() {
  const observation = { url: sender.url, origin, documentActive: true, accountRevision: 0, accountNames: ["alex"] };
  const nativeFrame = { url: sender.url, documentId: sender.documentId, documentLifecycle: "active" };
  let topUrl = sender.url;
  let afterObservation: (() => void) | undefined;
  const worker = createWorkflowWorker({ runtime: { id: "owned" },
    get storage() { throw new Error("Workflow must never touch storage"); },
    tabs: { get: async () => ({ id: 7, url: topUrl }), sendMessage: async () => { const value = structuredClone(observation); afterObservation?.(); return value; } },
    webNavigation: { getFrame: async () => ({ ...nativeFrame }) },
  });
  return { worker, observation, nativeFrame, top: (url: string) => { topUrl = url; },
    onObservation: (change: () => void) => { afterObservation = change; } };
}

describe("credential-free workflow broker", () => {
  it("installs without storage and forwards only public ceremony data, selecting no browser credential", async () => {
    const w = world(); w.worker.install();
    const message = sign();
    const result = w.worker.receive(message, sender);
    const request = await w.worker.next(); assert.ok(request);
    assert.deepEqual(request.request, { ...message.request, accountNames: ["alex"] });
    assert.equal(/credentialId|privateKey|signCount|highWater/.test(JSON.stringify(request)), false);
    await w.worker.reply(request.id, { ok: true, value: { ok: true, signature: "public-assertion" } });
    assert.deepEqual(await result, { ok: true, signature: "public-assertion" });
    w.worker.stop();
  });

  it("refuses unavailable, foreign, inactive or malformed senders and enrollment", async () => {
    const w = world(); await assert.rejects(w.worker.receive(sign(), sender)); w.worker.install();
    for (const changed of [{ id: "foreign" }, { url: "https://evil.invalid/" }, { url: "https://test.duosecurity.com:444/login" },
      { frameId: -1 }, { documentLifecycle: "cached" }, { documentId: "short" }, { tab: { id: -1 } }]) {
      await assert.rejects(w.worker.receive(sign(), { ...sender, ...changed }));
    }
    await assert.rejects(w.worker.receive({ type: "DUO_AUTOPILOT_ENROLL" }, sender));
    await assert.rejects(w.worker.receive({ ...sign(), request: { ...sign().request, origin: "https://evil.invalid" } }, sender));
    assert.throws(() => w.worker.install(), /ALREADY_INSTALLED/u); w.worker.stop();
  });

  it("preserves the complete stable account snapshot independently of page-supplied usernames", async () => {
    for (const names of [["invalid name"]]) {
      const w = world(); w.worker.install(); w.observation.accountNames = names;
      await assert.rejects(w.worker.receive(sign(), sender)); w.worker.stop();
    }
    const w = world(); w.worker.install();
    const result = w.worker.receive({ ...sign(), usernames: ["forged"] }, sender);
    const request = await w.worker.next(); assert.ok(request);
    assert.deepEqual(request.request.accountNames, ["alex"]);
    await w.worker.reply(request.id, { ok: true, value: { passThrough: true } });
    assert.deepEqual(await result, { passThrough: true }); w.worker.stop();
  });

  it("rejects final document, URL, lifecycle, account and account-revision drift", async () => {
    for (const mutate of [(w: ReturnType<typeof world>) => { w.observation.accountNames = ["other"]; },
      (w: ReturnType<typeof world>) => { w.observation.accountNames = ["alex", "alex@ucsd.edu"]; },
      (w: ReturnType<typeof world>) => { w.observation.accountRevision++; },
      (w: ReturnType<typeof world>) => { w.nativeFrame.documentId = "b".repeat(32); },
      (w: ReturnType<typeof world>) => { w.nativeFrame.documentLifecycle = "cached"; },
      (w: ReturnType<typeof world>) => { w.top(`${origin}/changed`); },
      (w: ReturnType<typeof world>) => { w.observation.documentActive = false; }]) {
      const w = world(); w.worker.install();
      const result = w.worker.receive(sign(), sender); const rejected = assert.rejects(result);
      const request = await w.worker.next(); assert.ok(request); mutate(w);
      await assert.rejects(w.worker.reply(request.id, { ok: true, value: { signature: "late" } }));
      await rejected; w.worker.stop();
    }
  });

  it("drains pending requests and rejects cancellations and late replies without storage cleanup", async () => {
    const w = world(); w.worker.install(); const message = sign();
    const result = w.worker.receive(message, sender); const rejected = assert.rejects(result);
    const request = await w.worker.next(); assert.ok(request);
    await w.worker.receive({ type: "DUO_WORKFLOW_ABORT", requestId: message.request.requestId }, sender);
    await rejected;
    await assert.rejects(w.worker.reply(request.id, { ok: true, value: { signature: "late" } }));
    const next = w.worker.next(); w.worker.stop(); assert.equal(await next, null);
    await assert.rejects(w.worker.receive(sign(), sender));
  });

  it("supports a legitimate Duo child frame without treating the parent URL as its origin", async () => {
    const w = world(); w.worker.install(); w.top("https://sso.example.invalid/login");
    const result = w.worker.receive(sign(), { ...sender, frameId: 2 });
    const request = await w.worker.next(); assert.ok(request);
    await w.worker.reply(request.id, { ok: true, value: { passThrough: true } });
    assert.deepEqual(await result, { passThrough: true }); w.worker.stop();
  });

  it("refuses an observation which changes during the native sender checks", async () => {
    const w = world(); w.worker.install(); w.onObservation(() => { w.observation.accountRevision++; });
    await assert.rejects(w.worker.receive(sign(), sender)); w.worker.stop();
  });
});

it("accepts empty and short/email alias snapshots for exact IDs and settings without preselecting credentials", async () => {
  for (const names of [[], ["alex", "alex@ucsd.edu"]]) {
    const w = world(); w.worker.install(); w.observation.accountNames = names;
    assert.deepEqual(await w.worker.receive({ type: "DUO_SETTINGS" }, sender), { enabled: true, trustClick: true, toast: true });
    const result = w.worker.receive(sign(), sender);
    const request = await w.worker.next(); assert.ok(request);
    assert.deepEqual(request.request.accountNames, names);
    await w.worker.reply(request.id, { ok: true, value: { passThrough: true } }); await result; w.worker.stop();
  }
});
