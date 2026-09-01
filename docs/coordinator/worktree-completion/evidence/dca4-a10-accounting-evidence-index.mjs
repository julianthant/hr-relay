import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
const directory = "docs/coordinator/worktree-completion/evidence";
const prefix = "dca4-a10-accounting-";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const gates = readdirSync(directory).filter(name => name.startsWith(prefix) && name.endsWith("-execution.json")).sort().map(name => {
  const executionBytes = readFileSync(directory + "/" + name);
  const execution = JSON.parse(executionBytes.toString());
  const bytes = readFileSync(execution.log);
  const plain = bytes.toString().replace(/\x1b\[[0-9;]*m/g, "");
  return { name: name.slice(prefix.length, -"-execution.json".length), ...execution,
    rawBytes: bytes.length, rawSha256: sha(bytes), executionSha256: sha(executionBytes),
    counts: plain.split("\n").filter(line => /^\s*(Test Files|Tests |Duration )/.test(line)),
  };
});
const controls = readdirSync(directory).filter(name => name.startsWith(prefix) && name.endsWith("-restoration.json"))
  .sort().map(name => ({ path: directory + "/" + name, sha256: sha(readFileSync(directory + "/" + name)),
    ...JSON.parse(readFileSync(directory + "/" + name, "utf8")) }));
const paths = [prefix+"before.json", prefix+"after-verified.json", prefix+"delta.patch", prefix+"control-baseline.json"];
process.stdout.write(JSON.stringify({ gates, controls, receipts: paths.map(name => ({
  path: directory+"/"+name, sha256: sha(readFileSync(directory+"/"+name)), bytes: readFileSync(directory+"/"+name).length,
})) }, null, 2) + "\n");

