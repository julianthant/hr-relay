import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { NATIVE_FILES, SERIAL_FILES, SERIAL_STORAGE_FILES, selectCiFiles } from "../../../scripts/test/ci-files.js";

const load = (name: string) => readFileSync(new URL(`../../../.github/workflows/${name}.yml`, import.meta.url), "utf8");
const ci = load("ci");
const pipeline = load("ci-pipeline");
const portable = load("ci-checks");
const release = load("ci-release-checks");
const suites = ["unit", "integration", "architecture", "parity"] as const;
type Result = "success" | "failure" | "skipped" | "cancelled";
type Need = { result: Result; outputs?: Record<string, string> };
const matrixSchema = z.object({ include: z.array(z.object({ suite: z.string(), shard: z.number(), shards: z.number() })) });
const planSchema = z.object({
  unit: z.boolean(), integration: z.boolean(), architecture: z.boolean(), parity: z.boolean(),
  fullRelease: z.boolean(), releaseBatch: z.boolean(), testJobs: z.number(),
  ubuntu: matrixSchema, macos: matrixSchema, windows: matrixSchema,
});
type Plan = z.infer<typeof planSchema>;
const github = { event_name: "pull_request", base_ref: "main", head_ref: "staging" };

function job(workflow: string, name: string): string {
  const body = workflow.split(`\n  ${name}:\n`)[1]?.split(/\n {2}[\w-]+:\n/u)[0];
  assert.ok(body, `Missing workflow job ${name}`);
  return body;
}

function expression(value: string, needs: Record<string, Need>, inputs: Record<string, string> = {}, context: Record<string, unknown> = github): unknown {
  return runInNewContext(value.replace(/\$\{\{(.*?)\}\}/gu, "$1").replace(/\.([\w]+-[\w-]+)/gu, '["$1"]'), {
    needs, inputs, github: context, fromJSON: JSON.parse, toJSON: JSON.stringify,
    cancelled: () => false, always: () => true,
  });
}

function select(base = "staging", filters: Record<string, string> = { shared: "true" }, eventName = "pull_request", draft = false, head = "staging") {
  const source = pipeline.match(/ {8}id: select[\s\S]*? {10}script: \|\n((?: {12}[^\n]*\n|\n)+)/u)?.[1];
  assert.ok(source, "Missing pipeline selection script");
  const outputs: Record<string, string> = {};
  runInNewContext(source.replace(/^ {12}/gmu, ""), {
    context: { eventName, payload: { pull_request: { base: { ref: base }, head: { ref: head }, draft } } },
    process: { env: { FILTERS: JSON.stringify({ ...Object.fromEntries(
      ["shared", ...suites].map(name => [name, "false"]),
    ), ...filters }) } },
    core: { setOutput: (name: string, value: string) => { outputs[name] = value; } },
  });
  return outputs;
}
const planOf = (outputs: Record<string, string>) => planSchema.parse(JSON.parse(outputs.plan));

function summary(workflow: string, suite: string, needs: Record<string, Need>, inputs: Record<string, string> = {}, context: Record<string, unknown> = github): Result {
  const body = job(workflow, suite);
  const condition = body.match(/^ {4}if: (.+)$/mu)?.[1];
  assert.ok(condition);
  expect(condition).toMatch(/!cancelled\(\)|always\(\)/u);
  if (!expression(condition, needs, inputs, context)) return "skipped";
  const env = Object.fromEntries([...body.matchAll(/^ {10}([A-Z_]+): (.+)$/gmu)].map(([, name, value]) => [name,
    value.replace(/\$\{\{(.*?)\}\}/gu, (_, code: string) => String(expression(code, needs, inputs, context))) ]));
  const script = body.match(/^ {8}run: \|\n((?: {10}[^\n]*\n|\n)+)/mu)?.[1]
    ?? body.match(/^ {8}run: (.+)$/mu)?.[1];
  assert.ok(script);
  const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
    env: { ...process.env, ...env }, encoding: "utf8",
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return result.status === 0 ? "success" : "failure";
}

function collect(plan: unknown, portableResult: Result, releaseResult: Result, selectedOutputs: Record<string, string>, planResult: Result = "success") {
  const body = job(pipeline, "results");
  const source = body.match(/ {10}script: \|\n((?: {12}[^\n]*\n|\n)+)/u)?.[1];
  assert.ok(source);
  const full = planSchema.safeParse(plan).data?.fullRelease;
  const outputs: Record<string, string> = {};
  runInNewContext(source.replace(/^ {12}/gmu, ""), {
    process: { env: { PLAN_RESULT: planResult, PLAN: JSON.stringify(plan), PORTABLE_RESULT: portableResult,
      RELEASE_RESULT: releaseResult, PORTABLE_OUTPUTS: JSON.stringify(full ? {} : selectedOutputs),
      RELEASE_OUTPUTS: JSON.stringify(full ? selectedOutputs : {}) } },
    core: { setOutput: (name: string, value: string) => { outputs[name] = value; } },
  });
  return outputs;
}

const portableOutputs = { static: "success", privacy: "success", unit: "success", integration: "success", architecture: "success" };
const releaseOutputs = (plan: Plan) => ({ ...portableOutputs, parity: "success", release: plan.releaseBatch ? "success" : "skipped" });

function reachable(workflow: string, outputs: Record<string, string>, inputs: Record<string, string> = {}, prefix = ""): string[] {
  const names = [...(workflow.split("\njobs:\n")[1] ?? "").matchAll(/^ {2}([\w-]+):$/gmu)].map(match => match[1]);
  return names.flatMap(name => {
    const body = job(workflow, name);
    const call = body.match(/^ {4}uses: \.\/\.github\/workflows\/([\w-]+)\.yml$/mu)?.[1];
    if (call) {
      const condition = body.match(/^ {4}if: (.+)$/mu)?.[1];
      if (condition && !expression(condition, { changes: { result: "success", outputs } }, inputs, {
        ...github, base_ref: outputs["full-release"] === "false" ? "staging" : "main", repository: "relay",
        event: { pull_request: { head: { repo: { full_name: "relay" } } } },
      })) return [];
      return reachable(load(call), outputs, { plan: outputs.plan }, `${prefix}${name} / `);
    }
    return [`${prefix}${name}`];
  });
}

describe("release workflow split", () => {
  it("keeps one admitted pipeline and no OS/parity execution in portable CI", () => {
    expect(job(ci, "checks")).toContain("uses: ./.github/workflows/ci-pipeline.yml");
    expect(job(ci, "checks")).toContain("group: ci-runners");
    for (const workflow of [pipeline, portable, release]) expect(workflow).not.toContain("group: ci-runners");
    expect(portable).not.toMatch(/^ {2}(?:macos|windows|parity|release):$/mu);
    expect(release).toContain("uses: ./.github/workflows/ci-checks.yml");
    expect(job(pipeline, "full-release")).toContain("needs.changes.outputs.full-release == 'true'");
    expect(job(pipeline, "portable")).toContain("needs.changes.outputs.full-release == 'false'");
    expect(job(pipeline, "results")).toContain("!cancelled()");
    expect(job(pipeline, "timings")).toContain("!cancelled()");
  });

  it("staging reaches only portable jobs and intentional required summaries", () => {
    const outputs = select();
    const plan = planOf(outputs);
    expect(Object.keys(outputs).sort()).toEqual(["full-release", "plan"]);
    expect(plan.macos.include).toEqual([]);
    expect(plan.windows.include).toEqual([]);
    expect(plan.parity).toBe(false);
    expect(plan.ubuntu.include.filter(entry => entry.suite === "unit")).toHaveLength(2);
    expect(plan.ubuntu.include.filter(entry => entry.suite === "integration")).toHaveLength(14);
    expect(plan.ubuntu.include.filter(entry => entry.suite === "architecture")).toHaveLength(2);
    expect(reachable(ci, outputs)).toEqual([
      "checks / changes", "checks / portable / static", "checks / portable / ubuntu",
      "checks / portable / unit", "checks / portable / integration", "checks / portable / architecture",
      "checks / portable / privacy", "checks / results", "checks / timings",
      "static", "privacy", "unit", "integration", "architecture", "parity", "release", "train / train",
    ]);
    const results = collect(plan, "success", "skipped", portableOutputs);
    expect(results).toEqual({ ...portableOutputs, parity: "success", release: "skipped" });
    for (const suite of suites) expect(summary(ci, suite, { checks: { result: "success", outputs: results } })).toBe("success");
  });

  it.each(["pull_request", "workflow_dispatch"])("preserves full native/parity reachability for %s", event => {
    const outputs = select(event === "pull_request" ? "main" : "staging", { shared: "true" }, event);
    const plan = planOf(outputs);
    expect(plan.fullRelease).toBe(true);
    expect(plan.releaseBatch).toBe(event === "pull_request");
    expect(plan.macos.include).toEqual([
      ...[1, 2, 3].map(shard => ({ suite: "parity", shard, shards: 3 })),
      ...[1, 2].map(shard => ({ suite: "native", shard, shards: 2 })),
    ]);
    expect(plan.windows.include).toEqual(Array.from({ length: 5 }, (_, i) => ({ suite: "native", shard: i + 1, shards: 5 })));
    const graph = reachable(ci, outputs);
    for (const name of ["macos", "windows", "parity", "release"]) expect(graph).toContain(`checks / full-release / ${name}`);
    expect(graph).toContain("checks / full-release / portable / ubuntu");
    expect(graph).not.toContain("checks / portable / ubuntu");
    expect(collect(plan, "skipped", "success", releaseOutputs(plan))).toEqual(releaseOutputs(plan));
  });

  it.each([
    { filter: "integration", draft: false, shards: 5 },
    { filter: "unit", draft: false, shards: 1 },
    { filter: "shared", draft: true, shards: 1 },
  ])("preserves native-only release layout and draft limits ($filter/$draft)", ({ filter, draft, shards }) => {
    const plan = planOf(select("main", { shared: "false", [filter]: "true" }, "pull_request", draft));
    expect(plan.macos.include).toEqual(Array.from({ length: shards }, (_, i) => ({ suite: "native", shard: i + 1, shards })));
    expect(plan.windows.include).toEqual(plan.macos.include);
    expect(plan.parity).toBe(false);
    expect(plan.releaseBatch).toBe(false);
  });

  it("preserves legitimate Markdown omissions and rejects missing selectors", () => {
    for (const base of ["staging", "main"]) {
      const plan = planOf(select(base, { shared: "false" }));
      expect(plan.testJobs).toBe(0);
      expect(plan.releaseBatch).toBe(false);
      expect(plan.ubuntu.include).toEqual([]);
      expect(plan.macos.include).toEqual([]);
      expect(plan.windows.include).toEqual([]);
      expect(collect(plan, base === "main" ? "skipped" : "success", base === "main" ? "success" : "skipped",
        base === "main" ? releaseOutputs(plan) : portableOutputs).release).toBe("skipped");
    }
    expect(reachable(pipeline, {})).toEqual(["changes", "results", "timings"]);
    for (const plan of [{}, { fullRelease: "false", releaseBatch: false }, { fullRelease: false }]) {
      expect(() => collect(plan, "skipped", "skipped", {})).toThrow();
    }
    expect(() => select("staging", { shared: "invalid" })).toThrow();
  });

  it("keeps one native file authority and runs each pinned file once on both platforms", () => {
    const nativeFiles = [...new Set([...NATIVE_FILES, ...SERIAL_FILES, ...SERIAL_STORAGE_FILES])];
    const plan = planOf(select("main"));
    for (const platform of ["macos", "windows"] as const) {
      const native = plan[platform].include.filter(entry => entry.suite === "native");
      for (const project of ["unit", "integration"] as const) {
        const listed = [`tests/portable${project === "integration" ? ".integration" : ""}.test.ts`,
          ...nativeFiles.filter(file => file.endsWith(".integration.test.ts") === (project === "integration"))];
        expect(selectCiFiles(listed, project, "ubuntu", 1, 1, {})).toEqual([listed[0]]);
        const selected = native.flatMap(({ shard, shards }) => (["native", "serial", "storage"] as const).flatMap(runner =>
          selectCiFiles(listed, project, runner, shard, shards, {})));
        expect(selected.sort(), platform).toEqual(listed.slice(1).sort());
      }
    }
  });

  it("retains platform bootstrap, budgets and every post-failure native group", () => {
    for (const workflow of [portable, release]) {
      expect(workflow).toContain('RELAY_TEST_RAM_MB: "2048"');
      expect(workflow).toContain('RELAY_TEST_TIME_SCALE: "2.5"');
    }
    const windows = job(release, "windows");
    expect(windows).toContain("runs-on: windows-latest");
    expect(windows).toContain("shell: bash");
    expect(windows.indexOf("git config --global core.autocrlf false")).toBeLessThan(windows.indexOf("uses: actions/checkout@v4"));
    expect(windows).toContain("git config --global core.autocrlf false");
    expect(windows).not.toMatch(/ram-tmp|mdutil|sysctl|memory_pressure|continue-on-error/u);
    expect(windows).toContain("npx playwright install chromium");
    for (const platform of ["macos", "windows"]) {
      const body = job(release, platform);
      expect(body).toContain("timeout-minutes: 30");
      expect(body).toContain("fail-fast: false");
      expect(body).toContain("run: npx tsx scripts/test/chromium-preflight.ts");
      const steps = body.split(/\n {6}- /u).filter(step => step.includes("scripts/test/ci-run.sh"));
      expect(steps).toHaveLength(4);
      for (const step of steps) expect(step).toContain("!cancelled()");
      for (const command of ["integration serial", "integration storage", "unit native", "integration native"]) {
        expect(body).toContain(`scripts/test/ci-run.sh ${command} "$SLICE"`);
      }
    }
    expect(job(release, "release")).toContain("needs: [portable, unit, integration, parity]");
    expect(job(release, "release")).toContain("npm run test:coverage\n      - run: npm run test:perf");
  });

  it.each(["failure", "cancelled", "skipped"] as const)("rejects failed or missing selected outputs (%s)", outcome => {
    for (const full of [false, true]) {
      const plan = planOf(select(full ? "main" : "staging"));
      const outputs = full ? releaseOutputs(plan) : portableOutputs;
      expect(() => collect(plan, full ? "skipped" : outcome, full ? outcome : "skipped", outputs)).toThrow();
      if (outcome !== "skipped") expect(() => collect(plan, full ? outcome : "success", full ? "success" : outcome, outputs)).toThrow();
      expect(() => collect(plan, "success", "success", outputs)).toThrow();
      expect(() => collect(plan, full ? "skipped" : "success", full ? "success" : "skipped", outputs, outcome)).toThrow();
      for (const suite of Object.keys(outputs)) {
        for (const value of [outcome, ""]) {
          expect(() => collect(plan, full ? "skipped" : "success", full ? "success" : "skipped", { ...outputs, [suite]: value })).toThrow();
        }
      }
    }
  });

  it("refuses empty native matrices for a selected release suite", () => {
    for (const suite of ["unit", "integration"] as const) {
      const plan = { ...planOf(select("main")), macos: { include: [] }, windows: { include: [] } };
      expect(summary(release, suite, { portable: { result: "success", outputs: portableOutputs },
        macos: { result: "skipped" }, windows: { result: "skipped" } }, { plan: JSON.stringify(plan) })).toBe("failure");
    }
  });

  it("refuses missing native matrices for a selected release suite", () => {
    for (const suite of ["unit", "integration"] as const) {
      const plan = { ...planOf(select("main")), macos: undefined, windows: undefined };
      expect(summary(release, suite, { portable: { result: "success", outputs: portableOutputs },
        macos: { result: "skipped" }, windows: { result: "skipped" } }, { plan: JSON.stringify(plan) })).toBe("failure");
    }
  });

  it.each([undefined, -1, 1.5, NaN, Infinity, 0])("refuses malformed or inconsistent timing work count %s", testJobs => {
    const plan = { ...planOf(select()), testJobs };
    expect(() => collect(plan, "success", "skipped", portableOutputs)).toThrow();
  });

  it.each(["unit", "integration", "architecture", "parity"])("refuses malformed suite-selection types for %s", suite => {
    for (const value of [undefined, "false", 1, {}]) {
      const plan = { ...planOf(select()), [suite]: value };
      expect(() => collect(plan, "success", "skipped", portableOutputs)).toThrow();
    }
  });

  it("requires successful selected and exactly skipped omitted native groups", () => {
    for (const base of ["staging", "main"]) {
      const plan = planOf(select(base));
      const inputs = { plan: JSON.stringify(plan) };
      for (const suite of ["unit", "integration", "architecture"] as const) {
        expect(summary(portable, suite, { ubuntu: { result: "success" } }, inputs)).toBe("success");
        for (const result of ["failure", "cancelled", "skipped"] as const) {
          expect(summary(portable, suite, { ubuntu: { result } }, inputs)).toBe("failure");
        }
      }
      if (plan.fullRelease) {
        for (const suite of ["unit", "integration"] as const) {
          const needs = { portable: { result: "success" as const, outputs: portableOutputs },
            macos: { result: "success" as Result }, windows: { result: "success" as Result } };
          expect(summary(release, suite, needs, inputs)).toBe("success");
          for (const platform of ["macos", "windows"] as const) {
            for (const result of ["failure", "cancelled", "skipped"] as const) {
              expect(summary(release, suite, { ...needs, [platform]: { result } }, inputs)).toBe("failure");
            }
          }
        }
        expect(summary(release, "parity", { macos: { result: "success" } }, inputs)).toBe("success");
        for (const result of ["failure", "cancelled", "skipped"] as const) {
          expect(summary(release, "parity", { macos: { result } }, inputs)).toBe("failure");
        }
      }
    }
  });

  it("keeps timing publication inside admission and mandatory for the top unit fence", () => {
    const outputs = select();
    expect(job(pipeline, "timings")).toContain("needs: [changes, results]");
    expect(job(pipeline, "timings")).toContain("pattern: durations-*");
    expect(job(pipeline, "timings")).toContain("name: ci-timings");
    for (const result of ["failure", "cancelled", "skipped"] as const) {
      expect(summary(ci, "unit", { checks: { result, outputs: portableOutputs } })).toBe("failure");
    }
    expect(planOf(outputs).testJobs).toBe(18);
    for (const suite of suites) expect(summary(ci, suite, { checks: { result: "success", outputs: {} } })).toBe("failure");
  });

  it.each([
    { event_name: "pull_request", base_ref: "main", head_ref: "staging", releaseResult: "success", expected: "success" },
    { event_name: "pull_request", base_ref: "main", head_ref: "feature/other", releaseResult: "skipped", expected: "failure" },
    { event_name: "pull_request", base_ref: "main", head_ref: "feature/other", releaseResult: "success", expected: "failure" },
    { event_name: "pull_request", base_ref: "main", head_ref: "staging", releaseResult: "skipped", expected: "skipped" },
    { event_name: "pull_request", base_ref: "staging", head_ref: "feature/other", releaseResult: "skipped", expected: "skipped" },
    { event_name: "workflow_dispatch", base_ref: "main", head_ref: "staging", releaseResult: "skipped", expected: "skipped" },
  ])("keeps the required release fence ($head_ref/$base_ref/$releaseResult)", ({ event_name, base_ref, head_ref, releaseResult, expected }) => {
    const context = { event_name, base_ref, head_ref };
    expect(summary(ci, "release", { checks: { result: "success", outputs: { release: releaseResult } } }, {}, context)).toBe(expected);
    if (head_ref !== "staging" || base_ref !== "main") {
      const plan = planOf(select(base_ref, { shared: "true" }, event_name, false, head_ref));
      expect(plan.fullRelease).toBe(event_name === "workflow_dispatch");
      expect(plan.releaseBatch).toBe(false);
    }
  });

  it.each(["failure", "cancelled", ""])("fails selected release output %s", releaseResult => {
    expect(summary(ci, "release", { checks: { result: "success", outputs: { release: releaseResult } } })).toBe("failure");
  });
});
