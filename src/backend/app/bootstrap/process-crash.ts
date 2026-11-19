import { readFileSync } from "node:fs";
import { z } from "zod";
import { systemClock } from "../../../rules/time/clock.js";
import { appendLocalDebug } from "../../storage/events/local-debug-log.js";

export function installProcessCrashHandlers(input: { stateRoot: string; processKind: "dashboard" | "worker"; build?: string }): void {
  const build = input.build ?? z.object({ version: z.string().min(1) })
    .parse(JSON.parse(readFileSync(new URL("../../../../package.json", import.meta.url), "utf8"))).version;
  const fail = (reason: "uncaught-exception" | "unhandled-rejection"): never => {
    try {
      appendLocalDebug({ stateRoot: input.stateRoot, build, now: systemClock.now(),
        event: { category: "boot", phase: "failed", area: `${input.processKind}-process`, reason,
          code: "INTERNAL_FAILURE", pinned: true } });
    } finally { process.exit(1); }
  };
  process.once("uncaughtException", (_error, origin) =>
    fail(origin === "unhandledRejection" ? "unhandled-rejection" : "uncaught-exception"));
  process.once("unhandledRejection", () => fail("unhandled-rejection"));
}
