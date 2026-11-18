import { readFileSync } from "node:fs";
import { z } from "zod";
import { serializeErrorCauses } from "../../../models/failures/error-origins.js";
import { sanitizeDebugText } from "../../../rules/redaction/redaction.js";
import { systemClock } from "../../../rules/time/clock.js";
import { appendLocalDebug } from "../../storage/events/local-debug-log.js";

export function installProcessCrashHandlers(input: { stateRoot: string; processKind: "dashboard" | "worker"; build?: string }): void {
  const build = input.build ?? z.object({ version: z.string().min(1) })
    .parse(JSON.parse(readFileSync(new URL("../../../../package.json", import.meta.url), "utf8"))).version;
  const fail = (value: unknown, reason: "uncaught-exception" | "unhandled-rejection"): never => {
    try {
      const [cause] = serializeErrorCauses(value);
      // Unbound errors can supply their own code.
      appendLocalDebug({ stateRoot: input.stateRoot, build, now: systemClock.now(),
        event: { category: "boot", phase: "failed", area: `${input.processKind}-process`, reason,
          code: "INTERNAL_FAILURE", message: sanitizeDebugText(cause.name), stack: sanitizeDebugText(cause.stack), pinned: true } });
    } finally { process.exit(1); }
  };
  const onException = (error: Error, origin: NodeJS.UncaughtExceptionOrigin): never =>
    fail(error, origin === "unhandledRejection" ? "unhandled-rejection" : "uncaught-exception");
  const onRejection = (value: unknown): never => fail(value, "unhandled-rejection");
  process.once("uncaughtException", onException);
  process.once("unhandledRejection", onRejection);
}
