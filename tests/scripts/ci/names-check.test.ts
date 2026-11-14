import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { closedWorktreeLine, type TicketOwner } from "../../../scripts/ci/names-check.js";
import { nameCases, runNamesCheck } from "../../support/helpers/names-check-cases.js";

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8" });
}

function initRepo(root: string): void {
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "names-check@example.com"]);
  git(root, ["config", "user.name", "names-check"]);
  git(root, ["commit", "--allow-empty", "-q", "-m", "init"]);
}

function snapshot(root: string): { branches: string; worktrees: string; status: string } {
  return {
    branches: git(root, ["branch", "--format=%(refname:short)"]),
    worktrees: git(root, ["worktree", "list", "--porcelain"]),
    status: git(root, ["status", "--porcelain"]),
  };
}

function writeLedger(path: string, rows: readonly { id: string; status: string; branch?: string; notes?: string; worktree?: string }[]): void {
  const database = new DatabaseSync(path);
  database.exec("CREATE TABLE tasks (task_id TEXT PRIMARY KEY, branch TEXT, worktree TEXT, status TEXT NOT NULL, notes TEXT)");
  const insert = database.prepare("INSERT INTO tasks (task_id, branch, worktree, status, notes) VALUES (?, ?, ?, ?, ?)");
  for (const row of rows) insert.run(row.id, row.branch ?? "", row.worktree ?? "", row.status, row.notes ?? null);
  database.close();
}

function filesystemAlias(porcelain: string): string {
  const real = realpathSync(porcelain);
  const alias = `${porcelain}.alias`;
  symlinkSync(real, alias);
  if (realpathSync(alias) !== real) throw new Error(`alias ${alias} does not resolve to ${real}`);
  return alias;
}

function worktreePath(root: string, folder: string): string {
  const line = git(root, ["worktree", "list", "--porcelain"]).split("\n").find((entry) => entry.includes(`/${folder}`));
  const path = line?.slice("worktree ".length);
  if (path === undefined || path === "") throw new Error(`missing worktree ${folder}`);
  return path;
}

const path = "/repo/.worktrees/names.closed";

const worktreeLineCases: readonly { label: string; checkout?: string; rows: readonly TicketOwner[]; line?: string }[] = [
  {
    label: "closed checkout branch and no path rows",
    checkout: "task/names/closed",
    rows: [{ status: "complete", branch: "task/names/closed" }],
    line: `${path}: ticket is closed`,
  },
  {
    label: "closed checkout branch plus an active row on the same path",
    checkout: "task/names/closed",
    rows: [
      { status: "complete", branch: "task/names/closed", worktree: path },
      { status: "active", branch: "feature/still-open", worktree: path },
    ],
  },
  {
    label: "detached path all closed",
    rows: [{ status: "complete", worktree: path }],
    line: `${path}: ticket is closed`,
  },
  {
    label: "detached path with an active owner",
    rows: [{ status: "active", worktree: path }],
  },
  {
    label: "detached path whose named branch still has an open ticket",
    rows: [
      { status: "complete", branch: "feature/shared", worktree: path },
      { status: "active", branch: "feature/shared" },
    ],
  },
  {
    label: "one complete and one active on the same path",
    rows: [
      { status: "complete", worktree: path },
      { status: "active", worktree: path },
    ],
  },
  {
    label: "active ticket on the checkout branch",
    checkout: "task/names/closed",
    rows: [
      { status: "complete", worktree: path },
      { status: "active", branch: "task/names/closed" },
    ],
  },
];

describe("names:check", () => {
  it.each(worktreeLineCases)("worktree line: $label", ({ checkout, rows, line }) => {
    expect(closedWorktreeLine(path, checkout, rows)).toBe(line);
  });

  it.each(nameCases)("$label", ({ args, ok, offender }) => {
    const result = runNamesCheck(args);
    expect(result.error).toBeUndefined();
    const output = `${result.stdout}${result.stderr}`;
    if (ok) {
      expect(result.status).toBe(0);
      expect(output).toBe("");
      return;
    }
    expect(result.status).not.toBe(0);
    const lines = output.split("\n").filter((line) => line !== "");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(offender);
  });

  it("lists off-pattern branches and worktrees twice without deleting them", () => {
    const root = mkdtempSync(join(tmpdir(), "names-check-all-"));
    const outside = mkdtempSync(join(tmpdir(), "names-check-outside-"));
    try {
      initRepo(root);
      git(root, ["branch", "staging"]);
      git(root, ["branch", "chore/leftover"]);
      git(root, ["worktree", "add", "-q", "-b", "feature/outside", outside]);
      const before = snapshot(root);
      const first = runNamesCheck(["--all"], root);
      const second = runNamesCheck(["--all"], root);
      expect(first.status).toBe(0);
      expect(second.status).toBe(0);
      expect(first.stdout).toBe(second.stdout);
      expect(first.stderr).toBe("");
      expect(first.stdout).toContain("chore/leftover");
      expect(first.stdout).toContain(outside);
      expect(snapshot(root)).toEqual(before);
    } finally {
      git(root, ["worktree", "remove", "--force", outside]);
      rmSync(outside, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exits zero when every local branch and worktree matches", () => {
    const root = mkdtempSync(join(tmpdir(), "names-check-clean-"));
    try {
      initRepo(root);
      git(root, ["branch", "staging"]);
      git(root, ["worktree", "add", "-q", "-b", "feature/names", ".worktrees/names"]);
      git(root, ["branch", "task/names/check"]);
      const result = runNamesCheck(["--all"], root);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts a good title and rejects a conventional title on the same head", () => {
    const head = ["--branch", "feature/names", "--base", "staging"] as const;
    const good = runNamesCheck([...head, "--title", "Workspace: check names"]);
    const bad = runNamesCheck([...head, "--title", "feat(ci): add names check"]);
    expect(good.status).toBe(0);
    expect(`${good.stdout}${good.stderr}`).toBe("");
    expect(bad.status).not.toBe(0);
    const lines = `${bad.stdout}${bad.stderr}`.split("\n").filter((line) => line !== "");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("feat(ci): add names check");
  });

  it("lists a closed ticket branch and its worktree without deleting them", () => {
    const root = mkdtempSync(join(tmpdir(), "names-check-closed-"));
    const ledger = join(root, "ledger.db");
    try {
      initRepo(root);
      git(root, ["branch", "feature/closed-lane"]);
      git(root, ["branch", "feature/open-lane"]);
      git(root, ["branch", "feature/reopened"]);
      git(root, ["branch", "feature/column-closed"]);
      git(root, ["worktree", "add", "-q", ".worktrees/closed-lane", "feature/closed-lane"]);
      writeLedger(ledger, [
        { id: "closed", status: "complete", notes: "Branch: `feature/closed-lane` · Feature branch: `feature/elsewhere`" },
        { id: "open", status: "active", notes: "Branch: `feature/open-lane`" },
        { id: "reopened-old", status: "complete", notes: "Branch: `feature/reopened`" },
        { id: "reopened-new", status: "active", notes: "Branch: `feature/reopened`" },
        { id: "column", status: "closed", branch: "feature/column-closed" },
        { id: "absent", status: "complete", notes: "Branch: `feature/absent`" },
      ]);
      const worktreePath = git(root, ["worktree", "list", "--porcelain"])
        .split("\n")
        .find((line) => line.includes(".worktrees/closed-lane"))
        ?.slice("worktree ".length);
      const before = snapshot(root);
      const first = runNamesCheck(["--all", "--ledger", ledger], root);
      const second = runNamesCheck(["--all", "--ledger", ledger], root);
      const expected = [
        "feature/closed-lane: ticket is closed",
        "feature/column-closed: ticket is closed",
        `${worktreePath}: ticket is closed`,
      ].sort((left, right) => left.localeCompare(right));
      expect(first.status).toBe(0);
      expect(second.status).toBe(0);
      expect(first.stderr).toBe("");
      expect(first.stdout).toBe(second.stdout);
      expect(first.stdout).toBe(`${expected.join("\n")}\n`);
      expect(first.stdout).not.toContain("feature/open-lane");
      expect(first.stdout).not.toContain("feature/reopened");
      expect(first.stdout).not.toContain("feature/absent");
      expect(snapshot(root)).toEqual(before);
    } finally {
      try {
        git(root, ["worktree", "remove", "--force", ".worktrees/closed-lane"]);
      } catch {
        // Cleanup only. The assertion above is the result that matters.
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lists a detached worktree whose ticket is closed without deleting it", () => {
    const root = mkdtempSync(join(tmpdir(), "names-check-detached-"));
    const ledger = join(root, "ledger.db");
    try {
      initRepo(root);
      git(root, ["branch", "task/names/closed"]);
      git(root, ["worktree", "add", "-q", "--detach", ".worktrees/names.closed", "task/names/closed"]);
      git(root, ["worktree", "add", "-q", "--detach", ".worktrees/open-detached", "HEAD"]);
      git(root, ["worktree", "add", "-q", "--detach", ".worktrees/shared-lane", "HEAD"]);
      const detached = worktreePath(root, ".worktrees/names.closed");
      const openDetached = worktreePath(root, ".worktrees/open-detached");
      const shared = worktreePath(root, ".worktrees/shared-lane");
      writeLedger(ledger, [
        { id: "detached", status: "complete", branch: "task/names/closed", worktree: detached },
        { id: "open-path", status: "active", worktree: openDetached },
        { id: "shared-closed", status: "complete", branch: "feature/shared", worktree: shared },
        { id: "shared-open", status: "active", branch: "feature/shared" },
      ]);
      const before = snapshot(root);
      const first = runNamesCheck(["--all", "--ledger", ledger], root);
      const second = runNamesCheck(["--all", "--ledger", ledger], root);
      const expected = [
        "task/names/closed: ticket is closed",
        `${detached}: ticket is closed`,
      ].sort((left, right) => left.localeCompare(right));
      expect(first.status).toBe(0);
      expect(second.status).toBe(0);
      expect(first.stderr).toBe("");
      expect(first.stdout).toBe(second.stdout);
      expect(first.stdout).toBe(`${expected.join("\n")}\n`);
      expect(first.stdout).not.toContain("open-detached");
      expect(first.stdout).not.toContain("shared-lane");
      expect(first.stdout).not.toContain("feature/shared");
      expect(snapshot(root)).toEqual(before);
    } finally {
      for (const folder of [".worktrees/names.closed", ".worktrees/open-detached", ".worktrees/shared-lane"]) {
        try {
          git(root, ["worktree", "remove", "--force", folder]);
        } catch {
          // Cleanup only. The assertion above is the result that matters.
        }
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaves an attached worktree unlisted when an active ticket owns that path", () => {
    const root = mkdtempSync(join(tmpdir(), "names-check-attached-"));
    const ledger = join(root, "ledger.db");
    try {
      initRepo(root);
      git(root, ["branch", "task/names/closed"]);
      git(root, ["worktree", "add", "-q", ".worktrees/names.closed", "task/names/closed"]);
      const path = worktreePath(root, ".worktrees/names.closed");
      writeLedger(ledger, [
        { id: "closed", status: "complete", branch: "task/names/closed", worktree: path },
        { id: "open", status: "active", branch: "feature/still-open", worktree: path },
      ]);
      const before = snapshot(root);
      const first = runNamesCheck(["--all", "--ledger", ledger], root);
      const second = runNamesCheck(["--all", "--ledger", ledger], root);
      expect(first.status).toBe(0);
      expect(second.status).toBe(0);
      expect(first.stderr).toBe("");
      expect(first.stdout).toBe(second.stdout);
      expect(first.stdout).toBe("task/names/closed: ticket is closed\n");
      expect(first.stdout).not.toContain(path);
      expect(first.stdout).not.toContain("feature/still-open");
      expect(snapshot(root)).toEqual(before);
    } finally {
      try {
        git(root, ["worktree", "remove", "--force", ".worktrees/names.closed"]);
      } catch {
        // Cleanup only. The assertion above is the result that matters.
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lists a detached worktree when the ledger path is a symlink alias", () => {
    const root = mkdtempSync(join(tmpdir(), "names-check-alias-detached-"));
    const ledger = join(root, "ledger.db");
    try {
      initRepo(root);
      git(root, ["branch", "task/names/closed"]);
      git(root, ["worktree", "add", "-q", "--detach", ".worktrees/names.closed", "task/names/closed"]);
      const porcelain = worktreePath(root, ".worktrees/names.closed");
      writeLedger(ledger, [
        { id: "closed", status: "complete", branch: "task/names/closed", worktree: filesystemAlias(porcelain) },
      ]);
      const before = snapshot(root);
      const first = runNamesCheck(["--all", "--ledger", ledger], root);
      const second = runNamesCheck(["--all", "--ledger", ledger], root);
      const expected = [
        "task/names/closed: ticket is closed",
        `${porcelain}: ticket is closed`,
      ].sort((left, right) => left.localeCompare(right));
      expect(first.status).toBe(0);
      expect(second.status).toBe(0);
      expect(first.stderr).toBe("");
      expect(first.stdout).toBe(second.stdout);
      expect(first.stdout).toBe(`${expected.join("\n")}\n`);
      expect(snapshot(root)).toEqual(before);
    } finally {
      try {
        git(root, ["worktree", "remove", "--force", ".worktrees/names.closed"]);
      } catch {
        // Cleanup only. The assertion above is the result that matters.
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("an active ticket at a symlink alias keeps the attached worktree unlisted", () => {
    const root = mkdtempSync(join(tmpdir(), "names-check-alias-attached-"));
    const ledger = join(root, "ledger.db");
    try {
      initRepo(root);
      git(root, ["branch", "task/names/closed"]);
      git(root, ["worktree", "add", "-q", ".worktrees/names.closed", "task/names/closed"]);
      const porcelain = worktreePath(root, ".worktrees/names.closed");
      writeLedger(ledger, [
        { id: "closed", status: "complete", branch: "task/names/closed", worktree: porcelain },
        { id: "open", status: "active", branch: "feature/still-open", worktree: filesystemAlias(porcelain) },
      ]);
      const before = snapshot(root);
      const first = runNamesCheck(["--all", "--ledger", ledger], root);
      const second = runNamesCheck(["--all", "--ledger", ledger], root);
      expect(first.status).toBe(0);
      expect(second.status).toBe(0);
      expect(first.stderr).toBe("");
      expect(first.stdout).toBe(second.stdout);
      expect(first.stdout).toBe("task/names/closed: ticket is closed\n");
      expect(first.stdout).not.toContain(porcelain);
      expect(first.stdout).not.toContain("feature/still-open");
      expect(snapshot(root)).toEqual(before);
    } finally {
      try {
        git(root, ["worktree", "remove", "--force", ".worktrees/names.closed"]);
      } catch {
        // Cleanup only. The assertion above is the result that matters.
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses an unreadable ticket ledger and deletes nothing", () => {
    const root = mkdtempSync(join(tmpdir(), "names-check-ledger-"));
    const ledger = join(root, "not-a-ledger");
    try {
      initRepo(root);
      git(root, ["branch", "feature/names"]);
      writeFileSync(ledger, "not sqlite");
      const before = snapshot(root);
      const result = runNamesCheck(["--all", "--ledger", ledger], root);
      const lines = `${result.stdout}${result.stderr}`.split("\n").filter((line) => line !== "");
      expect(result.status).not.toBe(0);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("not-a-ledger");
      expect(snapshot(root)).toEqual(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
