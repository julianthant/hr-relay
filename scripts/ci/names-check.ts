import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KEBAB = "[a-z0-9]+(?:-[a-z0-9]+)*";
const CONVENTIONAL_AREA = /^(?:build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test|wip)(?:\([^)]*\))?$/u;

interface Request {
  all: boolean;
  branch?: string;
  base?: string;
  title?: string;
  titleSet: boolean;
  worktree?: string;
  originBranches: string[];
  originSet: boolean;
}

function report(name: string, reason: string): string {
  return `${name.replace(/[\r\n]+/gu, " ")}: ${reason}`;
}

function reject(line: string): never {
  process.stderr.write(`${line}\n`);
  process.exit(1);
}

function matches(pattern: string, value: string): boolean {
  return new RegExp(`^${pattern}$`, "u").test(value);
}

function gitText(args: readonly string[]): string {
  return execFileSync("git", [...args], { encoding: "utf8" }).trim();
}

function gitLines(args: readonly string[]): string[] {
  const text = gitText(args);
  return text === "" ? [] : text.split("\n");
}

function originBranchNames(): string[] {
  const names: string[] = [];
  for (const ref of gitLines(["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"])) {
    if (!ref.startsWith("origin/")) continue;
    const name = ref.slice("origin/".length);
    if (name !== "" && name !== "HEAD") names.push(name);
  }
  return names;
}

function localBranchNames(): string[] {
  return gitLines(["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
}

function linkedWorktreePaths(): string[] {
  const paths: string[] = [];
  for (const line of gitLines(["worktree", "list", "--porcelain"])) {
    if (line.startsWith("worktree ")) paths.push(line.slice("worktree ".length));
  }
  // The first porcelain record is the main checkout, not a .worktrees folder.
  return paths.slice(1);
}

function currentBranch(): string {
  const branch = gitText(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "" || branch === "HEAD") return reject(report("HEAD", "detached HEAD is not an allowed branch name"));
  return branch;
}

function branchProblem(branch: string, origin: readonly string[]): string | undefined {
  if (branch === "main" || branch === "staging") return undefined;
  if (matches("dependabot/.+", branch) && !branch.endsWith("/") && !/[\s]/u.test(branch)) return undefined;
  if (matches(`feature/${KEBAB}`, branch)) return undefined;
  if (matches(`design/${KEBAB}`, branch)) return undefined;
  if (matches(`fix/${KEBAB}-${KEBAB}`, branch)) return undefined;
  if (matches(`scratch/${KEBAB}-[0-9]+`, branch)) return undefined;
  if (matches(`task/${KEBAB}/${KEBAB}`, branch)) return undefined;
  // An origin task branch keeps an older lane segment. A new lane stays kebab-case.
  const legacy = new RegExp(`^task/(${KEBAB})/([A-Za-z0-9][A-Za-z0-9._-]*)$`, "u").exec(branch);
  if (legacy && origin.includes(branch)) return undefined;
  return report(branch, "branch name is outside main, staging, dependabot/*, feature/<kebab>, task/<kebab>/<kebab>, fix/<kebab>-<kebab>, design/<kebab>, and scratch/<kebab>-<digits>");
}

function stagingHeadProblem(branch: string): string | undefined {
  if (branchProblem(branch, []) === undefined && (branch.startsWith("dependabot/") || branch.startsWith("feature/") || branch.startsWith("fix/"))) {
    return undefined;
  }
  return report(branch, "a staging pull request head must be feature/*, fix/*, or dependabot/*");
}

function titleProblem(title: string, branch: string): string | undefined {
  if (branchProblem(branch, []) === undefined && branch.startsWith("dependabot/")) return undefined;
  const shown = JSON.stringify(title);
  const match = /^(\S(?:.*\S)?): (\S(?:.*\S)?)$/u.exec(title);
  const area = match?.[1] ?? "";
  if (!match || CONVENTIONAL_AREA.test(area) || /[()]/u.test(area)) {
    return report(shown, "pull request title must be \"<Area>: <text>\"");
  }
  return undefined;
}

function worktreeFolder(path: string): string | undefined {
  const normalized = path.replaceAll("\\", "/");
  const marker = "/.worktrees/";
  const at = normalized.lastIndexOf(marker);
  const folder = at >= 0 ? normalized.slice(at + marker.length)
    : normalized.startsWith(".worktrees/") ? normalized.slice(".worktrees/".length) : undefined;
  if (folder === undefined || folder === "" || folder.includes("/")) return undefined;
  return folder;
}

function worktreeProblem(path: string): string | undefined {
  const folder = worktreeFolder(path);
  const dot = folder?.indexOf(".") ?? -1;
  const feature = folder === undefined ? "" : dot < 0 ? folder : folder.slice(0, dot);
  const lane = folder === undefined || dot < 0 ? undefined : folder.slice(dot + 1);
  if (folder !== undefined && matches(KEBAB, feature) && (lane === undefined || matches(KEBAB, lane))) return undefined;
  return report(path, "worktree folder must be .worktrees/<feature> or .worktrees/<feature>.<lane>");
}

function parse(argv: readonly string[]): Request {
  const request: Request = { all: false, titleSet: false, originBranches: [], originSet: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--all") {
      request.all = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) reject(report(token, "names:check is missing a value"));
    index += 1;
    switch (token) {
      case "--branch":
        request.branch = value;
        break;
      case "--base":
        request.base = value;
        break;
      case "--title":
        request.title = value;
        request.titleSet = true;
        break;
      case "--worktree":
        request.worktree = value;
        break;
      case "--origin-branch":
        request.originBranches.push(value);
        request.originSet = true;
        break;
      default:
        reject(report(token, "names:check does not recognize this argument"));
    }
  }
  return request;
}

function listOffPattern(extraOrigin: readonly string[]): string[] {
  const origin = [...new Set([...originBranchNames(), ...extraOrigin])];
  const lines: string[] = [];
  for (const branch of localBranchNames()) {
    const problem = branchProblem(branch, origin);
    if (problem) lines.push(problem);
  }
  for (const path of linkedWorktreePaths()) {
    const problem = worktreeProblem(path);
    if (problem) lines.push(problem);
  }
  return lines.sort((left, right) => left.localeCompare(right));
}

function main(): void {
  const request = parse(process.argv.slice(2));
  if (request.all) {
    const lines = listOffPattern(request.originBranches);
    if (lines.length > 0) process.stdout.write(`${lines.join("\n")}\n`);
    return;
  }
  const branch = request.branch ?? (request.worktree !== undefined && request.base === undefined && !request.titleSet
    ? undefined
    : currentBranch());
  if (branch !== undefined) {
    const origin = request.originSet || request.branch !== undefined ? request.originBranches : originBranchNames();
    const problem = branchProblem(branch, origin);
    if (problem) reject(problem);
    if (request.base === "staging") {
      const head = stagingHeadProblem(branch);
      if (head) reject(head);
    }
  }
  if (request.titleSet) {
    const problem = titleProblem(request.title ?? "", branch ?? "");
    if (problem) reject(problem);
  }
  if (request.worktree !== undefined) {
    const problem = worktreeProblem(request.worktree);
    if (problem) reject(problem);
  }
}

const entry = process.argv[1];
if (entry !== undefined && fileURLToPath(import.meta.url) === resolve(entry)) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : "names:check failed";
    reject(report("names:check", message.split("\n")[0] ?? "failed"));
  }
}
