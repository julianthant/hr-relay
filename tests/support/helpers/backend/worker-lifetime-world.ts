import { z } from "zod";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bindWorkerProcessAdmission, type RuntimeProcessLockHandle } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { WorkerIdSchema } from "../../../../src/rules/identity/ids.js";
import type { createRunRecordServiceTestWorld } from "./run-record-service-world.js";

const ownerLines = new WeakMap<ChildProcess, () => Promise<string>>();
function readOwnerLine(child: ChildProcess): Promise<string> {
  const existing = ownerLines.get(child);
  if (existing !== undefined) return existing();
  if (child.stdout === null) throw new Error("fence owner has no stdout");
  let pending = "";
  const queue: string[] = [];
  let notify: (() => void) | undefined;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", chunk => {
    pending += chunk;
    for (let newline = pending.indexOf("\n"); newline !== -1; newline = pending.indexOf("\n")) {
      queue.push(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
      notify?.();
      notify = undefined;
    }
  });
  const read = async (): Promise<string> => {
    const deadline = Date.now() + 15_000;
    while (queue.length === 0) {
      if (Date.now() > deadline) throw new Error("fence owner produced no line");
      await new Promise<void>(resolve => { notify = resolve; setTimeout(resolve, 50); });
    }
    const line = queue.shift();
    if (line === undefined) throw new Error("fence owner closed its channel");
    return line;
  };
  ownerLines.set(child, read);
  return read();
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await exited;
}
export async function ownedWorkerLifetimeFixture(world: ReturnType<typeof createRunRecordServiceTestWorld>, options?: { fenceInOwner?: boolean }) {
  const h = await world.fixture(), children: ChildProcess[] = [], handles: RuntimeProcessLockHandle[] = [];
  const slot = h.database.authority.workerSlots.list()[0];
  if (slot === undefined) throw new Error("missing member");
  const lease = h.database.authority.workerLeases.get(slot.workerId);
  if (lease === undefined) throw new Error("missing lease");
  const now = h.clock.now().toISOString();
  h.database.authority.workerLeases.reportLifecycle({ workerId: slot.workerId, leaseGeneration: lease.leaseGeneration,
    lifecycle: { state: "stopped", startedAt: lease.lifecycle.startedAt, stoppedAt: now, reason: "shutdown" }, now });
  const owner = async (authorityPath = join(h.root, "state.db"), onSpawn?: (child: ChildProcess) => void) => {
    const child = options?.fenceInOwner === true
      ? spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../../../support/processes/write-fence-owner.ts", import.meta.url)), authorityPath], { stdio: ["pipe", "pipe", "inherit"] })
      : spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", env: {} });
    children.push(child);
    onSpawn?.(child);
    await once(child, "spawn");
    if (options?.fenceInOwner === true) await readOwnerLine(child);
    if (child.pid === undefined) throw new Error("missing actual child pid");
    const bound = bindWorkerProcessAdmission({ processLockRoot: join(h.root, "locks"), authorityPath, workerId: slot.workerId,
      pid: child.pid, clock: h.clock, open: () => h.database, admit: () => WorkerIdSchema.parse(slot.workerId), close: () => undefined });
    handles.push(bound.processLock);
    return { child, pid: child.pid, handle: bound.processLock };
  };
  const old = await owner();
  const started = h.database.startOwnedWorker({ workerId: slot.workerId, workflow: slot.workflow,
    browserSystems: ["ucpath", "crm"], processId: old.pid, requestedBy: "local-operator", now }, old.handle);
  if (started.state !== "started") throw new Error("old birth failed");
  const observe = (state: "idle" | "paused" | "starting" | "waiting" | "busy") => {
    const common = { startedAt: started.lease.lifecycle.startedAt, heartbeatAt: now };
    h.database.authority.workerLeases.reportLifecycle({ workerId: slot.workerId, leaseGeneration: started.lease.leaseGeneration, now,
      lifecycle: state === "starting" ? { state, startedAt: common.startedAt }
        : state === "paused" ? { state, ...common, pausedAt: now }
        : state === "waiting" ? { state, ...common, activity: "authenticating" }
        : state === "busy" ? { state, ...common, runId: randomUUID() } : { state, ...common } });
  };
  const shutdown = async (reason: "shutdown" | "crashed" = "shutdown") => {
    const current = h.database.authority.workerLeases.get(slot.workerId);
    if (current === undefined) throw new Error("missing old lifetime");
    h.database.authority.workerLeases.control({ workerId: slot.workerId, expectedVersion: current.version, now,
      control: { directive: "stop", requestedAt: now, requestedBy: "local-operator" } });
    for (const state of ["stopping", "stopped"] as const) h.database.authority.workerLeases.reportLifecycle({ workerId: slot.workerId,
      leaseGeneration: current.leaseGeneration, now, lifecycle: state === "stopped" ? { state, startedAt: current.lifecycle.startedAt,
        stoppedAt: now, reason } : { state, startedAt: current.lifecycle.startedAt, heartbeatAt: now } });
    await stop(old.child);
    old.handle.release();
  };
  return { ...h, slot, old, started: started.lease, now, owner, observe, shutdown,
    fence: async (input: unknown) => {
      if (old.child.stdin === null) throw new Error("fence owner has no channel");
      old.child.stdin.write(`${JSON.stringify(input)}\n`);
      const line = await readOwnerLine(old.child);
      const parsed = z.object({
        state: z.string().optional(),
        error: z.string().optional(),
        refusal: z.object({ reason: z.string().optional() }).optional(),
      }).parse(JSON.parse(line));
      if (parsed.error !== undefined) throw new Error(parsed.error);
      if (parsed.state === "refused") throw new Error(`fixture fence refused: ${parsed.refusal?.reason ?? "unknown"}`);
      return parsed;
    },
    dispose: async () => { for (const child of children) await stop(child); for (const handle of handles) handle.release(); } };
}

