/**
 * Doc 02 §1.4 — THE coverage guard: one table-driven sweep over `DESCRIPTORS`.
 *
 * Its job is the half a descriptor cannot check about itself: cross-descriptor
 * uniqueness, the module tuple agreeing with the derived registry, the bundle
 * boundary that keeps a descriptor client-safe, the build manifest being
 * current, and the descriptor↔impl pairing that is legitimately incomplete in
 * 1e but must never be silently incomplete.
 *
 * The registered corpus is thin today — one workflow, four read steps — so
 * every rule that needs branch/gate/delegation/transaction shapes is also run
 * against `fixtureDescriptor`, and the negative arms construct violating
 * descriptors and require the factory to reject them. A guard that only swept a
 * four-step graph would pass by having nothing to look at.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { z } from "zod";
import {
  DESCRIPTORS,
  SERVER_REGISTRY,
  WORKFLOW_MODULES,
  auditImplBindings,
  auditWorkflowModuleBindings,
  intakeProjectionRegistry,
  readPendingImplBindings,
} from "../../../src/control/workflow-registry.js";
import { flow } from "../../../src/base/flow.js";
import { defineWorkflowDescriptor, workflowProjections } from "../../../src/base/workflow.js";
import type { AnyWorkflowDescriptor } from "../../../src/base/workflow.js";
import { CANONICAL_FIELDS } from "../../../src/domain/fields/registry.js";
import { BrowserSystemIdSchema, FingerprintSchema, TaskIdSchema } from "../../../src/domain/ids.js";
import { defineIntakeProjection } from "../../../src/domain/intake/projection.js";
import { BUILD_MANIFEST, BUILD_MANIFEST_PATH } from "../../../src/domain/workflow/build-manifest.js";
import { defineCanonicalInput } from "../../../src/domain/workflow/canonical-input.js";
import { ICON_NAMES, STANDARD_WORKFLOW_ACTIONS } from "../../../src/domain/workflow/presentation.js";
import {
  auditBuildManifestBytes,
  collectSourceClosure,
  computeBuildManifest,
  fingerprintSourceSet,
  renderBuildManifestModule,
} from "../../../src/infra/build/workflow-build-manifest.js";
import { taskStoreRegistry } from "../../../src/stores/index.js";
import { FixtureReadReceipt, fixtureDescriptor } from "./helpers/descriptor-fixtures.js";
import {
  INTAKE_FIXTURE_WORKFLOW_ID,
  intakeFixtureDescriptor,
  intakeFixtureProjection,
} from "../../fixtures/intake-workflow-fixture.js";
import { REPO_ROOT } from "./helpers/guard-files.js";

const ALL: readonly AnyWorkflowDescriptor[] = [...DESCRIPTORS, fixtureDescriptor];

/** Roots a descriptor module may VALUE-import. Type-only imports are exempt (§1.4 #6). */
const BUNDLE_SAFE_ROOTS = ["src/domain/", "src/base/", "src/validation/"];

function valueImportSpecifiers(path: string, content: string): readonly string[] {
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const specifiers: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      // `import type …` and `import { type X }` never reach the bundle.
      if (clause?.isTypeOnly !== true) specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined
      && ts.isStringLiteral(node.moduleSpecifier) && !node.isTypeOnly) {
      specifiers.push(node.moduleSpecifier.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return specifiers;
}

function bundleViolations(entry: string): readonly string[] {
  const violations: string[] = [];
  for (const source of collectSourceClosure(REPO_ROOT, join(REPO_ROOT, entry))) {
    const isEntry = source.path === entry;
    const inBundleRoot = BUNDLE_SAFE_ROOTS.some((root) => source.path.startsWith(root));
    if (!isEntry && !inBundleRoot) {
      violations.push(`${entry}: reaches ${source.path}, which is outside the bundle-safe roots`);
    }
    for (const specifier of valueImportSpecifiers(
      source.path,
      readFileSync(join(REPO_ROOT, source.path), "utf8"),
    )) {
      if (specifier.startsWith(".") || specifier === "zod") continue;
      violations.push(`${source.path}: value-imports "${specifier}" outside zod`);
    }
  }
  return violations;
}

describe("descriptor coverage", () => {
  it("keeps ids, codes, and icons unique and closed across every registered descriptor", () => {
    const ids = ALL.map(({ id }) => String(id));
    const codes = ALL.map(({ code }) => code);
    assert.equal(new Set(ids).size, ids.length, "workflow ids must be unique");
    assert.equal(new Set(codes).size, codes.length, "trace codes must be unique");
    for (const descriptor of ALL) {
      assert.match(descriptor.code, /^[a-z0-9]{2}$/, String(descriptor.id));
      assert.ok(ICON_NAMES.includes(descriptor.icon), String(descriptor.id));
      assert.ok(descriptor.version >= 1, String(descriptor.id));
      assert.match(descriptor.contractFingerprint, /^[0-9a-f]{64}$/, String(descriptor.id));
    }
  });

  it("derives every registry key from the one module tuple, in both directions", () => {
    const moduleIds = WORKFLOW_MODULES.map((module) => String(module.descriptor.id)).sort();
    const descriptorIds = DESCRIPTORS.map(({ id }) => String(id)).sort();
    assert.deepEqual(moduleIds, descriptorIds);
    assert.equal(new Set(moduleIds).size, moduleIds.length);
    assert.equal(WORKFLOW_MODULES.length, DESCRIPTORS.length);
    assert.deepEqual(Object.keys(SERVER_REGISTRY).sort(), descriptorIds);
  });

  it("resolves every contract's placement, example, freshness, and provenance", () => {
    for (const descriptor of ALL) {
      const { contracts, steps } = workflowProjections(descriptor);
      assert.ok(contracts.length > 0, String(descriptor.id));
      for (const contract of contracts) {
        assert.equal(contract.output.safeParse(contract.example).success, true, String(contract.id));
        if (contract.effect === "read") {
          assert.ok(contract.freshness.defaultMaxAgeMs >= 0, String(contract.id));
          assert.ok(["live", "derived"].includes(contract.provenance.default), String(contract.id));
        }
        if (contract.effect === "commit") {
          assert.ok(contract.writeSafety.idempotency.probe.effect === "read", String(contract.id));
        }
      }
      // Prepare and commit contracts appear ONLY as transaction arms.
      for (const step of steps) {
        if (step.kind === "prepare" || step.kind === "commit") {
          assert.ok(step.key.endsWith(`/${step.kind}`), step.key);
        }
      }
    }
  });

  it("derives the browser-system union from contract prefixes rather than a hand list", () => {
    for (const descriptor of ALL) {
      const { contracts, systems } = workflowProjections(descriptor);
      const expected = [...new Set(contracts
        .map((contract) => String(contract.id).slice(0, String(contract.id).indexOf("/")))
        .filter((prefix) => BrowserSystemIdSchema.safeParse(prefix).success))].sort();
      assert.deepEqual([...systems], expected, String(descriptor.id));
      // A `workflow:<id>` mini-store contributes no browser session.
      for (const system of systems) {
        assert.equal(BrowserSystemIdSchema.safeParse(system).success, true, system);
      }
    }
  });

  it("keeps node ids unique and every child-run target concretely typed", () => {
    for (const descriptor of ALL) {
      const ids = descriptor.nodes.map((node) => String(node.id));
      assert.equal(new Set(ids).size, ids.length, String(descriptor.id));
      for (const node of descriptor.nodes) {
        if (node.kind !== "child-run") continue;
        const target: unknown = Reflect.get(node, "target");
        assert.ok(target !== null && typeof target === "object", String(node.id));
        const input: unknown = Reflect.get(target, "input");
        const result: unknown = Reflect.get(target, "result");
        assert.ok(input instanceof z.ZodType, `${String(node.id)} target lost its input schema`);
        assert.ok(result instanceof z.ZodType, `${String(node.id)} target lost its result schema`);
      }
    }
  });

  it("keeps every descriptor module's value-import closure bundle-safe", () => {
    for (const descriptor of DESCRIPTORS) {
      const entry = `src/workflows/${String(descriptor.id)}/descriptor.ts`;
      assert.deepEqual(bundleViolations(entry), [], entry);
    }
    // The rule is only meaningful because the executable arm catches a breach.
    const breach = bundleViolations("src/control/workflow-registry.ts");
    assert.ok(breach.length > 0, "a module reaching outside the bundle-safe roots must be caught");
  });

  it("keeps the checked-in build manifest current", () => {
    const regenerated = computeBuildManifest(REPO_ROOT);
    assert.deepEqual(regenerated, BUILD_MANIFEST, "run `npm run build:manifest` and commit the result");
    for (const descriptor of DESCRIPTORS) {
      const entry = regenerated.workflows.find(({ id }) => id === descriptor.id);
      assert.ok(entry, `${String(descriptor.id)} has no manifest entry`);
      assert.equal(entry.fingerprint, descriptor.contractFingerprint);
      assert.ok(entry.sources.length > 1, "a fingerprint over one file is not a closure");
    }
    assert.deepEqual(
      regenerated.tasks.map(({ id }) => String(id)).sort(),
      taskStoreRegistry.stores
        .flatMap((store) => Object.values(store.tasks).map((task) => String(task.contract.id)))
        .sort(),
      "every bound task must have exactly one implementation fingerprint",
    );
  });

  it("fails on manifest BYTE drift the parsed comparison structurally cannot see", () => {
    const manifest = computeBuildManifest(REPO_ROOT);
    const onDisk = readFileSync(join(REPO_ROOT, BUILD_MANIFEST_PATH), "utf8");
    assert.deepEqual(auditBuildManifestBytes(onDisk, manifest), [], BUILD_MANIFEST_PATH);

    // Negative control. The arm above this one compares OBJECTS, so it is green
    // for every rendering of the same manifest — proven here by asserting it
    // against a manifest whose module text has been reformatted. Only the byte
    // arm separates "the checked-in file is what the generator writes" from
    // "the checked-in file happens to parse to the right thing".
    const reformatted = renderBuildManifestModule(manifest)
      .replace("export const GENERATED_BUILD_MANIFEST = {", "export const GENERATED_BUILD_MANIFEST =  {")
      .replace(" * GENERATED — run `npm run build:manifest`. Do not edit by hand.", " * GENERATED.");
    assert.notEqual(reformatted, renderBuildManifestModule(manifest));
    assert.deepEqual(manifest, BUILD_MANIFEST, "the parsed arm cannot observe the reformatting");
    assert.match(auditBuildManifestBytes(reformatted, manifest).join("\n"), /is stale on disk/);

    // A truncated file is byte drift too — the failure must name the artifact
    // and the command, not just report inequality.
    assert.match(
      auditBuildManifestBytes("", manifest).join("\n"),
      /generated-build-manifest\.ts is stale on disk.*npm run build:manifest/su,
    );

    // The same arm must stay reachable from the CLI. It shipped behind a
    // `--check` flag no npm script invoked, which is how the byte comparison
    // came to exist without ever running.
    const pkg = z.object({ scripts: z.record(z.string(), z.string()) })
      .parse(JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")));
    assert.match(pkg.scripts["build:manifest:check"] ?? "", /generate-build-manifest\.ts --check/);
  });

  it("changes a browser-task fingerprint when its driver interpreter closure changes", () => {
    const regenerated = computeBuildManifest(REPO_ROOT);
    const task = regenerated.tasks.find(({ id }) => id === "crm/read-onboarding-record");
    assert.ok(task, "CRM onboarding task has no implementation fingerprint");
    const driverPath = "src/stores/crm/driver/interpreter.ts";
    assert.ok(task.sources.some(({ path }) => path === driverPath));
    const mutatedSources = task.sources.map((source) => source.path === driverPath
      ? { ...source, sha256: FingerprintSchema.parse("0".repeat(64)) }
      : source);
    assert.notEqual(
      fingerprintSourceSet(regenerated.toolchain, task.id, mutatedSources),
      task.fingerprint,
    );
  });

  it("tracks every unbound contract explicitly, in both directions", () => {
    assert.deepEqual(auditImplBindings(readPendingImplBindings(REPO_ROOT)), []);
    const bindings = readPendingImplBindings(REPO_ROOT);
    assert.deepEqual(bindings.tasks, [], "1f binds every registered Phase-1 contract");
    // A pending entry no descriptor references is stale, and the audit says so.
    const stale = auditImplBindings({
      ...bindings,
      tasks: [...bindings.tasks, {
        taskId: TaskIdSchema.parse("kuali/read-requisition"),
        workflowId: "person-lookup",
        note: "fixture — no descriptor uses this contract",
      }],
    });
    assert.match(stale.join("\n"), /no registered descriptor uses/);

    const module = WORKFLOW_MODULES[0];
    if (module === undefined) throw new Error("module fixture requires Person Lookup");
    const missing = auditWorkflowModuleBindings([{
      descriptor: module.descriptor,
      stores: module.stores.filter(({ namespace }) => namespace !== "crm"),
    }]);
    assert.match(missing.join("\n"), /missing store crm/);
    assert.match(missing.join("\n"), /cannot resolve its exact contract crm\/read-onboarding-record/);
    const extraStore = taskStoreRegistry.stores.find(({ namespace }) => namespace === "onbase");
    if (extraStore === undefined) throw new Error("module fixture requires OnBase store");
    const extra = auditWorkflowModuleBindings([{
      descriptor: module.descriptor,
      stores: [...module.stores, extraStore],
    }]);
    assert.match(extra.join("\n"), /lists extra store onbase/);
  });

  it("refuses an intake projection built over a COPY of the descriptor's input schema (D171)", () => {
    // The real fixture reuses the one schema object, so it registers.
    assert.deepEqual(
      Object.keys(intakeProjectionRegistry([{
        descriptor: intakeFixtureDescriptor,
        intake: intakeFixtureProjection,
      }])),
      [INTAKE_FIXTURE_WORKFLOW_ID],
    );
    // A structurally identical copy is exactly the drift that would let intake
    // produce values the workflow itself never accepted.
    const copied = z.strictObject({
      emplId: CANONICAL_FIELDS.eid.schema,
      effectiveDate: CANONICAL_FIELDS.effectiveDate.schema,
    });
    assert.throws(
      () => intakeProjectionRegistry([{
        descriptor: intakeFixtureDescriptor,
        intake: defineIntakeProjection(copied, {
          emplId: CANONICAL_FIELDS.eid,
          effectiveDate: CANONICAL_FIELDS.effectiveDate,
        }),
      }]),
      /must reuse the descriptor's own schema/,
    );
  });

  it("rejects a descriptor whose detail path is not in the producing node's output", () => {
    const input = z.strictObject({ eid: z.string().min(1) });
    const canonical = defineCanonicalInput(input, z.strictObject({ eid: z.string().min(1) }), [{ eid: "1" }]);
    const built = flow(input)
      .step("probe", FixtureReadReceipt, {
        dependsOn: [],
        replay: "checkpoint",
        bind: () => ({ eid: "10800000" }),
      })
      .build({
        schema: z.strictObject({ present: z.boolean() }),
        dependsOn: ["probe"],
        derive: ({ outputs }) => ({ present: outputs.probe.present }),
      });
    const spec = {
      id: "detail-fixture",
      version: 1,
      contractFingerprint: FingerprintSchema.parse("e".repeat(64)),
      code: "df",
      label: "Detail Fixture",
      icon: "ShieldCheck" as const,
      category: "operations" as const,
      canonicalInput: canonical,
      inputSubject: "eid" as const,
      surface: { shape: "single" as const },
      enqueue: "reject-active" as const,
      actions: STANDARD_WORKFLOW_ACTIONS,
      surfaces: {},
      identity: { matchKey: (value: { eid: string }) => value.eid },
      presentation: { title: (value: { eid: string }) => value.eid },
      scenarios: ["detail-fixture/happy"] as const,
      flow: built,
    };
    assert.throws(() => defineWorkflowDescriptor({
      ...spec,
      details: [{
        key: "missing",
        label: "Missing",
        source: { nodeId: "probe", fieldPath: "notAField" },
        display: "text",
      }],
    }), /unknown schema field notAField/);
    assert.throws(() => defineWorkflowDescriptor({
      ...spec,
      details: [
        { key: "dup", label: "One", source: { nodeId: "probe", fieldPath: "present" }, display: "badge" },
        { key: "dup", label: "Two", source: { nodeId: "probe", fieldPath: "eid" }, display: "eid" },
      ],
    }), /detail keys must be unique/);
    assert.deepEqual(
      workflowProjections(defineWorkflowDescriptor({ ...spec, details: [] })).steps.map((step) => step.key),
      ["probe"],
    );
  });

  it("keeps completion program reveal out of every workflow module", () => {
    for (const source of collectSourceClosure(REPO_ROOT, join(REPO_ROOT, "src/workflows/person-lookup/module.ts"))) {
      if (!source.path.startsWith("src/workflows/")) continue;
      const content = readFileSync(join(REPO_ROOT, source.path), "utf8");
      assert.equal(
        content.includes("revealCompletionProgram"),
        false,
        `${source.path} must not unseal another workflow's completion program`,
      );
    }
  });
});
