import { testProcessImport } from "../../compiled-process.js";
import { fork } from "node:child_process";
import { createNominatimGeocodeAdapter } from "../../../../src/backend/processing/providers/geocode-adapters.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { join } from "node:path";
import { createIpcRouter } from "../../../../src/backend/runtime/workers/worker-ipc-router.js";

const owner = createNominatimGeocodeAdapter({ clock: systemClock, fetchFn: async (_url, init) => {
  process.send?.({ kind: "fetch-start" });
  return new Promise<Response>((_done, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
} });
const child = fork(join(import.meta.dirname, "nominatim-client.ts"), ["report-stdout"], { execArgv: ["--import", testProcessImport()], stdio: ["ignore", "inherit", "inherit", "ipc"] });
const router = createIpcRouter({ on: (event, listener) => child.on(event, listener), off: (event, listener) => child.off(event, listener),
  disconnect: () => { child.disconnect(); } }, error => { throw error; });
owner.attach(child, router);
router.register("ready", () => { process.send?.({ kind: "ready" }); });
router.register("fetch-start", () => undefined);
router.register("result", () => undefined);
process.on("message", value => { if (value === "call") child.send("call"); });
process.once("disconnect", () => { child.kill("SIGKILL"); void owner.stop(); });
