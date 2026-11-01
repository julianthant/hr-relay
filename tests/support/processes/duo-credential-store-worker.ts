import assert from "node:assert/strict";
import { Entry } from "@napi-rs/keyring";
import { FakeKeyringEntry } from "../helpers/credential-keychain-fake.js";
import { z } from "zod";
import { acquireSharedRuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { WorkerRuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { createDuoCredentialStore } from "../../../src/backend/storage/configuration/duo-credential-store.js";
import { manualClock } from "../../../src/rules/time/clock.js";

assert.equal(Entry, FakeKeyringEntry, "Duo child requires actual fake keychain preload before backend effects");
const [workspace, profileId, credentialId, at, port] = z.tuple([z.string().min(1), z.uuid(), z.string().min(1), z.iso.datetime(), z.coerce.number().int().positive()]).parse(process.argv.slice(2));
const parentStop = new AbortController();
const lifetime = await WorkerRuntimeLifetimeLock.receive(port, () => parentStop.abort(new Error("fixture-parent-disconnected")));
parentStop.signal.throwIfAborted();
const machine = acquireSharedRuntimeAdmission(workspace, lifetime), admission = machine.admitProfile(profileId);
const store = createDuoCredentialStore(admission, manualClock(new Date(at)));
async function close() {
  admission.release(); machine.release(); await lifetime.close();
  if (process.connected) {
      if (process.disconnect === undefined) throw new Error("fixture-worker-ipc-required");
      process.disconnect();
    }
}
async function command(input: unknown): Promise<void> {
  if (input === "close") { await close(); return; }
  const request = z.strictObject({ kind: z.literal("sign-then-crash"), requestId: z.uuid() }).parse(input);
  await store.sign({ requestId: request.requestId, credentialId, rpId: "duosecurity.com", origin: "https://test.duosecurity.com", challenge: "AQID" });
  process.exit(23);
}
process.on("message", (input: unknown) => { void command(input).catch(() => { process.stderr.write("duo-fixture-command-failed\n"); process.exit(1); }); });
parentStop.signal.addEventListener("abort", () => { void close().catch(() => { process.exit(1); }); }, { once: true });
if (process.send === undefined) throw new Error("duo-worker-ipc-required");
process.send({ type: "ready", pid: process.pid });
