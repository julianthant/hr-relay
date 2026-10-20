import { spreadsheetValueMatches } from "../../../src/dashboard/surfaces/spreadsheets/spreadsheet-fields-model.js";
import { REVIEWED_CATCH_DEFAULTS } from "./helpers/reviewed-catch-defaults.js";
import { createHash } from "node:crypto";
import { existsSync, globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import inventory from "../../../docs/rebuild/guard-inventory.json" with { type: "json" };
import vitestConfig, {
  REBUILD_ARCHITECTURE_TEST_INCLUDE,
  REBUILD_ARCHITECTURE_TEST_EXCLUDE,
  REBUILD_COVERAGE_EXCLUSIONS,
  REBUILD_COVERAGE_FLOORS,
  REBUILD_TEST_PROJECTS,
  REBUILD_TEST_REPORTERS,
  REBUILD_UNIT_TEST_EXCLUDE,
  REBUILD_UNIT_TEST_INCLUDE,
  REBUILD_INTEGRATION_TEST_INCLUDE,
  REBUILD_INTEGRATION_TEST_EXCLUDE,
  REBUILD_PERF_TEST_INCLUDE,
  REBUILD_PERF_TEST_EXCLUDE,
} from "../../../vitest.config.js";
import { REPO_ROOT, walkFiles } from "../support/helpers/guard-files.js";
import { projectOwnershipViolations } from "../../../scripts/test/project-policy.js";
import {
  auditFailLoudCatchDefaults,
  auditRebuildRatchetArm,
  rebuildRatchetFixture,
  REQUIRED_REBUILD_RATCHET_NAMES,
} from "./helpers/ratchet-arms.js";

const ARCHITECTURE_ROOT = join(REPO_ROOT, inventory.architectureRoot);
const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

interface CoverageExclusion {
  readonly pattern: string;
  readonly activation: {
    readonly ownerRoot: string;
    readonly status: "planned" | "active";
  };
  readonly reason: string;
}

export function discoverArchitectureTests(root: string): string[] {
  return walkFiles(root, { extensions: [".ts"] })
    .filter((file) => file.endsWith(".test.ts"))
    .map((file) => relative(REPO_ROOT, file).replaceAll("\\", "/"))
    .sort();
}

interface ArchitectureProjectInputs {
  readonly command: string;
  readonly unitInclude: readonly string[];
  readonly unitExclude: readonly string[];
  readonly integrationInclude: readonly string[];
  readonly integrationExclude: readonly string[];
  readonly architectureInclude: readonly string[];
  readonly architectureExclude: readonly string[];
  readonly perfInclude: readonly string[];
  readonly perfExclude: readonly string[];
  readonly reporters: readonly string[];
}

interface TestProjectDefinition {
  readonly name: string;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!isUnknownArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value;
}

function configuredTestProjects(config: unknown): readonly TestProjectDefinition[] {
  if (!isRecord(config) || !isRecord(config.test) || !isUnknownArray(config.test.projects)) {
    throw new Error("vitest config must expose a static projects array");
  }
  return config.test.projects.map((project, index) => {
    if (!isRecord(project) || !isRecord(project.test) || typeof project.test.name !== "string") {
      throw new Error(`vitest project ${String(index)} must declare name, include, and exclude`);
    }
    return {
      name: project.test.name,
      include: stringArray(project.test.include, `vitest project ${String(index)} include`),
      exclude: stringArray(project.test.exclude, `vitest project ${String(index)} exclude`),
    };
  });
}

function configuredTestReporters(config: unknown): readonly string[] {
  if (!isRecord(config) || !isRecord(config.test)) {
    throw new Error("vitest config must expose static test options");
  }
  return stringArray(config.test.reporters, "vitest config reporters");
}

export function architectureProjectViolations({
  command,
  unitInclude,
  unitExclude,
  integrationInclude,
  integrationExclude,
  architectureInclude,
  architectureExclude,
  perfInclude,
  perfExclude,
  reporters,
}: ArchitectureProjectInputs): string[] {
  const violations: string[] = [];
  const normalized = command.trim().replace(/\s+/g, " ");
  const exactCommand =
    "tsx scripts/test/runner.ts run --project architecture --passWithNoTests=false";
  if (normalized !== exactCommand) {
    violations.push(
      `test:architecture must select only the named architecture project; expected '${exactCommand}'`,
    );
  }
  if (JSON.stringify(unitInclude) !== JSON.stringify(["tests/**/*.test.ts"])) {
    violations.push("unit project include must remain tests/**/*.test.ts");
  }
  if (JSON.stringify(unitExclude) !== JSON.stringify(["tests/**/*.integration.test.ts", "tests/architecture/**", "tests/parity/**", "tests/perf/**"])) {
    violations.push("unit project must exclude integration suffixes, architecture, parity, and perf");
  }
  if (JSON.stringify(integrationInclude) !== JSON.stringify(["tests/**/*.integration.test.ts"])) {
    violations.push("integration project must include every recursive tests/**/*.integration.test.ts file");
  }
  if (JSON.stringify(integrationExclude) !== JSON.stringify(["tests/perf/**"])) {
    violations.push("integration project must exclude tests/perf/**");
  }
  if (
    JSON.stringify(architectureInclude) !==
      JSON.stringify(["tests/architecture/**/*.test.ts"])
  ) {
    violations.push(
      "architecture project must include every recursive tests/architecture/**/*.test.ts file",
    );
  }
  if (architectureExclude.length !== 0) {
    violations.push(
      `architecture project exclude must remain empty; received ${JSON.stringify(architectureExclude)}`,
    );
  }
  if (JSON.stringify(perfInclude) !== JSON.stringify(["tests/perf/**/*.test.ts"])) {
    violations.push("perf project must include every tests/perf/**/*.test.ts file");
  }
  if (perfExclude.length !== 0) violations.push("perf project exclude must remain empty");
  if (JSON.stringify(reporters) !== JSON.stringify(["verbose"])) {
    violations.push("every Vitest entry point must use the single verbose streaming reporter from config");
  }
  return violations;
}

export function testProjectTopologyViolations(
  root: string,
  definitions: readonly TestProjectDefinition[] = REBUILD_TEST_PROJECTS,
): string[] {
  const all = globSync(["tests/**/*.test.ts", "tests/**/*.test.tsx"], { cwd: root }).sort();
  const projects = definitions.map(({ name, include, exclude }) => {
    const excluded = new Set(globSync([...exclude], { cwd: root }));
    const collected = globSync([...include], { cwd: root }).filter((path) => !excluded.has(path));
    return { name, files: collected };
  });
  const parity = all.filter((path) => path.startsWith("tests/parity/"));
  const runtime = all.filter((path) => !path.startsWith("tests/parity/"));
  const violations = projectOwnershipViolations(runtime, projects.map((project) => ({
    ...project, files: project.files.filter((path) => !path.startsWith("tests/parity/")),
  })));
  for (const path of parity) {
    const owners = projects.filter(({ files }) => files.includes(path)).map(({ name }) => name);
    if (owners.length > 0) violations.push(`${path}: expected no Vitest projects, found ${owners.join(", ")}`);
  }
  return violations;
}

export function coverageExclusionActivationViolations(
  exclusions: readonly CoverageExclusion[],
  root: string,
): string[] {
  const violations: string[] = [];
  const owners = exclusions.map(({ activation }) => activation.ownerRoot);
  if (new Set(owners).size !== owners.length) violations.push("coverage exclusions must have independent owner roots");
  for (const [index, owner] of owners.entries()) {
    for (const other of owners.slice(index + 1)) {
      if (owner.startsWith(`${other}/`) || other.startsWith(`${owner}/`)) {
        violations.push(`${owner} and ${other}: coverage owner roots overlap`);
      }
    }
  }

  for (const exclusion of exclusions) {
    const { ownerRoot, status } = exclusion.activation;
    if (!exclusion.reason.trim()) violations.push(`${exclusion.pattern}: exclusion needs a reason`);
    if (/[*?{}[\]]/.test(ownerRoot)) violations.push(`${exclusion.pattern}: ownerRoot must be an exact path, not a glob`);
    if (ownerRoot === exclusion.pattern) violations.push(`${exclusion.pattern}: ownerRoot cannot equal its exclusion pattern`);
    if (!exclusion.pattern.startsWith(`${ownerRoot}/`)) {
      violations.push(`${exclusion.pattern}: exclusion must be owned beneath ownerRoot ${ownerRoot}`);
    }
    const ownerExists = existsSync(join(root, ownerRoot));
    const matches = globSync(exclusion.pattern, { cwd: root });
    if (status === "planned") {
      if (ownerExists) violations.push(`${exclusion.pattern}: planned exclusion owner is already active`);
      if (matches.length > 0) violations.push(`${exclusion.pattern}: planned exclusion already matches files`);
    } else {
      if (!ownerExists) violations.push(`${exclusion.pattern}: active exclusion owner is missing`);
      if (matches.length === 0) violations.push(`${exclusion.pattern}: active coverage exclusion is stale`);
    }
  }
  return violations;
}

function writeFixture(root: string, path: string, content: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

describe("reviewed architecture guard manifest", () => {

  it("recursively registers every guard file exactly once and every active entry exists", () => {
    const active = inventory.guards.filter(({ status }) => status === "active");
    const names = active.map(({ name }) => name);
    assert.equal(new Set(names).size, names.length, "active guard names must be unique");

    const registered = active.map(({ file }) => file).sort();
    assert.deepEqual(
      registered,
      discoverArchitectureTests(ARCHITECTURE_ROOT),
      "recursive guard file discovery and inventory must match exactly",
    );
    for (const entry of active) {
      assert.ok(entry.invariant.trim(), `${entry.name} must state its invariant`);
      assert.ok(entry.owner.trim(), `${entry.name} must name its owner`);
      assert.equal(entry.replacementRequired, true, `${entry.name} must require a replacement decision on removal`);
      assert.ok(existsSync(join(REPO_ROOT, entry.file)), entry.file);
    }
  });

  it("keeps four exact projects with complete architecture and single test ownership", () => {
    const actual = {
      command: packageJson.scripts[inventory.testScript] ?? "",
      unitInclude: REBUILD_UNIT_TEST_INCLUDE,
      unitExclude: REBUILD_UNIT_TEST_EXCLUDE,
      integrationInclude: REBUILD_INTEGRATION_TEST_INCLUDE,
      integrationExclude: REBUILD_INTEGRATION_TEST_EXCLUDE,
      architectureInclude: REBUILD_ARCHITECTURE_TEST_INCLUDE,
      architectureExclude: REBUILD_ARCHITECTURE_TEST_EXCLUDE,
      perfInclude: REBUILD_PERF_TEST_INCLUDE,
      perfExclude: REBUILD_PERF_TEST_EXCLUDE,
      reporters: REBUILD_TEST_REPORTERS,
    };
    assert.deepEqual(architectureProjectViolations(actual), []);
    assert.deepEqual(REBUILD_TEST_PROJECTS.map(({ name }) => name), ["unit", "integration", "architecture", "perf"]);
    assert.deepEqual(configuredTestProjects(vitestConfig), REBUILD_TEST_PROJECTS);
    assert.deepEqual(configuredTestReporters(vitestConfig), REBUILD_TEST_REPORTERS);
    assert.deepEqual(testProjectTopologyViolations(REPO_ROOT), []);

    for (const bypass of [
      { ...actual, command: "vitest run tests/architecture --reporter=dot" },
      { ...actual, command: "vitest run --project unit --reporter=dot" },
      { ...actual, command: "vitest run --project architecture guard-manifest.test.ts --reporter=dot" },
      { ...actual, command: "vitest run --project architecture --exclude runtime-isolation.test.ts --reporter=dot" },
      { ...actual, command: "vitest run --project architecture --config narrow.config.ts --reporter=dot" },
      { ...actual, unitExclude: ["tests/unit/fake.test.ts"] },
      { ...actual, integrationInclude: [] },
      { ...actual, integrationExclude: ["tests/integration/**"] },
      { ...actual, unitExclude: ["tests/architecture/tooling/guard-manifest.test.ts"] },
      { ...actual, integrationExclude: [] },
      { ...actual, architectureInclude: ["tests/architecture/tooling/guard-manifest.test.ts"] },
      { ...actual, architectureInclude: ["tests/architecture/*.test.ts"] },
      { ...actual, architectureExclude: ["tests/architecture/runtime-isolation.test.ts"] },
      { ...actual, perfInclude: ["tests/perf/**/*.integration.test.ts"] },
      { ...actual, perfExclude: ["tests/perf/**"] },
      { ...actual, reporters: ["dot"] },
    ]) {
      assert.ok(architectureProjectViolations(bypass).length > 0, JSON.stringify(bypass));
    }

    const root = join(tmpdir(), `hrauto-test-topology-${process.pid}-${Date.now()}`);
    try {
      writeFixture(root, "tests/models/owned.test.ts", "export {};\n");
      writeFixture(root, "tests/architecture/guard.test.ts", "export {};\n");
      writeFixture(root, "tests/models/real.integration.test.ts", "export {};\n");
      writeFixture(root, "tests/perf/shape.integration.test.ts", "export {};\n");
      writeFixture(root, "tests/parity/scene.test.ts", "export {};\n");
      assert.deepEqual(testProjectTopologyViolations(root), []);
      const missingPerf = REBUILD_TEST_PROJECTS.filter(({ name }) => name !== "perf");
      assert.match(testProjectTopologyViolations(root, missingPerf).join("\n"),
        /tests\/perf\/shape\.integration\.test\.ts: expected exactly one Vitest project, found none/u);
      const integrationPerfLeak = REBUILD_TEST_PROJECTS.map((project) => project.name === "integration"
        ? { ...project, exclude: [] }
        : project);
      assert.match(testProjectTopologyViolations(root, integrationPerfLeak).join("\n"),
        /tests\/perf\/shape\.integration\.test\.ts: expected exactly one Vitest project, found integration, perf/u);
      const parityLeak = REBUILD_TEST_PROJECTS.map((project) => project.name === "unit"
        ? { ...project, exclude: project.exclude.filter((pattern) => pattern !== "tests/parity/**") }
        : project);
      assert.deepEqual(testProjectTopologyViolations(root, parityLeak), [
        "tests/parity/scene.test.ts: expected no Vitest projects, found unit",
      ]);
      writeFixture(root, "tests/support/helpers/helper.test.ts", "export {};\n");
      writeFixture(root, "tests/types/input.integration.test.ts", "export {};\n");
      assert.deepEqual(testProjectTopologyViolations(root), []);
      const narrowed = REBUILD_TEST_PROJECTS.map((project) => project.name === "unit"
        ? { ...project, include: ["tests/models/**/*.test.ts", "tests/support/**/*.test.ts"] }
        : project);
      writeFixture(root, "tests/scenario/walk.test.ts", "export {};\n");
      assert.match(testProjectTopologyViolations(root, narrowed).join("\n"),
        /walk\.test\.ts: expected exactly one Vitest project, found none/u);
      writeFixture(root, "tests/unknown/orphan.test.ts", "export {};\n");
      assert.match(testProjectTopologyViolations(root, narrowed).join("\n"), /orphan\.test\.ts: expected exactly one Vitest project, found none/u);
      writeFixture(root, "tests/scenario/combined/live.combined.test.ts", "export {};\n");
      assert.match(
        testProjectTopologyViolations(root, narrowed).join("\n"),
        /live\.combined\.test\.ts: expected exactly one Vitest project, found none/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("pins independently activated coverage exclusions and ratified floors", () => {
    const digest = createHash("sha256")
      .update(JSON.stringify(REBUILD_COVERAGE_EXCLUSIONS))
      .digest("hex");
    assert.equal(digest, inventory.coveragePolicy.exclusionListSha256);
    const patterns = REBUILD_COVERAGE_EXCLUSIONS.map(({ pattern }) => pattern);
    assert.equal(new Set(patterns).size, patterns.length, "coverage exclusions must be unique");
    assert.deepEqual(coverageExclusionActivationViolations(REBUILD_COVERAGE_EXCLUSIONS, REPO_ROOT), []);

    const root = join(tmpdir(), `hrauto-coverage-policy-${process.pid}-${Date.now()}`);
    const planned: CoverageExclusion = {
      pattern: "owned/**/*.ts",
      activation: { ownerRoot: "owned", status: "planned" },
      reason: "fixture",
    };
    try {
      assert.deepEqual(coverageExclusionActivationViolations([planned], root), []);
      mkdirSync(join(root, "owned"), { recursive: true });
      assert.match(coverageExclusionActivationViolations([planned], root).join("\n"), /planned exclusion owner/);
      const active = { ...planned, activation: { ...planned.activation, status: "active" as const } };
      assert.match(coverageExclusionActivationViolations([active], root).join("\n"), /stale/);
      writeFixture(root, "owned/generated.ts", "export {};\n");
      assert.deepEqual(coverageExclusionActivationViolations([active], root), []);
      rmSync(join(root, "owned"), { recursive: true, force: true });
      assert.match(coverageExclusionActivationViolations([active], root).join("\n"), /owner is missing/);
      assert.match(
        coverageExclusionActivationViolations([{ ...planned, activation: { ownerRoot: planned.pattern, status: "planned" } }], root).join("\n"),
        /ownerRoot cannot equal/,
      );
      assert.match(
        coverageExclusionActivationViolations([
          planned,
          { ...planned, pattern: "owned/nested/**/*.ts", activation: { ownerRoot: "owned/nested", status: "planned" } },
        ], root).join("\n"),
        /owner roots overlap/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }

    assert.ok(REBUILD_COVERAGE_FLOORS.global.lines >= inventory.coveragePolicy.minimumFloors.global);
    assert.ok(REBUILD_COVERAGE_FLOORS.global.statements >= inventory.coveragePolicy.minimumFloors.global);
    assert.ok(REBUILD_COVERAGE_FLOORS.global.functions >= inventory.coveragePolicy.minimumFloors.global);
    assert.ok(REBUILD_COVERAGE_FLOORS.safetyCritical.lines >= inventory.coveragePolicy.minimumFloors.safetyCritical);
    assert.equal(REBUILD_COVERAGE_FLOORS.branches.phase1ReportOnly, true);
    assert.ok(REBUILD_COVERAGE_FLOORS.branches.phase2Global >= 50);
    assert.ok(REBUILD_COVERAGE_FLOORS.branches.phase2SafetyCritical >= 70);

    const movedCoreFiles = [
      "src/backend/runs/commands/command-application.ts",
      "src/backend/runs/commands/command-kernel.ts",
      "src/backend/runs/commands/command-refusal.ts",
      "src/backend/runs/start/dry-run-scenario-runner.ts",
      "src/backend/runs/provenance/evidence-receipt.ts",
      "src/backend/runs/lifecycle/failure-resolution.ts",
      "src/backend/processing/providers/provider-client.ts",
      "src/backend/runs/lifecycle/run-claim-admission.ts",
      "src/backend/runs/lifecycle/run-fan-out.ts",
      "src/backend/runs/lifecycle/run-record-service.ts",
      "src/backend/runs/lifecycle/run-result.ts",
      "src/backend/runs/settings/run-settings.ts",
      "src/backend/runs/projections/run-summary.ts",
      "src/backend/runs/provenance/task-provenance.ts",
      "src/backend/runs/lifecycle/terminal-authorization.ts",
      "src/backend/runs/provenance/test-data-usage.ts",
      "src/backend/runtime/checkpoints/checkpoint-patch.ts",
      "src/backend/runtime/scheduling/deadline-scheduler.ts",
      "src/backend/runtime/gates/duo-ceremony-gate.ts",
      "src/backend/runtime/gates/gate-source-runtime.ts",
      "src/backend/runtime/writes/operation-action-binding.ts",
      "src/backend/runtime/writes/receipt-derivation-binding.ts",
      "src/backend/runtime/gates/repeat-proof.ts",
      "src/backend/runtime/checkpoints/run-checkpoint-reader.ts",
      "src/backend/runtime/execution/run-executor.ts",
      "src/backend/runtime/execution/run-failure.ts",
      "src/backend/runtime/workers/worker-loop.ts",
      "src/backend/runtime/workers/worker-sessions.ts",
      "src/backend/runtime/writes/write-recovery.ts",
      "src/backend/runtime/writes/write-resolution-binding.ts",
      "src/backend/runtime/writes/write-sequencer.ts",
      "src/backend/runs/archive/archive-runtime-version-changes.ts",
      "src/backend/runs/lifecycle/archive-terminal-runs.ts",
      "src/backend/runs/archive/archive-version-changes.ts",
      "src/backend/storage/sqlite/run-lifecycle-storage.ts",
      "src/backend/storage/maintenance/storage-relocation-plans.ts",
    ];
    const thresholds = vitestConfig.test?.coverage?.thresholds as Record<string, unknown> | undefined;
    assert.ok(thresholds);
    const missingFloors = (candidate: Record<string, unknown>): string[] => movedCoreFiles.filter((path) =>
      candidate[path] !== REBUILD_COVERAGE_FLOORS.safetyCritical);
    assert.deepEqual(missingFloors(thresholds), []);
    assert.deepEqual(missingFloors({ ...thresholds, [movedCoreFiles[0] ?? ""]: undefined }), [movedCoreFiles[0]]);
  });

  it("executes every required rebuild ratchet arm and proves its violating fixture is caught", () => {
    assert.deepEqual(
      [...inventory.rebuildRatchetActivation.requiredGuardNames].sort(),
      [...REQUIRED_REBUILD_RATCHET_NAMES].sort(),
    );
    for (const name of REQUIRED_REBUILD_RATCHET_NAMES) {
      const actual = auditRebuildRatchetArm(name, REPO_ROOT);
      assert.deepEqual(actual.violations, [], `${name} found rebuild violations`);
      if (actual.state === "active") assert.ok(actual.files.length > 0, `${name} active scan is empty`);

      const root = join(tmpdir(), `hrauto-ratchet-${name}-${process.pid}-${Date.now()}`);
      try {
        const fixture = rebuildRatchetFixture(name);
        for (const [path, content] of Object.entries(fixture.files)) writeFixture(root, path, content);
        const result = auditRebuildRatchetArm(name, root);
        assert.equal(result.state, "active", `${name} fixture did not activate its scanner`);
        assert.ok(result.files.length > 0, `${name} fixture resolved no files`);
        assert.match(result.violations.join("\n"), fixture.expected, `${name} fixture bypassed its executable arm`);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("keeps reviewed spreadsheet validation failures distinct from missing field definitions", () => {
    assert.equal(spreadsheetValueMatches("personalEmail", "invalid@"), false);
    assert.equal(spreadsheetValueMatches("personalEmail", ""), true);
    assert.throws(() => spreadsheetValueMatches("unregistered-field", "value"), /SPREADSHEET_FIELD_NOT_FOUND/u);
  });

  it("pins reviewed catch behavior and rejects any changed source with the original scanner",()=>{
    const root=join(tmpdir(),`hrauto-reviewed-catches-${process.pid}-${Date.now()}`);
    try {
      for(const entry of REVIEWED_CATCH_DEFAULTS) {
        const source=readFileSync(join(REPO_ROOT,entry.path),"utf8");
        assert.equal(createHash("sha256").update(source).digest("hex"),entry.sha256);
        assert.ok(auditFailLoudCatchDefaults(entry.path,source).length>0);
        const target=join(root,entry.path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,source);
      }
      assert.deepEqual(auditRebuildRatchetArm("fail-loud-catch-default",root).violations,[]);
      for(const entry of REVIEWED_CATCH_DEFAULTS) {
        const target=join(root,entry.path),source=readFileSync(target,"utf8");
        writeFileSync(target,source+"\ntry { broken(); } catch { return []; }\n");
        const violations=auditRebuildRatchetArm("fail-loud-catch-default",root).violations;
        assert.ok(violations.some(value=>value.includes("catch returns a bare default")));
        assert.ok(violations.some(value=>value.includes("re-review required")));
        writeFileSync(target,source + "\n// source-byte control\n");
        const changedBytes = auditRebuildRatchetArm("fail-loud-catch-default",root).violations;
        assert.ok(changedBytes.some(value=>value.includes(entry.path) && value.includes("re-review required")));
        assert.ok(changedBytes.some(value=>value.includes(entry.path) && value.includes("bare default")));
        writeFileSync(target,source);
      }
    } finally {rmSync(root,{recursive:true,force:true});}
  });

  it("distinguishes erased type dependencies from runtime cycles without relaxing layering",()=>{
    const root=join(tmpdir(),`hrauto-runtime-cycles-${process.pid}-${Date.now()}`);
    const target=join(root,"src/domain");mkdirSync(target,{recursive:true});
    try {
      for(const declaration of ['import type {B} from "./b.js";', 'import {type B} from "./b.js";', 'export type {B} from "./b.js";', 'export {type B} from "./b.js";']) {
        writeFileSync(join(target,"a.ts"),declaration+' export const A=1;');
        writeFileSync(join(target,"b.ts"),'import {A} from "./a.js"; export const B=A;');
        assert.deepEqual(auditRebuildRatchetArm("import-cycles",root).violations,[]);
      }
      for(const declaration of ['import {B} from "./b.js";', 'import "./b.js";', 'export {B} from "./b.js";', 'export * from "./b.js";']) {
        writeFileSync(join(target,"a.ts"),declaration+' export const A=1;');
        assert.ok(auditRebuildRatchetArm("import-cycles",root).violations.length>0);
      }
    } finally {rmSync(root,{recursive:true,force:true});}
  });

  it("classifies backend responsibilities and refuses lower-to-higher imports",()=>{
    const root=join(tmpdir(),`hrauto-backend-layers-${process.pid}-${Date.now()}`);
    try {
      writeFixture(root,"src/backend/app/boot.ts","export const boot = true;\n");
      writeFixture(root,"src/backend/runtime/engine.ts","export const engine = true;\n");
      writeFixture(root,"src/backend/storage/repository.ts","export const repository = true;\n");
      writeFixture(root,"src/backend/workbooks/library.ts","export const library = true;\n");
      writeFixture(root,"src/backend/systems/browser-shared/adapter.ts","export const adapter = true;\n");
      writeFixture(root,"src/backend/app/worker/compose.ts","export const compose = true;\n");
      writeFixture(root,"src/base/pure.ts","export const pure = true;\n");
      writeFixture(root,"src/domain/value.ts","export const value = true;\n");
      writeFixture(root,"src/validation/pure.ts","export const pure = true;\n");
      assert.deepEqual(auditRebuildRatchetArm("control-layering",root).violations,[]);
      writeFixture(root,"src/backend/storage/repository.ts",'import { boot } from "../app/boot.js"; export const repository = boot;\n');
      writeFixture(root,"src/backend/systems/browser-shared/adapter.ts",'import { engine } from "../../runtime/engine.js"; export const adapter = engine;\n');
      writeFixture(root,"src/backend/runtime/engine.ts",'import type { compose } from "../app/worker/compose.js"; export type Engine = typeof compose;\n');
      writeFixture(root,"src/backend/workbooks/library.ts",'import { engine } from "../runtime/engine.js"; import { compose } from "../app/worker/compose.js"; export const library = [engine, compose];\n');
      writeFixture(root,"src/base/pure.ts",'import { boot } from "../backend/app/boot.js"; export const pure = boot;\n');
      writeFixture(root,"src/domain/value.ts",'import type { engine } from "../backend/runtime/engine.js"; export type Value = typeof engine;\n');
      writeFixture(root,"src/validation/pure.ts",'import type { engine } from "../backend/runtime/engine.js"; export type Pure = typeof engine;\n');
      writeFixture(root,"src/backend/accounts/account-service.ts",'import { boot } from "../app/boot.js"; import { engine } from "../runtime/engine.js"; export const service = { boot, engine };\n');
      writeFixture(root,"src/backend/misc/helper.ts","export const helper = true;\n");
      const issues=auditRebuildRatchetArm("control-layering",root).violations.join("\n");
      assert.match(issues,/backend\/storage\/repository\.ts: layer inversion imports backend\/app\/boot\.ts/u);
      assert.match(issues,/backend\/systems\/browser-shared\/adapter\.ts: layer inversion imports backend\/runtime\/engine\.ts/u);
      assert.match(issues,/backend\/runtime\/engine\.ts: layer inversion imports backend\/app\/worker\/compose\.ts/u);
      assert.match(issues,/backend\/workbooks\/library\.ts: layer inversion imports backend\/runtime\/engine\.ts/u);
      assert.match(issues,/backend\/workbooks\/library\.ts: layer inversion imports backend\/app\/worker\/compose\.ts/u);
      assert.match(issues,/base\/pure\.ts: layer inversion imports backend\/app\/boot\.ts/u);
      assert.match(issues,/domain\/value\.ts: layer inversion imports backend\/runtime\/engine\.ts/u);
      assert.match(issues,/validation\/pure\.ts: layer inversion imports backend\/runtime\/engine\.ts/u);
      assert.match(issues,/backend\/accounts\/account-service\.ts: layer inversion imports backend\/app\/boot\.ts/u);
      assert.match(issues,/backend\/accounts\/account-service\.ts: layer inversion imports backend\/runtime\/engine\.ts/u);
      assert.match(issues,/backend\/misc\/helper\.ts: unclassified backend responsibility/u);
    } finally {rmSync(root,{recursive:true,force:true});}
  });

  it("keeps fail-loud catch scanning semantic across multi-statement and nested handlers", () => {
    const violating = [
      "try { work(); } catch { log.warn('failed'); return []; }",
      "request().catch(() => { audit(); return {}; });",
      "try { work(); } catch { if (retryable) { recovered = false; } throw new Error('failed'); }",
      "request().catch(() => { if (missing) return 0; throw new Error('failed'); });",
      "try { work(); } catch { audit(); const fallback = null; return fallback; }",
    ];
    for (const [index, content] of violating.entries()) {
      assert.equal(auditFailLoudCatchDefaults(`fixture-${String(index)}.ts`, content).length > 0, true, content);
    }

    const allowed = [
      "try { work(); } catch (error) { log.warn('failed'); throw error; }",
      "request().catch((error) => { throw error; });",
      "try { work(); } catch (error) { return { state: 'unknown', reason: error.message }; }",
      "request().catch((error) => recoverKnownFailure(error));",
      "try { work(); } catch (error) { const nested = () => []; log.warn('return []; catch { result = false; }'); throw error; }",
      "const text = 'request.catch(() => { return []; })'; // catch { return {}; }",
    ];
    for (const [index, content] of allowed.entries()) {
      assert.deepEqual(auditFailLoudCatchDefaults(`allowed-${String(index)}.ts`, content), [], content);
    }
  });
});
