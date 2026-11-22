import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../../scripts/ci/allowed-workflows.ts", import.meta.url));

describe("allowed workflows check", () => {
  it("requires needs-human to add a workflow outside the four approved files", () => {
    const cwd = mkdtempSync(join(tmpdir(), "allowed-workflows-"));
    const git = (...args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
    const commit = (): void => {
      git("add", ".");
      git("-c", "user.name=Workflow test", "-c", "user.email=workflow@example.test", "commit", "-qm", "fixture");
    };
    const writeWorkflow = (name: string): void => writeFileSync(join(cwd, ".github/workflows", name), "on: push\n");
    try {
      git("init", "-q");
      mkdirSync(join(cwd, ".github/workflows"), { recursive: true });
      writeWorkflow("disabled-evidence.yml");
      commit();
      const base = git("rev-parse", "HEAD");
      const check = (labels: string[]) => spawnSync(process.execPath, [script, base, JSON.stringify(labels)], { cwd, encoding: "utf8" });

      for (const file of ["checks.yml", "development.yml", "staging.yml", "production.yml"]) writeWorkflow(file);
      commit();
      expect(check([]).status).toBe(0);

      writeWorkflow("extra.yaml");
      commit();
      const blocked = check(["reviewed"]);
      expect(blocked.status).toBe(1);
      expect(blocked.stderr).toContain(".github/workflows/extra.yaml");
      expect(check(["needs-human"]).status).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("runs from the shared static job on pull requests", () => {
    const workflow = readFileSync(new URL("../../../.github/workflows/checks.yml", import.meta.url), "utf8");
    const job = workflow.split("\n  static:\n")[1]?.split(/\n {2}[\w-]+:\n/u)[0] ?? "";
    expect(job).toContain("if: github.event_name == 'pull_request'");
    expect(job).toContain("run: node scripts/ci/allowed-workflows.ts \"$PR_BASE_SHA\" \"$PR_LABELS\"");
  });
});
