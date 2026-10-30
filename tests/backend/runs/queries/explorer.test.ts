
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { z } from "zod";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { WORKFLOW_MODULES } from "../../../../src/backend/app/registries/workflow-registry.js";
import {
EXPLORER_SOURCE_ROOT,
buildWorkflowExplorer,
readScenarioSources,
type ExplorerModuleView,
} from "../../../../src/backend/runs/queries/explorer.js";
import {
  ExplorerWorkflowWireSchema,
  WorkflowExplorerWireSchema,
  type ExplorerProvenanceWire,
} from "../../../../src/models/dashboard/explorer.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import {
DelegationEdgeIdSchema,
FingerprintSchema,
ItemIdSchema,
WorkflowIdSchema,
} from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { workflowSourcePath } from "../../../../src/workflow-kit/validation/source-layout.js";
import {
compileWorkflow,
composeWorkflowModule,
} from "../../../../src/workflow-kit/workflow-definition.js";
import { defineWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { separationsKualiReadWorkflow } from "../../../../src/workflows/separations/steps/kuali-extraction/step.js";
import { explorerQueryDeps } from "../../../support/fixtures/explorer-seams.js";

const CLOCK = manualClock(new Date("2026-08-09T12:00:00.000Z"));
const HASH = FingerprintSchema.parse("c".repeat(64));

/** Every task arm of every registered workflow, flattened. */
function allTasks() {
  return buildWorkflowExplorer(
    explorerQueryDeps(CLOCK, HASH),
  ).workflows.flatMap((workflow) =>
    workflow.nodes.flatMap((node) => node.tasks),
  );
}

/** The registered separations entry, read through the Explorer's real registry. */
function separationsExplorerEntry() {
  const entry = buildWorkflowExplorer(
    explorerQueryDeps(CLOCK, HASH),
  ).workflows.find((workflow) => String(workflow.id) === "separations");
  assert.ok(entry, "the Explorer serves no separations workflow");
  return entry;
}

describe("compiled Explorer declaration binding", () => {
  it("refuses a different definition beside the descriptor and names a descriptor without one", () => {
    const deps = explorerQueryDeps(CLOCK, HASH);
    const first = deps.modules[0];
    const second = deps.modules[1];
    assert.ok(first?.definition && second?.definition);
    assert.throws(() => buildWorkflowExplorer({ ...deps, modules: [{ ...first, definition: second.definition }, ...deps.modules.slice(1)] }),
      /Explorer definition is not the descriptor's compiled source/u);
    const unavailable = buildWorkflowExplorer({ ...deps, modules: [{ ...first, definition: undefined }, ...deps.modules.slice(1)] });
    assert.deepEqual(unavailable.workflows[0]?.definitionPreview,
      { state: "unavailable", reason: "this registered descriptor has no compiled ordered definition" });
  });
});

function syntheticDelegationExplorerWire() {
  const input = z.strictObject({
    route: z.enum(["single", "batch", "background"]),
  });
  const canonicalInput = defineCanonicalInput(input, input, [
    { route: "single" },
  ]);
  const childInput = z.strictObject({
    key: z.enum(["single", "batch-a", "batch-b", "background"]),
  });
  const childResult = z.strictObject({ complete: z.boolean() });
  const child = {
    id: WorkflowIdSchema.parse("unregistered-child"),
    input: childInput,
    result: childResult,
  };
  const childItemIds = {
    single: "00000000-0000-4000-8000-000000000001",
    "batch-a": "00000000-0000-4000-8000-000000000002",
    "batch-b": "00000000-0000-4000-8000-000000000003",
    background: "00000000-0000-4000-8000-000000000004",
  } as const;
  const childItemId = (value: z.output<typeof childInput>) =>
    ItemIdSchema.parse(childItemIds[value.key]);
  const graph = flow(input)
    .branch("select-child", {
      dependsOn: [],
      choose: ({ input: value }) => value.route,
      cases: {
        single: ["call-single"],
        batch: ["call-batch"],
        background: ["call-background"],
      },
    })
    .childRun("call-single", child, {
      label: "Single awaited child",
      dependsOn: ["select-child"],
      edgeId: DelegationEdgeIdSchema.parse("single-child-call"),
      cardinality: "one",
      bind: () => ({ key: "single" }),
      deriveChildItemId: childItemId,
      await: "terminal",
      join: "one",
      policy: {
        onChildFailed: "fail-parent",
        cascadeCancel: "cascade",
        afterChildRetry: "resume-parent",
        visibility: "inline",
      },
    })
    .childRun("call-batch", child, {
      label: "Settled child batch",
      dependsOn: ["select-child"],
      edgeId: DelegationEdgeIdSchema.parse("batch-child-call"),
      cardinality: "many",
      bind: () => [{ key: "batch-a" }, { key: "batch-b" }],
      deriveChildItemId: childItemId,
      await: "terminal",
      join: "all-settled",
      policy: {
        onChildFailed: "allow-partial",
        cascadeCancel: "independent",
        afterChildRetry: "manual-parent-resume",
        visibility: "linked",
      },
    })
    .childRun("call-background", child, {
      label: "Background child",
      dependsOn: ["select-child"],
      edgeId: DelegationEdgeIdSchema.parse("background-child-call"),
      cardinality: "one",
      bind: () => ({ key: "background" }),
      deriveChildItemId: childItemId,
      await: "none",
      join: "none",
      policy: {
        onChildFailed: "block-parent",
        cascadeCancel: "cascade",
        afterChildRetry: "manual-parent-resume",
        visibility: "hidden-unless-failed",
      },
    })
    .gate("completion", {
      dependsOn: ["call-single", "call-batch", "call-background"],
      label: "Completion",
      resolvedBy: "operator",
      result: z.strictObject({ complete: z.boolean() }),
    })
    .build({
      schema: z.strictObject({ complete: z.literal(true) }),
      dependsOn: ["completion"],
      derive: () => ({ complete: true as const }),
    });
  const descriptor = defineWorkflowDescriptor({
    id: "explorer-delegation-fixture",
    version: 1,
    contractFingerprint: FingerprintSchema.parse("d".repeat(64)),
    code: "edf",
    label: "Explorer Delegation Fixture",
    summary: "A typed graph fixture for Explorer metadata projection.",
    icon: "Search",
    category: "operations",
    canonicalInput,
    inputSubject: "none",
    surface: { shape: "single" },
    enqueue: "reject-active",
    actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {},
    details: [],
    timeline: [
      { key: "selection", label: "Selection", nodes: ["select-child"] },
      {
        key: "delegations",
        label: "Delegations",
        nodes: ["call-single", "call-batch", "call-background"],
      },
      { key: "completion", label: "Completion", nodes: ["completion"] },
    ],
    nodePurposes: [
      {
        nodeId: "select-child",
        purpose: "Selects one declared child call site.",
      },
      { nodeId: "call-single", purpose: "Waits for one child workflow." },
      { nodeId: "call-batch", purpose: "Joins all child outcomes." },
      {
        nodeId: "call-background",
        purpose: "Enqueues a child without awaiting it.",
      },
      {
        nodeId: "completion",
        purpose: "Waits for the selected child call site to settle.",
      },
    ],
    identity: { matchKey: ({ route }) => `route:${route}` },
    presentation: { title: ({ route }) => `Route ${route}` },
    scenarios: ["explorer-delegation-fixture/happy"],
    flow: graph,
  });
  const role = defineWorkflowRole({ kind: "standalone" });
  const module: ExplorerModuleView = { descriptor, stores: [], role };
  const deps = explorerQueryDeps(CLOCK, HASH);
  return buildWorkflowExplorer({
    ...deps,
    modules: [module],
    buildManifest: {
      workflows: [
        {
          id: String(descriptor.id),
          sources: [{ path: workflowSourcePath(String(descriptor.id), role) }],
        },
      ],
      tasks: [],
    },
  });
}

describe("the contract field census", () => {
  it("gives every arm a field for every leaf of both its schemas", () => {
    for (const task of allTasks()) {
      assert.ok(
        task.fields.length > 0,
        `${String(task.taskId)} serves no field census`,
      );
      assert.ok(task.fields.some((field) => field.side === "input"));
      assert.ok(task.fields.some((field) => field.side === "output"));
    }
  });

  it("never records an INPUT leaf as an observation — the graph binds it", () => {
    for (const task of allTasks()) {
      for (const field of task.fields.filter((one) => one.side === "input")) {
        assert.equal(
          field.recorded.state,
          "bound",
          `${String(task.taskId)} input ${String(field.path)} claims to be observed`,
        );
      }
    }
  });

  it("resolves a read output's provenance by the LONGEST declared prefix, as the kernel does", () => {
    const search = allTasks().find(
      (task) => String(task.taskId) === "ucpath/search-person-org",
    );
    assert.ok(search !== undefined);
    assert.ok(search.provenance !== undefined);
    for (const field of search.fields.filter((one) => one.side === "output")) {
      assert.equal(field.recorded.state, "observed");
      if (field.recorded.state !== "observed") continue;
      const rules: readonly ExplorerProvenanceWire["byField"][number][] =
        search.provenance.byField;
      const matching = rules
        .filter(
          (entry) =>
            String(field.path) === String(entry.path) ||
            String(field.path).startsWith(`${String(entry.path)}.`),
        )
        .toSorted(
          (left, right) => String(right.path).length - String(left.path).length,
        )[0];
      assert.equal(
        field.recorded.source,
        matching?.source ?? search.provenance.default,
      );
    }
  });

  it("states what holds a WRITE arm's fields rather than calling them observations", () => {
    const prepare = allTasks().find((task) => task.effect === "prepare");
    const commit = allTasks().find((task) => task.effect === "commit");
    assert.ok(prepare !== undefined && commit !== undefined);
    for (const field of prepare.fields.filter((one) => one.side === "output")) {

      assert.equal(field.recorded.state, "not-recorded");
    }
    for (const field of commit.fields.filter((one) => one.side === "output")) {
      assert.equal(field.recorded.state, "checkpointed");
    }
  });

  it("serves a field census whose paths every policy rule can name", () => {
    for (const task of allTasks()) {
      const outputs = new Set(
        task.fields
          .filter((field) => field.side === "output")
          .map((field) => String(field.path)),
      );
      for (const rule of task.provenance?.byField ?? []) {
        assert.ok(
          outputs.has(String(rule.path)) ||
            [...outputs].some((path) =>
              path.startsWith(`${String(rule.path)}.`),
            ),
          `${String(task.taskId)} provenance rule ${String(rule.path)} names no censused field`,
        );
      }
      for (const rule of task.freshness?.byField ?? []) {
        assert.ok(
          outputs.has(String(rule.path)) ||
            [...outputs].some((path) =>
              path.startsWith(`${String(rule.path)}.`),
            ),
          `${String(task.taskId)} freshness rule ${String(rule.path)} names no censused field`,
        );
      }
    }
  });
});

describe("the workflow explorer projection", () => {
  it("serves descriptor presentation without editor authority", () => {
    const deps = explorerQueryDeps(CLOCK, HASH);
    const wire = buildWorkflowExplorer(deps);
    for (const entry of wire.workflows) {
      const descriptor = deps.modules.find(module => module.descriptor.id === entry.id)?.descriptor;
      assert.ok(descriptor);
      assert.equal(entry.label, descriptor.label);
      assert.equal(entry.icon, descriptor.icon);
      assert.equal(entry.category, descriptor.category);
      assert.equal("edit" in entry, false);
    }
  });

  it("links workflow mini-store implementations to their backend workflow-task homes", () => {
    const expected = [
      [
        "workflow:person-lookup/read-active-status",
        "person-lookup/tasks/read-active-status",
      ],
      ...[
        "match-active-employment",
        "match-department-option",
        "match-identity",
        "match-separation-subject",
        "match-termination-type",
        "read-separation-dates",
        "read-separation-plan",
        "verify-identity-approval",
        "verify-termination-receipt",
      ].map((task) => [
        `workflow:separations/${task}`,
        `separations/tasks/${task}`,
      ]),
    ] as const;
    const tasks = allTasks();
    for (const [taskId, path] of expected) {
      const task = tasks.find(
        ({ taskId: candidate }) => String(candidate) === taskId,
      );
      assert.ok(task, `Explorer has no ${taskId} task`);
      assert.deepEqual(task.implSource, {
        state: "resolved",
        path: `src/workflows/${path}.ts`,
      });
    }
  });

  it("serves startup session needs from each bound task implementation", () => {
    for (const projected of allTasks()) {
      if (projected.binding.state !== "bound") continue;
      const task = taskStoreRegistry.stores
        .flatMap((store) => Object.values(store.tasks))
        .find((candidate) => candidate.contract.id === projected.taskId);
      assert.ok(task);
      assert.deepEqual(projected.binding.sessions, task.impl.sessions);
    }
  });
  it("parses through its own wire schema over the real registry", () => {
    const wire = buildWorkflowExplorer(explorerQueryDeps(CLOCK, HASH));
    // `buildWorkflowExplorer` already parses on the way out; re-parsing proves
    // the returned value is the wire, not a structurally similar object.
    assert.doesNotThrow(() => WorkflowExplorerWireSchema.parse(wire));
    assert.equal(wire.descriptorHash, HASH);
    assert.equal(wire.generatedAt, "2026-08-09T12:00:00.000Z");
  });

  it("is a pure function of registration state — two builds agree byte for byte", () => {
    const first = buildWorkflowExplorer(explorerQueryDeps(CLOCK, HASH));
    const second = buildWorkflowExplorer(explorerQueryDeps(CLOCK, HASH));
    assert.equal(JSON.stringify(first), JSON.stringify(second));
  });

  it("serves separations' typed-text declaration, including dry-run support", () => {
    const entry = separationsExplorerEntry();

    assert.equal(entry.surfaces.inputRun.state, "declared");
    if (entry.surfaces.inputRun.state !== "declared") return;
    assert.match(
      entry.surfaces.inputRun.placeholder,
      /Kuali document numbers/u,
    );
    assert.equal(entry.surfaces.inputRun.supportsDryRun, true);
  });

  it("serves separations' four declared verdicts with their exact tones", () => {
    const entry = separationsExplorerEntry();

    assert.deepEqual(
      entry.verdicts.map(({ key, label, tone }) => ({ key, label, tone })),
      [
        {
          key: "name-differs",
          label: "Name differs from UCPath",
          tone: "warning",
        },
        {
          key: "eid-name-resolved",
          label: "EID resolved by name",
          tone: "warning",
        },
        {
          key: "dates-moved",
          label: "Kronos moved the dates",
          tone: "neutral",
        },
        {
          key: "unclassified-pay-codes",
          label: "Unclassified pay codes",
          tone: "warning",
        },
      ],
    );
  });

  it("serves an authored purpose for every separations graph node", () => {
    const entry = separationsExplorerEntry();

    const unauthored = entry.nodes.filter(
      (node) => node.purpose.state !== "authored",
    );
    assert.deepEqual(
      unauthored.map(({ id }) => id),
      [],
    );
    const resolveAction = entry.nodes.find(
      (node) => node.id === "resolve-action",
    );
    assert.ok(resolveAction, "the ingress head node is missing from the Explorer");
    assert.equal(resolveAction.purpose.state, "authored");
    if (resolveAction.purpose.state !== "authored") return;
    assert.match(
      resolveAction.purpose.text,
      /refuses two actions for one number/u,
    );
  });


  it("serves each module's declared role and refuses a harness with no composition beside it", () => {
    const wire = buildWorkflowExplorer(explorerQueryDeps(CLOCK, HASH));
    const roles = new Map(
      wire.workflows.map((workflow) => [String(workflow.id), workflow.role]),
    );
    assert.deepEqual(
      wire.workflows.map((workflow) => String(workflow.id)),
      WORKFLOW_MODULES.map((module) => String(module.descriptor.id)),
    );
    assert.deepEqual(roles.get("separations"), { kind: "composition" });
    assert.equal(roles.has("separations-kuali-read"), false);
    assert.deepEqual(roles.get("person-lookup"), { kind: "composition" });
    assert.deepEqual(
      wire.workflows.flatMap((workflow) =>
        workflow.nodes
          .filter(
            ({ shape }) =>
              shape.kind === "branch" || shape.kind === "child-run",
          )
          .map(({ id }) => `${String(workflow.id)}:${String(id)}`),
      ),
      [],
    );
    for (const module of WORKFLOW_MODULES) {
      const projected = wire.workflows.find(
        ({ id }) => id === module.descriptor.id,
      );
      assert.ok(
        projected,
        `the Explorer omits registered workflow ${String(module.descriptor.id)}`,
      );
      assert.deepEqual(
        projected.nodes.map(({ id, shape }) => [String(id), shape.kind]),
        module.descriptor.nodes.map(({ id, kind }) => [String(id), kind]),
      );
      assert.deepEqual(
        projected.timeline.map(({ key, label, nodes }) => ({
          key,
          label,
          nodes: nodes.map(String),
        })),
        module.descriptor.timeline.map(({ key, label, nodes }) => ({
          key,
          label,
          nodes: nodes.map(({ id }) => String(id)),
        })),
      );
    }

    const harness = composeWorkflowModule(
      compileWorkflow(separationsKualiReadWorkflow),
      taskStoreRegistry.stores,
    );
    const withHarness = buildWorkflowExplorer({
      ...explorerQueryDeps(CLOCK, HASH),
      modules: [...WORKFLOW_MODULES, harness],
    });
    const harnessRoles = new Map(
      withHarness.workflows.map((workflow) => [
        String(workflow.id),
        workflow.role,
      ]),
    );
    assert.deepEqual(harnessRoles.get("separations-kuali-read"), {
      kind: "chunk-harness",
      of: "separations",
      step: "kuali-extraction",
    });

    // Drop the composition and the harnesses point at nothing this document
    // carries — the wire says so rather than serving an unnestable entry.
    const orphaned = WorkflowExplorerWireSchema.safeParse({
      ...withHarness,
      workflows: withHarness.workflows.filter(
        (workflow) => String(workflow.id) !== "separations",
      ),
    });
    assert.equal(orphaned.success, false);
    assert.match(
      JSON.stringify(orphaned.error?.issues ?? []),
      /is served as a chunk harness of separations/u,
    );
  });

  it("projects typed branch and repeated child-call metadata without fabricating unavailable child detail", () => {
    const wire = syntheticDelegationExplorerWire();
    assert.doesNotThrow(() => WorkflowExplorerWireSchema.parse(wire));
    assert.deepEqual(
      wire.workflows.map(({ id }) => String(id)),
      ["explorer-delegation-fixture"],
    );
    const entry = wire.workflows[0];
    assert.ok(entry, "the synthetic workflow is absent from its own wire");
    assert.deepEqual(
      entry.timeline.map(({ key, label, nodes }) => ({
        key,
        label,
        nodes: nodes.map(String),
      })),
      [
        { key: "selection", label: "Selection", nodes: ["select-child"] },
        {
          key: "delegations",
          label: "Delegations",
          nodes: ["call-single", "call-batch", "call-background"],
        },
        { key: "completion", label: "Completion", nodes: ["completion"] },
      ],
    );

    const branch = entry.nodes.find(({ id }) => String(id) === "select-child");
    assert.ok(branch, "the synthetic branch is absent from the public wire");
    assert.equal(branch.shape.kind, "branch");
    if (branch.shape.kind !== "branch") return;
    assert.deepEqual(
      branch.shape.cases.map(({ name, nodes }) => ({
        name,
        nodes: nodes.map(String),
      })),
      [
        { name: "single", nodes: ["call-single"] },
        { name: "batch", nodes: ["call-batch"] },
        { name: "background", nodes: ["call-background"] },
      ],
    );
    assert.deepEqual(
      entry.scenarios.map(({ scenarioId }) => String(scenarioId)),
      ["explorer-delegation-fixture/happy"],
    );
    assert.ok(
      branch.shape.cases.every(
        ({ name }) =>
          !entry.scenarios.some(
            ({ scenarioId }) => String(scenarioId) === name,
          ),
      ),
    );

    const calls = entry.nodes.flatMap((node) =>
      node.shape.kind === "child-run"
        ? [{ nodeId: String(node.id), ...node.shape }]
        : [],
    );
    assert.deepEqual(
      calls.map((call) => call.nodeId),
      ["call-single", "call-batch", "call-background"],
    );
    assert.equal(new Set(calls.map(({ edgeId }) => edgeId)).size, 3);
    assert.deepEqual(
      calls.map((call) => ({
        targetWorkflowId: String(call.targetWorkflowId),
        cardinality: call.cardinality,
        await: call.await,
        join: call.join,
        onChildFailed: call.onChildFailed,
        cascadeCancel: call.cascadeCancel,
        afterChildRetry: call.afterChildRetry,
        visibility: call.visibility,
      })),
      [
        {
          targetWorkflowId: "unregistered-child",
          cardinality: "one",
          await: "terminal",
          join: "one",
          onChildFailed: "fail-parent",
          cascadeCancel: "cascade",
          afterChildRetry: "resume-parent",
          visibility: "inline",
        },
        {
          targetWorkflowId: "unregistered-child",
          cardinality: "many",
          await: "terminal",
          join: "all-settled",
          onChildFailed: "allow-partial",
          cascadeCancel: "independent",
          afterChildRetry: "manual-parent-resume",
          visibility: "linked",
        },
        {
          targetWorkflowId: "unregistered-child",
          cardinality: "one",
          await: "none",
          join: "none",
          onChildFailed: "block-parent",
          cascadeCancel: "cascade",
          afterChildRetry: "manual-parent-resume",
          visibility: "hidden-unless-failed",
        },
      ],
    );
    assert.equal(
      wire.workflows.some(({ id }) => String(id) === "unregistered-child"),
      false,
      "an absent child target must not gain fabricated workflow detail",
    );

    const incompleteTimeline = ExplorerWorkflowWireSchema.safeParse({
      ...entry,
      timeline: [entry.timeline[0]],
    });
    assert.equal(incompleteTimeline.success, false);
    assert.match(
      JSON.stringify(incompleteTimeline.error?.issues ?? []),
      /timeline omits graph node/u,
    );
  });

  it("reports a scenario with no executable file as unresolved, naming the path it tried", () => {
    const deps = explorerQueryDeps(CLOCK, HASH);
    const wire = buildWorkflowExplorer({
      ...deps,
      listScenarioSources: () => [],
    });
    const scenarios = wire.workflows.flatMap((workflow) => workflow.scenarios);
    assert.ok(scenarios.length > 0, "the registry declares scenarios");
    for (const scenario of scenarios) {
      assert.equal(scenario.source.state, "unresolved");
      if (scenario.source.state === "unresolved") {
        assert.match(
          String(scenario.source.attemptedPath),
          /^tests\/scenario\//u,
        );
        assert.match(scenario.source.reason, /no executable scenario file/u);
      }
    }
  });

  it("refuses to place a contract no store binds and no pending entry tracks", () => {
    const deps = explorerQueryDeps(CLOCK, HASH);
    assert.throws(
      () =>
        buildWorkflowExplorer({
          ...deps,

          modules: deps.modules.map((module) => ({ ...module, stores: [] })),
        }),
      /no module store implements it/u,
    );
  });

  it("reports the absent scenario corpus without claiming executable sources", () => {
    const sources = readScenarioSources(EXPLORER_SOURCE_ROOT);
    assert.deepEqual(sources, []);
    const wire = buildWorkflowExplorer({
      ...explorerQueryDeps(CLOCK, HASH),
      listScenarioSources: () => sources,
    });
    const scenarios = wire.workflows.flatMap(({ scenarios }) => scenarios);
    assert.ok(scenarios.length > 0, "registered scenarios must remain visible");
    assert.ok(scenarios.every(({ source }) => source.state === "unresolved"));
  });

  it("returns an empty corpus — never a throw — when the scenario directory is absent", () => {
    assert.deepEqual(
      readScenarioSources("/nonexistent-source-root-for-this-test"),
      [],
    );
  });
});
