import { z } from "zod";

if (process.env.RELAY_TEST_KEYCHAIN === undefined || !process.env.NODE_OPTIONS?.includes("credential-keychain-process-preload.mjs"))
  throw new Error("chatgpt-worker-fake-keychain-required");
const { FakeKeyringEntry } = await import("../helpers/credential-keychain-fake.js");
const keyringEntry: unknown = (await import("@napi-rs/keyring")).Entry;
if (keyringEntry !== FakeKeyringEntry) throw new Error("chatgpt-worker-fake-keychain-required");

const { acquireSharedRuntimeAdmission } = await import("../../../src/backend/storage/admission/admission.js");
const { WorkerRuntimeLifetimeLock } = await import("../../../src/backend/storage/admission/lifetime-lock.js");
const { createChatGptCredentialRepository, ChatGptCredentialError } = await import("../../../src/backend/storage/configuration/chatgpt-credential-repository.js");
const [workspace, profileId, port] = z.tuple([z.string().min(1), z.uuid(), z.coerce.number().int().positive()]).parse(process.argv.slice(2));
const disconnected = new AbortController();
const lifetime = await WorkerRuntimeLifetimeLock.receive(port, () => disconnected.abort());
disconnected.signal.throwIfAborted();
const machine = acquireSharedRuntimeAdmission(workspace, lifetime), admission = machine.admitProfile(profileId);
const repository = createChatGptCredentialRepository({ admission, stateRoot: admission.stateRoot });
const remote = Promise.withResolvers<void>();
let operation: Promise<void> | undefined, closing: Promise<void> | undefined;
function send(value: Readonly<Record<string, string | number | null>>): void {
  if (process.send === undefined || !process.connected) throw new Error("chatgpt-worker-ipc-required");
  process.send(value);
}
function close(): Promise<void> {
  return closing ??= (async () => {
    remote.resolve(); await operation;
    admission.release(); machine.release(); await lifetime.close();
    if (process.connected) {
      if (process.disconnect === undefined) throw new Error("fixture-worker-ipc-required");
      process.disconnect();
    }
  })();
}
async function command(input: unknown): Promise<void> {
  const command = z.enum(["hold", "release", "probe", "close"]).parse(input);
  if (command === "close") { await close(); return; }
  if (command === "release") { remote.resolve(); return; }
  try {
    if (command === "hold") {
      if (operation !== undefined) throw new Error("chatgpt-worker-operation-already-started");
      operation = repository.withLock(async transaction => {
        const current = transaction.read();
        if (current === undefined) throw new Error("chatgpt-worker-existing-record-required");
        send({ type: "held", revision: current.revision });
        await remote.promise;
        transaction.replace({ ...current, revision: current.revision + 1 }, current.revision);
      });
      await operation; send({ type: "released" });
    } else {
      const revision = await repository.withLock(async transaction => transaction.read()?.revision ?? null);
      send({ type: "entered", revision });
    }
  } catch (error) {
    if (!(error instanceof ChatGptCredentialError)) throw error;
    send({ type: "refused", code: error.code });
  }
}
process.on("message", (input: unknown) => {
  void command(input).catch(() => { process.exitCode = 1; process.stderr.write("chatgpt-worker-command-failed\n"); });
});
disconnected.signal.addEventListener("abort", () => {
  process.exitCode = 1;
  void close().catch(() => { process.stderr.write("chatgpt-worker-close-failed\n"); });
}, { once: true });
send({ type: "ready", pid: process.pid });
