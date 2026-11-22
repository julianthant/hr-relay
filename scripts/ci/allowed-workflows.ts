import { execFileSync } from "node:child_process";
import { z } from "zod";

const approved = new Set(["checks.yml", "development.yml", "staging.yml", "production.yml"]);
const directory = ".github/workflows/";
const base = z.string().regex(/^[a-f0-9]{40}$/u).parse(process.argv[2]);
const labels = z.array(z.string()).parse(JSON.parse(process.argv[3] ?? "null"));

if (!labels.includes("needs-human")) {
  const additions = execFileSync("git", [
    "diff", "--no-renames", "--diff-filter=A", "--name-only", "-z", base, "HEAD", "--", directory,
  ], { encoding: "utf8" });
  const unexpected = additions.split("\0").filter(path => /\.ya?ml$/u.test(path) && !approved.has(path.slice(directory.length)));
  if (unexpected.length > 0) {
    process.stderr.write(`Adding workflows requires the needs-human label: ${unexpected.map(path => JSON.stringify(path)).join(", ")}\n`);
    process.exitCode = 1;
  }
}
