import nativeFs, { existsSync, fstatSync, openSync, closeSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { z } from "zod";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { composeProfileRuntime } from "../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { observeProcessIdentity } from "../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { SignUpOperationSchema } from "../../../src/models/profiles/profile.js";
import { systemClock } from "../../../src/rules/time/clock.js";
import { FakeKeyringEntry } from "../helpers/credential-keychain-fake.js";

const [workspace, boundary] = z.tuple([z.string().min(1), z.enum(["source-fsync", "protected-stage"])]).parse(process.argv.slice(2));
const machine = acquireEntrypointAdmission(workspace, "exclusive"), processLockRoot = join(workspace, rebuildRuntimeIsolation.processLockRoot);
let armed = false;
const fsync = nativeFs.fsyncSync;
function loseProcess(): never {
  const observation = observeProcessIdentity(process.pid);
  if (observation.state !== "alive") process.exit(96);
  const path = join(workspace, "onboarding-process-loss.json");
  writeFileSync(path, JSON.stringify({ boundary, pid: process.pid, identity: observation.identity }), { mode: 0o600, flag: "wx" });
  const descriptor = openSync(path, "r"); try { fsync(descriptor); } finally { closeSync(descriptor); }
  process.exit(97);
}
const profile = composeProfileRuntime({ admission: machine, processLockRoot, hostFacts: { primaryDisplay: null }, clock: systemClock,
  credentialHooks: { beforeRename() { if (armed && boundary === "protected-stage") loseProcess(); } } });
const draft = profile.session.signUp({ firstName: "Recovery", lastName: "Fixture", email: "draft-recovery@ucsd.edu",
  password: "disposable-draft-recovery", createdAt: new Date().toISOString() });
if (draft.state !== "onboarding") process.exit(96);
const credentials = join(machine.stateRoot, "profiles", draft.profileId, "credentials"), operationPath = join(machine.stateRoot, "machine", "operations", `${draft.operationId}.json`);
nativeFs.fsyncSync = descriptor => {
  fsync(descriptor);
  if (!armed || boundary !== "source-fsync" || !fstatSync(descriptor).isDirectory()) return;
  const operation = SignUpOperationSchema.parse(JSON.parse(readFileSync(operationPath, "utf8"))), abort = operation.onboarding?.abort;
  if (abort === undefined) return;
  const source = join(credentials, `.protected.${draft.operationId}.${abort.commandId}.tmp`), expected = statSync(credentials), actual = fstatSync(descriptor);
  if (existsSync(source) && actual.dev === expected.dev && actual.ino === expected.ino) loseProcess();
};
syncBuiltinESMExports();
process.on("message", (message: unknown) => {
  if (message !== "cancel") process.exit(96);
  armed = true;
  void profile.session.cancelOnboarding(draft.token, draft.operationId).then(() => process.exit(96), () => process.exit(96));
});
process.send?.({ type: "ready", pid: process.pid, keychain: FakeKeyringEntry.snapshot() });
