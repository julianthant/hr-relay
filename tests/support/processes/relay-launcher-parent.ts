import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startRelay } from "../../../scripts/dev/relay.js";

const root = process.argv[2], loader = process.argv[3];
if (root === undefined || loader === undefined) throw new Error("launcher-parent-fixture-input-required");
writeFileSync(join(root, "console.json"), JSON.stringify({ pid: process.pid, consolePid: process.ppid }));
process.exitCode = await startRelay({ directory: join(root, "launcher"), prepare: async () => undefined,
  backendArguments: ["--import", loader, fileURLToPath(new URL("./relay-drain-child.ts", import.meta.url)), root, "clean"],
  openWindow: async () => { writeFileSync(join(root, "ready"), "ready"); }, write: () => undefined,
});
