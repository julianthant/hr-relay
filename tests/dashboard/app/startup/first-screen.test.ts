import assert from "node:assert/strict";
import { it } from "vitest";
import { startupDeadlineClient } from "../../../../src/dashboard/app/startup/first-screen.js";
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";

const pending = () => new Promise<never>(() => {});
const settledWithin = (promise: Promise<unknown>) => Promise.race([promise.then(() => "resolved", () => "rejected"), new Promise(resolve => setTimeout(() => resolve("pending"), 20))]);

it("expires a pending first-screen read but leaves a pending write to settle on its own", async () => {
  let finishWrite: ((value: unknown) => void) | undefined;
  const client = { assistantHistory: pending, assistantHistoryWrite: () => new Promise(resolve => { finishWrite = resolve; }) } as unknown as DashboardClient;
  const startup = startupDeadlineClient(client);
  assert.ok(typeof startup.client.assistantHistory === "function");
  assert.ok(typeof startup.client.assistantHistoryWrite === "function");
  const read = startup.client.assistantHistory();
  const write = startup.client.assistantHistoryWrite({ operation: "create", conversationId: "00000000-0000-4000-8000-0000000000c1", title: "New chat" });
  startup.expire();
  assert.equal(await settledWithin(read), "rejected");
  assert.equal(await settledWithin(write), "pending");
  finishWrite?.({ state: "saved" });
  assert.deepEqual(await write, { state: "saved" });
});

it("expires a pending account check with the first screen that waits for it", async () => {
  const startup = startupDeadlineClient({ checkChatGptAccount: pending } as unknown as DashboardClient);
  assert.ok(typeof startup.client.checkChatGptAccount === "function");
  const check = startup.client.checkChatGptAccount();
  startup.expire();
  assert.equal(await settledWithin(check), "rejected");
});

it("passes reads through untouched once the first screen is shown", async () => {
  const client = { assistantHistory: pending } as unknown as DashboardClient;
  const startup = startupDeadlineClient(client);
  startup.end();
  assert.ok(typeof startup.client.assistantHistory === "function");
  const read = startup.client.assistantHistory();
  startup.expire();
  assert.equal(await settledWithin(read), "pending");
});
