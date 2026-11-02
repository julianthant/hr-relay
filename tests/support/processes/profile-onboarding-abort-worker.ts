import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { Entry } from "@napi-rs/keyring";
import { FakeKeyringEntry } from "../helpers/credential-keychain-fake.js";

const actualEntry: unknown = Entry;
if (process.env.RELAY_TEST_KEYCHAIN === undefined || !process.env.NODE_OPTIONS?.includes("credential-keychain-process-preload.mjs")
  || actualEntry !== FakeKeyringEntry) throw new Error("onboarding-abort-worker-fake-keychain-required");
const [workspace, boundary, portText] = process.argv.slice(2), port = Number(portText);
if (process.argv.slice(2).length !== 3 || !workspace || !["erase-plan-fsync", "erase-head-stage"].includes(boundary ?? "")
  || !Number.isInteger(port) || port < 1 || port > 65535 || !process.connected || process.send === undefined) throw new Error("onboarding-abort-worker-arguments-invalid");
const { z } = await import("zod");
const { RuntimeLifetimeLock } = await import("../../../src/backend/storage/admission/lifetime-lock.js");
const { acquireEntrypointAdmission } = await import("../../../src/backend/storage/admission/bootstrap-admission.js");
const { composeProfileRuntime } = await import("../../../src/backend/app/composition/storage-compose.js");
const { observeProcessIdentity } = await import("../../../src/backend/storage/sqlite/runtime-process-locks.js");
const { SignUpOperationSchema } = await import("../../../src/models/profiles/profile.js");
const { systemClock } = await import("../../../src/rules/time/clock.js");
const lifetime = await RuntimeLifetimeLock.acquire(port);
const machine = acquireEntrypointAdmission(workspace, "exclusive", lifetime);
const profile = composeProfileRuntime({ admission: machine, hostFacts: { primaryDisplay: null }, clock: systemClock });
const operations = join(machine.stateRoot, "machine", "operations"), names = fs.readdirSync(operations).filter(name => name.endsWith(".json"));
if (names.length !== 1 || names[0] === undefined) throw new Error("onboarding-abort-worker-operation-membership");
const draft = SignUpOperationSchema.parse(JSON.parse(fs.readFileSync(join(operations, names[0]), "utf8")));
const eraseDirectory = join(machine.stateRoot, "machine", "credential-operations");
const erasePath = join(eraseDirectory, `${draft.profileId}.json`);
const sync = fs.fsyncSync, write = fs.writeFileSync;
let armed = false;
function loseProcess(): never {
  const observation = observeProcessIdentity(process.pid);
  if (observation.state !== "alive") process.exit(96);
  const path = join(workspace, "onboarding-process-loss.json");
  write(path, JSON.stringify({ boundary, pid: process.pid, identity: observation.identity }), { mode: 0o600, flag: "wx" });
  const descriptor = fs.openSync(path, "r"); try { sync(descriptor); } finally { fs.closeSync(descriptor); }
  process.exit(97);
}
fs.fsyncSync = descriptor => {
  sync(descriptor);
  if (!armed || boundary !== "erase-plan-fsync" || !fs.existsSync(erasePath)) return;
  const expected = fs.statSync(eraseDirectory), actual = fs.fstatSync(descriptor);
  if (actual.isDirectory() && actual.dev === expected.dev && actual.ino === expected.ino
    && z.object({ kind: z.literal("erase") }).safeParse(JSON.parse(fs.readFileSync(erasePath, "utf8"))).success) loseProcess();
};
fs.writeFileSync = (path, data, options) => {
  write(path, data, options);
  if (armed && boundary === "erase-head-stage" && String(path).endsWith(".erase.tmp")) loseProcess();
};
syncBuiltinESMExports();
process.on("message", (message: unknown) => {
  if (message !== "cancel" || armed) process.exit(96);
  armed = true;
  void profile.session.recoverOnboarding().then(() => process.exit(96), () => process.exit(96));
});
process.send({ type: "ready", pid: process.pid, keychain: FakeKeyringEntry.snapshot() });
