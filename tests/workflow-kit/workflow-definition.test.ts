import { createSearchWorkflowDefinitionFixtures } from "../support/helpers/search-workflow-definition-fixtures.js";
import { createOperationDisplayFixtures } from "../support/helpers/operation-display-fixtures.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { taskStoreRegistry } from "../../src/backend/app/registries/task-registry.js";
import { SearchPersonOrg } from "../../src/models/systems/ucpath/search-person-org.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../src/models/workflow/presentation.js";
import { type RegisteredTaskStore } from "../../src/workflow-kit/task-registry.js";
import { BUILD_MANIFEST } from "../../src/workflow-kit/validation/build-manifest.js";
import { defineWorkflowRole } from "../../src/workflow-kit/validation/module-role.js";
import { type AnyWorkflowEntry, type WorkflowAuthor, compileWorkflow, composeWorkflowModule, defineStepEntries, defineWorkflow, workflowDefinitionOf, workflowExplorerDeclaration, workflowEntryKinds } from "../../src/workflow-kit/workflow-definition.js";
import { defineWorkflowStep, descriptorRuntimeNodes, workflowTerminalResultExecution } from "../../src/workflow-kit/workflow.js";
import { PersonLookupCanonicalInput, PersonLookupInput, personLookupWorkflow } from "../../src/workflows/person-lookup/workflow.js";
import { personLookupDescriptor } from "../support/helpers/registered-workflows.js";
import assert from "node:assert/strict";
import { UcpathDeletePendingTerminations } from "../../src/models/systems/ucpath/delete-pending-terminations.js";
import { UcpathReadPendingTerminationSet } from "../../src/models/systems/ucpath/read-pending-termination-set.js";
import { UcpathStagePendingTerminationSweep } from "../../src/models/systems/ucpath/stage-pending-termination-sweep.js";
import { ItemIdSchema, WorkflowIdSchema, EidSchema, FingerprintSchema } from "../../src/rules/identity/ids.js";
import { compileFixtureWorkflow, everyEntryKindWorkflow, fixtureBuildManifest } from "../support/fixtures/workflow-definition-fixtures.js";
import { projectStartSteps } from "../../src/backend/runs/start/step-selection.js";
import { CANONICAL_FIELDS } from "../../src/models/fields/registry.js";
import { CrmReadOnboardingRecord } from "../../src/models/systems/crm/read-onboarding-record.js";
import { defineCanonicalInput } from "../../src/models/workflow/canonical-input.js";
import { manualClock } from "../../src/rules/time/clock.js";
import { QUEUED_RUN } from "../support/fixtures/phase1f-run-fixtures.js";
import { buildWorkflowExplorer } from "../../src/backend/runs/queries/explorer.js";
import { freezeWorkflowOperationDisplaySnapshot } from "../../src/models/workflow/operation-display-snapshot.js";

import { explorerQueryDeps } from "../support/fixtures/explorer-seams.js";

const { lookupInput, fixtureWorkflow } = createSearchWorkflowDefinitionFixtures();


type Author = WorkflowAuthor<typeof PersonLookupInput>;

describe("workflow definition compiler", () => {
  it("preserves an omitted task label when sharing a step identity", () => {
    const step = defineWorkflowStep({ key: "searching", label: "Search for person" });
    const entries = defineStepEntries(step);
    const unlabeled = entries.task("search", SearchPersonOrg, { replay: "checkpoint" });
    expect(unlabeled.step).toBe(step);
    expect(unlabeled).not.toHaveProperty("label");
    expect(entries.task("named", SearchPersonOrg, { label: "Named search", replay: "checkpoint" }).label).toBe("Named search");
  });

  it("validates outcome declarations against the result field and unique vocabulary", () => {
    const projection = personLookupWorkflow.outcomeProjection;
    assert.ok(projection);
    expect(compileWorkflow(personLookupWorkflow).descriptor.outcomeProjection).toEqual(projection);
    expect(() => compileWorkflow({ ...personLookupWorkflow, outcomeProjection: { ...projection, fieldPath: "activeStatus.missing" } })).toThrow(/result outcome projection/u);
    expect(() => compileWorkflow({ ...personLookupWorkflow, outcomeProjection: { ...projection, fieldPath: "activeStatus..state" } })).toThrow();
    expect(() => compileWorkflow({ ...personLookupWorkflow, outcomeProjection: { ...projection, fieldPath: "activeStatus.details" } })).toThrow(/result outcome projection/u);
    expect(() => compileWorkflow({ ...personLookupWorkflow, outcomeProjection: { ...projection, cases: [projection.cases[0], projection.cases[0]] } })).toThrow(/unique/u);
    expect(() => compileWorkflow({ ...personLookupWorkflow, outcomeProjection: { ...projection, cases: [{ value: "unknown-result", label: "Unknown", tone: "warning" }] } })).toThrow(/vocabulary/u);
  });
  it("validates declared result subtitle paths against the terminal result schema", () => {
    const projection = { fieldPath: "activeStatus.details.eid", display: "eid" as const };
    expect(compileWorkflow({ ...personLookupWorkflow, subtitleProjection: projection }).descriptor.subtitleProjection).toEqual(projection);
    expect(() => compileWorkflow({ ...personLookupWorkflow, subtitleProjection: { ...projection, fieldPath: "activeStatus.details.missing" } })).toThrow(/result subtitle projection/u);
    expect(() => compileWorkflow({ ...personLookupWorkflow, subtitleProjection: { ...projection, fieldPath: "activeStatus..eid" } })).toThrow();
  });
  it("exports the compiled ordered tuple product and refuses an uncompiled definition", () => {
    const declaration = workflowExplorerDeclaration(personLookupWorkflow);
    expect(declaration.map((group) => [group.key, group.label, group.entries.map((entry) => ({
      id: entry.id, nodeIds: entry.nodeIds.map(String), dependsOn: entry.dependsOn.map(String),
    }))])).toEqual([
      [
        "searching",
        "Search for person",
        [
          {
            id: "searching",
            nodeIds: [
              "searching"
            ],
            dependsOn: []
          },
          {
            id: "matching",
            nodeIds: [
              "matching"
            ],
            dependsOn: [
              "searching"
            ]
          },
          {
            id: "search-identity",
            nodeIds: [
              "search-identity"
            ],
            dependsOn: [
              "searching",
              "matching"
            ]
          }
        ]
      ],
      [
        "cross-verify",
        "Cross-check identity",
        [
          {
            id: "cross-verify",
            nodeIds: [
              "cross-verify"
            ],
            dependsOn: [
              "search-identity",
              "searching",
              "matching"
            ]
          },
          {
            id: "crm-identity",
            nodeIds: [
              "crm-identity"
            ],
            dependsOn: [
              "search-identity",
              "cross-verify",
              "searching",
              "matching"
            ]
          },
          {
            id: "crm-selected-record",
            nodeIds: [
              "crm-selected-record"
            ],
            dependsOn: [
              "crm-identity"
            ]
          },
          {
            id: "crm-results",
            nodeIds: ["crm-results"],
            dependsOn: ["search-identity", "cross-verify", "crm-identity", "searching", "matching"]
          }
        ]
      ],
      [
        "active-status",
        "Read employment status",
        [
          {
            id: "crm-only-recovery",
            nodeIds: [
              "crm-only-recovery"
            ],
            dependsOn: [
              "crm-identity",
              "crm-selected-record",
              "crm-results"
            ]
          },
          {
            id: "active-status",
            nodeIds: [
              "active-status"
            ],
            dependsOn: [
              "search-identity",
              "crm-identity",
              "crm-only-recovery",
              "crm-selected-record",
              "crm-results"
            ]
          }
        ]
      ],
      ["crm-dates", "Read CRM dates", [{id: "crm-dates", nodeIds: ["crm-dates"], dependsOn: ["active-status"]}]],
    ]);
    expect(Object.isFrozen(declaration)).toBe(true);
    expect(Object.isFrozen(declaration[0]?.entries[0]?.nodeIds)).toBe(true);
    const uncompiled = fixtureWorkflow("uncompiled-explorer", ({ task, result }) => {
      const read = task({ id: "read", contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
      return { steps: [[{ key: "read", label: "Read" }, [read]]], result: result(z.string(), [], () => "done") };
    });
    expect(() => workflowExplorerDeclaration(uncompiled)).toThrow(/has no compiled definition/u);
  });

  it("derives execution order and edges from entry references while preserving tuple presentation order", () => {
    const graph = descriptorRuntimeNodes(personLookupDescriptor);

    expect(graph.map((node) => ({ id: String(node.id), dependsOn: node.dependsOn.map(String) }))).toEqual([
      {id: "searching", dependsOn: []},
      {id: "matching", dependsOn: ["searching"]},
      {id: "search-identity", dependsOn: ["searching", "matching"]},
      {id: "cross-verify", dependsOn: ["search-identity", "searching", "matching"]},
      {id: "crm-identity", dependsOn: ["search-identity", "cross-verify", "searching", "matching"]},
      {id: "crm-selected-record", dependsOn: ["crm-identity"]},
      {id: "crm-results", dependsOn: ["search-identity", "cross-verify", "crm-identity", "searching", "matching"]},
      {id: "crm-only-recovery", dependsOn: ["crm-identity", "crm-selected-record", "crm-results"]},
      {id: "active-status", dependsOn: ["search-identity", "crm-identity", "crm-only-recovery", "crm-selected-record", "crm-results"]},
      {id: "crm-dates", dependsOn: ["active-status"]},
    ]);
    expect(personLookupWorkflow.steps.map(([group]) => group.key)).toEqual([
      "searching",
      "cross-verify",
      "active-status",
      "crm-dates",
    ]);
    expect(workflowDefinitionOf(personLookupDescriptor)).toBe(personLookupWorkflow);
    expect(compileWorkflow(personLookupWorkflow).descriptor).toBe(personLookupDescriptor);
    expect(personLookupWorkflow.kind).toBe("workflow-definition");
    expect(compileWorkflow(personLookupWorkflow).kind).toBe("compiled-workflow");
  });

  it("memoizes one compiled workflow per definition AND build manifest; a second manifest refuses instead of returning the first compile", () => {
    const compiled = compileWorkflow(personLookupWorkflow);
    expect(compileWorkflow(personLookupWorkflow, { manifest: BUILD_MANIFEST })).toBe(compiled);

    expect(() => compileWorkflow(personLookupWorkflow, { manifest: { ...BUILD_MANIFEST } })).toThrow(
      /workflow person-lookup was already compiled under a different build manifest; one definition compiles under exactly one manifest/u,
    );
    expect(compileWorkflow(personLookupWorkflow)).toBe(compiled);
  });

  it("refuses unresolved references and dependency cycles by entry name", () => {
    expect(() => fixtureWorkflow("unresolved", ({ task, result }) => {
      const missing = task({ id: "missing", contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
      const consumer = task({ id: "consumer", contract: SearchPersonOrg, replay: "checkpoint" }, [missing], lookupInput);
      return {
        steps: [[{ key: "consumer", label: "Consumer" }, [consumer]]],
        result: result(z.string(), [], () => "done"),
      };
    })).toThrow(/workflow entry "consumer" references unresolved entry "missing"/u);

    expect(() => fixtureWorkflow("unresolved-result", ({ task, result }) => {
      const missing = task({ id: "missing", contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
      const declared = task({ id: "declared", contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
      return {
        steps: [[{ key: "declared", label: "Declared" }, [declared]]],
        result: result(z.string(), [missing], () => "done"),
      };
    })).toThrow(/workflow unresolved-result result references unresolved entry "missing"/u);

    expect(() => fixtureWorkflow("cycle", ({ task, result }) => {
      const firstReferences: AnyWorkflowEntry[] = [];
      const first = task({ id: "first", contract: SearchPersonOrg, replay: "checkpoint" }, firstReferences, lookupInput);
      const second = task({ id: "second", contract: SearchPersonOrg, replay: "checkpoint" }, [first], lookupInput);
      firstReferences.push(second);
      return {
        steps: [[{ key: "cycle", label: "Cycle" }, [first, second]]],
        result: result(z.string(), [], () => "done"),
      };
    })).toThrow(/workflow cycle dependency cycle: first -> second -> first/u);
  });

  it("derives exact module stores at the composition root and refuses an incomplete inventory", () => {
    const compiled = compileWorkflow(personLookupWorkflow);
    const withoutCrm = taskStoreRegistry.stores.filter(({ namespace }) => namespace !== "crm");
    const crm = taskStoreRegistry.stores.find(({ namespace }) => namespace === "crm");
    expect(crm).toBeDefined();
    if (crm === undefined) throw new Error("fixture registry is missing the crm store");

    expect(() => composeWorkflowModule(compiled, withoutCrm))
      .toThrow(/workflow person-lookup requires missing store crm/u);
    expect(() => composeWorkflowModule(compiled, [...taskStoreRegistry.stores, crm]))
      .toThrow(/workflow person-lookup found duplicate stores for crm/u);

    const wrongContractCrm = {
      ...crm,
      tasks: Object.fromEntries(Object.entries(crm.tasks).map(([key, task]) => [
        key,
        { ...task, contract: SearchPersonOrg },
      ])),
    } as RegisteredTaskStore;
    expect(() => composeWorkflowModule(
      compiled,
      taskStoreRegistry.stores.map((store) => store === crm ? wrongContractCrm : store),
    )).toThrow(/workflow person-lookup cannot resolve exact contract crm\/search-onboarding-records/u);

    const module = composeWorkflowModule(compiled, taskStoreRegistry.stores);
    expect(module.stores.map(({ namespace }) => String(namespace))).toEqual(["ucpath", "crm", "workflow:person-lookup"]);
    expect(module.role).toEqual({ kind: "composition" });
    expect(module.definition).toBe(personLookupWorkflow);

    const foreign = { ...compiled, definition: personLookupWorkflow };
    expect(() => composeWorkflowModule(foreign, taskStoreRegistry.stores))
      .toThrow(/workflow person-lookup module does not use the compiled workflow of its own definition/u);
  });
});

describe("workflow definition entry algebra", () => {
  it("compiles every explicit entry kind into its existing node kind with the author's exact policies", () => {
    const compiled = compileFixtureWorkflow(everyEntryKindWorkflow);
    expect(workflowEntryKinds(everyEntryKindWorkflow).toSorted())
      .toEqual(["delegate", "gate", "parallel", "task", "transaction"]);
    const nodes = descriptorRuntimeNodes(compiled.descriptor);
    const byId = new Map(nodes.map((node) => [String(node.id), node]));
    expect(nodes.map((node) => `${String(node.id)}:${node.kind}`).toSorted()).toEqual([
      "child:child-run",
      "crm-dates:task",
      "crm-record:task",
      "fan:parallel",
      "pending-set:task",
      "review:gate",
      "search:task",
      "sweep:transaction",
    ]);
    const fan = byId.get("fan");
    assert.ok(fan?.kind === "parallel");
    expect(fan.join).toBe("all");
    expect(fan.branches.map((branch) => ({ id: branch.id, nodes: branch.nodes.map(String) })))
      .toEqual([{ id: "record", nodes: ["crm-record"] }, { id: "dates", nodes: ["crm-dates"] }]);

    const order = nodes.map((node) => String(node.id));
    expect(order.indexOf("fan")).toBeLessThan(order.indexOf("crm-record"));
    expect(order.indexOf("fan")).toBeLessThan(order.indexOf("crm-dates"));
    const child = byId.get("child");
    assert.ok(child?.kind === "child-run");
    expect({ cardinality: child.cardinality, await: child.await, join: child.join, edgeId: String(child.edgeId) })
      .toEqual({ cardinality: "one", await: "terminal", join: "one", edgeId: "fixture-child-lookup" });
    expect(child.dependsOn.map(String)).toEqual(["review"]);
    const sweep = byId.get("sweep");
    assert.ok(sweep?.kind === "transaction");
    expect({ dryRun: sweep.dryRun, probePolicy: sweep.probePolicy, budget: sweep.probeToFenceMaxMs })
      .toEqual({ dryRun: "stop-after-prepare", probePolicy: "always", budget: 90_000 });

    expect(compiled.descriptor.timeline.map((group) => ({ key: group.key, nodes: group.nodes.map(({ id }) => String(id)) })))
      .toEqual([
        { key: "reads", nodes: ["search", "fan", "crm-record", "crm-dates"] },
        { key: "review", nodes: ["review", "child"] },
        { key: "sweep", nodes: ["pending-set", "sweep"] },
      ]);

    expect(compiled.storeNamespaces).toEqual(["ucpath", "crm"]);
  });

  it("refuses an implicit or unsupported control shape by name instead of inferring one", () => {
    const leaf = (author: Author, id: string) =>
      author.task({ id, contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
    expect(() => fixtureWorkflow("parallel-one-branch", (author) => {
      const fan = author.parallel({ id: "fan", join: "all", failure: "fail-fast" }, [
        { id: "only", leaves: [leaf(author, "a")] },
      ]);
      return { steps: [[{ key: "fan", label: "Fan" }, [fan]]], result: author.result(z.string(), [], () => "done") };
    })).toThrow(/parallel entry "fan" requires at least two branches/u);

    expect(() => fixtureWorkflow("parallel-all-settled", (author) => {
      const fan = author.parallel({ id: "fan", join: "all-settled", failure: "fail-fast" }, [
        { id: "a", leaves: [leaf(author, "a")] },
        { id: "b", leaves: [leaf(author, "b")] },
      ]);
      return { steps: [[{ key: "fan", label: "Fan" }, [fan]]], result: author.result(z.string(), [], () => "done") };
    })).toThrow(/join "all-settled", which the run executor does not interpret \(capability-unavailable\)/u);

    expect(() => fixtureWorkflow("parallel-leaf-in-tuple", (author) => {
      const a = leaf(author, "a");
      const b = leaf(author, "b");
      const fan = author.parallel({ id: "fan", join: "all", failure: "fail-fast" }, [
        { id: "a", leaves: [a] },
        { id: "b", leaves: [b] },
      ]);
      return {
        steps: [[{ key: "fan", label: "Fan" }, [fan, a]]],
        result: author.result(z.string(), [], () => "done"),
      };
    })).toThrow(/workflow entry "a" is a leaf of parallel entry "fan" and may not also appear in a timeline tuple/u);

    expect(() => fixtureWorkflow("parallel-leaf-twice", (author) => {
      const a = leaf(author, "a");
      const fan = author.parallel({ id: "fan", join: "all", failure: "fail-fast" }, [
        { id: "a", leaves: [a] },
        { id: "b", leaves: [a] },
      ]);
      return { steps: [[{ key: "fan", label: "Fan" }, [fan]]], result: author.result(z.string(), [], () => "done") };
    })).toThrow(/parallel entry "fan" lists leaf "a" in more than one branch/u);

    expect(() => fixtureWorkflow("parallel-gate-leaf", (author) => {
      const review = author.gate({ id: "review", label: "Review", result: z.strictObject({ ok: z.boolean() }) }, []);
      const fan = author.parallel({ id: "fan", join: "all", failure: "fail-fast" }, [
        { id: "a", leaves: [leaf(author, "a")] },
        { id: "b", leaves: [review] },
      ]);
      return { steps: [[{ key: "fan", label: "Fan" }, [fan]]], result: author.result(z.string(), [], () => "done") };
    })).toThrow(/leaf "review" is a gate entry; a parallel leaf is a task entry with its own checkpoint/u);

    const target = { id: WorkflowIdSchema.parse("person-lookup"), input: PersonLookupInput, result: z.strictObject({}) };
    const policy = {
      onChildFailed: "fail-parent",
      cascadeCancel: "cascade",
      afterChildRetry: "resume-parent",
      visibility: "inline",
    } as const;
    expect(() => fixtureWorkflow("delegate-shape", (author) => {
      const child = author.delegate({
        id: "child", target, edgeId: "fixture-edge", cardinality: "one", await: "terminal", join: "all", policy,
      }, [], { bind: () => ({ emplId: "10800000" }), deriveChildItemId: () => ItemIdSchema.parse("00000000-0000-4000-8000-000000000fe2") });
      return { steps: [[{ key: "child", label: "Child" }, [child]]], result: author.result(z.string(), [], () => "done") };
    })).toThrow(/delegate entry "child" declares cardinality\/await\/join one\/terminal\/all, which is not one of the typed child-run shapes/u);

    expect(() => fixtureWorkflow("delegate-edge", (author) => {
      const child = author.delegate({
        id: "child", target, edgeId: "Not A Slug", cardinality: "one", await: "terminal", join: "one", policy,
      }, [], { bind: () => ({ emplId: "10800000" }), deriveChildItemId: () => ItemIdSchema.parse("00000000-0000-4000-8000-000000000fe2") });
      return { steps: [[{ key: "child", label: "Child" }, [child]]], result: author.result(z.string(), [], () => "done") };
    })).toThrow(/delegation edge id must be kebab-case/u);

    expect(() => fixtureWorkflow("transaction-budget", (author) => {
      const pendingSet = author.task({ id: "pending-set", contract: UcpathReadPendingTerminationSet, replay: "checkpoint" }, [], () => ({ emplId: "10800000", expectedName: "Fixture, Person" }));
      const sweep = author.transaction({
        id: "sweep",
        prepare: UcpathStagePendingTerminationSweep,
        commit: UcpathDeletePendingTerminations,
        dryRun: "stop-after-prepare",
        probePolicy: "always",
        probeToFenceMaxMs: 0,
      }, [pendingSet], {
        prepareBind: ({ outputs }) => ({ emplId: "10800000", expectedName: "Fixture, Person", observedSet: outputs["pending-set"] }),
        commitBind: ({ outputs }) => ({ emplId: "10800000", expectedName: "Fixture, Person", observedSet: outputs["pending-set"] }),
      });
      return { steps: [[{ key: "sweep", label: "Sweep" }, [pendingSet, sweep]]], result: author.result(z.string(), [], () => "done") };
    })).toThrow(/transaction entry "sweep" requires a positive integer probeToFenceMaxMs budget/u);
  });
});

const Input = z.strictObject({ emplId: EidSchema, expectedName: CANONICAL_FIELDS.fullName.schema });
const CanonicalInput = defineCanonicalInput(
  Input,
  z.strictObject({ emplId: EidSchema, expectedName: CANONICAL_FIELDS.fullName.schema }),
  [{ emplId: "10800000", expectedName: "Fixture, Person" }],
);
const ResultSchema = z.strictObject({ verified: z.boolean() });

type Grouping = (entries: Readonly<{ search: AnyWorkflowEntry; verify: AnyWorkflowEntry }>) =>
  readonly (readonly [Readonly<{ key: string; label: string }>, readonly AnyWorkflowEntry[]])[];

function variant(id: string, code: string, grouping: Grouping) {
  return defineWorkflow({
    id,
    version: 1,
    code,
    label: "Grouping proof",
    icon: "Search",
    category: "operations",
    input: Input,
    canonicalInput: CanonicalInput,
    inputSubject: "eid",
    surface: { shape: "single" },
    enqueue: "reject-active",
    actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {},
    details: [],
    identity: { matchKey: (input) => `eid:${input.emplId}` },
    presentation: { title: (input) => `EID ${input.emplId}` },
    scenarios: ["grouping-proof/happy"],
    role: defineWorkflowRole({ kind: "standalone" }),
    steps: ({ task, result }) => {
      const search = task({ id: "search", contract: SearchPersonOrg, label: "Search", replay: "checkpoint" }, [], ({ input }) => ({
        kind: "by-eid" as const, emplId: input.emplId,
      }));
      const verify = task({ id: "verify", contract: CrmReadOnboardingRecord, label: "Verify", replay: "checkpoint" }, [search], ({ input }) => ({
        eid: input.emplId, name: input.expectedName,
      }));
      return {
        steps: grouping({ search, verify }),
        result: result(ResultSchema, [verify], ({ outputs }) => ({ verified: outputs.verify.state === "found" })),
      };
    },
  });
}

describe("grouping/options-only change", () => {
  it("changes only the definition: the compiled graph is identical while every generic grouping projection follows the tuples", () => {
    const twoGroups = compileFixtureWorkflow(variant("grouping-proof-two", "gpa", ({ search, verify }) => [
      [{ key: "search", label: "Search" }, [search]],
      [{ key: "verify", label: "Verify" }, [verify]],
    ]));
    const oneGroup = compileFixtureWorkflow(variant("grouping-proof-one", "gpb", ({ search, verify }) => [
      [{ key: "reads", label: "Reads (renamed)" }, [search, verify]],
    ]));

    const graph = (compiled: typeof twoGroups) => descriptorRuntimeNodes(compiled.descriptor).map((node) => ({
      id: String(node.id),
      kind: node.kind,
      dependsOn: node.dependsOn.map(String),
      contract: node.kind === "task" ? String(node.uses.id) : undefined,
    }));
    assert.deepEqual(graph(oneGroup), graph(twoGroups), "the executable graph does not follow grouping");
    assert.deepEqual(oneGroup.contracts, twoGroups.contracts);
    assert.deepEqual(oneGroup.storeNamespaces, twoGroups.storeNamespaces);

    assert.deepEqual(twoGroups.descriptor.timeline.map(({ key, label, nodes }) => ({ key, label, nodes: nodes.map(({ id }) => String(id)) })), [
      { key: "search", label: "Search", nodes: ["search"] },
      { key: "verify", label: "Verify", nodes: ["verify"] },
    ]);
    assert.deepEqual(oneGroup.descriptor.timeline.map(({ key, label, nodes }) => ({ key, label, nodes: nodes.map(({ id }) => String(id)) })), [
      { key: "reads", label: "Reads (renamed)", nodes: ["search", "verify"] },
    ]);
    assert.equal(twoGroups.descriptor.timelineDeclared, false, "single-entry groups keyed by node id are the default timeline");
    assert.equal(oneGroup.descriptor.timelineDeclared, true);
    assert.deepEqual(projectStartSteps(oneGroup.descriptor).map(({ key, label }) => ({ key, label })), [
      { key: "reads", label: "Reads (renamed)" },
    ]);
    assert.deepEqual(projectStartSteps(twoGroups.descriptor).map(({ key, label }) => ({ key, label })), [
      { key: "search", label: "Search" },
      { key: "verify", label: "Verify" },
    ]);
  });
});

describe("canonical awaited child terminal evidence", () => {
  it("refuses a many-child result dependency instead of inventing one child identity", () => {
    assert.throws(() => compileWorkflow(defineWorkflow({
      id: "fixture-child-result-parent", version: 1, code: "fcr", label: "Child result parent", icon: "Search", category: "operations",
      input: personLookupDescriptor.input, canonicalInput: PersonLookupCanonicalInput, inputSubject: "eid",
      surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
      surfaces: {}, details: [], identity: { matchKey: () => "child-fixture" }, presentation: { title: () => "Child parent" },
      scenarios: ["fixture-child-result/parent"], role: defineWorkflowRole({ kind: "standalone" }),
      steps: ({ delegate, result }) => {
        const common = { id: "child", target: { id: personLookupDescriptor.id, input: personLookupDescriptor.input, result: workflowTerminalResultExecution(personLookupDescriptor).schema }, edgeId: "fixture-child-result-edge", await: "terminal" as const,
          policy: { onChildFailed: "fail-parent" as const, cascadeCancel: "cascade" as const, afterChildRetry: "resume-parent" as const, visibility: "inline" as const } };
        const child = delegate({ ...common, cardinality: "many", join: "all" }, [], { bind: ({ input }) => [input], deriveChildItemId: () => ItemIdSchema.parse(QUEUED_RUN.envelope.itemId) });
        return { steps: [[{ key: "child", label: "Child" }, [child]]],
          result: result(z.strictObject({ state: z.literal("done") }), [child], ({ outputs }) => z.object({ state: z.literal("done") }).parse(outputs.child)) };
      },
    }), { manifest: fixtureBuildManifest(["fixture-child-result-parent"]) }), /owns no output schema/);
  });
});

const { DISPLAY_CHILD_A_ID, DISPLAY_CHILD_B_ID, DISPLAY_FORWARD_ID, outerWorkflow } = createOperationDisplayFixtures();


const operation = SearchPersonOrg.operation;
if (operation === undefined) throw new Error("SearchPersonOrg must declare its reusable display operation");

const forwardWorkflow = outerWorkflow(DISPLAY_FORWARD_ID, "forward");
const displayManifest = fixtureBuildManifest([
  DISPLAY_CHILD_A_ID,
  DISPLAY_CHILD_B_ID,
  DISPLAY_FORWARD_ID,
]);

describe("workflow operation display declarations", () => {

  it("serves the exact compiled complete structure through the real Explorer projection", () => {
    const compiled = compileWorkflow(forwardWorkflow, { manifest: displayManifest });
    const module = composeWorkflowModule(compiled, taskStoreRegistry.stores);
    const explorer = buildWorkflowExplorer({
      ...explorerQueryDeps(manualClock(new Date("2026-09-27T12:00:00.000Z")), FingerprintSchema.parse("c".repeat(64))),
      modules: [module],
      buildManifest: fixtureBuildManifest([DISPLAY_FORWARD_ID]),
    });
    const workflow = explorer.workflows[0];
    if (workflow === undefined || workflow.operationStructure.state !== "declared") {
      throw new Error("Explorer did not serve the complete operation declaration");
    }
    const expected = freezeWorkflowOperationDisplaySnapshot({
      workflowId: compiled.descriptor.id,
      definitionFingerprint: compiled.descriptor.contractFingerprint,
      display: compiled.descriptor.operationDisplay,
    });
    expect(workflow.operationStructure.definition).toEqual(expected);
  });
});
