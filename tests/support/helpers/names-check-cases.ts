import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../../scripts/ci/names-check.ts", import.meta.url));

export interface NameCase {
  readonly label: string;
  readonly args: readonly string[];
  readonly ok: boolean;
  readonly offender: string;
}

const olderLane = ["--branch", "task/names-check-fixture/Old_Lane", "--origin-branch", "task/names-check-fixture/Old_Lane"] as const;

export const nameCases: readonly NameCase[] = [
  { label: "accepts main", args: ["--branch", "main"], ok: true, offender: "" },
  { label: "accepts development", args: ["--branch", "development"], ok: true, offender: "" },
  { label: "accepts staging", args: ["--branch", "staging"], ok: true, offender: "" },
  { label: "accepts dependabot/npm_and_yarn/lodash-4.17.21", args: ["--branch", "dependabot/npm_and_yarn/lodash-4.17.21"], ok: true, offender: "" },
  { label: "accepts feature/workspace-conventions", args: ["--branch", "feature/workspace-conventions"], ok: true, offender: "" },
  { label: "accepts feature/storage", args: ["--branch", "feature/storage"], ok: true, offender: "" },
  { label: "accepts task/workspace-conventions/name-check", args: ["--branch", "task/workspace-conventions/name-check"], ok: true, offender: "" },
  { label: "accepts fix/ci-names", args: ["--branch", "fix/ci-names"], ok: true, offender: "" },
  { label: "accepts fix/workspace-conventions-bad-name", args: ["--branch", "fix/workspace-conventions-bad-name"], ok: true, offender: "" },
  { label: "accepts design/dashboard-mock", args: ["--branch", "design/dashboard-mock"], ok: true, offender: "" },
  { label: "accepts an origin task branch with an older lane", args: olderLane, ok: true, offender: "" },
  { label: "rejects chore/docs", args: ["--branch", "chore/docs"], ok: false, offender: "chore/docs" },
  { label: "rejects follow-up/settings-parity", args: ["--branch", "follow-up/settings-parity"], ok: false, offender: "follow-up/settings-parity" },
  { label: "rejects check/names", args: ["--branch", "check/names"], ok: false, offender: "check/names" },
  { label: "rejects feature/Workspace", args: ["--branch", "feature/Workspace"], ok: false, offender: "feature/Workspace" },
  { label: "rejects feature/workspace_conventions", args: ["--branch", "feature/workspace_conventions"], ok: false, offender: "feature/workspace_conventions" },
  { label: "rejects task/workspace-conventions", args: ["--branch", "task/workspace-conventions"], ok: false, offender: "task/workspace-conventions" },
  { label: "rejects task/workspace-conventions/name-check/extra", args: ["--branch", "task/workspace-conventions/name-check/extra"], ok: false, offender: "task/workspace-conventions/name-check/extra" },
  { label: "rejects fix/ci", args: ["--branch", "fix/ci"], ok: false, offender: "fix/ci" },
  { label: "accepts hotfix/duo-window-crash", args: ["--branch", "hotfix/duo-window-crash"], ok: true, offender: "" },
  { label: "rejects hotfix/x", args: ["--branch", "hotfix/x"], ok: false, offender: "hotfix/x" },
  { label: "rejects scratch/workers-1", args: ["--branch", "scratch/workers-1"], ok: false, offender: "scratch/workers-1" },
  { label: "rejects scratch/1", args: ["--branch", "scratch/1"], ok: false, offender: "scratch/1" },
  { label: "rejects dependabot", args: ["--branch", "dependabot"], ok: false, offender: "dependabot" },
  { label: "rejects task/names-check-fixture/Old_Lane when it is not on origin", args: ["--branch", "task/names-check-fixture/Old_Lane"], ok: false, offender: "task/names-check-fixture/Old_Lane" },
  { label: "rejects task/NotKebab/Old_Lane even on origin", args: ["--branch", "task/NotKebab/Old_Lane", "--origin-branch", "task/NotKebab/Old_Lane"], ok: false, offender: "task/NotKebab/Old_Lane" },
  { label: "rejects feature/Old_Name even on origin", args: ["--branch", "feature/Old_Name", "--origin-branch", "feature/Old_Name"], ok: false, offender: "feature/Old_Name" },
  { label: "accepts a development feature head and an area title", args: ["--branch", "feature/workspace-conventions", "--base", "development", "--title", "Workspace conventions: check names"], ok: true, offender: "" },
  { label: "accepts a development chore head", args: ["--branch", "chore/remove-parity-suite", "--base", "development", "--title", "Tests: remove the parity suite"], ok: true, offender: "" },
  { label: "accepts a development fix head", args: ["--branch", "fix/ci-names", "--base", "development", "--title", "CI: reject a bad branch name"], ok: true, offender: "" },
  { label: "accepts a dependabot development head with an area title", args: ["--branch", "dependabot/npm_and_yarn/foo", "--base", "development", "--title", "Dependencies: bump foo"], ok: true, offender: "" },
  { label: "rejects a development hotfix head", args: ["--branch", "hotfix/duo-window-crash", "--base", "development", "--title", "Hotfix: close the Duo window crash"], ok: false, offender: "hotfix/duo-window-crash" },
  { label: "accepts a canonical task head into development", args: ["--branch", "task/workspace-conventions/name-check", "--base", "development", "--title", "Workspace: check task names"], ok: true, offender: "" },
  { label: "rejects a legacy task lane into development even when it exists on origin", args: [...olderLane, "--base", "development"], ok: false, offender: "task/names-check-fixture/Old_Lane" },
  { label: "accepts the CI cleanup task into development", args: ["--branch", "task/ci-environments/cleanup", "--base", "development", "--title", "CI: enforce workflow rules"], ok: true, offender: "" },
  { label: "accepts cut/staging-cut", args: ["--branch", "cut/staging-cut"], ok: true, offender: "" },
  { label: "accepts a milestone cut into staging", args: ["--branch", "cut/staging-cut", "--base", "staging", "--title", "CI: cut staging"], ok: true, offender: "" },
  { label: "accepts main into staging for the release sync", args: ["--branch", "main", "--base", "staging", "--title", "Release: Sync main into staging after v2026.11.22"], ok: true, offender: "" },
  ...["development", "cut/Not-Kebab", "cut/staging-cut/extra", "feature/workspace-conventions", "fix/ci-names", "chore/remove-parity-suite", "dependabot/npm_and_yarn/foo", "staging", "hotfix/duo-window-crash", "task/workspace-conventions/name-check", "design/dashboard-mock"].map(branch => ({
    label: `rejects ${branch} into staging`, args: ["--branch", branch, "--base", "staging", "--title", "CI: promote development"], ok: false, offender: branch,
  })),
  ...["development", "main", "staging", "cut/staging-cut", "design/dashboard-mock"].map(branch => ({
    label: `rejects ${branch} into development`, args: ["--branch", branch, "--base", "development", "--title", "CI: check development"], ok: false, offender: branch,
  })),
  { label: "rejects a conventional dependabot development title", args: ["--branch", "dependabot/npm_and_yarn/foo", "--base", "development", "--title", "chore(deps): bump foo"], ok: false, offender: "chore(deps): bump foo" },
  { label: "rejects feat(ci): add names check", args: ["--branch", "feature/workspace-conventions", "--title", "feat(ci): add names check"], ok: false, offender: "feat(ci): add names check" },
  { label: "rejects a title with an empty area", args: ["--branch", "feature/workspace-conventions", "--title", ": add names check"], ok: false, offender: ": add names check" },
  { label: "rejects a title with no colon", args: ["--branch", "feature/workspace-conventions", "--title", "add names check"], ok: false, offender: "add names check" },
  { label: "accepts .worktrees/workspace-conventions", args: ["--worktree", ".worktrees/workspace-conventions"], ok: true, offender: "" },
  { label: "accepts .worktrees/workspace-conventions.name-check", args: ["--worktree", ".worktrees/workspace-conventions.name-check"], ok: true, offender: "" },
  { label: "accepts an absolute .worktrees feature folder", args: ["--worktree", "/Users/example/repo/.worktrees/emergency-contact-served-switch"], ok: true, offender: "" },
  { label: "rejects .worktrees/Foo", args: ["--worktree", ".worktrees/Foo"], ok: false, offender: ".worktrees/Foo" },
  { label: "rejects .worktrees/workspace_conventions", args: ["--worktree", ".worktrees/workspace_conventions"], ok: false, offender: ".worktrees/workspace_conventions" },
  { label: "rejects .worktrees/foo.bar.baz", args: ["--worktree", ".worktrees/foo.bar.baz"], ok: false, offender: ".worktrees/foo.bar.baz" },
  { label: "rejects .worktrees/feature/lane", args: ["--worktree", ".worktrees/feature/lane"], ok: false, offender: ".worktrees/feature/lane" },
  { label: "rejects a worktree outside .worktrees", args: ["--worktree", "/private/tmp/g2"], ok: false, offender: "/private/tmp/g2" },
];

export function runNamesCheck(args: readonly string[], cwd?: string) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
}
