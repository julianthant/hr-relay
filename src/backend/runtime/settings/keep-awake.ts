import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

export interface KeepAwakeOptions {
  readonly platform?: NodeJS.Platform;
  readonly pid?: number;
  readonly startProcess?: (command: string, args: readonly string[]) => ChildProcess;
  readonly debugEvents: { emit(input: unknown): unknown };
}

/** Owns one idle-sleep assertion; closing it waits for the actual child to close. */
export function createKeepAwake(input: KeepAwakeOptions) {
  const startProcess = input.startProcess ?? ((command, args) => spawn(command, args, { stdio: "ignore" }));
  const report = (reason: string) => input.debugEvents.emit({ category: "boot", phase: "failed",
    area: "keep-awake", reason, correlationId: randomUUID() });
  let holder: { process: ChildProcess; closed: Promise<void>; settled: boolean; failed: boolean; stopping: boolean } | undefined;
  let stopped = false, attempted = false;
  let pending = Promise.resolve();

  const reconcile = async (needed: boolean): Promise<void> => {
    // shortcut: non-macOS holders do nothing until Windows has a supervised native API host.
    if ((input.platform ?? process.platform) !== "darwin") return;
    if (!needed || stopped) {
      attempted = false;
      if (holder === undefined) return;
      holder.stopping = true;
      const child = holder.process;
      if (!holder.settled && child.pid !== undefined && child.exitCode === null && child.signalCode === null
        && !child.kill("SIGTERM")) throw new Error("keep-awake-stop-failed");
      await holder.closed;
      holder = undefined;
      return;
    }
    if (attempted) return;
    attempted = true;
    let child: ChildProcess;
    try { child = startProcess("/usr/bin/caffeinate", ["-i", "-w", String(input.pid ?? process.pid)]); }
    catch { report("keep-awake-start-failed"); return; }
    const completion = Promise.withResolvers<void>();
    const owned = { process: child, closed: completion.promise,
      settled: false, failed: false, stopping: false };
    holder = owned;
    child.once("error", () => { owned.failed = true; report("keep-awake-start-failed"); });
    child.once("close", () => {
      owned.settled = true;
      completion.resolve();
      if (!owned.stopping && !owned.failed) report("keep-awake-exited");
    });
  };
  const update = (needed: boolean): Promise<void> => {
    pending = pending.then(() => reconcile(needed), () => reconcile(needed));
    return pending;
  };
  return Object.freeze({ update, stop(): Promise<void> { stopped = true; return update(false); } });
}
