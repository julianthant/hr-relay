import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { PositiveIntSchema } from "../../../rules/identity/ids.js";

export const ProcessStartIdentitySchema = z.strictObject({
  platform: z.enum(["linux", "darwin", "win32"]),
  startToken: z.string().min(1),
});
export type ProcessStartIdentity = z.infer<typeof ProcessStartIdentitySchema>;

export type PidObservation =
  | Readonly<{ state: "alive" }>
  | Readonly<{ state: "gone" }>;

export type ProcessIdentityObservation =
  | Readonly<{ state: "alive"; identity: ProcessStartIdentity }>
  | Readonly<{ state: "gone" }>;

export type ProcessIdentityObserver = (pid: number) => ProcessIdentityObservation;

function errnoOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code: unknown = Reflect.get(error, "code");
  return typeof code === "string" ? code : undefined;
}

export function observePid(pid: number): PidObservation {
  const failure = signalProcess(pid);
  if (failure === undefined) return { state: "alive" };
  const code = errnoOf(failure);
  if (code === "EPERM") return { state: "alive" };
  if (code === "ESRCH") return { state: "gone" };
  throw new Error(
    `could not observe whether pid ${String(pid)} is still running (${code ?? "no errno"})`,
    { cause: failure },
  );
}

// Observe OS birth identity as well as PID occupancy to detect PID reuse.
export function observeProcessIdentity(pid: number): ProcessIdentityObservation {
  const parsedPid = PositiveIntSchema.parse(pid);
  if (parsedPid === process.pid && selfProcessIdentity !== undefined) return selfProcessIdentity;
  const observed = observeUncachedProcessIdentity(parsedPid);
  if (parsedPid === process.pid) selfProcessIdentity = observed;
  return observed;
}

// This process's birth identity cannot change while it is alive. Other pids are observed every time.
let selfProcessIdentity: ProcessIdentityObservation | undefined;

function observeUncachedProcessIdentity(parsedPid: number): ProcessIdentityObservation {
  if (observePid(parsedPid).state === "gone") return { state: "gone" };
  if (process.platform === "linux") {
    try {
      const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
      const stat = readFileSync(`/proc/${String(parsedPid)}/stat`, "utf8");
      const closeParen = stat.lastIndexOf(")");
      if (closeParen === -1) throw new Error("process stat has no closing command delimiter");
      const fieldsAfterCommand = stat.slice(closeParen + 2).trim().split(/\s+/u);
      const startTicks = fieldsAfterCommand[19];
      if (bootId.length === 0 || startTicks === undefined || !/^\d+$/u.test(startTicks)) {
        throw new Error("process stat has no valid start-time ticks or boot identity");
      }
      return {
        state: "alive",
        identity: ProcessStartIdentitySchema.parse({
          platform: "linux",
          startToken: `${bootId}:${startTicks}`,
        }),
      };
    } catch (error) {
      if (errnoOf(error) === "ENOENT" && observePid(parsedPid).state === "gone") {
        return { state: "gone" };
      }
      throw new Error(`could not observe Linux start identity for pid ${String(parsedPid)}`, {
        cause: error,
      });
    }
  }
  if (process.platform === "darwin") {
    const result = spawnSync("/bin/ps", ["-o", "lstart=", "-p", String(parsedPid)], {
      encoding: "utf8",
      env: { LANG: "C", LC_ALL: "C", TZ: "UTC" },
    });
    const rawStart = result.stdout.trim();
    const startTimeMs = Date.parse(`${rawStart} UTC`);
    if (result.status === 0 && rawStart.length > 0 && Number.isFinite(startTimeMs)) {
      return {
        state: "alive",
        identity: ProcessStartIdentitySchema.parse({
          platform: "darwin",
          startToken: String(Math.floor(startTimeMs / 1000)),
        }),
      };
    }
    if (observePid(parsedPid).state === "gone") return { state: "gone" };
    throw new Error(
      `could not observe Darwin start identity for pid ${String(parsedPid)}: `
      + `${result.stderr.trim() || `ps exited ${String(result.status)}`}`,
      { cause: result.error },
    );
  }
  if (process.platform === "win32") {
    const script = `(Get-Process -Id ${String(parsedPid)} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
    });
    const token = result.stdout.trim();
    if (result.status === 0 && /^\d+$/u.test(token)) {
      return {
        state: "alive",
        identity: ProcessStartIdentitySchema.parse({ platform: "win32", startToken: token }),
      };
    }
    if (observePid(parsedPid).state === "gone") return { state: "gone" };
    throw new Error(
      `could not observe Windows start identity for pid ${String(parsedPid)}: `
      + `${result.stderr.trim() || `PowerShell exited ${String(result.status)}`}`,
      { cause: result.error },
    );
  }
  throw new Error(`runtime process identity is unsupported on platform ${process.platform}`);
}


function signalProcess(pid: number): unknown {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return error;
  }
  return undefined;
}
