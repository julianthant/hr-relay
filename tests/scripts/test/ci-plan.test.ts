import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createCiPlan, hasTimingArtifact, publishTimings, registeredTimingWorkflows, timingRunIds, verifyCiResults, verifyProofs, verifyUnitProof } from "../../../scripts/test/ci-plan.js";

const filters = { shared: "true", unit: "false", integration: "false", architecture: "false" };
const none = { core: false, shardCount: 0, shards: [] };
const context = (workflow = "portable", extra: Record<string, unknown> = {}) => ({ workflow, event: "pull_request",
  base: workflow === "portable" ? "staging" : "main", head: workflow === "portable" ? "cut/m1" : "hotfix/x",
  draft: false, filters, ...extra });
const portableResults = { changes: { result: "success" }, lint: { result: "success" }, static: { result: "success" }, privacy: { result: "success" },
  ubuntu: { result: "success" }, integration: { result: "success" }, architecture: { result: "success" },
  perf: { result: "success" }, smoke: { result: "success" } };
const releaseResults = { ...portableResults, macos: { result: "success" },
  "unit-proofs": { result: "success" } };

function cli(command: string, input: unknown, results?: unknown) {
  return spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"),
    fileURLToPath(new URL("../../../scripts/test/ci-plan.ts", import.meta.url)), command, JSON.stringify(input),
    ...(results === undefined ? [] : [JSON.stringify(results)])], { encoding: "utf8" });
}

describe("flat CI plan", () => {
  it("plans only three unit and two architecture shards for development, with a unit-only draft", () => {
    const fast = context("fast", { base: "development", head: "feature/test", affected: none });
    const plan = createCiPlan(fast);
    expect(plan.ubuntu.include).toEqual([
      { suite: "unit", shard: 1, shards: 3 }, { suite: "unit", shard: 2, shards: 3 }, { suite: "unit", shard: 3, shards: 3 },
      { suite: "architecture", shard: 1, shards: 2 }, { suite: "architecture", shard: 2, shards: 2 },
    ]);
    expect(plan).toMatchObject({ workflow: "fast", lint: true, integration: false, perf: false, smoke: false,
      fullRelease: false, macos: { include: [] }, testJobs: 5 });
    const draft = createCiPlan({ ...fast, draft: true });
    expect(draft).toMatchObject({ lint: false, unit: true, architecture: false, integration: false, testJobs: 3 });
    expect(draft.ubuntu.include.every(row => row.suite === "unit")).toBe(true);
    for (const invalid of [{ ...fast, base: "staging" }, { ...fast, event: "workflow_dispatch" }]) {
      expect(() => createCiPlan(invalid)).toThrow("Fast CI requires a development pull request.");
    }
    expect(createCiPlan({ ...fast, event: "push", head: "task/ci/push" })).toEqual(plan);
    expect(() => createCiPlan({ ...fast, affected: undefined })).toThrow("Only fast CI takes the affected integration plan.");
    expect(() => createCiPlan(context("portable", { affected: none }))).toThrow("Only fast CI takes the affected integration plan.");
    for (const invalid of [{ ...fast, event: "push" }, context("portable", { event: "push", head: "task/ci/push" })]) {
      expect(() => createCiPlan(invalid)).toThrow("Push CI runs only fast checks on task branches.");
    }
  });

  it("runs the selector's integration shards with their files on ready fast runs only", () => {
    const shards = [["tests/a.integration.test.ts", "tests/b.integration.test.ts"], ["tests/c.integration.test.ts"]];
    const affected = { core: false, shardCount: 2, shards };
    const fast = context("fast", { base: "development", head: "task/ci/push", event: "push",
      filters: { ...filters, shared: "false" }, affected });
    const plan = createCiPlan(fast);
    expect(plan.ubuntu.include).toEqual(shards.map((files, i) => ({ suite: "integration", shard: i + 1, shards: 2, files })));
    expect(plan).toMatchObject({ integration: true, unit: false, architecture: false, testJobs: 2 });
    expect(createCiPlan({ ...fast, filters }).testJobs).toBe(7);
    expect(createCiPlan({ ...fast, event: "pull_request", head: "feature/x", draft: true, filters })).toMatchObject({ integration: false, testJobs: 3 });
    expect(() => createCiPlan({ ...fast, affected: { ...affected, shards: [[]] } })).toThrow();
    expect(() => createCiPlan({ ...fast, affected: { ...affected, shards: [["src/a.ts"]] } })).toThrow();
  });

  it.each(["portable", "release"])("selects perf and smoke on ready %s pull requests only", workflow => {
    for (const selectedFilters of [filters, { ...filters, shared: "false" }]) {
      expect(createCiPlan(context(workflow, { filters: selectedFilters }))).toMatchObject({ perf: true, smoke: true });
      expect(createCiPlan(context(workflow, { filters: selectedFilters, draft: true }))).toMatchObject({ perf: false, smoke: false });
    }
    if (workflow === "release") {
      expect(createCiPlan(context(workflow, { event: "workflow_dispatch", filters: {} }))).toMatchObject({ perf: false, smoke: false });
    }
  });

  it("keeps staging portable and preserves release/manual native shards", () => {
    const portable = createCiPlan(context());
    expect(portable.ubuntu.include.filter(row => row.suite === "unit")).toHaveLength(3);
    expect(portable.ubuntu.include.filter(row => row.suite === "architecture")).toHaveLength(2);
    expect(portable.ubuntu.include.filter(row => row.suite === "integration")).toHaveLength(30);
    expect(portable.macos.include).toEqual([]);
    expect(portable).not.toHaveProperty("windows");
    expect(portable.testJobs).toBe(35);
    const unitOnly = createCiPlan(context("portable", { filters: { ...filters, shared: "false", unit: "true" } }));
    expect(unitOnly.ubuntu.include.filter(row => row.suite === "unit")).toHaveLength(3);
    expect(unitOnly.ubuntu.include.filter(row => row.suite === "integration")).toHaveLength(0);
    for (const manual of [false, true]) {
      const plan = createCiPlan(context("release", manual ? { event: "workflow_dispatch", base: "", head: "", filters: {}, draft: true } : {}));
      expect(plan.macos.include).toEqual(Array.from({ length: 5 }, (_, i) => ({ suite: "native", shard: i + 1, shards: 5 })));
      expect(plan).not.toHaveProperty("windows");
      expect(plan.testJobs).toBe(40);
    }
  });

  it.each([
    { suite: "integration", draft: false, shards: 5 },
    { suite: "unit", draft: false, shards: 1 },
    { suite: "shared", draft: true, shards: 1 },
  ])("preserves native-only/draft layout $suite/$draft", ({ suite, draft, shards }) => {
    const plan = createCiPlan(context("release", { filters: { ...filters, shared: "false", [suite]: "true" }, draft }));
    expect(plan.macos.include).toEqual(Array.from({ length: shards }, (_, i) => ({ suite: "native", shard: i + 1, shards })));
  });

  it("preserves Markdown matrix omissions and prevents native work on invalid main heads", () => {
    for (const workflow of ["portable", "release"]) {
      const plan = createCiPlan(context(workflow, { filters: { ...filters, shared: "false" } }));
      expect(plan.testJobs).toBe(0);
    }
    const invalid = createCiPlan(context("release", { head: "feature/other" }));
    expect(invalid.fullRelease).toBe(false);
    expect(invalid.macos.include).toEqual([]);
    const hotfix = createCiPlan(context("release", { head: "hotfix/x" }));
    expect(hotfix.fullRelease).toBe(true);
    expect(hotfix.macos.include).toEqual(createCiPlan(context("release")).macos.include);
    expect(createCiPlan(context("release", { head: "hotfix" })).fullRelease).toBe(false);
  });

  it("plans the scheduled full run with every suite, perf, smoke and native shards", () => {
    const full = { workflow: "full", event: "schedule", base: "", head: "development", draft: false, filters: {} };
    const plan = createCiPlan(full);
    expect(plan).toMatchObject({ workflow: "full", fullRelease: true, lint: true, perf: true, smoke: true,
      unit: true, integration: true, architecture: true, testJobs: 40 });
    expect(plan.ubuntu.include.filter(row => row.suite === "integration")).toHaveLength(30);
    expect(plan.macos.include).toEqual(createCiPlan(context("release")).macos.include);
    expect(() => verifyCiResults(plan, releaseResults)).not.toThrow();
    expect(publishTimings(plan, releaseResults)).toBe(true);
    for (const job of ["macos", "unit-proofs", "perf", "smoke"]) {
      expect(() => verifyCiResults(plan, { ...releaseResults, [job]: { result: "skipped" } })).toThrow();
    }
    for (const invalid of [{ ...full, head: "task/ci/x" }, { ...full, event: "push" }, { ...full, workflow: "release" },
      context("portable", { event: "schedule" })]) {
      expect(() => createCiPlan(invalid)).toThrow();
    }
  });

  it("runs staging-to-main releases on the portable suite without native shards", () => {
    const release = createCiPlan(context("portable", { base: "main", head: "staging" }));
    expect(release).toEqual(createCiPlan(context()));
    expect(release).toMatchObject({ fullRelease: false, macos: { include: [] }, testJobs: 35 });
    expect(createCiPlan(context("release", { head: "staging" })).fullRelease).toBe(false);
    expect(() => createCiPlan(context("portable", { base: "main", head: "hotfix/x" }))).toThrow();
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
    expect(cli("verify", createCiPlan(context()), { ...portableResults, ubuntu: { result: "failure" } }).status).toBe(1);
    expect(cli("verify", createCiPlan(context()), { ...portableResults, ubuntu: { result: "cancelled" } }).status).toBe(1);
    expect(JSON.parse(cli("publish", createCiPlan(context()), portableResults).stdout)).toBe(true);
    expect(JSON.parse(cli("publish", createCiPlan(context()), { ...portableResults, static: { result: "failure" } }).stdout)).toBe(false);
    expect(JSON.parse(cli("publish", createCiPlan(context()), { ...portableResults, static: { result: "cancelled" } }).stdout)).toBe(false);
    expect(cli("plan", context("portable", { filters: {} })).status).toBe(1);
    expect(cli("unknown", {}).status).toBe(1);
  });
});

describe("flat CI failure fences", () => {
  it("folds fast proofs into the development gate and rejects unsuccessful or missing results", () => {
    const skipped = { result: "skipped" };
    for (const draft of [false, true]) {
      const plan = createCiPlan(context("fast", { base: "development", draft, affected: none }));
      const positive: Record<string, { result: string }> = { ...portableResults,
        lint: { result: draft ? "skipped" : "success" }, integration: skipped, architecture: skipped,
        macos: skipped, "unit-proofs": skipped, unit: skipped, perf: skipped, smoke: skipped };
      expect(() => verifyCiResults(plan, positive)).not.toThrow();
      for (const job of Object.keys(positive)) {
        for (const result of ["failure", "cancelled", positive[job].result === "success" ? "skipped" : "success"]) {
          expect(() => verifyCiResults(plan, { ...positive, [job]: { result } })).toThrow();
        }
        const missing = { ...positive };
        delete missing[job];
        expect(() => verifyCiResults(plan, missing)).toThrow();
      }
    }
    const omitted = createCiPlan(context("fast", { base: "development", filters: { ...filters, shared: "false" }, affected: none }));
    expect(omitted.testJobs).toBe(0);
    expect(() => verifyCiResults(omitted, { ...portableResults, ubuntu: skipped, integration: skipped,
      architecture: skipped, macos: skipped, "unit-proofs": skipped, unit: skipped, perf: skipped, smoke: skipped })).not.toThrow();
  });

  it("requires every proof, and publishes timings only after every proof passes", () => {
    expect(() => verifyCiResults(createCiPlan(context()), portableResults)).not.toThrow();
    expect(() => verifyCiResults(createCiPlan(context("release")), releaseResults)).not.toThrow();
    const manual = createCiPlan(context("release", { event: "workflow_dispatch", base: "", head: "", filters: {} }));
    expect(() => verifyCiResults(manual, { ...releaseResults, perf: { result: "skipped" }, smoke: { result: "skipped" } })).not.toThrow();
    expect(publishTimings(createCiPlan(context()), portableResults)).toBe(true);
    expect(publishTimings(createCiPlan(context("release")), releaseResults)).toBe(true);
    expect(publishTimings(manual, { ...releaseResults, perf: { result: "skipped" }, smoke: { result: "skipped" } })).toBe(true);
    expect(publishTimings(createCiPlan(context()), { ...portableResults, privacy: { result: "failure" } })).toBe(false);
    expect(publishTimings(createCiPlan(context()), { ...portableResults, privacy: { result: "cancelled" } })).toBe(false);
    expect(() => publishTimings(createCiPlan(context()), { changes: { result: "bogus" } })).toThrow();
    for (const workflow of ["portable", "release"]) {
      const plan = createCiPlan(context(workflow, { filters: { ...filters, shared: "false" } }));
      const omitted = { ...releaseResults, ubuntu: { result: "skipped" }, macos: { result: "skipped" } };
      expect(() => verifyCiResults(plan, omitted)).not.toThrow();
      expect(publishTimings(plan, omitted)).toBe(false);
      expect(() => verifyCiResults(plan, { ...omitted, ubuntu: { result: "success" } })).toThrow();
      expect(publishTimings(plan, { ...omitted, ubuntu: { result: "failure" } })).toBe(false);
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
    for (const platform of ["macos"]) {
      for (const result of ["failure", "cancelled", "skipped"]) {
        expect(() => verifyUnitProof(plan, { ...releaseResults, [platform]: { result } })).toThrow();
      }
    }
    const empty = { ...plan, macos: { include: [] }, testJobs: plan.ubuntu.include.length };
    expect(() => verifyUnitProof(empty, { ...releaseResults, macos: { result: "skipped" } })).toThrow();
    const missing = { ...plan, macos: undefined };
    expect(() => verifyUnitProof(missing, releaseResults)).toThrow();
  });

  it("refuses malformed selectors, matrices and timing counts", () => {
    const plan = createCiPlan(context());
    for (const field of ["unit", "integration", "architecture", "fullRelease", "lint", "perf", "smoke"]) {
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
    expect(registeredTimingWorkflows([{ id: 1, path: ".github/workflows/staging.yml" }, { id: 3, path: ".github/workflows/other.yml" }])).toEqual([1]);
    expect(registeredTimingWorkflows([{ id: 1, path: ".github/workflows/staging.yml" }, { id: 2, path: ".github/workflows/production.yml" }])).toEqual([1, 2]);
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
    expect(() => registeredTimingWorkflows([{ path: ".github/workflows/staging.yml" }])).toThrow();
    expect(() => timingRunIds({ currentRunId: 9, runs: [{ id: 1, created_at: "invalid", conclusion: "success" }] })).toThrow();
    expect(() => timingRunIds({ currentRunId: 9, runs: [{ id: 1, created_at: "2026-11-03T00:00:00Z", conclusion: "failure" }] })).toThrow();
    expect(() => hasTimingArtifact([{ name: "ci-timings" }])).toThrow();
  });
});
