import { execFileSync } from "node:child_process";

const approved = new Set(["checks.yml", "development.yml", "full.yml", "pr.yml", "staging.yml", "production.yml"]);
const directory = ".github/workflows/";
const base = process.argv[2];
if (!base || !/^[a-f0-9]{40}$/u.test(base)) throw new Error("PR_BASE_SHA must be a commit SHA.");
const labels: unknown = JSON.parse(process.argv[3] ?? "null");
if (!Array.isArray(labels) || !labels.every((label: unknown) => typeof label === "string")) {
  throw new Error("PR_LABELS must be an array of label names.");
}

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
