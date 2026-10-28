import { fork } from "node:child_process";
import { createNominatimGeocodeAdapter } from "../../../../src/backend/processing/providers/geocode-adapters.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { join } from "node:path";

const owner = createNominatimGeocodeAdapter({ clock: systemClock, fetchFn: async (_url, init) => {
  process.send?.({ kind: "fetch-start" });
  return new Promise<Response>((_done, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
} });
const child = fork(join(import.meta.dirname, "nominatim-client.ts"), ["report-stdout"], { execArgv: ["--import", "tsx"], stdio: ["ignore", "inherit", "inherit", "ipc"] });
owner.attach(child);
child.on("message", value => {
  if (typeof value === "object" && value !== null && "kind" in value && value.kind === "ready") process.send?.({ kind: "ready" });
});
process.on("message", value => { if (value === "call") child.send("call"); });
process.once("disconnect", () => { child.kill("SIGKILL"); void owner.stop(); });
