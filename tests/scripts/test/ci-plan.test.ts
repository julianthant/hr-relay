import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createCiPlan, hasTimingArtifact, registeredTimingWorkflows, timingRunIds, verifyCiResults, verifyProofs, verifyUnitProof } from "../../../scripts/test/ci-plan.js";

const filters = { shared: "true", unit: "false", integration: "false", architecture: "false" };
const context = (workflow = "portable", extra: Record<string, unknown> = {}) => ({ workflow, event: "pull_request",
  base: workflow === "portable" ? "staging" : "main", head: workflow === "portable" ? "feature/test" : "staging",
  draft: false, filters, ...extra });
const portableResults = { changes: { result: "success" }, static: { result: "success" }, privacy: { result: "success" },
  ubuntu: { result: "success" }, integration: { result: "success" }, architecture: { result: "success" },
  timings: { result: "success" } };
const releaseResults = { ...portableResults, macos: { result: "success" }, windows: { result: "success" },
  "unit-proofs": { result: "success" }, "release-batch": { result: "success" } };

function cli(command: string, input: unknown, results?: unknown) {
  return spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"),
    fileURLToPath(new URL("../../../scripts/test/ci-plan.ts", import.meta.url)), command, JSON.stringify(input),
    ...(results === undefined ? [] : [JSON.stringify(results)])], { encoding: "utf8" });
}

describe("flat CI plan", () => {
  it("keeps staging portable and preserves release/manual native shards", () => {
    const portable = createCiPlan(context());
    expect(portable.ubuntu.include.filter(row => row.suite === "unit")).toHaveLength(2);
    expect(portable.ubuntu.include.filter(row => row.suite === "architecture")).toHaveLength(2);
    expect(portable.ubuntu.include.filter(row => row.suite === "integration")).toHaveLength(14);
    expect(portable.macos.include).toEqual([]);
    expect(portable.windows.include).toEqual([]);
    expect(portable.testJobs).toBe(18);
    for (const manual of [false, true]) {
      const plan = createCiPlan(context("release", manual ? { event: "workflow_dispatch", base: "", head: "", filters: {}, draft: true } : {}));
      expect(plan.macos.include).toEqual(Array.from({ length: 5 }, (_, i) => ({ suite: "native", shard: i + 1, shards: 5 })));
      expect(plan.windows.include).toEqual(Array.from({ length: 5 }, (_, i) => ({ suite: "native", shard: i + 1, shards: 5 })));
      expect(plan.releaseBatch).toBe(!manual);
      expect(plan.testJobs).toBe(28);
    }
  });

  it.each([
    { suite: "integration", draft: false, shards: 5 },
    { suite: "unit", draft: false, shards: 1 },
    { suite: "shared", draft: true, shards: 1 },
  ])("preserves native-only/draft layout $suite/$draft", ({ suite, draft, shards }) => {
    const plan = createCiPlan(context("release", { filters: { ...filters, shared: "false", [suite]: "true" }, draft }));
    expect(plan.macos.include).toEqual(Array.from({ length: shards }, (_, i) => ({ suite: "native", shard: i + 1, shards })));
    expect(plan.windows.include).toEqual(plan.macos.include);
    expect(plan.releaseBatch).toBe(false);
  });

  it("preserves Markdown work omissions and prevents expensive work on invalid main heads", () => {
    for (const workflow of ["portable", "release"]) {
      const plan = createCiPlan(context(workflow, { filters: { ...filters, shared: "false" } }));
      expect(plan.testJobs).toBe(0);
      expect(plan.releaseBatch).toBe(false);
    }
    const invalid = createCiPlan(context("release", { head: "feature/other" }));
    expect(invalid.fullRelease).toBe(false);
    expect(invalid.macos.include).toEqual([]);
    expect(invalid.windows.include).toEqual([]);
    expect(invalid.releaseBatch).toBe(false);
  });

  it("refuses incorrect entry contexts and incomplete filters", () => {
    for (const input of [context("portable", { base: "main" }), context("portable", { event: "workflow_dispatch" }),
      context("release", { base: "staging" }), context("portable", { filters: {} }), context("portable", { filters: { ...filters, unit: "unknown" } })]) {
      expect(() => createCiPlan(input)).toThrow();
    }
  });

  it("runs the real CLI and preserves failure exit status", () => {
    const valid = cli("plan", context());
    expect(valid.error).toBeUndefined();
    expect(valid.status).toBe(0);
    expect(JSON.parse(valid.stdout)).toEqual(createCiPlan(context()));
    expect(cli("verify", createCiPlan(context()), portableResults).status).toBe(0);
    expect(cli("verify", createCiPlan(context()), { ...portableResults, timings: { result: "cancelled" } }).status).toBe(1);
    expect(cli("plan", context("portable", { filters: {} })).status).toBe(1);
    expect(cli("unknown", {}).status).toBe(1);
  });
});

describe("flat CI failure fences", () => {
  it("requires every proof plus timing publication, with legitimate manual/Markdown omissions", () => {
    expect(() => verifyCiResults(createCiPlan(context()), portableResults)).not.toThrow();
    expect(() => verifyCiResults(createCiPlan(context("release")), releaseResults)).not.toThrow();
    expect(() => verifyCiResults(createCiPlan(context("release", { event: "workflow_dispatch", base: "", head: "", filters: {} })),
      { ...releaseResults, "release-batch": { result: "skipped" } })).not.toThrow();
    for (const workflow of ["portable", "release"]) {
      const plan = createCiPlan(context(workflow, { filters: { ...filters, shared: "false" } }));
      const omitted = { ...releaseResults, ubuntu: { result: "skipped" }, macos: { result: "skipped" },
        windows: { result: "skipped" }, "release-batch": { result: "skipped" }, timings: { result: "skipped" } };
      expect(() => verifyCiResults(plan, omitted)).not.toThrow();
      expect(() => verifyCiResults(plan, { ...omitted, ubuntu: { result: "success" } })).toThrow();
      expect(() => verifyCiResults(plan, { ...omitted, timings: { result: "success" } })).toThrow();
    }
  });

  it.each(["failure", "cancelled", "skipped"])("refuses unsuccessful or missing mandatory outcomes %s", result => {
    for (const workflow of ["portable", "release"]) {
      const plan = createCiPlan(context(workflow));
      const positive: Record<string, { result: string }> = workflow === "portable" ? portableResults : releaseResults;
      for (const job of Object.keys(positive)) {
        expect(() => verifyCiResults(plan, { ...positive, [job]: { result } })).toThrow();
        const missing = { ...positive };
        delete missing[job];
        expect(() => verifyCiResults(plan, missing)).toThrow();
      }
    }
  });

  it("requires timing input proofs before publication and both selected native platforms", () => {
    const plan = createCiPlan(context("release"));
    expect(() => verifyProofs(plan, releaseResults)).not.toThrow();
    expect(() => verifyProofs(plan, { ...releaseResults, architecture: { result: "failure" } })).toThrow();
    expect(() => verifyUnitProof(plan, releaseResults)).not.toThrow();
    for (const platform of ["macos", "windows"]) {
      for (const result of ["failure", "cancelled", "skipped"]) {
        expect(() => verifyUnitProof(plan, { ...releaseResults, [platform]: { result } })).toThrow();
      }
    }
    const empty = { ...plan, macos: { include: [] }, windows: { include: [] }, testJobs: plan.ubuntu.include.length };
    expect(() => verifyUnitProof(empty, { ...releaseResults, macos: { result: "skipped" }, windows: { result: "skipped" } })).toThrow();
    const missing = { ...plan, macos: undefined, windows: undefined };
    expect(() => verifyUnitProof(missing, releaseResults)).toThrow();
  });

  it("refuses malformed selectors, matrices and timing counts", () => {
    const plan = createCiPlan(context());
    for (const field of ["unit", "integration", "architecture", "fullRelease", "releaseBatch"]) {
      for (const value of [undefined, "false", 1, {}]) {
        expect(() => verifyCiResults({ ...plan, [field]: value }, portableResults)).toThrow();
      }
    }
    for (const testJobs of [undefined, -1, 1.5, NaN, Infinity, 0]) {
      expect(() => verifyCiResults({ ...plan, testJobs }, portableResults)).toThrow();
    }
  });
});

describe("registered CI timing history", () => {
  it("queries only registered eligible workflow IDs, including before release registration", () => {
    expect(registeredTimingWorkflows([{ id: 1, path: ".github/workflows/ci.yml" }, { id: 3, path: ".github/workflows/other.yml" }])).toEqual([1]);
    expect(registeredTimingWorkflows([{ id: 1, path: ".github/workflows/ci.yml" }, { id: 2, path: ".github/workflows/release.yml" }])).toEqual([1, 2]);
    expect(registeredTimingWorkflows([])).toEqual([]);
    expect(timingRunIds({ currentRunId: 9, runs: [] })).toEqual([]);
    expect(hasTimingArtifact([])).toBe(false);
  });

  it("orders CI and release history together, excludes the current run, and rejects corrupt responses", () => {
    expect(timingRunIds({ currentRunId: 9, runs: [
      { id: 5, created_at: "2026-11-02T00:00:00Z", conclusion: "success" },
      { id: 9, created_at: "2026-11-03T00:00:00Z", conclusion: "success" },
      { id: 4, created_at: "2026-11-03T00:00:00Z", conclusion: "success" },
      { id: 6, created_at: "2026-11-03T00:00:00Z", conclusion: "success" },
    ] })).toEqual([6, 4, 5]);
    expect(hasTimingArtifact([{ name: "ci-timings", expired: true }])).toBe(false);
    expect(hasTimingArtifact([{ name: "ci-timings", expired: false }])).toBe(true);
    expect(() => registeredTimingWorkflows([{ path: ".github/workflows/ci.yml" }])).toThrow();
    expect(() => timingRunIds({ currentRunId: 9, runs: [{ id: 1, created_at: "invalid", conclusion: "success" }] })).toThrow();
    expect(() => timingRunIds({ currentRunId: 9, runs: [{ id: 1, created_at: "2026-11-03T00:00:00Z", conclusion: "failure" }] })).toThrow();
    expect(() => hasTimingArtifact([{ name: "ci-timings" }])).toThrow();
  });
});
