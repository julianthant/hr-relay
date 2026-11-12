import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const CLOSED_TICKET = new Set(["complete", "closed"]);

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
  ledger?: string;
  ledgerSet: boolean;
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

interface LinkedWorktree {
  path: string;
  branch?: string;
}

function linkedWorktrees(): LinkedWorktree[] {
  const records: LinkedWorktree[] = [];
  let current: LinkedWorktree | undefined;
  for (const line of gitLines(["worktree", "list", "--porcelain"])) {
    if (line.startsWith("worktree ")) {
      if (current !== undefined) records.push(current);
      current = { path: line.slice("worktree ".length) };
      continue;
    }
    if (current !== undefined && line.startsWith("branch refs/heads/")) {
      current.branch = line.slice("branch refs/heads/".length);
    }
  }
  if (current !== undefined) records.push(current);
  // The first porcelain record is the main checkout, not a .worktrees folder.
  return records.slice(1);
}

function branchToken(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const name = value.trim();
  if (name === "" || name === "none" || /\s/u.test(name)) return undefined;
  return name;
}

function branchFromNotes(notes: string | null): string | undefined {
  if (notes === null) return undefined;
  return branchToken(/^Branch:\s*`([^`]+)`/mu.exec(notes)?.[1]);
}

function textColumn(value: unknown, ledger: string, column: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`ticket ledger is unreadable (${ledger}): tasks.${column} is not text`);
  return value;
}

export interface TicketOwner {
  status: string;
  branch?: string;
  worktree?: string;
}

function repoRoot(): string {
  return resolve(gitText(["rev-parse", "--path-format=absolute", "--git-common-dir"]), "..");
}

function canonicalIdentity(path: string): string {
  const lexical = resolve(path);
  try {
    return realpathSync(lexical);
  } catch (error) {
    if (!existsSync(lexical)) return lexical;
    const message = error instanceof Error ? error.message : "unreadable";
    throw new Error(`worktree path is unreadable (${lexical}): ${message}`, { cause: error });
  }
}

function canonicalWorktree(path: string, root: string): string {
  const slash = path.replaceAll("\\", "/").replace(/\/+$/u, "");
  const absolute = slash.startsWith("/") || /^[A-Za-z]:\//u.test(slash) ? slash : join(root, slash);
  return canonicalIdentity(absolute);
}

function sameWorktree(left: string, right: string): boolean {
  const normalize = (value: string): string => value.replaceAll("\\", "/").replace(/\/+$/u, "");
  return canonicalIdentity(normalize(left)) === canonicalIdentity(normalize(right));
}

function ticketRows(ledger: string, root: string): TicketOwner[] {
  let database: DatabaseSync;
  try {
    database = new DatabaseSync(ledger, { readOnly: true, timeout: 2000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unreadable";
    throw new Error(`ticket ledger is unreadable (${ledger}): ${message}`, { cause: error });
  }
  try {
    const rows = database.prepare("SELECT branch, worktree, status, notes FROM tasks").all();
    const owners: TicketOwner[] = [];
    for (const row of rows) {
      const status = textColumn(row.status ?? null, ledger, "status");
      if (status === null || status === "") throw new Error(`ticket ledger is unreadable (${ledger}): tasks.status is missing`);
      const column = textColumn(row.branch ?? null, ledger, "branch");
      const notes = textColumn(row.notes ?? null, ledger, "notes");
      const worktree = textColumn(row.worktree ?? null, ledger, "worktree");
      const named = branchToken(column ?? undefined) ?? branchFromNotes(notes);
      const path = worktree === null || worktree.trim() === "" ? undefined : canonicalWorktree(worktree.trim(), root);
      const owner: TicketOwner = { status };
      if (named !== undefined) owner.branch = named;
      if (path !== undefined) owner.worktree = path;
      owners.push(owner);
    }
    return owners;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("ticket ledger is unreadable")) throw error;
    const message = error instanceof Error ? error.message : "unreadable";
    throw new Error(`ticket ledger is unreadable (${ledger}): ${message}`, { cause: error });
  } finally {
    database.close();
  }
}

function closedBranch(branch: string, rows: readonly TicketOwner[]): boolean {
  const owners = rows.filter((row) => row.branch === branch);
  return owners.length > 0 && owners.every((row) => CLOSED_TICKET.has(row.status));
}

export function closedWorktreeLine(path: string, checkoutBranch: string | undefined, rows: readonly TicketOwner[]): string | undefined {
  const pathOwners = rows.filter((row) => {
    const owned = row.worktree?.trim() ?? "";
    return owned !== "" && sameWorktree(owned, path);
  });
  if (pathOwners.some((row) => !CLOSED_TICKET.has(row.status))) return undefined;
  const branchOwners = checkoutBranch === undefined ? [] : rows.filter((row) => row.branch === checkoutBranch);
  if (branchOwners.some((row) => !CLOSED_TICKET.has(row.status))) return undefined;
  const associated = pathOwners.flatMap((row) => row.branch === undefined ? [] : [row.branch]);
  const associatedOpen = associated.some((branch) => rows.some((row) => row.branch === branch && !CLOSED_TICKET.has(row.status)));
  if (associatedOpen) return undefined;
  const owners = checkoutBranch === undefined ? pathOwners : [...pathOwners, ...branchOwners];
  if (!owners.some((row) => CLOSED_TICKET.has(row.status))) return undefined;
  return report(path, "ticket is closed");
}

function discoveredLedger(): string | undefined {
  const top = gitText(["rev-parse", "--show-toplevel"]);
  const manifest = join(top, "package.json");
  if (!existsSync(manifest)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifest, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unreadable";
    throw new Error(`package.json is unreadable: ${message}`, { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null || !("name" in parsed)) {
    throw new Error("package.json name is not a single path segment");
  }
  const name = parsed.name;
  if (typeof name !== "string" || !/^[A-Za-z0-9._-]+$/u.test(name)) {
    throw new Error("package.json name is not a single path segment");
  }
  const path = join(homedir(), ".concord-ledger", name, ".concord", "concord.db");
  return existsSync(path) ? path : undefined;
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
  if (matches(`chore/${KEBAB}-${KEBAB}`, branch)) return undefined;
  if (matches(`hotfix/${KEBAB}-${KEBAB}`, branch)) return undefined;
  if (matches(`task/${KEBAB}/${KEBAB}`, branch)) return undefined;
  // An origin task branch keeps an older lane segment. A new lane stays kebab-case.
  const legacy = new RegExp(`^task/(${KEBAB})/([A-Za-z0-9][A-Za-z0-9._-]*)$`, "u").exec(branch);
  if (legacy && origin.includes(branch)) return undefined;
  return report(branch, "branch name is outside main, staging, dependabot/*, feature/<kebab>, task/<kebab>/<kebab>, fix/<kebab>-<kebab>, chore/<kebab>-<kebab>, hotfix/<kebab>-<kebab>, and design/<kebab>");
}

function stagingHeadProblem(branch: string): string | undefined {
  if (branchProblem(branch, []) === undefined && (branch.startsWith("dependabot/") || branch.startsWith("feature/") || branch.startsWith("fix/") || branch.startsWith("chore/"))) {
    return undefined;
  }
  return report(branch, "a staging pull request head must be feature/*, fix/*, chore/*, or dependabot/*");
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
  const request: Request = { all: false, titleSet: false, originBranches: [], originSet: false, ledgerSet: false };
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
      case "--ledger":
        request.ledger = value;
        request.ledgerSet = true;
        break;
      default:
        reject(report(token, "names:check does not recognize this argument"));
    }
  }
  return request;
}

function listOffPattern(extraOrigin: readonly string[], ledger: string | undefined): string[] {
  const origin = [...new Set([...originBranchNames(), ...extraOrigin])];
  const root = repoRoot();
  const rows = ledger === undefined ? [] : ticketRows(ledger, root);
  const lines: string[] = [];
  for (const branch of localBranchNames()) {
    const problem = branchProblem(branch, origin);
    if (problem) lines.push(problem);
    else if (closedBranch(branch, rows)) lines.push(report(branch, "ticket is closed"));
  }
  for (const worktree of linkedWorktrees()) {
    const problem = worktreeProblem(worktree.path);
    if (problem) lines.push(problem);
    const line = closedWorktreeLine(canonicalWorktree(worktree.path, root), worktree.branch, rows);
    if (line !== undefined) lines.push(line);
  }
  return lines.sort((left, right) => left.localeCompare(right));
}

function main(): void {
  const request = parse(process.argv.slice(2));
  if (request.all) {
    const ledger = request.ledgerSet ? request.ledger : discoveredLedger();
    if (request.ledgerSet && (ledger === undefined || !existsSync(ledger))) {
      reject(report(ledger ?? "--ledger", "ticket ledger was not found"));
    }
    const lines = listOffPattern(request.originBranches, ledger);
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
