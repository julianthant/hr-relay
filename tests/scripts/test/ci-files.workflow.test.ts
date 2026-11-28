import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, matchesGlob } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { ciPlanSchema, createCiPlan, hasTimingArtifact, registeredTimingWorkflows, timingRunIds } from "../../../scripts/test/ci-plan.js";
import { LINUX_NATIVE_FILES, NATIVE_FILES, SERIAL_FILES, SERIAL_STORAGE_FILES, selectCiFiles } from "../../../scripts/test/ci-files.js";
import type { CiPlan } from "../../../scripts/test/ci-plan.js";
import { dialogsShareShape } from "../../support/helpers/dashboard/smoke/state-rules.js";
import { START_STEP } from "../../../scripts/ci/full-run.js";

const load = (name: string) => readFileSync(new URL(`../../../.github/workflows/${name}.yml`, import.meta.url), "utf8");
const development = load("development");
const full = load("full");
const pr = load("pr");
const staging = load("staging");
const production = load("production");
const checks = load("checks");
const filters = { shared: "true", unit: "false", integration: "false", architecture: "false", smoke: "false" };
const none = { core: false, shardCount: 0, shards: [] as string[][] };
const planFor = (workflow: "fast" | "portable" | "release", extra: Record<string, unknown> = {}) => createCiPlan({
  workflow, event: "pull_request", base: workflow === "fast" ? "development" : workflow === "portable" ? "staging" : "main",
  head: workflow === "fast" ? "task/ci/test" : workflow === "portable" ? "development" : "hotfix/x", draft: false, filters,
  ...(workflow === "fast" ? { affected: none } : {}), ...extra,
});
const portableResults = { changes: { result: "success" }, lint: { result: "success" }, static: { result: "success" }, privacy: { result: "success" },
  ubuntu: { result: "success" }, integration: { result: "success" }, architecture: { result: "success" },
  perf: { result: "success" }, smoke: { result: "success" } };
const releaseResults = { ...portableResults, macos: { result: "success" },
  "unit-proofs": { result: "success" } };

function job(workflow: string, name: string): string {
  const body = workflow.split(`\n  ${name}:\n`)[1]?.split(/\n {2}[\w-]+:\n/u)[0];
  assert.ok(body, `Missing workflow job ${name}`);
  return body;
}
const jobNames = (workflow: string) => [...(workflow.split("\njobs:\n")[1] ?? "").matchAll(/^ {2}([\w-]+):$/gmu)].map(match => match[1]);

const taskBranch = "task/ci/demo";

describe("development task push", () => {
  it("goes straight to shared checks and reports one required result on the pushed head", () => {
    expect(development.split("\npermissions:\n")[0]).toContain("on:\n  push:\n    branches: ['task/**']\n");
    expect(development).not.toMatch(/pull_request:|schedule:|workflow_dispatch:|ci-runners/u);
    expect(jobNames(development)).toEqual(["checks", "development"]);
    const call = job(development, "checks");
    expect(call).toContain("uses: ./.github/workflows/checks.yml");
    expect(call).toContain("kind: fast");
    expect(call).not.toMatch(/^ {4}(?:if|needs):/mu);
    const gate = job(development, "development");
    expect(gate).toContain("name: development");
    expect(gate).toContain("needs: checks");
    expect(gate).toContain("if: ${{ !cancelled() }}");
    expect(gate).toContain('scripts/test/ci-plan.ts verify "$PLAN" "$RESULTS"');
    expect(job(checks, "changes")).not.toContain("names:check");
  });

  it("scopes cancellation to newer pushes to the same task branch", () => {
    const header = development.split("\njobs:\n")[0];
    expect(header).toContain("group: ci-${{ github.workflow }}-${{ github.ref }}");
    expect(header).toContain("cancel-in-progress: true");
  });

  it("selects task-branch push shards like a pull request, refuses other pushes", () => {
    expect(selectUsingAdapter("fast", "push", "", "task/ci/push", filters))
      .toEqual(selectUsingAdapter("fast", "pull_request", "development", "task/ci/test", filters));
    expect(() => selectUsingAdapter("fast", "push", "", "fix/ci", filters)).toThrow("Push CI runs only fast checks on task branches.");
    const affected = { core: true, shardCount: 9, shards: [["tests/a.integration.test.ts"], ["tests/b.integration.test.ts"]] };
    expect(selectUsingAdapter("fast", "push", "", "task/ci/push", filters, false, affected).ubuntu.include.slice(5))
      .toEqual(affected.shards.map((files, i) => ({ suite: "integration", shard: i + 1, shards: 2, files })));
    const select = job(checks, "changes").split("id: affected")[1]?.split("\n      - ")[0] ?? "";
    expect(select).toContain("if: inputs.kind == 'fast'");
    expect(select).toContain("base=$(git merge-base origin/development HEAD)");
    expect(select).not.toContain("--all");
    expect(select).toContain('scripts/test/affected-tests.ts "$base" HEAD');
    expect(job(checks, "changes")).toContain("fetch-depth: ${{ inputs.kind != 'fast' && 1 || 0 }}");
  });

  it("runs affected shards by their file lists and other shards through ci-run", () => {
    const ubuntu = job(checks, "ubuntu");
    const steps = ubuntu.split(/\n {6}- /u);
    const tests = steps.find(step => step.startsWith("name: Tests"));
    const affected = steps.find(step => step.startsWith("name: Affected integration tests"));
    expect(tests).toContain("if: matrix.files == null");
    expect(affected).toContain("if: matrix.files != null");
    expect(affected).toContain("FILES: ${{ toJSON(matrix.files) }}");
    expect(affected).toContain('RELAY_TEST_NATIVE: "1"');
    expect(affected).toContain('npm run test:integration -- "${files[@]}" --reporter=verbose --maxWorkers=3');
  });

  it.each([
    { draft: false, markdown: false, count: 10 },
    { draft: true, markdown: false, count: 7 },
    { draft: false, markdown: true, count: 5 },
  ])("starts $count runner jobs for draft=$draft markdown=$markdown and no affected tests", ({ draft, markdown, count }) => {
    const plan = selectUsingAdapter("fast", "pull_request", "development", "task/ci/test",
      { ...filters, shared: markdown ? "false" : "true" }, draft);
    const needs = { changes: { result: "success", outputs: { plan: JSON.stringify(plan) } } };
    const started = jobNames(checks).filter(name => {
      const condition = job(checks, name).match(/^ {4}if: (.+)$/mu)?.[1];
      return !condition || expression(condition, needs, {}, "fast");
    });
    expect(started).toEqual(["changes", ...(!draft ? ["lint"] : []), "static", "privacy", ...(!markdown ? ["ubuntu"] : [])]);
    // The required result runs in the calling workflow.
    const runners = started.reduce((total, name) => total + (name === "ubuntu" ? plan.ubuntu.include.length : 1), 1);
    expect(runners).toBe(count);
    expect(plan.ubuntu.include.map(row => row.suite)).toEqual(markdown ? [] : draft
      ? ["unit", "unit", "unit"] : ["unit", "unit", "unit", "architecture", "architecture"]);
    for (const name of ["lint", "static", "privacy", "ubuntu"]) expect(job(checks, name)).toContain("needs: changes");
  });

  it.each([
    { workflow: development, resultJob: "development", needed: "checks" },
    { workflow: pr, resultJob: "non-task-result", needed: "non-task-checks" },
  ])("rejects failed, cancelled, skipped and missing proofs in $resultJob", ({ workflow, resultJob, needed }) => {
    const skipped = { result: "skipped" };
    for (const plan of [planFor("fast"), planFor("fast", { draft: true }),
      selectUsingAdapter("fast", "push", "", taskBranch, { ...filters, smoke: "true" })]) {
      const positive = { ...portableResults, lint: plan.lint ? portableResults.lint : skipped,
        integration: skipped, architecture: skipped, macos: skipped, "unit-proofs": skipped,
        unit: skipped, perf: skipped, smoke: plan.smoke ? portableResults.smoke : skipped };
      const run = (result: string, outcomes: Record<string, { result: string }>) => summary(workflow, resultJob, plan,
        { [needed]: { result, outputs: { plan: JSON.stringify(plan), results: JSON.stringify(outcomes) } } },
        { event_name: "pull_request", head_ref: "fix/ci-pr", event: { action: "opened" } });
      expect(run("success", positive)).toBe("success");
      for (const result of ["failure", "cancelled"]) {
        expect(run(result, positive)).toBe("failure");
        expect(run("success", { ...positive, ubuntu: { result } })).toBe("failure");
      }
      if (plan.smoke) {
        expect(run("success", { ...positive, smoke: { result: "failure" } })).toBe("failure");
        expect(run("success", { ...positive, smoke: skipped })).toBe("failure");
      }
      expect(run("skipped", positive)).toBe("failure");
      const missing: Record<string, { result: string }> = { ...positive };
      delete missing.static;
      expect(run("success", missing)).toBe("failure");
    }
  });

  it("rejects an independent gallery story that draws a cross-story dialog reference", async () => {
    const page = {
      viewportSize: () => ({ width: 1280, height: 720 }),
      evaluate: vi.fn().mockResolvedValue([{ kind: "dialog:custom", variant: null, shape: {} }]),
      context: vi.fn(), url: vi.fn(),
    };
    await expect(dialogsShareShape({
      page, storyId: "queue/status/queued", story: { title: "Queued", render: () => null }, dialogShapes: new Map(),
    })).rejects.toThrow("queue/status/queued draws dialog:custom with a cross-story reference");
  });

  it("runs the shared smoke command for browser inputs on task pushes", () => {
    const filter = job(checks, "changes").match(/^ {12}smoke:\n((?: {14}- '[^'\n]+'\n)+)/mu)?.[1];
    assert.ok(filter);
    expect(job(checks, "changes")).toContain("predicate-quantifier: every");
    const patterns = [...filter.matchAll(/- '([^']+)'/gu)].map(([, pattern]) => pattern);
    const matches = (file: string) => patterns.every(pattern => pattern.startsWith("!")
      ? !matchesGlob(file, pattern.slice(1)) : matchesGlob(file, pattern));
    for (const file of ["tests/smoke/dashboard.smoke.ts", "tests/smoke/dashboard-states.gallery.ts", "tests/smoke/gallery/index.html",
      "playwright.smoke.config.ts", ".github/workflows/checks.yml", "tests/support/helpers/dashboard/smoke/stories/catalogue.ts",
      "tests/support/helpers/dashboard/served-fixtures/seeded-bff.ts", "tests/support/fixtures/dashboard/fixture-day.ts",
      "tests/support/fixtures/operator-command-fixtures.ts", "tests/support/helpers/synthetic-storage-admission.ts",
      "tsconfig.json", ".node-version", "scripts/build/windows-observer-policy.ts", "vite.dashboard.config.ts", "src/dashboard/index.html",
      "tests/support/helpers/credential-keychain-fake.ts"]) {
      expect(matches(file), file).toBe(true);
    }
    for (const file of ["README.md", "tests/smoke/README.md", "tests/scripts/test/ci-plan.test.ts"]) {
      expect(matches(file), file).toBe(false);
    }

    const body = job(checks, "smoke");
    const changes = job(checks, "changes");
    expect(changes).toContain("smoke-matrix: ${{ steps.smoke-matrix.outputs.matrix }}");
    expect(changes).toContain("python3 tests/support/helpers/dashboard/smoke/smoke-lanes.py matrix");
    expect(body).toContain("matrix: ${{ fromJSON(needs.changes.outputs.smoke-matrix) }}");
    expect(body).toContain("SLOTS: ${{ strategy.job-total }}");
    expect(body).toContain('run: npm run test:smoke -- --test-list "$RUNNER_TEMP/smoke-tests.txt"');
    expect(body).toContain("-f tests/support/helpers/dashboard/smoke/verify-shard.jq");
    const condition = body.match(/^ {4}if: (.+)$/mu)?.[1];
    assert.ok(condition);
    for (const smoke of ["true", "false"]) {
      const plan = selectUsingAdapter("fast", "push", "", taskBranch, { ...filters, smoke });
      expect(expression(condition, { changes: { outputs: { plan: JSON.stringify(plan) } } }, {}, "fast")).toBe(smoke === "true");
    }
  });

});

describe("development pull requests", () => {
  it("runs metadata on the requested PR events without polling workflow runs", () => {
    expect(pr.split("\npermissions:\n")[0]).toContain("on:\n  pull_request:\n    branches: [development]\n"
      + "    types: [opened, edited, synchronize, reopened, ready_for_review, labeled, unlabeled]");
    expect(jobNames(pr)).toEqual(["metadata", "non-task-checks", "non-task-result"]);
    expect(pr.split("\njobs:\n")[0]).not.toContain("concurrency:");
    expect(pr).not.toMatch(/listWorkflowRuns|listJobsForWorkflowRun|setTimeout|\bsleep\b/u);
    const metadata = job(pr, "metadata");
    expect(metadata).toMatch(/^ {4}name: PR metadata$/mu);
    expect(metadata).not.toMatch(/^\s*(?:if|needs):|npm ci|ci-plan\.ts/u);
    expect(metadata).toContain("group: ci-${{ github.workflow }}-${{ github.event.pull_request.number }}-metadata");
    expect(metadata).toContain("cancel-in-progress: true");
    expect(metadata).toContain("PR_BODY: ${{ github.event.pull_request.body }}");
    expect(metadata).toContain('git cat-file -e "$PR_BASE_SHA^{commit}"');
    expect(metadata).toContain('|| git fetch --no-tags --depth=1 origin "$PR_BASE_SHA"');
    expect(metadata).toContain("is not available to fetch");
    expect(metadata.indexOf("git fetch")).toBeLessThan(metadata.indexOf("allowed-workflows.ts"));
  });

  it("keeps metadata-only events from superseding a non-Task fast result", () => {
    const call = job(pr, "non-task-checks");
    const result = job(pr, "non-task-result");
    expect(call).toContain("uses: ./.github/workflows/checks.yml");
    expect(call).toContain("kind: fast");
    expect(call).toContain("group: ci-${{ github.workflow }}-${{ github.event.pull_request.number }}-fast");
    expect(call).toContain("cancel-in-progress: true");
    const condition = call.match(/^ {4}if: (.+)$/mu)?.[1];
    const resultCondition = result.match(/^ {4}if: (.+)$/mu)?.[1];
    const name = result.match(/^ {4}name: (.+)$/mu)?.[1];
    assert.ok(condition);
    assert.ok(resultCondition);
    assert.ok(name);
    expect(result).toContain("needs: non-task-checks");
    for (const head_ref of [taskBranch, "fix/ci-other", "chore/ci-other", "dependabot/npm_and_yarn/tool"]) {
      for (const [action, rerun] of [
        ["opened", true], ["synchronize", true], ["reopened", true], ["ready_for_review", true],
        ["edited", false], ["labeled", false], ["unlabeled", false],
      ] as const) {
        const context = { head_ref, event: { action } };
        const fast = rerun && head_ref !== taskBranch;
        expect(expression(condition, {}, context)).toBe(fast);
        expect(expression(resultCondition, {}, context)).toBe(fast);
        expect(expression(name, {}, context)).toBe(fast ? "development" : "Non-task result");
      }
    }
  });

  it.each([
    { head: taskBranch, title: "CI: check metadata", body: "Update the gate.\r\n\r\nCloses #669\r\n", error: "" },
    { head: "fix/ci-other", title: "CI: retain fast proof", body: "", error: "" },
    { head: "chore/ci-other", title: "CI: keep chore metadata", body: "Updated the runners.", error: "" },
    { head: "dependabot/npm_and_yarn/tool", title: "Dependencies: bump tool", body: "Automated dependency update.", error: "" },
    { head: "feature/ci", title: "CI: check metadata", body: "Closes #669", error: "branch name" },
    { head: taskBranch, title: "ci: use conventional title", body: "Closes #669", error: "pull request title" },
    { head: taskBranch, title: "CI: check metadata", body: "", error: "pull request body" },
    { head: taskBranch, title: "CI: check metadata",
      body: "Summary.\n\nCloses #669\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n", error: "" },
    { head: taskBranch, title: "CI: check metadata", body: "This Closes #669", error: "pull request body" },
    { head: "fix/ci-other", title: "fix: conventional title", body: "", error: "pull request title" },
    { head: "chore/ci-other", title: "chore: conventional title", body: "", error: "pull request title" },
    { head: "dependabot/npm_and_yarn/tool", title: "Bump tool", body: "", error: "pull request title" },
  ])("validates the shipped metadata command for $head with error=$error", ({ head, title, body, error }) => {
    const step = job(pr, "metadata").split("\n      - name: Check the development pull request metadata\n")[1];
    const script = step?.match(/^ {8}run: \|\n((?: {10}[^\n]*\n)+)/mu)?.[1];
    assert.ok(script);
    const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
      env: { ...process.env, NAMES_BASE: "development", NAMES_HEAD: head, NAMES_TITLE: title, PR_BODY: body }, encoding: "utf8",
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(error ? 1 : 0);
    if (error) expect(result.stderr).toContain(error);
  });
});

describe("development full run", () => {
  it("decides only for scheduled and dispatched runs on development and starts full jobs only on the decision", () => {
    expect(full.split("\npermissions:\n")[0]).toContain("on:\n  workflow_dispatch:\n  schedule:\n    - cron: '7,27,47 * * * *'");
    expect(full).not.toMatch(/^ {2}(?:push|pull_request):/mu);
    expect(jobNames(full)).toEqual(["decide", "full-checks", "codeql", "dependencies", "full"]);
    const decide = job(full, "decide");
    const condition = decide.match(/^ {4}if: (.+)$/mu)?.[1];
    assert.ok(condition);
    expect(expression(condition, {}, { ref: "refs/heads/development" })).toBe(true);
    for (const ref of ["refs/heads/main", "refs/heads/staging", "refs/tags/development", "refs/heads/task/ci/demo"]) {
      expect(expression(condition, {}, { ref })).toBe(false);
    }
    expect(decide).toContain("checks: read");
    expect(decide).toContain("sparse-checkout: scripts/ci");
    expect(decide).toContain("decideFullRun({ github, context, now: Date.now() })");
    expect(decide).toContain(`- name: ${START_STEP}\n        if: steps.decide.outputs.start == 'true'`);
    for (const name of ["full-checks", "codeql", "dependencies"]) {
      expect(job(full, name)).toContain("needs: decide");
      expect(job(full, name)).toContain("if: ${{ needs.decide.outputs.start == 'true' }}");
    }
    expect(job(full, "full-checks")).toContain("kind: full");
    expect(job(full, "full")).toContain("needs: [decide, full-checks, codeql, dependencies]");
  });

  it("passes the full gate only when every full job passed", () => {
    const schedule = { event_name: "schedule" };
    const ok = { decide: { result: "success", outputs: { start: "true" } },
      "full-checks": { result: "success", outputs: { "coverage-result": "success" } },
      codeql: { result: "success" }, dependencies: { result: "success" } };
    const plan = selectUsingAdapter("full", "schedule", "", "development", {});
    expect(summary(full, "full", plan, ok, schedule)).toBe("success");
    expect(summary(full, "full", plan, { ...ok, decide: { result: "success", outputs: { start: "false" } } }, schedule)).toBe("skipped");
    for (const name of ["full-checks", "codeql", "dependencies"] as const) {
      for (const result of ["failure", "cancelled", "skipped"]) {
        expect(summary(full, "full", plan, { ...ok, [name]: { ...ok[name], result } }, schedule)).toBe("failure");
      }
    }
    for (const result of ["failure", "cancelled", "skipped", ""]) {
      const checks = { result: "success", outputs: { "coverage-result": result } };
      expect(summary(full, "full", plan, { ...ok, "full-checks": checks }, schedule)).toBe("failure");
    }
    expect(summary(full, "full", plan, { ...ok, "full-checks": { result: "success", outputs: {} } }, schedule)).toBe("failure");
  });
});

function expression(value: string, needs: unknown, context: Record<string, unknown>, kind = "portable"): unknown {
  return runInNewContext(value.replace(/\$\{\{(.*?)\}\}/gu, "$1").replaceAll("needs.*.result", "Object.values(needs).map(need => need.result)").replace(/\.([\w]+-[\w-]+)/gu, '["$1"]'), {
    needs, github: context, inputs: { kind }, fromJSON: JSON.parse, toJSON: JSON.stringify, always: () => true, cancelled: () => false,
    contains: (items: unknown[], item: string) => items.includes(item),
    startsWith: (value: string, prefix: string) => value.startsWith(prefix),
  });
}

function summary(workflow: string, name: string, plan: CiPlan, outcomes: Record<string, { result: string; outputs?: Record<string, string> }>,
  context: Record<string, unknown> = { event_name: "pull_request", head_ref: "staging" }): string {
  const skipped = { result: "skipped" };
  const needs = { macos: skipped, "unit-proofs": skipped, ...outcomes, changes: { ...outcomes.changes, outputs: { plan: JSON.stringify(plan) } } };
  const body = job(workflow, name);
  const condition = body.match(/^ {4}if: (.+)$/mu)?.[1];
  assert.ok(condition);
  if (!expression(condition, needs, context, plan.workflow)) return "skipped";
  const proof = body.split("\n      - name: Require every fast proof\n")[1] ?? body;
  const env = Object.fromEntries([...proof.matchAll(/^ {10}([A-Z_]+): (.+)$/gmu)].map(([, key, value]) => [key,
    value.replace(/\$\{\{(.*?)\}\}/gu, (_, code: string) => String(expression(code, needs, context, plan.workflow))) ]));
  const verify = [...proof.matchAll(/^ {8}run: (.+)$/gmu)].map((match) => match[1]).find((line) => line.includes("ci-plan.ts verify"));
  const script = verify
    ?? proof.match(/^ {8}run: \|\n((?: {10}[^\n]*\n|\n)+)/mu)?.[1]
    ?? body.match(/^ {8}run: (.+)$/mu)?.[1] ?? body.match(/^ {6}- run: (.+)$/mu)?.[1];
  assert.ok(script);
  const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
    env: { ...process.env, ...env }, encoding: "utf8",
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return result.status === 0 ? "success" : "failure";
}

function selectUsingAdapter(kind: "fast" | "portable" | "release" | "full", event: string, base: string, head: string, selectedFilters: Record<string, string>, draft = false, affected = none): CiPlan {
  const source = job(checks, "changes").match(/ {8}id: select[\s\S]*? {10}script: \|\n((?: {12}[^\n]*\n|\n)+)/u)?.[1];
  assert.ok(source);
  const outputs: Record<string, string> = {};
  runInNewContext(source.replace(/^ {12}/gmu, ""), {
    require: () => ({ execFileSync: (_node: string, args: string[]) => JSON.stringify(createCiPlan(JSON.parse(args[4] ?? ""))) }),
    context: { eventName: event, ref: `refs/heads/${head || "main"}`, payload: event === "pull_request" ? { pull_request: { base: { ref: base }, head: { ref: head }, draft } } : {} },
    process: { env: { FILTERS: JSON.stringify(selectedFilters), KIND: kind, ...(kind === "fast" ? { AFFECTED: JSON.stringify(affected) } : {}) } },
    core: { setOutput: (key: string, value: string) => { outputs[key] = value; } },
  });
  expect(Object.keys(outputs)).toEqual(["plan"]);
  return ciPlanSchema.parse(JSON.parse(outputs.plan));
}

function publication(workflow: string, plan: CiPlan, outcomes: Record<string, { result: string }>): string {
  const source = job(workflow, "unit").match(/ {8}id: publish[\s\S]*? {8}run: \|\n((?: {10}[^\n]*\n|\n)+)/u)?.[1];
  assert.ok(source, "unit must run the shipped publication decision");
  const directory = mkdtempSync(join(tmpdir(), "relay-ci-publish-"));
  const output = join(directory, "github-output");
  try {
    const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", source.replace(/^ {10}/gmu, "")], {
      env: { ...process.env, PLAN: JSON.stringify(plan), RESULTS: JSON.stringify(outcomes), GITHUB_OUTPUT: output },
      encoding: "utf8",
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    return readFileSync(output, "utf8");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function uploadGate(workflow: string, upload: string, succeeded: boolean): boolean {
  const step = job(workflow, "unit").split("\n      - uses: actions/upload-artifact@v7\n").find((part) => part.includes("name: ci-timings"));
  assert.ok(step, "unit must upload ci-timings");
  const condition = step.match(/^ {8}if: (.+)$/mu)?.[1];
  assert.ok(condition);
  const code = condition.replace(/^\$\{\{\s*/u, "").replace(/\s*\}\}$/u, "");
  return Boolean(runInNewContext(code, { success: () => succeeded, steps: { publish: { outputs: { upload } } } }));
}

function timingScript(workflow: string): string {
  const source = job(workflow, "changes").match(/ {8}id: timings[\s\S]*? {10}script: \|\n((?: {12}[^\n]*\n|\n)+)/u)?.[1];
  assert.ok(source);
  return source.replace(/^ {12}/gmu, "");
}

async function discoverTimings(workflows: { id: number; path: string }[], emptyHistory = false, failAt = "") {
  const queried: number[] = [];
  const artifacts: number[] = [];
  const output: Record<string, string> = {};
  const policies: Record<string, (input: unknown) => unknown> = {
    workflows: registeredTimingWorkflows, history: timingRunIds, artifact: hasTimingArtifact,
  };
  await runInNewContext(`(async () => {${timingScript(checks)}\n})()`, {
    require: () => ({ execFileSync: (_node: string, args: string[]) => {
      const policy = policies[args[3] ?? ""];
      assert.ok(policy);
      return JSON.stringify(policy(JSON.parse(args[4] ?? "")));
    } }),
    context: { repo: { owner: "owner", repo: "relay" }, runId: 99 },
    github: {
      paginate: async (operation: string, args: { run_id?: number }) => {
        if (failAt === operation) throw new Error(`API ${operation} failed`);
        if (operation === "workflows") return workflows;
        assert.equal(operation, "artifacts");
        assert.ok(args.run_id);
        artifacts.push(args.run_id);
        return [{ name: "ci-timings", expired: args.run_id === 30 }];
      },
      rest: { actions: { listRepoWorkflows: "workflows", listWorkflowRunArtifacts: "artifacts",
        listWorkflowRuns: async ({ workflow_id }: { workflow_id: number }) => {
          if (failAt === "runs") throw new Error("API runs failed");
          queried.push(workflow_id);
          assert.ok(workflows.some(row => row.id === workflow_id), "Must not query an unregistered workflow");
          return { data: { workflow_runs: emptyHistory ? [] : workflow_id === 1
            ? [{ id: 10, created_at: "2026-11-01T00:00:00Z", conclusion: "success" }]
            : [{ id: 30, created_at: "2026-11-03T00:00:00Z", conclusion: "success" },
              { id: 20, created_at: "2026-11-02T00:00:00Z", conclusion: "success" },
              { id: 99, created_at: "2026-11-04T00:00:00Z", conclusion: "success" }] } };
        } } },
    },
    core: { info: () => undefined, setOutput: (key: string, value: string) => { output[key] = value; } },
  });
  return { queried, artifacts, output };
}

describe("separate event and admitted proof workflows", () => {
  it("pins every setup-node step to the Node 26 version file", () => {
    expect(readFileSync(new URL("../../../.node-version", import.meta.url), "utf8")).toBe("26\n");
    for (const name of readdirSync(new URL("../../../.github/workflows/", import.meta.url))) {
      if (!name.endsWith(".yml")) continue;
      const body = readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), "utf8");
      const uses = body.match(/uses: actions\/setup-node@/gu)?.length ?? 0;
      const pins = body.match(/node-version-file: \.node-version/gu)?.length ?? 0;
      expect(pins, name).toBe(uses);
      expect(body, name).not.toContain("node-version-file: package.json");
    }
  });

  it("keeps six entry and reusable workflows", () => {
    expect(readdirSync(new URL("../../../.github/workflows/", import.meta.url)).filter(name => /\.ya?ml$/u.test(name)).sort()).toEqual([
      "checks.yml", "development.yml", "full.yml", "pr.yml", "production.yml", "staging.yml",
    ]);
    const stagingTrigger = staging.split("\npermissions:\n")[0];
    const productionTrigger = production.split("\npermissions:\n")[0];
    expect(stagingTrigger).toContain("run-name: ${{ github.event.pull_request.title || github.event.head_commit.message }}");
    expect(stagingTrigger).not.toMatch(/\n {2}push:|auto_merge_enabled/u);
    expect(stagingTrigger).toContain("pull_request:\n    branches: [staging]");
    const pullRequestTypes = stagingTrigger.match(/types:\s*\[([^\]]*)\]/u)?.[1] ?? "";
    expect(pullRequestTypes.split(",").map((item) => item.trim())).toEqual(["opened", "edited", "synchronize", "reopened", "ready_for_review", "converted_to_draft"]);
    expect(stagingTrigger).not.toContain("workflow_dispatch:");
    expect(productionTrigger).toContain("run-name: ${{ github.event.pull_request.title || inputs.title }}");
    expect(productionTrigger).toContain("pull_request:\n    branches: [main]");
    expect(productionTrigger).toMatch(/workflow_dispatch:\n {4}inputs:\n {6}title:\n[^\n]*\n {8}required: true/u);
    expect(productionTrigger).toContain("push:\n    branches: [main]");
    expect(job(staging, "checks")).toContain("uses: ./.github/workflows/checks.yml");
    expect(job(staging, "checks")).toContain("kind: portable");
    expect(job(production, "checks")).toContain("uses: ./.github/workflows/checks.yml");
    expect(job(production, "checks")).toContain("kind: ${{ github.head_ref == 'staging' && 'portable' || 'release' }}");
    expect(checks).not.toMatch(/uses: \.\/\.github\/workflows\//u);
    expect(checks).not.toMatch(/windows/iu);
    expect(checks.split("\njobs:\n")[0]).toContain("value: ${{ toJSON(jobs) }}");
    expect(jobNames(staging)).toEqual(["names", "checks", "full-proof", "staging"]);
    expect(jobNames(production)).toEqual(["checks", "codeql", "dependencies", "full-proof", "production"]);
    expect(jobNames(checks)).toEqual(["changes", "lint", "static", "privacy", "ubuntu", "macos", "coverage", "unit-proofs", "integration", "architecture", "perf", "smoke", "unit"]);
    expect(job(checks, "lint")).toContain("run: npm run lint");
    expect(job(checks, "lint")).toContain("working-directory: fast-duo");
    expect(job(checks, "lint")).toContain("if: ${{ fromJSON(needs.changes.outputs.plan).lint }}");
    expect(job(checks, "static")).toContain("run: npm run typecheck");
    expect(job(checks, "static")).not.toContain("npm run lint");
  });

  it("uses small runners for selection, metadata, and workflow results", () => {
    for (const [workflow, name] of [
      [checks, "changes"], [development, "development"], [pr, "metadata"], [pr, "non-task-result"], [full, "decide"], [full, "full"],
      [staging, "staging"], [production, "production"],
    ]) expect(job(workflow, name)).toContain("runs-on: ubuntu-slim");
  });

  it.each(["perf", "smoke"])("runs %s separately on Ubuntu with the integration-shard setup", name => {
    const body = job(checks, name);
    expect(body).toContain(`name: ${name}`);
    expect(body).toContain("runs-on: ubuntu-latest");
    expect(body).toContain("needs: changes");
    expect(body).toContain("timeout-minutes: 20");
    for (const setup of ["actions/checkout@v7", "actions/setup-node@v7", "node-version-file: .node-version",
      "cache: npm", "run: npm ci", "actions/cache@v6",
      "path: ~/.cache/ms-playwright", "key: ${{ runner.os }}-${{ runner.arch }}-playwright-chromium-${{ hashFiles('package-lock.json') }}",
      "run: npx playwright install chromium", "run: npm run web:build", "mktemp -d /dev/shm/relay-tmp.XXXXXX",
      String.raw`printf 'TMPDIR=%s\nTEMP=%s\nTMP=%s\n' "$dir" "$dir" "$dir" >> "$GITHUB_ENV"`]) {
      expect(body).toContain(setup);
    }
    if (name === "smoke") expect(body).toContain("run: npm run build:observer-policy");
    expect(body).toContain(`run: npm run test:${name}`);
    const condition = body.match(/^ {4}if: (.+)$/mu)?.[1];
    assert.ok(condition);
    for (const workflow of ["portable", "release"] as const) {
      for (const draft of [false, true]) {
        const plan = planFor(workflow, { draft, filters: { ...filters, shared: "false" } });
        expect(expression(condition, { changes: { outputs: { plan: JSON.stringify(plan) } } }, {})).toBe(!draft);
      }
    }
    const manual = selectUsingAdapter("release", "workflow_dispatch", "", "", {});
    expect(expression(condition, { changes: { outputs: { plan: JSON.stringify(manual) } } }, {})).toBe(false);
  });

  it("collects coverage on existing Full shards and merges it without a second test pass", () => {
    const directory = new URL("../../../.github/workflows/", import.meta.url);
    for (const file of readdirSync(directory, { withFileTypes: true })) {
      if (!file.isFile() || !/\.ya?ml$/u.test(file.name)) continue;
      const workflow = readFileSync(new URL(file.name, directory), "utf8");
      expect(workflow).not.toContain("test:coverage");
      if (file.name !== "checks.yml") expect(workflow).not.toContain("--coverage");
    }
    const coverage = job(checks, "coverage");
    const condition = coverage.match(/^ {4}if: (.+)$/mu)?.[1];
    assert.ok(condition);
    for (const kind of ["fast", "portable", "release", "full"]) {
      expect(expression(condition, {}, {}, kind)).toBe(kind === "full");
      for (const shard of ["ubuntu", "macos"]) {
        const body = job(checks, shard);
        const flags = body.match(/^ {6}COVERAGE_FLAGS: (.+)$/mu)?.[1];
        assert.ok(flags);
        expect(expression(flags, {}, {}, kind)).toBe(kind === "full"
          ? "--coverage --no-coverage.thresholds --coverage.reporter=json" : "");
        expect(body).toContain("coverage-final.json");
        expect(body).toContain("if: inputs.kind == 'full'");
      }
    }
    expect(coverage).toContain("needs: [changes, ubuntu, macos]");
    expect(coverage).toContain("pattern: coverage-*");
    expect(coverage).toContain('scripts/ci/full-coverage.ts "$RUNNER_TEMP/full-coverage" "$PLAN"');
    expect(coverage).not.toContain("npm run test:");
    expect(checks).toContain("value: ${{ jobs.coverage.result }}");
    expect(jobNames(checks)).not.toContain("release-batch");
  });

  it.each(["portable", "release"] as const)("requires perf and smoke through the shipped %s gate and publication shell", workflow => {
    const positive = workflow === "portable" ? portableResults : releaseResults;
    const plan = planFor(workflow);
    for (const name of ["perf", "smoke"]) {
      for (const result of ["failure", "cancelled", "skipped"]) {
        const outcomes = { ...positive, [name]: { result } };
        expect(summary(checks, "unit", plan, outcomes)).toBe("failure");
        expect(publication(checks, plan, outcomes)).toBe("upload=false\n");
      }
      const missing: Record<string, { result: string }> = { ...positive };
      delete missing[name];
      expect(summary(checks, "unit", plan, missing)).toBe("failure");
    }
    const draft = planFor(workflow, { draft: true });
    const skipped = { ...positive, perf: { result: "skipped" }, smoke: { result: "skipped" } };
    expect(summary(checks, "unit", draft, skipped)).toBe("success");
    for (const name of ["perf", "smoke"]) {
      expect(summary(checks, "unit", draft, { ...skipped, [name]: { result: "success" } })).toBe("failure");
    }
  });

  it("executes each entry's actual shared selection adapter", () => {
    expect(selectUsingAdapter("portable", "pull_request", "staging", "development", filters)).toEqual(planFor("portable"));
    expect(selectUsingAdapter("portable", "pull_request", "main", "staging", filters)).toEqual(planFor("portable"));
    expect(selectUsingAdapter("release", "pull_request", "main", "staging", filters).fullRelease).toBe(false);
    expect(selectUsingAdapter("release", "pull_request", "main", "fix/other", filters).fullRelease).toBe(false);
    expect(selectUsingAdapter("full", "schedule", "", "development", {})).toMatchObject({ workflow: "full", fullRelease: true, perf: true, smoke: true, testJobs: 40 });
    expect(selectUsingAdapter("full", "workflow_dispatch", "", "development", {})).toMatchObject({ workflow: "full", fullRelease: true, testJobs: 40 });
    expect(selectUsingAdapter("release", "pull_request", "main", "hotfix/x", filters)).toEqual(planFor("release", { head: "hotfix/x" }));
    expect(planFor("release", { head: "hotfix/x" }).fullRelease).toBe(true);
    expect(selectUsingAdapter("release", "workflow_dispatch", "", "", {})).toMatchObject({ perf: false, smoke: false });
    expect(selectUsingAdapter("release", "workflow_dispatch", "", "", {}).testJobs).toBe(40);
    expect(selectUsingAdapter("release", "pull_request", "main", "staging", { ...filters, shared: "false" }).testJobs).toBe(0);
    expect(() => selectUsingAdapter("portable", "pull_request", "staging", "development", {})).toThrow();
  });

  it("retains explicit budgets and complete inner/outer fences without nested admission", () => {
    for (const workflow of [checks]) {
      expect(workflow).not.toContain("group: ci-runners");
      expect(workflow).toContain('RELAY_TEST_RAM_MB: "2048"');
      expect(workflow).toContain('RELAY_TEST_TIME_SCALE: "2.5"');
      expect(job(workflow, "changes")).toContain("scripts/test/ci-plan.ts', 'plan'");
      expect(job(workflow, "unit")).toContain("!cancelled()");
      expect(job(workflow, "unit")).not.toContain("train");
      expect(workflow).not.toMatch(/^ {2}timings:$/mu);
      expect(job(workflow, "unit")).toContain('scripts/test/ci-plan.ts proofs "$PLAN" "$RESULTS"');
      expect(job(workflow, "unit")).toContain("scripts/test/ci-files.ts durations");
      expect(job(workflow, "unit")).toContain("name: ci-timings");
      expect(job(workflow, "unit")).toContain('scripts/test/ci-plan.ts verify "$PLAN" "$RESULTS"');
      expect(job(workflow, "unit").match(/actions\/checkout@v7/gu)).toHaveLength(1);
      expect(job(workflow, "unit").match(/run: npm ci/gu)).toHaveLength(1);
    }
    expect(job(checks, "unit")).toContain("needs: [changes, lint, static, privacy, ubuntu, integration, architecture, macos, coverage, unit-proofs, perf, smoke]");
    expect(job(checks, "unit")).not.toMatch(/^ {4}needs:.*\btimings\b/mu);
    expect(job(staging, "staging")).toContain("needs: [names, checks, full-proof]");
    expect(job(production, "production")).toContain("needs: [checks, codeql, dependencies, full-proof]");
  });

  it("retains native/bootstrap budgets, post-failure groups and exact file membership", () => {
    for (const platform of ["macos"] as const) {
      const body = job(checks, platform);
      expect(body).toContain("timeout-minutes: 30");
      expect(body).toContain("fail-fast: false");
      expect(body).toContain("scripts/test/chromium-preflight.ts");
      const steps = body.split(/\n {6}- /u).filter(step => step.includes("scripts/test/ci-run.sh"));
      expect(steps).toHaveLength(4);
      for (const step of steps) expect(step).toContain("!cancelled()");
      for (const command of ["integration serial", "integration storage", "unit native", "integration native"]) {
        expect(body).toContain(`scripts/test/ci-run.sh ${command} "$SLICE"`);
      }
      const native = planFor("release")[platform].include.filter(row => row.suite === "native");
      const all = [...new Set([...NATIVE_FILES, ...SERIAL_FILES, ...SERIAL_STORAGE_FILES])];
      for (const project of ["unit", "integration"] as const) {
        const pinned = all.filter(file => file.endsWith(".integration.test.ts") === (project === "integration"));
        const listed = [`tests/portable${project === "integration" ? ".integration" : ""}.test.ts`, ...pinned];
        expect(selectCiFiles(listed, project, "ubuntu", 1, 1, {})).toEqual([listed[0], ...pinned.filter(file => LINUX_NATIVE_FILES.includes(file))].sort());
        const selected = native.flatMap(({ shard, shards }) => (["native", "serial", "storage"] as const).flatMap(group =>
          selectCiFiles(listed, project, group, shard, shards, {})));
        expect(selected.sort()).toEqual(pinned.sort());
      }
    }
  });

  it.each(["portable", "release"] as const)("executes the actual final unit shell and rejects incomplete %s pipelines", workflow => {
    const source = checks;
    const plan = planFor(workflow);
    const positive = workflow === "portable" ? portableResults : releaseResults;
    expect(summary(source, "unit", plan, positive)).toBe("success");
    for (const result of ["failure", "cancelled"]) {
      expect(summary(source, "unit", plan, { ...positive, ubuntu: { result } })).toBe("failure");
    }
    expect(summary(source, "unit", plan, { ...positive, static: { result: "failure" } })).toBe("failure");
    expect(summary(source, "unit", plan, { ...positive, changes: { result: "failure" } })).toBe("failure");
  });

  it.each(["portable", "release"] as const)("uploads ci-timings only after every %s proof passes", workflow => {
    const source = checks;
    const plan = planFor(workflow);
    const positive = workflow === "portable" ? portableResults : releaseResults;
    expect(publication(source, plan, positive)).toBe("upload=true\n");
    expect(publication(source, plan, { ...positive, static: { result: "failure" } })).toBe("upload=false\n");
    expect(publication(source, plan, { ...positive, static: { result: "cancelled" } })).toBe("upload=false\n");
    expect(uploadGate(source, "true", true)).toBe(true);
    expect(uploadGate(source, "false", true)).toBe(false);
    expect(uploadGate(source, "true", false)).toBe(false);
    const omitted = planFor(workflow, { filters: { ...filters, shared: "false" } });
    const quiet = { ...releaseResults, ubuntu: { result: "skipped" }, macos: { result: "skipped" } };
    expect(publication(source, omitted, quiet)).toBe("upload=false\n");
  });

  it("requires both selected native groups and preserves legitimate work omissions", () => {
    const plan = planFor("release");
    expect(summary(checks, "integration", plan, releaseResults)).toBe("success");
    for (const platform of ["macos"]) {
      for (const result of ["failure", "cancelled", "skipped"]) {
        expect(summary(checks, "integration", plan, { ...releaseResults, [platform]: { result } })).toBe("failure");
      }
    }
    const omitted = planFor("release", { filters: { ...filters, shared: "false" } });
    const outcomes = { ...releaseResults, ubuntu: { result: "skipped" }, macos: { result: "skipped" } };
    expect(summary(checks, "unit", omitted, outcomes)).toBe("success");
    expect(summary(production, "production", omitted, { checks: { result: "success" }, codeql: { result: "skipped" }, dependencies: { result: "success" }, "full-proof": { result: "success" } })).toBe("success");
  });

  it("runs codeql on hotfix pull requests and main pushes, dependencies on main pull requests, and both in the full run", () => {
    const codeql = job(production, "codeql").match(/^ {4}if: \$\{\{ (.+) \}\}$/mu)?.[1];
    assert.ok(codeql);
    const runsCodeql = (event_name: string, head_ref: string) => runInNewContext(codeql, { github: { event_name, head_ref },
      startsWith: (value: string, prefix: string) => value.startsWith(prefix) }) as boolean;
    expect(runsCodeql("pull_request", "hotfix/x-y")).toBe(true);
    expect(runsCodeql("push", "")).toBe(true);
    expect(runsCodeql("pull_request", "staging")).toBe(false);
    expect(runsCodeql("workflow_dispatch", "")).toBe(false);
    for (const workflow of [production, full]) {
      expect(job(workflow, "codeql")).toContain("security-events: write");
      expect(job(workflow, "codeql")).toContain("github/codeql-action/init@v4");
      expect(job(workflow, "codeql")).toContain("github/codeql-action/analyze@v4");
      expect(job(workflow, "dependencies")).toContain("run: npm audit --omit=dev --audit-level=high");
    }
    expect(job(production, "dependencies")).toContain("if: ${{ github.event_name == 'pull_request' }}");
    expect(job(production, "checks")).toContain("if: ${{ github.event_name != 'push' }}");
    expect(job(production, "production")).toContain("github.event_name != 'push'");
    expect(staging).not.toMatch(/codeql|npm audit/u);
  });

  const productionOk = { checks: { result: "success" }, codeql: { result: "success" }, dependencies: { result: "success" }, "full-proof": { result: "success" } };
  it.each([
    { event_name: "pull_request", head_ref: "staging", checks: "success", expected: "success" },
    { event_name: "pull_request", head_ref: "hotfix/x", checks: "success", expected: "success" },
    { event_name: "pull_request", head_ref: "fix/other", checks: "success", expected: "failure" },
    { event_name: "pull_request", head_ref: "hotfix", checks: "success", expected: "failure" },
    { event_name: "workflow_dispatch", head_ref: "", checks: "success", expected: "success" },
    { event_name: "workflow_dispatch", head_ref: "", checks: "failure", expected: "failure" },
    ...["failure", "cancelled", "skipped", ""].map(checks => ({ event_name: "pull_request", head_ref: "staging", checks, expected: "failure" })),
  ])("runs the production gate ($event_name/$head_ref/$checks)", ({ event_name, head_ref, checks: result, expected }) => {
    expect(summary(production, "production", planFor("release"), { ...productionOk, checks: { result } }, { event_name, head_ref })).toBe(expected);
  });

  it.each([
    { head_ref: "staging", name: "full-proof", other: "codeql" },
    { head_ref: "hotfix/x", name: "codeql", other: "full-proof" },
    { head_ref: "staging", name: "dependencies", other: "codeql" },
    { head_ref: "hotfix/x", name: "dependencies", other: "full-proof" },
  ])("requires $name for a $head_ref pull request and ignores the skipped $other", ({ head_ref, name, other }) => {
    const context = { event_name: "pull_request", head_ref };
    const ok = { ...productionOk, [other]: { result: "skipped" } };
    expect(summary(production, "production", planFor("release"), ok, context)).toBe("success");
    for (const result of ["failure", "cancelled", "skipped"]) {
      expect(summary(production, "production", planFor("release"), { ...ok, [name]: { result } }, context)).toBe("failure");
    }
  });

  it("runs full-proof only for staging pull requests and staging releases", () => {
    const runs = (workflow: string, event_name: string, head_ref: string) => runInNewContext(
      job(workflow, "full-proof").match(/^ {4}if: \$\{\{ (.+) \}\}$/mu)?.[1] ?? "", { github: { event_name, head_ref } }) as boolean;
    expect(runs(staging, "pull_request", "development")).toBe(true);
    expect(runs(staging, "pull_request", "main")).toBe(true);
    expect(runs(production, "pull_request", "staging")).toBe(true);
    expect(runs(production, "pull_request", "hotfix/x")).toBe(false);
    expect(runs(production, "workflow_dispatch", "")).toBe(false);
    for (const workflow of [staging, production]) {
      expect(job(workflow, "full-proof")).toContain("checks: read");
      expect(job(workflow, "full-proof")).toContain("sparse-checkout: scripts/ci");
      expect(job(workflow, "full-proof")).toContain("await fullRunProof({ github, context })");
    }
  });

  it("skips the production gate on a push to main", () => {
    const skipped = { checks: { result: "skipped" }, codeql: { result: "success" }, dependencies: { result: "skipped" }, "full-proof": { result: "skipped" } };
    expect(summary(production, "production", planFor("release"), skipped, { event_name: "push", head_ref: "" })).toBe("skipped");
  });

  it.each(["failure", "cancelled"])("fails the staging gate when a needed job is %s", result => {
    const pull = { event_name: "pull_request", event: { action: "synchronize" } };
    const plan = planFor("portable");
    const ok = { names: { result: "success" }, checks: { result: "success" }, "full-proof": { result: "success" } };
    expect(summary(staging, "staging", plan, ok, pull)).toBe("success");
    expect(summary(staging, "staging", plan, { ...ok, checks: { result } }, pull)).toBe("failure");
    expect(summary(staging, "staging", plan, { ...ok, names: { result }, checks: { result: "skipped" } }, pull)).toBe("failure");
    expect(summary(staging, "staging", plan, { ...ok, "full-proof": { result } }, pull)).toBe("failure");
  });

});

describe("shared timing discovery adapters", () => {
  it("uses one policy and handles an unregistered new release workflow without a 404 query", async () => {
    expect(await discoverTimings([{ id: 1, path: ".github/workflows/staging.yml" }])).toEqual({ queried: [1], artifacts: [10], output: { run: "10" } });
    expect(await discoverTimings([{ id: 1, path: ".github/workflows/staging.yml" }, { id: 2, path: ".github/workflows/production.yml" }]))
      .toEqual({ queried: [1, 2], artifacts: [30, 20], output: { run: "20" } });
  });

  it("uses the seed only for valid no-history/no-retained-report cases", async () => {
    expect(await discoverTimings([])).toEqual({ queried: [], artifacts: [], output: {} });
    expect(await discoverTimings([{ id: 1, path: ".github/workflows/staging.yml" }], true)).toEqual({ queried: [1], artifacts: [], output: {} });
  });

  it.each(["workflows", "runs", "artifacts"])("does not swallow unexpected API failures at %s", async failAt => {
    await expect(discoverTimings([{ id: 1, path: ".github/workflows/staging.yml" }], false, failAt)).rejects.toThrow(/API/u);
  });
});

describe("per-PR cancellation with complete FIFO pipelines", () => {
  it.each([staging, production])("supersedes the same PR/manual branch while separating other keys", source => {
    const header = source.split("\njobs:\n")[0];
    const group = header.match(/^ {2}group: (.+)$/mu)?.[1];
    assert.ok(group);
    const name = source === staging ? "Staging" : "Production";
    const key = (number: number | undefined, ref: string, action = "synchronize") => group.replace(/\$\{\{(.*?)\}\}/gu, (_, code: string) => String(runInNewContext(code, {
      github: { workflow: name, event: { action, pull_request: { number } }, ref },
    })));
    expect(key(90, "refs/pull/90/merge")).toBe(key(90, "refs/heads/updated-source"));
    expect(key(undefined, "refs/heads/staging", "")).toBe(`ci-${name}-refs/heads/staging`);
    expect(key(90, "refs/pull/90/merge")).not.toBe(key(91, "refs/pull/91/merge"));
    expect(key(undefined, "refs/heads/staging", "")).not.toBe(key(undefined, "refs/heads/other", ""));
    const cancel = header.match(/^ {2}cancel-in-progress: (.+)$/mu)?.[1];
    assert.ok(cancel);
    const cancels = (event_name: string, action: string): unknown => runInNewContext(cancel.replace(/^\$\{\{\s*|\s*\}\}$/gu, ""), { github: { event_name, event: { action } } });
    expect(cancels("pull_request", "synchronize")).toBe(true);
    if (source === staging) {
      expect(cancels("push", "")).toBe(false);
    }
  });

  it.each([staging, production])("queues the transitive whole proof pipeline through the shared final proof", source => {
    const admitted = job(source, "checks");
    expect(admitted).toContain(source === staging ? "group: ci-runners" : "group: release-runners");
    if (source === production) expect(admitted).not.toContain("group: ci-runners");
    expect(admitted).toContain("queue: max");
    expect(admitted).toContain("cancel-in-progress: false");
    const calleeName = admitted.match(/uses: \.\/\.github\/workflows\/([\w-]+)\.yml/u)?.[1];
    assert.ok(calleeName);
    const callee = load(calleeName);
    const covered = jobNames(callee);
    for (const name of ["changes", "static", "privacy", "ubuntu", "integration", "architecture", "unit"]) expect(covered).toContain(name);
    expect(covered).not.toContain("timings");
    expect(covered).not.toContain("train");
    const closure = (name: string, ancestors: string[] = []): string[] => {
      expect(ancestors).not.toContain(name);
      const dependencies = job(callee, name).match(/^ {4}needs: \[(.+)\]$/mu)?.[1]?.split(", ") ?? [];
      return [name, ...dependencies.flatMap(dependency => closure(dependency, [...ancestors, name]))];
    };
    expect([...new Set(closure("unit"))].sort()).toEqual([...covered].sort());
    expect(callee).not.toContain("group: ci-runners");
    for (const name of ["macos", "unit-proofs", "perf", "smoke"]) expect(covered).toContain(name);
  });
});

describe("cancelled admitted source work", () => {
  it.each(["staging", "production"])("stops inner checkout work while the %s gate rejects cancellation", name => {
    const entry = name === "staging" ? staging : production;
    const inner = job(checks, "unit");
    const outer = job(entry, name);
    const condition = (body: string, cancelled: boolean) => {
      const code = body.match(/^ {4}if: \$\{\{ (.+) \}\}$/mu)?.[1];
      assert.ok(code);
      return Boolean(runInNewContext(code, { cancelled: () => cancelled, always: () => true, inputs: { kind: name === "staging" ? "portable" : "release" }, github: { event_name: "pull_request", event: { action: "synchronize" } } }));
    };
    expect(inner).toContain("uses: actions/checkout@v7");
    expect(inner).toContain("run: npm ci");
    expect(outer).not.toContain("actions/checkout");
    expect(outer).not.toContain("npm ci");
    expect(condition(inner, false)).toBe(true);
    expect(condition(inner, true)).toBe(false);
    expect(condition(outer, true)).toBe(true);
  });
});
