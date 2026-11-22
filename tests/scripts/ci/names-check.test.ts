import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    const head = ["--branch", "feature/names", "--base", "development"] as const;
    const good = runNamesCheck([...head, "--title", "Workspace: check names"]);
    const bad = runNamesCheck([...head, "--title", "feat(ci): add names check"]);
    expect(good.status).toBe(0);
    expect(`${good.stdout}${good.stderr}`).toBe("");
    expect(bad.status).not.toBe(0);
    const lines = `${bad.stdout}${bad.stderr}`.split("\n").filter((line) => line !== "");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("feat(ci): add names check");
  });
});
