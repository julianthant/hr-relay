
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { z } from "zod";
import {
  DESCRIPTORS,
  INTAKE_PROJECTIONS,
  SERVER_REGISTRY,
  WORKFLOW_MODULES,
  WORKFLOW_IDS_BY_CODE,
  WORKFLOW_ROLES,
  auditImplBindings,
  readPendingImplBindings,
} from "../../../src/backend/app/registries/workflow-registry.js";
import {
  auditWorkflowCodes,
  auditWorkflowModuleBindings,
  auditWorkflowModuleRoles,
  intakeProjectionRegistry,
  workflowCodeRegistry,
  workflowRoleRegistry,
} from "../../../src/workflow-kit/validation/workflow-module-audit.js";
import { STEP_PROOF_MODULES } from "../../../src/backend/app/registries/step-proof-modules.js";
import { flow } from "../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor, workflowProjections } from "../../../src/workflow-kit/workflow.js";
import type { AnyWorkflowDescriptor } from "../../../src/workflow-kit/workflow.js";
import { CANONICAL_FIELDS } from "../../../src/models/fields/registry.js";
import {
  BrowserSystemIdSchema,
  FingerprintSchema,
  TaskIdSchema,
  TraceIdSchema,
} from "../../../src/rules/identity/ids.js";
import { defineIntakeProjection } from "../../../src/models/intake/projection.js";
import { BUILD_MANIFEST } from "../../../src/workflow-kit/validation/build-manifest.js";
import { BUILD_MANIFEST_PATH } from "../../../src/models/workflow/build-manifest.js";
import { defineCanonicalInput } from "../../../src/models/workflow/canonical-input.js";
import {
  ICON_NAMES,
  STANDARD_WORKFLOW_ACTIONS,
  WorkflowCodeSchema,
} from "../../../src/models/workflow/presentation.js";
import {
  WorkflowModuleRoleSchema,
  defineWorkflowRole,
} from "../../../src/workflow-kit/validation/module-role.js";
import {
  auditBuildManifestBytes,
  collectSourceClosure,
  computeBuildManifest,
  fingerprintSourceSet,
  renderBuildManifestModule,
} from "../../../scripts/build/workflow-build-manifest.js";
import { taskStoreRegistry } from "../../../src/backend/app/registries/task-registry.js";
import { FixtureReadReceipt, fixtureDescriptor } from "../../support/fixtures/descriptor-fixtures.js";
import {
  INTAKE_FIXTURE_WORKFLOW_ID,
  intakeFixtureDescriptor,
  intakeFixtureProjection,
} from "../../support/fixtures/intake-workflow-fixture.js";
import { REPO_ROOT } from "../support/helpers/guard-files.js";
import { workflowSourcePath } from "../../../src/workflow-kit/validation/source-layout.js";

const ALL: readonly AnyWorkflowDescriptor[] = [...DESCRIPTORS, fixtureDescriptor];

/** Roots a descriptor module may VALUE-import. Type-only imports are exempt (§1.4 #6). */

const BUNDLE_SAFE_ROOTS = ["src/models/", "src/rules/", "src/workflow-kit/", "src/workflows/"];

let currentBuildManifest: ReturnType<typeof computeBuildManifest> | undefined;

function computeCurrentBuildManifest(): ReturnType<typeof computeBuildManifest> {
  currentBuildManifest ??= computeBuildManifest(REPO_ROOT);
  return currentBuildManifest;
}

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

function bundleViolations(entry: string, root = REPO_ROOT): readonly string[] {
  const violations: string[] = [];
  for (const source of collectSourceClosure(root, join(root, entry))) {
    const isEntry = source.path === entry;
    const inBundleRoot = BUNDLE_SAFE_ROOTS.some((root) => source.path.startsWith(root));
    if (!isEntry && !inBundleRoot) {
      violations.push(`${entry}: reaches ${source.path}, which is outside the bundle-safe roots`);
    }
    for (const specifier of valueImportSpecifiers(
      source.path,
      readFileSync(join(root, source.path), "utf8"),
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


  it("declares one role per module, every chunk harness naming a registered composition", () => {
    const roleSpecimens = [...WORKFLOW_MODULES, ...STEP_PROOF_MODULES];
    assert.deepEqual(auditWorkflowModuleRoles(roleSpecimens), []);
    for (const module of roleSpecimens) {
      assert.ok(
        WorkflowModuleRoleSchema.safeParse(module.role).success,
        `${String(module.descriptor.id)} must declare a role the closed union admits`,
      );
    }
    // The registry's own frozen projection agrees with the tuple, both ways.
    assert.deepEqual(
      Object.keys(WORKFLOW_ROLES).sort(),
      WORKFLOW_MODULES.map((module) => String(module.descriptor.id)).sort(),
    );

    const harness = STEP_PROOF_MODULES[0];
    const composition = WORKFLOW_MODULES.find((module) => module.role.kind === "composition");
    if (harness === undefined || composition === undefined) {
      throw new Error("the role fixtures require one retained step proof and one composition");
    }

    // A dangling `of`: the composition is simply not in the tuple.
    const dangling = auditWorkflowModuleRoles(
      roleSpecimens.filter((module) => module !== composition),
    );
    assert.match(dangling.join("\n"), /which is not a registered workflow/);
    assert.match(dangling.join("\n"), new RegExp(String(harness.descriptor.id)));

    // An `of` that resolves to a workflow which is NOT a composition — the
    // harness-of-a-harness chain, and the standalone target, in one arm.
    const notAComposition = auditWorkflowModuleRoles(roleSpecimens.map((module) =>
      module === composition
        ? { descriptor: module.descriptor, role: defineWorkflowRole({ kind: "standalone" }) }
        : module));
    assert.match(notAComposition.join("\n"), /whose own role is standalone rather than composition/);

    // The load-time refusal is the SAME audit, so the throw and the guard can
    // never disagree about what a violation is.
    assert.throws(
      () => workflowRoleRegistry(roleSpecimens.filter((module) => module !== composition)),
      /which is not a registered workflow/,
    );
    assert.doesNotThrow(() => workflowRoleRegistry(roleSpecimens));
  });

  // A harness role names both its composition and the step that owns its address.
  it("refuses a chunk harness whose step its composition does not declare", () => {
    const roleSpecimens = [...WORKFLOW_MODULES, ...STEP_PROOF_MODULES];
    const harness = STEP_PROOF_MODULES[0];
    const composition = WORKFLOW_MODULES.find((module) => module.role.kind === "composition");
    if (harness === undefined || composition === undefined) {
      throw new Error("the role fixtures require one retained step proof and one composition");
    }
    const compositionId = String(composition.descriptor.id);
    const declaredKeys = composition.descriptor.timeline.map((category) => category.key);

    // The real tuple is clean, and every harness names a key its composition
    // actually declares.
    assert.deepEqual(auditWorkflowModuleRoles(roleSpecimens), []);
    for (const module of roleSpecimens) {
      if (module.role.kind !== "chunk-harness") continue;
      assert.ok(
        declaredKeys.includes(module.role.step),
        `${String(module.descriptor.id)} must name a step ${compositionId} declares`,
      );
    }

    // An unknown step: the violation names the workflow, the step, and what
    // the composition does declare.
    const unknownStep = auditWorkflowModuleRoles(roleSpecimens.map((module) =>
      module === harness
        ? {
          descriptor: module.descriptor,
          role: defineWorkflowRole({ kind: "chunk-harness", of: compositionId, step: "no-such-step" }),
        }
        : module));
    assert.match(unknownStep.join("\n"), new RegExp(String(harness.descriptor.id)));
    assert.match(unknownStep.join("\n"), /no-such-step/);
    assert.match(unknownStep.join("\n"), new RegExp(declaredKeys[0] ?? "unreachable"));


    const originalStandalone = WORKFLOW_MODULES.find((module) => module.role.kind === "standalone");
    const standalone = originalStandalone === undefined ? undefined : { ...originalStandalone, descriptor: { ...originalStandalone.descriptor, timelineDeclared: false } };
    if (standalone === undefined) throw new Error("the role fixtures require one standalone workflow");
    const derivedKey = standalone.descriptor.timeline[0]?.key;
    const standaloneNodeIds = standalone.descriptor.nodes.map((node) => String(node.id));
    assert.ok(
      derivedKey !== undefined && standaloneNodeIds.includes(derivedKey),
      "the no-timeline specimen's derived category keys ARE its node ids",
    );
    const noTimeline = auditWorkflowModuleRoles([
      { descriptor: standalone.descriptor, role: defineWorkflowRole({ kind: "composition" }) },
      {
        descriptor: harness.descriptor,
        role: defineWorkflowRole({
          kind: "chunk-harness",
          of: String(standalone.descriptor.id),
          step: derivedKey,
        }),
      },
    ]);
    assert.match(noTimeline.join("\n"), /declares no timeline steps; a harness cannot be a step of it/);

    // And the load-time refusal is the same audit.
    assert.throws(
      () => workflowRoleRegistry(roleSpecimens.map((module) =>
        module === harness
          ? {
            descriptor: module.descriptor,
            role: defineWorkflowRole({ kind: "chunk-harness", of: compositionId, step: "no-such-step" }),
          }
          : module)),
      /no-such-step/,
    );
  });


  it("declares one unique short code per workflow, and every code composes a legal trace id", () => {
    assert.deepEqual(auditWorkflowCodes(DESCRIPTORS), []);
    for (const descriptor of DESCRIPTORS) {
      assert.ok(
        WorkflowCodeSchema.safeParse(descriptor.code).success,
        `${String(descriptor.id)} declares code ${descriptor.code}, which is not two to four lowercase letters`,
      );
      // The second consumer, executed rather than described: a code the trace
      // schema would refuse is a code that cannot start a run.
      assert.ok(
        TraceIdSchema.safeParse(`${descriptor.code}-000619-4ebf`).success,
        `${String(descriptor.id)}'s code cannot compose a trace id`,
      );
    }
    assert.deepEqual(
      Object.values(WORKFLOW_IDS_BY_CODE).sort(),
      DESCRIPTORS.map((descriptor) => String(descriptor.id)).sort(),
    );

    // The negative arm runs the real audit against a colliding corpus, because
    // a check that only ever sees the passing registry cannot fail.
    const [first, second] = DESCRIPTORS;
    if (first === undefined || second === undefined) {
      throw new Error("the code fixtures require at least two registered workflows");
    }
    const collided = DESCRIPTORS.map((descriptor) =>
      descriptor === second ? { ...descriptor, code: first.code } : descriptor);
    const violations = auditWorkflowCodes(collided);
    assert.match(violations.join("\n"), /a short code names exactly one workflow/);
    assert.match(violations.join("\n"), new RegExp(String(second.id)));
    assert.throws(() => workflowCodeRegistry(collided), /a short code names exactly one workflow/);
    assert.doesNotThrow(() => workflowCodeRegistry(DESCRIPTORS));
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
    for (const module of WORKFLOW_MODULES) {

      const entry = workflowSourcePath(String(module.descriptor.id), module.role);
      assert.deepEqual(bundleViolations(entry), [], entry);
    }
    // The rule is only meaningful because the executable arm catches a breach.
    const breach = bundleViolations("src/backend/app/registries/workflow-registry.ts");
    assert.ok(breach.length > 0, "a module reaching outside the bundle-safe roots must be caught");
  });

  it("rejects a workflow value closure reaching backend runtime", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-backend-bundle-"));
    try {
      mkdirSync(join(root, "src/workflows/probe"), { recursive: true });
      mkdirSync(join(root, "src/backend/runtime"), { recursive: true });
      writeFileSync(join(root, "src/backend/runtime/engine.ts"), "export const engine = true;\n");
      writeFileSync(join(root, "src/workflows/probe/workflow.ts"), 'import { engine } from "../../backend/runtime/engine.js"; export const value = engine;\n');
      assert.match(
        bundleViolations("src/workflows/probe/workflow.ts", root).join("\n"),
        /reaches src\/backend\/runtime\/engine\.ts, which is outside the bundle-safe roots/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a workflow value closure reaching a browser-system task", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-system-bundle-"));
    try {
      mkdirSync(join(root, "src/workflows/probe"), { recursive: true });
      mkdirSync(join(root, "src/backend/systems/crm/tasks"), { recursive: true });
      writeFileSync(join(root, "src/backend/systems/crm/tasks/read.ts"), "export const read = true;\n");
      writeFileSync(join(root, "src/workflows/probe/workflow.ts"), 'import { read } from "../../backend/systems/crm/tasks/read.js"; export const value = read;\n');
      assert.match(
        bundleViolations("src/workflows/probe/workflow.ts", root).join("\n"),
        /reaches src\/backend\/systems\/crm\/tasks\/read\.ts, which is outside the bundle-safe roots/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the checked-in build manifest current", () => {
    const regenerated = computeCurrentBuildManifest();
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
    const manifest = computeCurrentBuildManifest();
    const onDisk = readFileSync(join(REPO_ROOT, BUILD_MANIFEST_PATH), "utf8");
    assert.deepEqual(auditBuildManifestBytes(onDisk, manifest), [], BUILD_MANIFEST_PATH);


    const reformatted = renderBuildManifestModule(manifest)
      .replace("export const GENERATED_BUILD_MANIFEST = {", "export const GENERATED_BUILD_MANIFEST =  {")
      .replace("/** Generated by npm run build:manifest; do not edit by hand. */", "/** Generated. */");
    assert.notEqual(reformatted, renderBuildManifestModule(manifest));
    assert.deepEqual(manifest, BUILD_MANIFEST, "the parsed arm cannot observe the reformatting");
    assert.match(auditBuildManifestBytes(reformatted, manifest).join("\n"), /is stale on disk/);

    // A truncated file is byte drift too — the failure must name the artifact
    // and the command, not just report inequality.
    assert.match(
      auditBuildManifestBytes("", manifest).join("\n"),
      /generated-build-manifest\.ts is stale on disk.*npm run build:manifest/su,
    );


    const pkg = z.object({ scripts: z.record(z.string(), z.string()) })
      .parse(JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")));
    assert.match(pkg.scripts["build:manifest:check"] ?? "", /generate-workflow-manifest\.ts --check/);
  });

  it("changes a browser-task fingerprint when its driver interpreter closure changes", () => {
    const regenerated = computeCurrentBuildManifest();
    const task = regenerated.tasks.find(({ id }) => id === "crm/read-onboarding-record");
    assert.ok(task, "CRM onboarding task has no implementation fingerprint");
    const driverPath = "src/backend/systems/crm/driver/interpreter.ts";
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

    const nowBound = auditImplBindings({
      ...bindings,
      tasks: [...bindings.tasks, {
        taskId: TaskIdSchema.parse("ucpath/search-person-org"),
        workflowId: "person-lookup",
        note: "fixture — a registered store implements this contract today",
      }],
    });
    assert.match(nowBound.join("\n"), /which a store now implements — delete the entry/);

    const module = WORKFLOW_MODULES[0];
    if (module === undefined) throw new Error("module fixture requires Person Lookup");
    const missing = auditWorkflowModuleBindings([{
      descriptor: module.descriptor,
      stores: module.stores.filter(({ namespace }) => namespace !== "crm"),
    }]);
    assert.match(missing.join("\n"), /missing store crm/);
    assert.match(missing.join("\n"), /cannot resolve its exact contract crm\/search-onboarding-records/);
    const extraStore = taskStoreRegistry.stores.find(({ namespace }) => namespace === "onbase");
    if (extraStore === undefined) throw new Error("module fixture requires OnBase store");
    const extra = auditWorkflowModuleBindings([{
      descriptor: module.descriptor,
      stores: [...module.stores, extraStore],
    }]);
    assert.match(extra.join("\n"), /lists extra store onbase/);
  });

  it("refuses an intake projection built over a COPY of the descriptor's input schema", () => {
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


  it("registers the production intake projections over the canonical registry's own fields", () => {
    const registered = Object.entries(INTAKE_PROJECTIONS);
    assert.equal(registered.length > 0, true, "no workflow declares an intake projection");
    for (const [workflowId, projection] of registered) {
      assert.equal(
        DESCRIPTORS.some((descriptor) => String(descriptor.id) === workflowId),
        true,
        `${workflowId} has an intake projection but no registered descriptor`,
      );
      assert.equal(projection.targets.length > 0, true, `${workflowId} declares an empty projection`);
      for (const target of projection.targets) {
        const field = CANONICAL_FIELDS[target.canonicalFieldId];
        assert.notEqual(field, undefined, `${workflowId}.${target.targetFieldId} names no canonical field`);
        assert.equal(
          field.label,
          target.label,
          `${workflowId}.${target.targetFieldId} labels itself differently from its canonical field`,
        );
      }
    }
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
    for (const source of collectSourceClosure(REPO_ROOT, join(REPO_ROOT, "src/workflows/person-lookup/workflow.ts"))) {
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
