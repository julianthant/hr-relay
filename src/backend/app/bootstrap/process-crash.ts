import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { ErrorCatalogCodeSchema } from "../../../models/failures/error-catalog.js";
import { serializeErrorCauses } from "../../../models/failures/error-origins.js";
import { systemClock } from "../../../rules/time/clock.js";
import { appendLocalDebug } from "../../storage/events/local-debug-log.js";

const buildRoot = new URL("../../../../", import.meta.url);
const errorTypes = new Set(["TypeError", "RangeError", "ReferenceError", "SyntaxError", "AggregateError", "Error", "UnknownCause"]);
const systemCodes = new Set(["EPIPE", "ERR_IPC_CHANNEL_CLOSED", "ERR_SQLITE_ERROR", "ERR_INVALID_STATE"]);

function rejectionDetails(error: unknown): { message: string; stack?: string } {
  try {
    const causes = serializeErrorCauses(error);
    const labels: string[] = [], frames: string[] = [];
    for (const cause of causes) {
      const hasCode = cause.code !== "INTERNAL_FAILURE" && (ErrorCatalogCodeSchema.safeParse(cause.code).success || systemCodes.has(cause.code));
      const type = errorTypes.has(cause.name) ? cause.name : "Error";
      const label = hasCode ? cause.code : type;
      labels.push(label);
      for (const line of cause.stack.split("\n").slice(1)) {
        const path = /^ {4}at (src\/[a-zA-Z0-9_./-]+\.[jt]sx?):\d{1,6}:\d{1,6}$/u.exec(line)?.[1];
        if (path !== undefined && existsSync(new URL(path, buildRoot))) frames.push(`${label} ${line.trim()}`);
      }
    }
    return { message: labels.join(" <- "), ...(frames.length ? { stack: frames.join("\n").slice(0, 65536) } : {}) };
  } catch {
    // An error can throw from its stack or cause accessor. Keep the crash record in that case.
    return { message: "rejection-details-unavailable" };
  }
}

function processBuild(): string {
  return z.object({ version: z.string().min(1) })
    .parse(JSON.parse(readFileSync(new URL("../../../../package.json", import.meta.url), "utf8"))).version;
}

export function recordDashboardStopFailure(stateRoot: string, reason: string, error: unknown, now: Date): void {
  appendLocalDebug({ stateRoot, build: processBuild(), now,
    event: { category: "boot", phase: "failed", area: "dashboard-shutdown", reason,
      code: "INTERNAL_FAILURE", ...rejectionDetails(error), pinned: true } });
}

export function installProcessCrashHandlers(input: { stateRoot: string; processKind: "dashboard" | "worker"; build?: string }): void {
  const build = input.build ?? processBuild();
  const fail = (reason: "uncaught-exception" | "unhandled-rejection", error: unknown): never => {
    try {
      appendLocalDebug({ stateRoot: input.stateRoot, build, now: systemClock.now(),
        event: { category: "boot", phase: "failed", area: `${input.processKind}-process`, reason,
          code: "INTERNAL_FAILURE", ...(reason === "unhandled-rejection" ? rejectionDetails(error) : {}), pinned: true } });
    } finally { process.exit(1); }
  };
  process.once("uncaughtException", (error, origin) =>
    fail(origin === "unhandledRejection" ? "unhandled-rejection" : "uncaught-exception", error));
  process.once("unhandledRejection", error => fail("unhandled-rejection", error));
}
