import { createInterface } from "node:readline";
import { startSeededServer } from "../../../../../tests/parity/helpers/seeded-bff.js";
import { PARITY_DIST_DIR } from "../../../../../tests/parity/helpers/bundle.js";

// Evidence-only wrapper: existing synthetic parity composition, no new routes or fixtures.
const server = await startSeededServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
const input = createInterface({ input: process.stdin });
console.log(JSON.stringify({ state: "ready", pid: process.pid, baseUrl: server.baseUrl, day: server.day }));
try {
  for await (const line of input) {
    if (line !== "close") throw new Error("Expected the owned-server close command");
    break;
  }
} finally {
  input.close();
  await server.close();
  console.log(JSON.stringify({ state: "closed", pid: process.pid, port: server.port }));
}
