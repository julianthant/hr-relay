import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

const KEEP_AWAKE_CLOSE_GRACE_MS = 1_000;

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
  let holder: { process: ChildProcess; settled: boolean; failed: boolean; stopping: boolean; closeUnproved: boolean } | undefined;
  let stopped = false, attempted = false;
  let pending = Promise.resolve();

  const reconcile = async (needed: boolean): Promise<void> => {
    // shortcut: non-macOS holders do nothing until Windows has a supervised native API host.
    if ((input.platform ?? process.platform) !== "darwin") return;
    if (!needed || stopped || holder?.stopping) {
      attempted = false;
      if (holder === undefined) return;
      const owned = holder, child = owned.process;
      owned.stopping = true;
      if (owned.closeUnproved && !owned.settled) throw new Error("keep-awake-closure-unproved");
      const isRunning = () => !owned.settled && child.pid !== undefined && child.exitCode === null && child.signalCode === null;
      const waitForClose = async (): Promise<boolean> => {
        if (owned.settled) return true;
        const close = Promise.withResolvers<boolean>();
        const onClose = () => close.resolve(true);
        child.once("close", onClose);
        const timer = setTimeout(() => close.resolve(false), KEEP_AWAKE_CLOSE_GRACE_MS);
        try { return await close.promise; }
        finally { clearTimeout(timer); child.off("close", onClose); }
      };
      if (isRunning() && !child.kill("SIGTERM")) throw new Error("keep-awake-stop-failed");
      if (!await waitForClose()) {
        if (isRunning()) child.kill("SIGKILL");
        if (!await waitForClose()) {
          owned.closeUnproved = true;
          throw new Error("keep-awake-closure-unproved");
        }
      }
      holder = undefined;
      if (!needed || stopped) return;
    }
    if (attempted) return;
    attempted = true;
    let child: ChildProcess;
    try { child = startProcess("/usr/bin/caffeinate", ["-i", "-w", String(input.pid ?? process.pid)]); }
    catch { report("keep-awake-start-failed"); return; }
    const owned = { process: child, settled: false, failed: false, stopping: false, closeUnproved: false };
    holder = owned;
    child.once("error", () => { owned.failed = true; report("keep-awake-start-failed"); });
    child.once("close", () => {
      owned.settled = true;
      if (!owned.stopping && !owned.failed) report("keep-awake-exited");
    });
  };
  const update = (needed: boolean): Promise<void> => {
    pending = pending.then(() => reconcile(needed), () => reconcile(needed));
    return pending;
  };
  return Object.freeze({ update, stop(): Promise<void> { stopped = true; return update(false); } });
}
