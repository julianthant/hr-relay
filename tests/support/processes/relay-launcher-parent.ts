import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import koffi from "koffi";
import { startRelay } from "../../../scripts/dev/relay.js";
import { windowsSystemRoot } from "../../../src/models/config/secrets.js";

const root = process.argv[2], loader = process.argv[3];
if (root === undefined || loader === undefined) throw new Error("launcher-parent-fixture-input-required");
const system = windowsSystemRoot();
if (system === undefined) throw new Error("system-root-required");
const kernel = koffi.load(join(system, "System32", "kernel32.dll"));
const currentConsole = kernel.func("uintptr_t __stdcall GetConsoleWindow()");
let consoleWindow: unknown = currentConsole();
if (typeof consoleWindow !== "number" && typeof consoleWindow !== "bigint") throw new Error("console-window-unproved");
if (BigInt(consoleWindow) === 0n) {
  if (kernel.func("int __stdcall AllocConsole()")() === 0) throw new Error("owned-console-creation-failed");
  consoleWindow = currentConsole();
  if (typeof consoleWindow !== "number" && typeof consoleWindow !== "bigint" || BigInt(consoleWindow) === 0n) throw new Error("console-window-unproved");
}
writeFileSync(join(root, "console.json"), JSON.stringify({ pid: process.pid, handle: BigInt(consoleWindow).toString() }));
process.exitCode = await startRelay({ directory: join(root, "launcher"), prepare: async () => undefined,
  backendArguments: ["--import", loader, fileURLToPath(new URL("./relay-drain-child.ts", import.meta.url)), root, "clean"],
  openWindow: async () => { writeFileSync(join(root, "ready"), "ready"); }, write: () => undefined,
});
