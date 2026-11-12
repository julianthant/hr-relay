import { WorkerRuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { WorkerParentMessageSchema } from "../../../src/backend/runtime/workers/worker-messages.js";
import { PositiveIntSchema } from "../../../src/rules/identity/ids.js";

// A real worker process that speaks the pool's IPC protocol and claims nothing; `ignore-stop` models a child that never honours Stop or SIGTERM.
const [runtimePortRaw, mode, subcommand, , poolIndexFlag, , ...launchArgs] = process.argv.slice(2);
if (runtimePortRaw === undefined || !["obey", "ignore-stop"].includes(mode ?? "") || subcommand !== "worker" || poolIndexFlag !== "--pool-index") {
  throw new Error(`worker-stub-cli refused argv ${JSON.stringify(process.argv.slice(2))}; expected <runtime-port> <obey|ignore-stop> worker <workflow-id> --pool-index <n> ...`);
}
const flag = (name: string): string => {
  const value = launchArgs[launchArgs.indexOf(name) + 1];
  if (!launchArgs.includes(name) || value === undefined) throw new Error(`worker-stub-cli launch is missing ${name}`);
  return value;
};
const workerId = flag("--worker-id"), profileId = flag("--profile-id"), sessionGeneration = Number(flag("--session-generation"));
const send = (message: unknown): void => {
  if (process.send === undefined) throw new Error("worker-stub-cli has no parent channel");
  process.send(message);
};

await WorkerRuntimeLifetimeLock.receive(PositiveIntSchema.parse(Number(runtimePortRaw)), () => { process.exit(1); });
if (mode === "ignore-stop") process.on("SIGTERM", () => { process.stdout.write(`WORKER-STUB IGNORED SIGTERM ${workerId}\n`); });
process.on("message", (raw: unknown) => {
  const parsed = WorkerParentMessageSchema.safeParse(raw);
  if (!parsed.success) return;
  const message = parsed.data;
  if (message.kind === "worker-stop") {
    if (mode === "ignore-stop") return;
    process.stdout.write(`WORKER-STUB STOPPED ${workerId} ${message.reason}\n`);
    process.exit(0);
  }
  const result = message.kind === "worker-pause" ? { directive: "pause" } : message.kind === "worker-resume" ? { directive: "run" } : null;
  send({ kind: "worker-reply", requestId: message.requestId, outcome: { state: "done", result } });
});
send({ kind: "worker-ready", workerId, pid: process.pid, profileId, sessionGeneration, browserSystems: [], activity: { state: "idle" } });
process.stdout.write(`WORKER-STUB BORN ${workerId} ${String(process.pid)}\n`);
