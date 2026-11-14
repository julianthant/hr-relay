import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { ciPlanSchema, createCiPlan, hasTimingArtifact, registeredTimingWorkflows, timingRunIds } from "../../../scripts/test/ci-plan.js";
import { NATIVE_FILES, SERIAL_FILES, SERIAL_STORAGE_FILES, selectCiFiles } from "../../../scripts/test/ci-files.js";
import type { CiPlan } from "../../../scripts/test/ci-plan.js";

const load = (name: string) => readFileSync(new URL(`../../../.github/workflows/${name}.yml`, import.meta.url), "utf8");
const ci = load("ci");
const release = load("release");
const portable = load("ci-checks");
const full = load("release-checks");
const filters = { shared: "true", unit: "false", integration: "false", architecture: "false" };
const planFor = (workflow: "portable" | "release", extra: Record<string, unknown> = {}) => createCiPlan({
  workflow, event: "pull_request", base: workflow === "portable" ? "staging" : "main",
  head: workflow === "portable" ? "feature/test" : "staging", draft: false, filters, ...extra,
});
const portableResults = { changes: { result: "success" }, static: { result: "success" }, privacy: { result: "success" },
  ubuntu: { result: "success" }, integration: { result: "success" }, architecture: { result: "success" },
  timings: { result: "success" } };
const releaseResults = { ...portableResults, macos: { result: "success" }, windows: { result: "success" },
  "unit-proofs": { result: "success" }, "release-batch": { result: "success" } };

function job(workflow: string, name: string): string {
  const body = workflow.split(`\n  ${name}:\n`)[1]?.split(/\n {2}[\w-]+:\n/u)[0];
  assert.ok(body, `Missing workflow job ${name}`);
  return body;
}
const jobNames = (workflow: string) => [...(workflow.split("\njobs:\n")[1] ?? "").matchAll(/^ {2}([\w-]+):$/gmu)].map(match => match[1]);

function expression(value: string, needs: unknown, context: Record<string, string>): unknown {
  return runInNewContext(value.replace(/\$\{\{(.*?)\}\}/gu, "$1").replace(/\.([\w]+-[\w-]+)/gu, '["$1"]'), {
    needs, github: context, fromJSON: JSON.parse, toJSON: JSON.stringify, always: () => true, cancelled: () => false,
  });
}

function summary(workflow: string, name: string, plan: CiPlan, outcomes: Record<string, { result: string; outputs?: Record<string, string> }>,
  context = { event_name: "pull_request", head_ref: "staging" }): string {
  const needs = { ...outcomes, changes: { ...outcomes.changes, outputs: { plan: JSON.stringify(plan) } } };
  const body = job(workflow, name);
  const condition = body.match(/^ {4}if: (.+)$/mu)?.[1];
  assert.ok(condition);
  if (!expression(condition, needs, context)) return "skipped";
  const env = Object.fromEntries([...body.matchAll(/^ {10}([A-Z_]+): (.+)$/gmu)].map(([, key, value]) => [key,
    value.replace(/\$\{\{(.*?)\}\}/gu, (_, code: string) => String(expression(code, needs, context))) ]));
  const script = body.match(/^ {8}run: \|\n((?: {10}[^\n]*\n|\n)+)/mu)?.[1]
    ?? body.match(/^ {8}run: (.+)$/mu)?.[1] ?? body.match(/^ {6}- run: (.+)$/mu)?.[1];
  assert.ok(script);
  const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
    env: { ...process.env, ...env }, encoding: "utf8",
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return result.status === 0 ? "success" : "failure";
}

function selectUsingAdapter(workflow: string, event: string, base: string, head: string, selectedFilters: Record<string, string>, draft = false): CiPlan {
  const source = job(workflow, "changes").match(/ {8}id: select[\s\S]*? {10}script: \|\n((?: {12}[^\n]*\n|\n)+)/u)?.[1];
  assert.ok(source);
  const outputs: Record<string, string> = {};
  runInNewContext(source.replace(/^ {12}/gmu, ""), {
    require: () => ({ execFileSync: (_node: string, args: string[]) => JSON.stringify(createCiPlan(JSON.parse(args[4] ?? ""))) }),
    context: { eventName: event, payload: event === "pull_request" ? { pull_request: { base: { ref: base }, head: { ref: head }, draft } } : {} },
    process: { env: { FILTERS: JSON.stringify(selectedFilters) } },
    core: { setOutput: (key: string, value: string) => { outputs[key] = value; } },
  });
  expect(Object.keys(outputs)).toEqual(["plan"]);
  return ciPlanSchema.parse(JSON.parse(outputs.plan));
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
  await runInNewContext(`(async () => {${timingScript(portable)}\n})()`, {
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

  it("owns disjoint actual triggers and never loads release from staging CI", () => {
    const ciTrigger = ci.split("\npermissions:\n")[0];
    const releaseTrigger = release.split("\npermissions:\n")[0];
    expect(ciTrigger).toContain("branches: [staging]");
    const pullRequestTypes = ciTrigger.match(/types:\s*\[([^\]]*)\]/u)?.[1] ?? "";
    expect(pullRequestTypes.split(",").map((item) => item.trim())).toContain("edited");
    expect(ciTrigger).not.toContain("workflow_dispatch:");
    expect(ciTrigger).not.toContain("push:");
    expect(load("merge-train").split("\non:\n")[1]?.split("\npermissions:")[0]).toBe(`  push:
    branches: [staging]
    paths-ignore: ['docs/roadmap/**']
  workflow_call:
    inputs:
      pr: {type: string, default: ""}
      conclusion: {type: string, default: ""}
    secrets:
      TRAIN_TOKEN: {required: true}
`);
    expect(releaseTrigger).toContain("branches: [main]");
    expect(releaseTrigger).toContain("workflow_dispatch:");
    expect(ci).not.toContain("release.yml");
    expect(job(ci, "checks")).toContain("uses: ./.github/workflows/ci-checks.yml");
    expect(job(release, "checks")).toContain("uses: ./.github/workflows/release-checks.yml");
    expect(portable).not.toMatch(/uses: \.\/\.github\/workflows\//u);
    expect(portable).not.toMatch(/runs-on: (?:macos|windows)/u);
    for (const name of ["ci-pipeline", "ci-release-checks"]) {
      expect(existsSync(new URL(`../../../.github/workflows/${name}.yml`, import.meta.url))).toBe(false);
    }
    expect(jobNames(ci)).toEqual(["names", "checks", "static", "privacy", "unit", "integration", "architecture", "train"]);
    expect(jobNames(release)).toEqual(["checks", "static", "privacy", "unit", "integration", "architecture", "release"]);
    expect(jobNames(portable)).toEqual(["changes", "static", "privacy", "ubuntu", "integration", "architecture", "timings", "unit"]);
    expect(jobNames(full)).toEqual(["changes", "static", "privacy", "ubuntu", "macos", "windows", "unit-proofs", "integration", "architecture", "release-batch", "timings", "unit"]);
    for (const name of jobNames(portable)) expect(job(portable, name)).toContain("runs-on: ubuntu-latest");
  });

  it("executes each entry's actual shared selection adapter", () => {
    expect(selectUsingAdapter(portable, "pull_request", "staging", "feature/test", filters)).toEqual(planFor("portable"));
    expect(selectUsingAdapter(full, "pull_request", "main", "staging", filters)).toEqual(planFor("release"));
    expect(selectUsingAdapter(full, "pull_request", "main", "feature/other", filters).fullRelease).toBe(false);
    expect(selectUsingAdapter(full, "workflow_dispatch", "", "", {}).releaseBatch).toBe(false);
    expect(selectUsingAdapter(full, "workflow_dispatch", "", "", {}).testJobs).toBe(28);
    expect(selectUsingAdapter(full, "pull_request", "main", "staging", { ...filters, shared: "false" }).testJobs).toBe(0);
    expect(() => selectUsingAdapter(portable, "pull_request", "staging", "feature/test", {})).toThrow();
  });

  it("retains explicit budgets and complete inner/outer fences without nested admission", () => {
    for (const workflow of [portable, full]) {
      expect(workflow).not.toContain("group: ci-runners");
      expect(workflow).toContain('RELAY_TEST_RAM_MB: "2048"');
      expect(workflow).toContain('RELAY_TEST_TIME_SCALE: "2.5"');
      expect(job(workflow, "changes")).toContain("scripts/test/ci-plan.ts', 'plan'");
      expect(job(workflow, "unit")).toContain("!cancelled()");
      expect(job(workflow, "unit")).not.toContain("train");
      expect(job(workflow, "timings")).toContain("!cancelled()");
      expect(job(workflow, "timings")).toContain('scripts/test/ci-plan.ts proofs "$PLAN" "$RESULTS"');
    }
    for (const workflow of [ci, release]) {
      expect(job(workflow, "unit")).toContain('test "$PIPELINE" = success');
      expect(job(workflow, "unit")).toContain('test "$RESULT" = success');
      expect(job(workflow, "unit")).toContain("always()");
    }
    expect(job(ci, "train")).toContain("needs: [names, static, unit, integration, architecture, privacy]");
    expect(job(ci, "train")).toContain("uses: ./.github/workflows/merge-train.yml");
    expect(job(full, "release-batch")).toContain("needs: [changes, static, privacy, unit-proofs, integration, architecture]");
    expect(job(full, "unit")).toContain("release-batch, timings]");
    expect(job(release, "release")).toContain("needs: checks");
  });

  it("retains native/bootstrap budgets, post-failure groups and exact file membership", () => {
    const windows = job(full, "windows");
    expect(windows.indexOf("git config --global core.autocrlf false")).toBeLessThan(windows.indexOf("uses: actions/checkout@v7"));
    expect(windows).toContain("git config --global core.autocrlf false");
    expect(windows).toContain("shell: bash");
    expect(windows).not.toMatch(/ram-tmp|mdutil|sysctl|memory_pressure|continue-on-error/u);
    expect(windows).toContain("npx playwright install chromium");
    for (const platform of ["macos", "windows"] as const) {
      const body = job(full, platform);
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
        expect(selectCiFiles(listed, project, "ubuntu", 1, 1, {})).toEqual([listed[0]]);
        const selected = native.flatMap(({ shard, shards }) => (["native", "serial", "storage"] as const).flatMap(group =>
          selectCiFiles(listed, project, group, shard, shards, {})));
        expect(selected.sort()).toEqual(pinned.sort());
      }
    }
    expect(job(full, "release-batch")).toContain("npm run test:coverage\n      - run: npm run test:perf");
  });

  it.each(["portable", "release"] as const)("executes the actual final unit shell and rejects incomplete %s pipelines", workflow => {
    const source = workflow === "portable" ? portable : full;
    const plan = planFor(workflow);
    const positive = workflow === "portable" ? portableResults : releaseResults;
    expect(summary(source, "unit", plan, positive)).toBe("success");
    for (const result of ["failure", "cancelled", "skipped"]) {
      expect(summary(source, "unit", plan, { ...positive, timings: { result } })).toBe("failure");
    }
    expect(summary(source, "unit", plan, { ...positive, static: { result: "failure" } })).toBe("failure");
    expect(summary(source, "unit", plan, { ...positive, changes: { result: "failure" } })).toBe("failure");
  });

  it.each([ci, release])("rejects incomplete calls or missing inner-unit outcomes at the actual outer fence", source => {
    const plan = planFor(source === ci ? "portable" : "release");
    expect(summary(source, "unit", plan, { checks: { result: "success", outputs: { unit: "success" } } })).toBe("success");
    for (const result of ["failure", "cancelled", "skipped", ""]) {
      expect(summary(source, "unit", plan, { checks: { result, outputs: { unit: "success" } } })).toBe("failure");
      expect(summary(source, "unit", plan, { checks: { result: "success", outputs: { unit: result } } })).toBe("failure");
    }
    expect(summary(source, "unit", plan, { checks: { result: "success", outputs: {} } })).toBe("failure");
  });


  it("requires both selected native groups and preserves legitimate work omissions", () => {
    const plan = planFor("release");
    expect(summary(full, "integration", plan, releaseResults)).toBe("success");
    for (const platform of ["macos", "windows"]) {
      for (const result of ["failure", "cancelled", "skipped"]) {
        expect(summary(full, "integration", plan, { ...releaseResults, [platform]: { result } })).toBe("failure");
      }
    }
    const omitted = planFor("release", { filters: { ...filters, shared: "false" } });
    const outcomes = { ...releaseResults, ubuntu: { result: "skipped" }, macos: { result: "skipped" }, windows: { result: "skipped" },
      "release-batch": { result: "skipped" }, timings: { result: "skipped" } };
    expect(summary(full, "unit", omitted, outcomes)).toBe("success");
    expect(summary(release, "release", omitted, { checks: { result: "success", outputs: { unit: "success" } } })).toBe("success");
  });

  it.each([
    { event_name: "pull_request", head_ref: "staging", unit: "success", expected: "success" },
    { event_name: "pull_request", head_ref: "feature/other", unit: "success", expected: "failure" },
    { event_name: "pull_request", head_ref: "feature/other", unit: "skipped", expected: "failure" },
    { event_name: "workflow_dispatch", head_ref: "", unit: "success", expected: "success" },
    { event_name: "workflow_dispatch", head_ref: "", unit: "failure", expected: "failure" },
    { event_name: "pull_request", head_ref: "staging", unit: "cancelled", expected: "failure" },
    { event_name: "pull_request", head_ref: "staging", unit: "skipped", expected: "failure" },
  ])("runs the required release fence ($event_name/$head_ref/$unit)", ({ event_name, head_ref, unit, expected }) => {
    expect(summary(release, "release", planFor("release"), { checks: { result: "success", outputs: { unit } } }, { event_name, head_ref })).toBe(expected);
  });
  it("rejects an incomplete release call even when its inner unit output claims success", () => {
    const plan = planFor("release");
    for (const result of ["failure", "cancelled", "skipped", ""]) {
      expect(summary(release, "release", plan, { checks: { result, outputs: { unit: "success" } } })).toBe("failure");
    }
    expect(summary(release, "release", plan, { checks: { result: "success", outputs: {} } })).toBe("failure");
  });

});

describe("shared timing discovery adapters", () => {
  it("uses one policy and handles an unregistered new release workflow without a 404 query", async () => {
    expect(timingScript(portable)).toBe(timingScript(full));
    expect(await discoverTimings([{ id: 1, path: ".github/workflows/ci.yml" }])).toEqual({ queried: [1], artifacts: [10], output: { run: "10" } });
    expect(await discoverTimings([{ id: 1, path: ".github/workflows/ci.yml" }, { id: 2, path: ".github/workflows/release.yml" }]))
      .toEqual({ queried: [1, 2], artifacts: [30, 20], output: { run: "20" } });
  });

  it("uses the seed only for valid no-history/no-retained-report cases", async () => {
    expect(await discoverTimings([])).toEqual({ queried: [], artifacts: [], output: {} });
    expect(await discoverTimings([{ id: 1, path: ".github/workflows/ci.yml" }], true)).toEqual({ queried: [1], artifacts: [], output: {} });
  });

  it.each(["workflows", "runs", "artifacts"])("does not swallow unexpected API failures at %s", async failAt => {
    await expect(discoverTimings([{ id: 1, path: ".github/workflows/ci.yml" }], false, failAt)).rejects.toThrow(/API/u);
  });
});

describe("per-PR cancellation with complete FIFO pipelines", () => {
  it.each([ci, release])("supersedes the same PR/manual branch while separating other keys", source => {
    const header = source.split("\njobs:\n")[0];
    const group = header.match(/^ {2}group: (.+)$/mu)?.[1];
    assert.ok(group);
    const key = (number: number | undefined, ref: string) => group.replace(/\$\{\{(.*?)\}\}/gu, (_, code: string) => String(runInNewContext(code, {
      github: { workflow: source === ci ? "CI" : "Release", event: { pull_request: { number } }, ref },
    })));
    expect(key(90, "refs/pull/90/merge")).toBe(key(90, "refs/heads/updated-source"));
    expect(key(undefined, "refs/heads/staging")).toBe(`ci-${source === ci ? "CI" : "Release"}-refs/heads/staging`);
    expect(key(90, "refs/pull/90/merge")).not.toBe(key(91, "refs/pull/91/merge"));
    expect(key(undefined, "refs/heads/staging")).not.toBe(key(undefined, "refs/heads/other"));
    expect(header).toContain("cancel-in-progress: true");
  });

  it.each([ci, release])("queues the transitive whole proof pipeline while keeping train outside", source => {
    const admitted = job(source, "checks");
    expect(admitted).toContain("group: ci-runners");
    expect(admitted).toContain("queue: max");
    expect(admitted).toContain("cancel-in-progress: false");
    const calleeName = admitted.match(/uses: \.\/\.github\/workflows\/([\w-]+)\.yml/u)?.[1];
    assert.ok(calleeName);
    const callee = load(calleeName);
    const covered = jobNames(callee);
    for (const name of ["changes", "static", "privacy", "ubuntu", "integration", "architecture", "timings", "unit"]) expect(covered).toContain(name);
    expect(covered).not.toContain("train");
    const closure = (name: string, ancestors: string[] = []): string[] => {
      expect(ancestors).not.toContain(name);
      const dependencies = job(callee, name).match(/^ {4}needs: \[(.+)\]$/mu)?.[1]?.split(", ") ?? [];
      return [name, ...dependencies.flatMap(dependency => closure(dependency, [...ancestors, name]))];
    };
    expect([...new Set(closure("unit"))].sort()).toEqual([...covered].sort());
    expect(job(callee, "unit")).toContain("timings]");
    expect(callee).not.toContain("group: ci-runners");
    if (source === ci) {
      for (const name of covered) expect(job(callee, name)).toContain("runs-on: ubuntu-latest");
      expect(callee).not.toMatch(/uses: \.\/\.github\/workflows\//u);
      expect(job(source, "train")).toContain("needs: [names, static, unit, integration, architecture, privacy]");
    } else {
      for (const name of ["macos", "windows", "unit-proofs", "release-batch"]) expect(covered).toContain(name);
      expect(job(callee, "unit")).toContain("release-batch, timings]");
    }
  });
});

describe("cancelled admitted source work", () => {
  it.each([[ci, portable], [release, full]])("stops inner checkout work while the outer fence rejects cancellation", (entry, callee) => {
    const inner = job(callee, "unit");
    const outer = job(entry, "unit");
    const condition = (body: string, cancelled: boolean) => {
      const code = body.match(/^ {4}if: \$\{\{ (.+) \}\}$/mu)?.[1];
      assert.ok(code);
      return Boolean(runInNewContext(code, { cancelled: () => cancelled, always: () => true }));
    };
    expect(inner).toContain("uses: actions/checkout@v7");
    expect(inner).toContain("run: npm ci");
    expect(outer).not.toContain("actions/checkout");
    expect(outer).not.toContain("npm ci");
    expect(condition(inner, false)).toBe(true);
    expect(condition(inner, true)).toBe(false);
    expect(condition(outer, true)).toBe(true);
    expect(summary(entry, "unit", planFor(entry === ci ? "portable" : "release"), {
      checks: { result: "cancelled", outputs: { unit: "skipped" } },
    })).toBe("failure");
  });
});
