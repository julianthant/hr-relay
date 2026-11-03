import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MACOS_FILES, SERIAL_FILES, SERIAL_STORAGE_FILES, selectCiFiles } from "../../../scripts/test/ci-files.js";

const checks = readFileSync(new URL("../../../.github/workflows/ci-checks.yml", import.meta.url), "utf8");
const ci = readFileSync(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8");
const suites = ["unit", "integration", "architecture", "parity"] as const;
type Suite = typeof suites[number];
type Result = "success" | "failure" | "skipped" | "cancelled";
type Need = { result: Result; outputs?: Record<string, string> };
const matrixSchema = z.object({ include: z.array(z.object({ suite: z.string(), shard: z.number(), shards: z.number() })) });

function job(workflow: string, name: string): string {
  const body = workflow.split(`\n  ${name}:\n`)[1]?.split(/\n {2}[\w-]+:\n/u)[0];
  assert.ok(body, `Missing workflow job ${name}`);
  return body;
}

function expression(value: string, needs: Record<string, Need>): unknown {
  return runInNewContext(value.replace(/\$\{\{(.*?)\}\}/gu, "$1"), {
    needs, cancelled: () => false, always: () => true,
  });
}

function select(base = "staging", filters: Record<string, string> = { shared: "true" }, eventName = "pull_request", draft = false) {
  const source = checks.match(/ {8}id: select[\s\S]*? {10}script: \|\n((?: {12}[^\n]*\n|\n)+)/u)?.[1];
  assert.ok(source, "Missing workflow selection script");
  const outputs: Record<string, string> = {};
  runInNewContext(source.replace(/^ {12}/gmu, ""), {
    context: { eventName, payload: { pull_request: { base: { ref: base }, draft } } },
    process: { env: { FILTERS: JSON.stringify({ ...Object.fromEntries(
      ["shared", ...suites].map(name => [name, "false"]),
    ), ...filters }) } },
    core: { setOutput: (name: string, value: string) => { outputs[name] = value; } },
  });
  return outputs;
}

function summary(workflow: string, suite: Suite, needs: Record<string, Need>): Result {
  const body = job(workflow, suite);
  const condition = body.match(/^ {4}if: (.+)$/mu)?.[1];
  assert.ok(condition, `Missing ${suite} summary condition`);
  expect(condition).toMatch(/!cancelled\(\)|always\(\)/u);
  if (!expression(condition, needs)) return "skipped";
  const env = Object.fromEntries([...body.matchAll(/^ {10}([A-Z_]+): (.+)$/gmu)].map(([, name, value]) => {
    const evaluated = value.replace(/\$\{\{(.*?)\}\}/gu, (_, code: string) => String(expression(code, needs)));
    return [name, evaluated];
  }));
  const script = body.match(/^ {8}run: \|\n((?: {10}[^\n]*\n|\n)+)/mu)?.[1]
    ?? body.match(/^ {8}run: (.+)$/mu)?.[1];
  assert.ok(script, `Missing ${suite} summary script`);
  const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
    env: { ...process.env, ...env }, encoding: "utf8",
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return result.status === 0 ? "success" : "failure";
}

function aggregate(suite: Suite, outputs: Record<string, string>, ubuntu: Result, macos: Result, changes: Result = "success") {
  return summary(checks, suite, { changes: { result: changes, outputs }, ubuntu: { result: ubuntu }, macos: { result: macos } });
}

describe("CI workflow selection and required summaries", () => {
  it("runs portable suites with no macOS jobs on staging", () => {
    const outputs = select();
    expect(outputs.macos).toBe('{"include":[]}');
    expect(outputs.parity).toBe("false");
    const ubuntu = matrixSchema.parse(JSON.parse(outputs.ubuntu));
    expect(ubuntu.include.filter(entry => entry.suite === "unit")).toHaveLength(2);
    expect(ubuntu.include.filter(entry => entry.suite === "integration")).toHaveLength(14);
    expect(ubuntu.include.filter(entry => entry.suite === "architecture")).toHaveLength(2);
    const condition = job(checks, "macos").match(/^ {4}if: (.+)$/mu)?.[1];
    assert.ok(condition);
    expect(expression(condition, { changes: { result: "success", outputs } })).toBe(false);
    for (const suite of suites) {
      const result = aggregate(suite, outputs, "success", "skipped");
      expect(result, suite).toBe("success");
      expect(summary(ci, suite, { checks: { result: "success", outputs: { [suite]: result } } }), suite).toBe("success");
    }
  });

  it.each(["pull_request", "workflow_dispatch"])("keeps native and parity shards for release/manual %s", event => {
    const outputs = select(event === "pull_request" ? "main" : "staging", { shared: "true" }, event);
    const macos = matrixSchema.parse(JSON.parse(outputs.macos));
    expect(macos.include).toEqual([
      ...[1, 2, 3].map(shard => ({ suite: "parity", shard, shards: 3 })),
      ...[1, 2].map(shard => ({ suite: "native", shard, shards: 2 })),
    ]);
    const condition = job(checks, "macos").match(/^ {4}if: (.+)$/mu)?.[1];
    assert.ok(condition);
    expect(expression(condition, { changes: { result: "success", outputs } })).toBe(true);
    for (const suite of suites) expect(aggregate(suite, outputs, "success", "success"), suite).toBe("success");
    for (const result of ["failure", "cancelled", "skipped"] as const) {
      for (const suite of ["unit", "integration", "parity"] as const) {
        const failed = aggregate(suite, outputs, "success", result);
        expect(failed, `${suite}: ${result}`).toBe("failure");
        expect(summary(ci, suite, { checks: { result: "failure", outputs: { [suite]: failed } } }), suite).toBe("failure");
      }
    }
  });

  it.each([
    { filter: "integration", draft: false, shards: 5 },
    { filter: "unit", draft: false, shards: 1 },
    { filter: "shared", draft: true, shards: 1 },
  ])("preserves the release native-only layout with $shards shards (draft=$draft)", ({ filter, draft, shards }) => {
    const filters = { shared: "false", [filter]: "true" };
    const outputs = select("main", filters, "pull_request", draft);
    expect(JSON.parse(outputs.macos)).toEqual({ include: Array.from({ length: shards }, (_, i) => ({ suite: "native", shard: i + 1, shards })) });
    expect(select("staging", filters, "pull_request", draft).macos).toBe('{"include":[]}');
  });

  it("exports every required summary through the reusable workflow", () => {
    const declarations = checks.split("\njobs:\n")[0];
    for (const suite of suites) expect(declarations).toContain(`      ${suite}:\n        value: \${{ jobs.${suite}.result }}`);
  });

  it("keeps every native-only file on release shards and out of staging Ubuntu shards", () => {
    const nativeFiles = [...new Set([...MACOS_FILES, ...SERIAL_FILES, ...SERIAL_STORAGE_FILES])];
    const release = matrixSchema.parse(JSON.parse(select("main").macos));
    const native = release.include.filter(entry => entry.suite === "native");
    for (const project of ["unit", "integration"] as const) {
      const listed = [`tests/portable${project === "integration" ? ".integration" : ""}.test.ts`,
        ...nativeFiles.filter(file => file.endsWith(".integration.test.ts") === (project === "integration"))];
      expect(selectCiFiles(listed, project, "ubuntu", 1, 1, {})).toEqual([listed[0]]);
      const selected = native.flatMap(({ shard, shards }) => (["macos", "serial", "storage"] as const).flatMap(runner =>
        selectCiFiles(listed, project, runner, shard, shards, {})));
      expect(selected.sort()).toEqual(listed.slice(1).sort());
    }
    const macosJob = job(checks, "macos");
    for (const command of ["integration serial", "integration storage", "unit macos", "integration macos"]) {
      expect(macosJob).toContain(`scripts/test/ci-run.sh ${command} "$SLICE"`);
    }
  });

  it("requires selected Ubuntu jobs and successful selection on staging", () => {
    const outputs = select();
    for (const result of ["failure", "cancelled", "skipped"] as const) {
      for (const suite of ["unit", "integration", "architecture"] as const) {
        expect(aggregate(suite, outputs, result, "skipped"), suite).toBe("failure");
      }
      for (const suite of suites) expect(aggregate(suite, outputs, "success", "skipped", result), suite).toBe("failure");
    }
    expect(summary(ci, "unit", { checks: { result: "failure", outputs: { unit: "success" } } })).toBe("failure");
  });

  it("keeps Markdown-only suites intentionally omitted", () => {
    const outputs = select("staging", { shared: "false" });
    expect(outputs.ubuntu).toBe('{"include":[]}');
    expect(outputs.macos).toBe('{"include":[]}');
    for (const suite of suites) expect(aggregate(suite, outputs, "skipped", "skipped"), suite).toBe("success");
  });
});
