import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { isDirectExecution } from "../test/scope-files.js";
import { clearGeneratedSection, GENERATED_OUTPUTS, generatedOnlyConflicts } from "./generated-outputs.js";

const TRAIN_IDENTITY = ["-c", "user.name=Relay merge train", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com"];

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function regenerate(root: string): void {
  const npm = ["-u", "GH_TOKEN", "-u", "GITHUB_TOKEN", "npm"];
  execFileSync("env", [...npm, "ci"], { cwd: root, stdio: "inherit" });
  for (const output of GENERATED_OUTPUTS) {
    execFileSync("env", [...npm, "run", output.script], { cwd: root, stdio: "inherit" });
  }
}

export function mergeGeneratedConflicts(root: string, staging: string, generate = regenerate): boolean {
  const merge = spawnSync("git", [...TRAIN_IDENTITY, "merge", "--no-commit", "--no-ff", staging], { cwd: root, encoding: "utf8" });
  if (merge.error !== undefined) throw merge.error;
  if (merge.status !== 0 && merge.status !== 1) throw new Error(`merge-failed: ${merge.stderr}`);
  const conflicts = git(root, "diff", "--name-only", "--diff-filter=U", "-z").split("\0").filter(Boolean);
  if (merge.status !== 0 && !generatedOnlyConflicts(conflicts)) {
    process.stdout.write(`Authored conflicts: ${conflicts.join(", ")}\n`);
    return false;
  }
  for (const output of GENERATED_OUTPUTS) {
    for (const path of output.paths) {
      if (!conflicts.includes(path)) continue;
      if ("section" in output) {
        git(root, "cat-file", "-e", `:2:${path}`);
        git(root, "cat-file", "-e", `:3:${path}`);
        writeFileSync(join(root, path), clearGeneratedSection(readFileSync(join(root, path), "utf8"), output.section));
      } else {
        writeFileSync(join(root, path), "");
      }
    }
  }
  generate(root);
  const generated: readonly string[] = GENERATED_OUTPUTS.flatMap(output => [...output.paths]);
  const changed = git(root, "diff", "--name-only", "-z").split("\0").filter(Boolean);
  if (changed.some(path => !generated.includes(path))) throw new Error("generator-changed-authored-file");
  git(root, "add", "--", ...generated);
  if (git(root, "diff", "--name-only", "--diff-filter=U") !== "") throw new Error("generated-conflicts-unresolved");
  git(root, "diff", "--cached", "--check");
  return true;
}

const PullRequest = z.object({
  state: z.enum(["open", "closed"]),
  draft: z.boolean(),
  user: z.object({ login: z.string() }),
  base: z.object({ ref: z.string() }),
  head: z.object({ sha: z.string(), ref: z.string(), repo: z.object({ full_name: z.string() }) }),
});

function pullRequest(repo: string, number: string): z.infer<typeof PullRequest> {
  const bytes = execFileSync("gh", ["api", `repos/${repo}/pulls/${number}`], { encoding: "utf8" });
  return PullRequest.parse(JSON.parse(bytes));
}

function updatePullRequest(number: string, expectedHead: string, repo: string): boolean {
  const eligible = (pr: z.infer<typeof PullRequest>) => pr.state === "open" && !pr.draft && pr.base.ref === "staging"
    && pr.user.login === "julianthant" && pr.head.repo.full_name === repo && pr.head.sha === expectedHead;
  const pr = pullRequest(repo, number);
  if (!eligible(pr)) throw new Error("pr-no-longer-eligible-or-head-moved");
  const root = resolve(".");
  git(root, "fetch", "origin", "refs/heads/staging");
  const staging = git(root, "rev-parse", "FETCH_HEAD");
  git(root, "fetch", "origin", expectedHead);
  const temporary = mkdtempSync(join(tmpdir(), "relay-train-"));
  const checkout = join(temporary, "checkout");
  try {
    git(root, "worktree", "add", "--detach", checkout, expectedHead);
    if (!mergeGeneratedConflicts(checkout, staging)) return false;
    git(checkout, ...TRAIN_IDENTITY, "commit", "-m", "Merge staging and regenerate derived outputs");
    const current = pullRequest(repo, number);
    if (!eligible(current) || current.head.ref !== pr.head.ref) throw new Error("pr-no-longer-eligible-or-head-moved");
    git(checkout, "push", "origin", `HEAD:refs/heads/${pr.head.ref}`);
    process.stdout.write(`Regenerated and updated #${number}: ${git(checkout, "rev-parse", "HEAD")}\n`);
    return true;
  } finally {
    git(root, "worktree", "remove", "--force", checkout);
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (isDirectExecution(import.meta.url)) {
  const number = z.string().regex(/^\d+$/u).parse(process.argv[2]);
  const expectedHead = z.string().regex(/^[a-f0-9]{40}$/u).parse(process.argv[3]);
  const repo = z.string().regex(/^[\w.-]+\/[\w.-]+$/u).parse(process.argv[4]);
  if (!updatePullRequest(number, expectedHead, repo)) process.exitCode = 1;
}
