import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { Entry } from "@napi-rs/keyring";
import { FakeKeyringEntry } from "../helpers/credential-keychain-fake.js";

const actualEntry: unknown = Entry;
if (process.env.RELAY_TEST_KEYCHAIN === undefined || !process.env.NODE_OPTIONS?.includes("credential-keychain-process-preload.mjs")
  || actualEntry !== FakeKeyringEntry) throw new Error("duo-worker-fake-keychain-required");

const [portText, workspace, profileId, credentialId, requestId, mode] = process.argv.slice(2);
const port = Number(portText);
if (process.argv.slice(2).length !== 6 || !Number.isInteger(port) || port < 1 || port > 65535 || !workspace
  || !profileId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(profileId)
  || !credentialId || !requestId || !["close", "crash", "crash-head"].includes(mode ?? "")) throw new Error("duo-worker-arguments-invalid");
if (!process.connected || process.send === undefined || process.disconnect === undefined) throw new Error("duo-worker-inherited-ipc-required");

const { WorkerRuntimeLifetimeLock } = await import("../../../src/backend/storage/admission/lifetime-lock.js");
const { acquireSharedRuntimeAdmission } = await import("../../../src/backend/storage/admission/admission.js");
const { createCanonicalCredentials } = await import("../../../src/backend/storage/configuration/canonical-credential-store.js");
const disconnected = new AbortController();
const lifetime = await WorkerRuntimeLifetimeLock.receive(port, () => disconnected.abort(new Error("duo-worker-parent-disconnected")));
disconnected.signal.throwIfAborted();
const machine = acquireSharedRuntimeAdmission(workspace, lifetime), admission = machine.admitProfile(profileId);
const disconnect = process.disconnect.bind(process);
try {
  const owner = createCanonicalCredentials(admission);
  if (mode === "crash-head") {
    const rename = fs.renameSync, head = join(machine.stateRoot, "machine", "credential-keys", `${profileId}.json`);
    fs.renameSync = (source, target) => { rename(source, target); if (String(target) === head) process.exit(97); };
    syncBuiltinESMExports();
  }
  let result: ReturnType<typeof owner.reserveDuoCounter> | undefined;
  for (let attempt = 0; attempt < 1000; attempt++) {
    disconnected.signal.throwIfAborted();
    try { result = owner.reserveDuoCounter(credentialId, requestId); break; }
    catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "CREDENTIAL_BUSY") throw error;
      await new Promise<void>(resolve => setTimeout(resolve, 1));
    }
  }
  if (result === undefined) throw new Error("duo-worker-writer-remained-busy");
  disconnected.signal.throwIfAborted();
  const committed = result;
  await new Promise<void>((resolve, reject) => process.stdout.write(JSON.stringify({ pid: process.pid, count: committed.count }), error => {
    if (error) reject(error); else resolve();
  }));
  if (mode === "crash") process.exit(23);
} finally {
  admission.release(); machine.release(); await lifetime.close();
  if (process.connected) disconnect();
}
