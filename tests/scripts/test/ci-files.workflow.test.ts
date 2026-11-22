import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { ciPlanSchema, createCiPlan, hasTimingArtifact, registeredTimingWorkflows, timingRunIds } from "../../../scripts/test/ci-plan.js";
import { LINUX_NATIVE_FILES, NATIVE_FILES, SERIAL_FILES, SERIAL_STORAGE_FILES, selectCiFiles } from "../../../scripts/test/ci-files.js";
import type { CiPlan } from "../../../scripts/test/ci-plan.js";

const load = (name: string) => readFileSync(new URL(`../../../.github/workflows/${name}.yml`, import.meta.url), "utf8");
const staging = load("staging");
const production = load("production");
const checks = load("checks");
const filters = { shared: "true", unit: "false", integration: "false", architecture: "false" };
const none = { core: false, shardCount: 0, shards: [] as string[][] };
const planFor = (workflow: "fast" | "portable" | "release", extra: Record<string, unknown> = {}) => createCiPlan({
  workflow, event: "pull_request", base: workflow === "fast" ? "development" : workflow === "portable" ? "staging" : "main",
  head: workflow === "fast" ? "feature/test" : workflow === "portable" ? "development" : "staging", draft: false, filters,
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

type GateJob = { name: string; status: string; conclusion: string | null };
type GateRun = { id: number; status: string; created_at: string; html_url: string; jobs: GateJob[] };

// Runs the development gate's lookup with a fake clock; `poll` returns the runs GitHub reports on each poll.
async function proofLookup(poll: (count: number) => GateRun[]) {
  const source = job(load("development"), "development").match(/ {10}script: \|\n((?: {12}[^\n]*\n|\n)+)/u)?.[1];
  assert.ok(source);
  let clock = 0;
  let polls = 0;
  let current: GateRun[] = [];
  const failures: string[] = [];
  const infos: string[] = [];
  await runInNewContext(`(async () => {${source.replace(/^ {12}/gmu, "")}\n})()`, {
    context: { runId: 1, repo: { owner: "owner", repo: "relay" }, payload: { pull_request: { head: { sha: "a".repeat(40) } } } },
    github: {
      paginate: async (operation: (args: Record<string, unknown>) => unknown, args: Record<string, unknown>) => operation(args),
      rest: { actions: {
        listWorkflowRuns: ({ workflow_id, head_sha }: Record<string, unknown>) => {
          expect({ workflow_id, head_sha }).toEqual({ workflow_id: "development.yml", head_sha: "a".repeat(40) });
          current = poll(polls++);
          return current;
        },
        listJobsForWorkflowRun: ({ run_id, filter }: Record<string, unknown>) => {
          expect(filter).toBe("latest");
          return current.find(run => run.id === run_id)?.jobs ?? [];
        },
      } },
    },
    core: { info: (line: string) => infos.push(line), setFailed: (line: string) => failures.push(line) },
    Date: { now: () => clock, parse: Date.parse },
    setTimeout: (resolve: () => void, ms: number) => { clock += ms; resolve(); },
    Promise,
  });
  return { failures, infos, minutes: clock / 60_000, polls };
}

const proofRun = (id: number, proof: Partial<GateJob> | undefined, status = "completed", created_at = `2026-11-22T00:0${id}:00Z`): GateRun => ({
  id, status, created_at, html_url: `https://example.test/runs/${id}`,
  jobs: proof ? [{ name: "proof", status: "completed", conclusion: "success", ...proof }] : [{ name: "development", status, conclusion: null }],
});

describe("development fast check", () => {
  const development = load("development");

  it("tests task pushes and other pull requests, and gives task pull requests one gate job", () => {
    expect(development).toContain("name: Development");
    expect(development).toContain("run-name: ${{ github.event.pull_request.title || github.ref_name }}");
    expect(development).toContain("branches: [development]");
    expect(development).toContain("push:\n    branches: ['task/**']");
    expect(development).not.toMatch(/workflow_dispatch:|ci-runners/u);
    expect(jobNames(development)).toEqual(["checks", "proof", "development"]);
    expect(job(development, "checks")).toContain("uses: ./.github/workflows/checks.yml");
    expect(job(development, "checks")).toContain("kind: fast");
    const runsChecks = (event_name: string, action: string | undefined, head_ref: string): unknown => runInNewContext(
      job(development, "checks").match(/^ {4}if: \$\{\{ (.+) \}\}$/mu)?.[1] ?? "",
      { github: { event_name, event: { action }, head_ref }, startsWith: (value: string, prefix: string) => value.startsWith(prefix) });
    expect(runsChecks("push", undefined, "")).toBe(true);
    for (const head of ["fix/x", "chore/x", "feature/x"]) {
      for (const action of ["opened", "synchronize", "reopened", "ready_for_review", "converted_to_draft"]) {
        expect(runsChecks("pull_request", action, head)).toBe(true);
      }
      expect(runsChecks("pull_request", "edited", head)).toBe(false);
    }
    for (const action of ["opened", "edited", "synchronize"]) expect(runsChecks("pull_request", action, "task/ci/x")).toBe(false);
    const proof = job(development, "proof");
    expect(proof).toContain("needs: checks");
    expect(proof).toContain("if: ${{ always() && needs.checks.result != 'skipped' }}");
    expect(proof).toContain('scripts/test/ci-plan.ts verify "$PLAN" "$RESULTS"');
    const gate = job(development, "development");
    expect(gate).toContain("name: development");
    expect(gate).toContain("needs: proof");
    expect(gate).toContain("if: ${{ always() }}");
    expect(gate).toContain("npm run names:check");
    expect(gate).toContain('node scripts/ci/allowed-workflows.ts "$PR_BASE_SHA" "$PR_LABELS"');
    expect(gate).toContain("PR_LABELS: ${{ toJSON(github.event.pull_request.labels.*.name) }}");
    expect(gate.indexOf("allowed-workflows.ts")).toBeLessThan(gate.indexOf("listWorkflowRuns"));
    expect(job(checks, "changes")).not.toContain("names:check");
    expect(job(checks, "static")).toContain("if: github.event_name == 'pull_request' && inputs.kind != 'fast'");
  });

  it("lets an edited event queue behind the test run instead of cancelling it", () => {
    const header = development.split("\njobs:\n")[0];
    expect(header).toContain("group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}");
    const cancel = header.match(/^ {2}cancel-in-progress: \$\{\{ (.+) \}\}$/mu)?.[1];
    assert.ok(cancel);
    const cancels = (action?: string): unknown => runInNewContext(cancel, { github: { event: { action } } });
    expect(cancels("edited")).toBe(false);
    for (const action of ["synchronize", "opened", undefined]) expect(cancels(action)).toBe(true);
  });

  it("selects task-branch push shards like a pull request, uncaps feature pull requests and refuses other pushes", () => {
    expect(selectUsingAdapter("fast", "push", "", "task/ci/push", filters))
      .toEqual(selectUsingAdapter("fast", "pull_request", "development", "feature/test", filters));
    expect(() => selectUsingAdapter("fast", "push", "", "feature/ci", filters)).toThrow("Push CI runs only fast checks on task branches.");
    const affected = { core: true, shardCount: 9, shards: [["tests/a.integration.test.ts"], ["tests/b.integration.test.ts"]] };
    expect(selectUsingAdapter("fast", "push", "", "task/ci/push", filters, false, affected).ubuntu.include.slice(5))
      .toEqual(affected.shards.map((files, i) => ({ suite: "integration", shard: i + 1, shards: 2, files })));
    const select = job(checks, "changes").split("id: affected")[1]?.split("\n      - ")[0] ?? "";
    expect(select).toContain("if: inputs.kind == 'fast'");
    expect(select).toContain("base=$(git merge-base origin/development HEAD)");
    expect(select).toContain('if [[ "$HEAD_REF" == feature/* ]]; then scope=(--all); fi');
    expect(select).toContain('scripts/test/affected-tests.ts "$base" HEAD "${scope[@]}"');
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
    expect(affected).toContain('npm run test:integration -- "${files[@]}" --reporter=verbose --maxWorkers=3');
  });

  it.each([
    { draft: false, markdown: false, count: 11 },
    { draft: true, markdown: false, count: 8 },
    { draft: false, markdown: true, count: 6 },
  ])("starts $count runner jobs for draft=$draft markdown=$markdown and no affected tests", ({ draft, markdown, count }) => {
    const plan = selectUsingAdapter("fast", "pull_request", "development", "feature/test",
      { ...filters, shared: markdown ? "false" : "true" }, draft);
    const needs = { changes: { result: "success", outputs: { plan: JSON.stringify(plan) } } };
    const started = jobNames(checks).filter(name => {
      const condition = job(checks, name).match(/^ {4}if: (.+)$/mu)?.[1];
      return !condition || expression(condition, needs, {}, "fast");
    });
    expect(started).toEqual(["changes", ...(!draft ? ["lint"] : []), "static", "privacy", ...(!markdown ? ["ubuntu"] : [])]);
    // proof and development run in the calling workflow.
    const runners = started.reduce((total, name) => total + (name === "ubuntu" ? plan.ubuntu.include.length : 1), 2);
    expect(runners).toBe(count);
    expect(plan.ubuntu.include.map(row => row.suite)).toEqual(markdown ? [] : draft
      ? ["unit", "unit", "unit"] : ["unit", "unit", "unit", "architecture", "architecture"]);
    for (const name of ["lint", "static", "privacy", "ubuntu"]) expect(job(checks, name)).toContain("needs: changes");
  });

  it("executes the proof shell, rejecting failures, cancellations and missing results", () => {
    const skipped = { result: "skipped" };
    for (const draft of [false, true]) {
      const plan = planFor("fast", { draft });
      const positive = { ...portableResults, lint: { result: draft ? "skipped" : "success" },
        integration: skipped, architecture: skipped, macos: skipped, "unit-proofs": skipped,
        unit: skipped, perf: skipped, smoke: skipped };
      const run = (result: string, outcomes: Record<string, { result: string }>) => summary(development, "proof", plan,
        { checks: { result, outputs: { plan: JSON.stringify(plan), results: JSON.stringify(outcomes) } } });
      expect(run("success", positive)).toBe("success");
      for (const result of ["failure", "cancelled"]) {
        expect(run(result, positive)).toBe("failure");
        expect(run("success", { ...positive, ubuntu: { result } })).toBe("failure");
      }
      expect(run("skipped", positive)).toBe("skipped");
      const missing: Record<string, { result: string }> = { ...positive };
      delete missing.static;
      expect(run("success", missing)).toBe("failure");
    }
  });

  it("requires this run's proof when it ran and looks one up otherwise", () => {
    const steps = job(development, "development").split(/\n {6}- /u);
    const own = steps.find(step => step.startsWith("name: Require this run's proof"));
    const lookup = steps.find(step => step.startsWith("name: Find the proof for the pull request head"));
    expect(own).toContain("if: needs.proof.result != 'skipped'");
    expect(own).toContain('run: test "$PROOF_RESULT" = success');
    expect(lookup).toContain("if: needs.proof.result == 'skipped'");
    expect(job(development, "development")).toContain("timeout-minutes: 25");
  });

  it("passes on the newest completed proof for the head commit, skipping gate-only runs", async () => {
    const runs = [proofRun(1, undefined, "in_progress", "2026-11-22T00:09:00Z"), proofRun(3, { conclusion: "skipped" }),
      proofRun(2, {}), proofRun(4, undefined)];
    const result = await proofLookup(() => runs);
    expect(result.failures).toEqual([]);
    expect(result.infos).toEqual([`Proof passed for ${"a".repeat(40)} in https://example.test/runs/2`]);
    expect(result.polls).toBe(1);
  });

  it.each(["failure", "cancelled"])("fails when the newest proof is %s, even if an older one passed", async conclusion => {
    const result = await proofLookup(() => [proofRun(3, { conclusion }), proofRun(2, {})]);
    expect(result.failures).toEqual([`Proof ${conclusion} for ${"a".repeat(40)} in https://example.test/runs/3`]);
  });

  it("waits for a running push run and passes when its proof succeeds", async () => {
    const result = await proofLookup(count => count < 3
      ? [proofRun(2, undefined, "in_progress")]
      : [proofRun(2, {})]);
    expect(result.failures).toEqual([]);
    expect(result.polls).toBe(4);
    expect(result.infos).toContain("Waiting for https://example.test/runs/2");
  });

  it("fails within about a minute when no run proves the head commit", async () => {
    for (const runs of [[], [proofRun(2, undefined)], [proofRun(2, { conclusion: "skipped" })]]) {
      const result = await proofLookup(() => runs);
      expect(result.failures).toEqual([`No Development run proves ${"a".repeat(40)}; push the branch to start one.`]);
      expect(result.minutes).toBeGreaterThanOrEqual(1);
      expect(result.minutes).toBeLessThan(2);
    }
  });

  it("fails instead of waiting forever on a proof that never finishes", async () => {
    const result = await proofLookup(() => [proofRun(2, { status: "in_progress", conclusion: null }, "in_progress")]);
    expect(result.failures).toEqual(["Timed out waiting for https://example.test/runs/2"]);
    expect(result.minutes).toBeGreaterThanOrEqual(20);
    expect(result.minutes).toBeLessThan(21);
  });
});

function expression(value: string, needs: unknown, context: Record<string, unknown>, kind = "portable"): unknown {
  return runInNewContext(value.replace(/\$\{\{(.*?)\}\}/gu, "$1").replaceAll("needs.*.result", "Object.values(needs).map(need => need.result)").replace(/\.([\w]+-[\w-]+)/gu, '["$1"]'), {
    needs, github: context, inputs: { kind }, fromJSON: JSON.parse, toJSON: JSON.stringify, always: () => true, cancelled: () => false,
    contains: (items: unknown[], item: string) => items.includes(item),
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
  const env = Object.fromEntries([...body.matchAll(/^ {10}([A-Z_]+): (.+)$/gmu)].map(([, key, value]) => [key,
    value.replace(/\$\{\{(.*?)\}\}/gu, (_, code: string) => String(expression(code, needs, context, plan.workflow))) ]));
  const verify = [...body.matchAll(/^ {8}run: (.+)$/gmu)].map((match) => match[1]).find((line) => line.includes("ci-plan.ts verify"));
  const script = verify
    ?? body.match(/^ {8}run: \|\n((?: {10}[^\n]*\n|\n)+)/mu)?.[1]
    ?? body.match(/^ {8}run: (.+)$/mu)?.[1] ?? body.match(/^ {6}- run: (.+)$/mu)?.[1];
  assert.ok(script);
  const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
    env: { ...process.env, ...env }, encoding: "utf8",
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return result.status === 0 ? "success" : "failure";
}

function selectUsingAdapter(kind: "fast" | "portable" | "release", event: string, base: string, head: string, selectedFilters: Record<string, string>, draft = false, affected = none): CiPlan {
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

  it("keeps the three gated workflows and a separate opt-in evidence run", () => {
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
    expect(job(production, "checks")).toContain("kind: release");
    expect(checks).not.toMatch(/uses: \.\/\.github\/workflows\//u);
    expect(checks).not.toMatch(/windows/iu);
    expect(checks.split("\njobs:\n")[0]).toContain("value: ${{ toJSON(jobs) }}");
    const evidence = load("dashboard-skeleton-evidence");
    expect(evidence.split("\npermissions:\n")[0]).toMatch(/\non:\n {2}push:\n {4}branches: \['chore\/dashboard-skeleton-evidence-\*'\]\n$/u);
    expect(jobNames(evidence)).toEqual(["dashboard-skeleton-evidence"]);
    expect(evidence).toContain("npm run test:smoke -- dashboard-skeletons.smoke.ts");
    expect(jobNames(staging)).toEqual(["names", "checks", "staging"]);
    expect(jobNames(production)).toEqual(["checks", "codeql", "dependencies", "production"]);
    expect(jobNames(checks)).toEqual(["changes", "lint", "static", "privacy", "ubuntu", "macos", "unit-proofs", "integration", "architecture", "perf", "smoke", "unit"]);
    expect(job(checks, "lint")).toContain("run: npm run lint");
    expect(job(checks, "lint")).toContain("working-directory: fast-duo");
    expect(job(checks, "lint")).toContain("if: ${{ fromJSON(needs.changes.outputs.plan).lint }}");
    expect(job(checks, "static")).toContain("run: npm run typecheck");
    expect(job(checks, "static")).not.toContain("npm run lint");
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

  it("keeps coverage local in every workflow", () => {
    const directory = new URL("../../../.github/workflows/", import.meta.url);
    for (const file of readdirSync(directory, { withFileTypes: true })) {
      if (!file.isFile() || !/\.ya?ml$/u.test(file.name)) continue;
      expect(readFileSync(new URL(file.name, directory), "utf8")).not.toMatch(/test:coverage|--coverage/u);
    }
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
    expect(selectUsingAdapter("release", "pull_request", "main", "staging", filters)).toEqual(planFor("release"));
    expect(selectUsingAdapter("release", "pull_request", "main", "feature/other", filters).fullRelease).toBe(false);
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
    expect(job(checks, "unit")).toContain("needs: [changes, lint, static, privacy, ubuntu, integration, architecture, macos, unit-proofs, perf, smoke]");
    expect(job(checks, "unit")).not.toMatch(/^ {4}needs:.*\btimings\b/mu);
    expect(job(staging, "staging")).toContain("needs: [names, checks]");
    expect(job(production, "production")).toContain("needs: [checks, codeql, dependencies]");
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
    expect(summary(production, "production", omitted, { checks: { result: "success" }, codeql: { result: "success" }, dependencies: { result: "success" } })).toBe("success");
  });

  it("runs the security jobs only in Production: codeql on pull requests and pushes, dependencies on pull requests", () => {
    expect(job(production, "codeql")).toContain("if: ${{ github.event_name != 'workflow_dispatch' }}");
    expect(job(production, "codeql")).toContain("security-events: write");
    expect(job(production, "codeql")).toContain("github/codeql-action/init@v4");
    expect(job(production, "codeql")).toContain("github/codeql-action/analyze@v4");
    expect(job(production, "dependencies")).toContain("if: ${{ github.event_name == 'pull_request' }}");
    expect(job(production, "dependencies")).toContain("run: npm audit --omit=dev --audit-level=high");
    expect(job(production, "checks")).toContain("if: ${{ github.event_name != 'push' }}");
    expect(job(production, "production")).toContain("github.event_name != 'push'");
    expect(staging).not.toMatch(/codeql|npm audit/u);
  });

  it.each([
    { event_name: "pull_request", head_ref: "staging", checks: "success", expected: "success" },
    { event_name: "pull_request", head_ref: "hotfix/x", checks: "success", expected: "success" },
    { event_name: "pull_request", head_ref: "feature/other", checks: "success", expected: "failure" },
    { event_name: "pull_request", head_ref: "hotfix", checks: "success", expected: "failure" },
    { event_name: "workflow_dispatch", head_ref: "", checks: "success", expected: "success" },
    { event_name: "workflow_dispatch", head_ref: "", checks: "failure", expected: "failure" },
    ...["failure", "cancelled", "skipped", ""].map(checks => ({ event_name: "pull_request", head_ref: "staging", checks, expected: "failure" })),
  ])("runs the production gate ($event_name/$head_ref/$checks)", ({ event_name, head_ref, checks: result, expected }) => {
    expect(summary(production, "production", planFor("release"), { checks: { result }, codeql: { result: "success" }, dependencies: { result: "success" } }, { event_name, head_ref })).toBe(expected);
  });

  it.each(["codeql", "dependencies"])("fails the production gate for a pull request when %s did not succeed", name => {
    const context = { event_name: "pull_request", head_ref: "staging" };
    const ok = { checks: { result: "success" }, codeql: { result: "success" }, dependencies: { result: "success" } };
    for (const result of ["failure", "cancelled", "skipped"]) {
      expect(summary(production, "production", planFor("release"), { ...ok, [name]: { result } }, context)).toBe("failure");
    }
  });

  it("skips the production gate on a push to main", () => {
    const skipped = { checks: { result: "skipped" }, codeql: { result: "success" }, dependencies: { result: "skipped" } };
    expect(summary(production, "production", planFor("release"), skipped, { event_name: "push", head_ref: "" })).toBe("skipped");
  });

  it.each(["failure", "cancelled"])("fails the staging gate when a needed job is %s", result => {
    const pull = { event_name: "pull_request", event: { action: "synchronize" } };
    const plan = planFor("portable");
    expect(summary(staging, "staging", plan, { names: { result: "success" }, checks: { result: "success" } }, pull)).toBe("success");
    expect(summary(staging, "staging", plan, { names: { result: "success" }, checks: { result } }, pull)).toBe("failure");
    expect(summary(staging, "staging", plan, { names: { result }, checks: { result: "skipped" } }, pull)).toBe("failure");
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
