import assert from "node:assert/strict";
import { afterEach, it, vi } from "vitest";
import { composeApplicationStop } from "../../../../../src/backend/app/composition/dashboard/shutdown-custody.js";
import type { DashboardComposeInput, DashboardRuntime } from "../../../../../src/backend/app/composition/dashboard/runtime-contracts.js";
import type { composeProfileRuntime } from "../../../../../src/backend/app/composition/storage-compose.js";
import type { RuntimeAdmission } from "../../../../../src/backend/storage/admission/admission.js";
import type { DashboardHttpListener } from "../../../../../src/backend/transports/http/http-server.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";

const { events } = vi.hoisted(() => ({ events: [] as string[] }));
vi.mock("../../../../../src/backend/app/composition/storage-compose.js", async importOriginal => ({
  ...await importOriginal<typeof import("../../../../../src/backend/app/composition/storage-compose.js")>(),
  backupRegisteredPeopleAtCleanShutdown: async () => { events.push("backup"); },
}));

afterEach(() => { events.splice(0); vi.restoreAllMocks(); });

it("writes one timestamped line per shutdown phase, each before its work", async () => {
  const clock = manualClock(new Date("2026-11-11T09:00:00.000Z"));
  const lines: string[] = [];
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(line => {
    if (!String(line).includes("dashboard shutdown")) return true;
    lines.push(String(line));
    const parsed = JSON.parse(String(line)) as { ts: string; level: string; message: string; phase: string };
    assert.deepEqual(parsed, { ts: "2026-11-11T09:00:00.000Z", level: "info", message: "dashboard shutdown", phase: parsed.phase });
    events.push(`phase:${parsed.phase}`);
    return true;
  });
  const stop = composeApplicationStop({
    input: { lifetimeLock: {} } as unknown as DashboardComposeInput,
    profileRuntime: {
      beginClose: () => undefined,
      session: { closeOnboarding: async () => undefined },
      close: async () => { events.push("store.close"); },
    } as unknown as ReturnType<typeof composeProfileRuntime>,
    listener: { close: async () => { events.push("transport.close"); } } as unknown as DashboardHttpListener,
    machine: { release: () => { events.push("machine.release"); } } as unknown as RuntimeAdmission,
    installation: { workspace: {} } as unknown as NonNullable<ReturnType<RuntimeAdmission["readInstallationContext"]>>,
    clock, retainedCustodyFailures: [], beginTransition: () => undefined,
    readSelectedRuntime: () => ({ detach: async () => { events.push("workers.detach"); } }) as unknown as DashboardRuntime,
  });
  await stop();
  stdout.mockRestore();
  assert.deepEqual(events, ["phase:closing transport", "transport.close", "phase:stopping workers", "workers.detach",
    "phase:closing store", "store.close", "machine.release", "phase:backing up", "backup", "phase:done"]);
  assert.ok(lines.every(line => line.endsWith("}\n")));
});
