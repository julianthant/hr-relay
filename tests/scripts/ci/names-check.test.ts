import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
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

function writeLedger(path: string, rows: readonly { id: string; status: string; branch?: string; notes?: string }[]): void {
  const database = new DatabaseSync(path);
  database.exec("CREATE TABLE tasks (task_id TEXT PRIMARY KEY, branch TEXT, status TEXT NOT NULL, notes TEXT)");
  const insert = database.prepare("INSERT INTO tasks (task_id, branch, status, notes) VALUES (?, ?, ?, ?)");
  for (const row of rows) insert.run(row.id, row.branch ?? "", row.status, row.notes ?? null);
  database.close();
}

describe("names:check", () => {
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
