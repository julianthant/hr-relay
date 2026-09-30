import { defineTaskContract } from "../../src/domain/contracts/base.js";
import { WriteFixturePrepare, WriteFixtureCommit, WriteFixtureProbe, WriteFixtureVerify } from "./fixtures/write-sequencer-fixtures.js";
import { ObservedOperationStructureWireSchema } from "../../src/domain/dashboard/operation-structure.js";
import { createDeclaredActionBinder } from "../../src/core/operation-action-binding.js";
import { DeclaredActionIdentitySchema } from "../../src/domain/workflow/operation-action-identity.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  compileWorkflow,
  composeWorkflowModule,
  defineWorkflow,
} from "../../src/base/workflow-definition.js";
import { descriptorRuntimeNodes } from "../../src/base/workflow.js";
import { sha256Hex } from "../../src/domain/sha256.js";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { SearchPersonOrg } from "../../src/domain/contracts/ucpath/search-person-org.js";
import { EidSchema, FingerprintSchema, ItemIdSchema, WorkflowIdSchema } from "../../src/domain/ids.js";
import { RunEnvelopeSchema } from "../../src/domain/run/envelope.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import {
  UCPATH_PERSON_ORG_SEARCH_SCREEN,
} from "../../src/domain/ui/ucpath-person-org.js";
import {
  OPERATION_ACTION_KINDS,
  OPERATION_DISPLAY_FORMAT_VERSION,
  assertCompiledWorkflowOperationDisplay,
  assertTaskOperationDeclaration,
  compileWorkflowOperationDisplay,
  renderOperationTemplate,
} from "../../src/domain/workflow/operation-display.js";
import {
  freezeWorkflowOperationDisplaySnapshot,
  requireWorkflowOperationDisplaySnapshot,
  WorkflowOperationDisplaySnapshotSchema,
} from "../../src/domain/workflow/operation-display-snapshot.js";
import type {
  TaskOperationDeclaration,
  WorkflowOperationDisplayCompileInput,
  WorkflowOperationDisplayDeclaration,
  WorkflowOperationEntryProjection,
  WorkflowValueReference,
} from "../../src/domain/workflow/operation-display.js";
import { defineCanonicalInput } from "../../src/domain/workflow/canonical-input.js";
import { defineWorkflowRole } from "../../src/domain/workflow/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../src/domain/workflow/presentation.js";
import { buildQueuedRun } from "../../src/services/runs/enqueue.js";
import { taskStoreRegistry } from "../../src/stores/index.js";
import { buildWorkflowExplorer } from "../../src/server/dashboard/queries/explorer.js";
import { manualClock } from "../../src/domain/clock.js";
import { explorerQueryDeps } from "../fixtures/explorer-seams.js";
import { fixtureBuildManifest } from "./fixtures/workflow-definition-fixtures.js";

const DISPLAY_NESTED_ID = "fixture-operation-display-nested";
const DISPLAY_CHILD_A_ID = "fixture-operation-display-child-a";
const DISPLAY_CHILD_B_ID = "fixture-operation-display-child-b";
const DISPLAY_FORWARD_ID = "fixture-operation-display-forward";
const DISPLAY_REVERSED_ID = "fixture-operation-display-reversed";
const DISPLAY_LEGACY_ID = "fixture-operation-display-legacy-definition";

const DisplayInput = z.strictObject({
  firstEid: EidSchema,
  secondEid: EidSchema,
});
const DisplayCanonicalInput = defineCanonicalInput(
  DisplayInput,
  z.strictObject({ firstEid: EidSchema, secondEid: EidSchema }),
  [{ firstEid: "10800000", secondEid: "10800001" }],
);
const DisplayResult = z.strictObject({ done: z.boolean() });
const NestedResult = z.strictObject({ approved: z.boolean() });
const ChildAResult = z.strictObject({ nestedState: z.enum(["done", "failed", "cancelled", "blocked"]) });
const ChildBResult = z.strictObject({ approved: z.boolean() });

const NestedRef = {
  id: WorkflowIdSchema.parse(DISPLAY_NESTED_ID),
  input: DisplayInput,
  result: NestedResult,
};
const ChildARef = {
  id: WorkflowIdSchema.parse(DISPLAY_CHILD_A_ID),
  input: DisplayInput,
  result: ChildAResult,
};
const ChildBRef = {
  id: WorkflowIdSchema.parse(DISPLAY_CHILD_B_ID),
  input: DisplayInput,
  result: ChildBResult,
};

const DelegationPolicy = {
  onChildFailed: "fail-parent" as const,
  cascadeCancel: "cascade" as const,
  afterChildRetry: "resume-parent" as const,
  visibility: "inline" as const,
};

const operation = SearchPersonOrg.operation;
if (operation === undefined) throw new Error("SearchPersonOrg must declare its reusable display operation");

const nestedWorkflow = defineWorkflow({
  id: DISPLAY_NESTED_ID,
  version: 1,
  code: "fdn",
  label: "Operation Display Nested Child",
  icon: "Search",
  category: "operations",
  input: DisplayInput,
  canonicalInput: DisplayCanonicalInput,
  inputSubject: "eid",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {},
  details: [],
  identity: { matchKey: (input) => `nested:${input.firstEid}` },
  presentation: { title: () => "Nested display child" },
  scenarios: ["fixture-operation-display/nested"],
  role: defineWorkflowRole({ kind: "standalone" }),
  operationDisplay: {
    capability: "complete",
    version: OPERATION_DISPLAY_FORMAT_VERSION,
    invocations: [],
    presentation: [{ id: "nested-approval", kind: "operator-gate", entryId: "nested-approval" }],
  } satisfies WorkflowOperationDisplayDeclaration,
  steps: ({ gate, result }) => {
    const approval = gate({
      id: "nested-approval",
      label: "Nested approval",
      result: NestedResult,
    }, []);
    return {
      steps: [[{ key: "nested", label: "Nested" }, [approval]]],
      result: result(NestedResult, [approval], ({ outputs }) => outputs["nested-approval"]),
    };
  },
});

const childAWorkflow = defineWorkflow({
  id: DISPLAY_CHILD_A_ID,
  version: 1,
  code: "fda",
  label: "Operation Display Child A",
  icon: "Search",
  category: "operations",
  input: DisplayInput,
  canonicalInput: DisplayCanonicalInput,
  inputSubject: "eid",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {},
  details: [],
  identity: { matchKey: (input) => `child-a:${input.firstEid}` },
  presentation: { title: () => "Display child A" },
  scenarios: ["fixture-operation-display/child-a"],
  role: defineWorkflowRole({ kind: "standalone" }),
  operationDisplay: {
    capability: "complete",
    version: OPERATION_DISPLAY_FORMAT_VERSION,
    invocations: [],
    presentation: [{
      id: "delegate-nested",
      kind: "delegate",
      entryId: "nested-child",
      targetWorkflowId: DISPLAY_NESTED_ID,
    }],
  } satisfies WorkflowOperationDisplayDeclaration,
  steps: ({ delegate, result }) => {
    const nested = delegate({
      id: "nested-child",
      label: "Nested child",
      target: NestedRef,
      edgeId: "fixture-display-nested-child",
      cardinality: "one",
      await: "terminal",
      join: "one",
      policy: DelegationPolicy,
    }, [], {
      bind: ({ input }) => input,
      deriveChildItemId: () => ItemIdSchema.parse("00000000-0000-4000-8000-000000000da1"),
    });
    return {
      steps: [[{ key: "nested-child", label: "Nested child" }, [nested]]],
      result: result(ChildAResult, [], () => ({ nestedState: "done" as const })),
    };
  },
});

const childBWorkflow = defineWorkflow({
  id: DISPLAY_CHILD_B_ID,
  version: 1,
  code: "fdb",
  label: "Operation Display Child B",
  icon: "Search",
  category: "operations",
  input: DisplayInput,
  canonicalInput: DisplayCanonicalInput,
  inputSubject: "eid",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {},
  details: [],
  identity: { matchKey: (input) => `child-b:${input.secondEid}` },
  presentation: { title: () => "Display child B" },
  scenarios: ["fixture-operation-display/child-b"],
  role: defineWorkflowRole({ kind: "standalone" }),
  operationDisplay: {
    capability: "complete",
    version: OPERATION_DISPLAY_FORMAT_VERSION,
    invocations: [],
    presentation: [{ id: "child-b-approval", kind: "operator-gate", entryId: "child-b-approval" }],
  } satisfies WorkflowOperationDisplayDeclaration,
  steps: ({ gate, result }) => {
    const approval = gate({
      id: "child-b-approval",
      label: "Child B approval",
      result: ChildBResult,
    }, []);
    return {
      steps: [[{ key: "child-b", label: "Child B" }, [approval]]],
      result: result(ChildBResult, [approval], ({ outputs }) => outputs["child-b-approval"]),
    };
  },
});

function searchInvocation(id: string, entryId: string, inputPath: "firstEid" | "secondEid") {
  return {
    id,
    entryId,
    contractRole: "task" as const,
    occurrencePath: [entryId],
    bindings: [
      { slot: "search-kind", value: { kind: "constant" as const, value: "by-eid" } },
      { slot: "empl-id", value: { kind: "run-input" as const, path: inputPath } },
      { slot: "name", value: { kind: "constant" as const, value: "unused" } },
    ],
  };
}

function outerDisplay(order: "forward" | "reversed"): WorkflowOperationDisplayDeclaration {
  const operationNodes = order === "forward"
    ? [
      { id: "first-search-operation", kind: "operation" as const, invocationId: "first-search" },
      { id: "second-search-operation", kind: "operation" as const, invocationId: "second-search" },
    ]
    : [
      { id: "second-search-operation", kind: "operation" as const, invocationId: "second-search" },
      { id: "first-search-operation", kind: "operation" as const, invocationId: "first-search" },
    ];
  return {
    capability: "complete",
    version: OPERATION_DISPLAY_FORMAT_VERSION,
    transforms: [{
      id: "search-summary",
      input: z.strictObject({ first: EidSchema, second: EidSchema, mode: z.string().min(1) }),
      output: z.strictObject({ text: z.string().min(1) }),
      inputs: [
        { id: "first", inputPath: "first", value: { kind: "run-input", path: "firstEid" } },
        { id: "second", inputPath: "second", value: { kind: "run-input", path: "secondEid" } },
        {
          id: "mode",
          inputPath: "mode",
          value: {
            kind: "configuration",
            key: "explorer.search.mode",
            schema: z.string().min(1),
            example: "normal",
          },
        },
      ],
      example: { first: "10800000", second: "10800001", mode: "normal" },
      derive: (value) => {
        const input = z.strictObject({ first: EidSchema, second: EidSchema, mode: z.string().min(1) }).parse(value);
        return { text: `${input.mode}:${input.first}/${input.second}` };
      },
    }],
    invocations: [
      searchInvocation("first-search", "first-search", "firstEid"),
      searchInvocation("second-search", "second-search", "secondEid"),
    ],
    presentation: [{
      id: "search-session",
      kind: "session-lifecycle",
      children: operationNodes,
    }, {
      id: "selection-outcome",
      kind: "branch",
      outcomes: [{
        id: "first-resolved",
        label: "First search resolved",
        when: {
          kind: "equals",
          value: { kind: "task-output", entryId: "first-search", path: "selection.status" },
          expected: "resolved",
        },
        continuation: "delegate-child-a",
      }],
    }, {
      id: "summary-ready",
      kind: "verify",
      outcomes: [{
        id: "summary-present",
        label: "Search summary present",
        when: {
          kind: "is-present",
          value: { kind: "transformation", transformId: "search-summary", path: "text" },
        },
      }],
    }, {
      id: "delegate-child-a",
      kind: "delegate",
      entryId: "child-a",
      targetWorkflowId: DISPLAY_CHILD_A_ID,
    }, {
      id: "delegate-child-b",
      kind: "delegate",
      entryId: "child-b",
      targetWorkflowId: DISPLAY_CHILD_B_ID,
    }, {
      id: "child-a-finished",
      kind: "verify",
      outcomes: [{
        id: "child-a-output-present",
        label: "Child A returned a state",
        when: {
          kind: "is-present",
          value: { kind: "child-output", entryId: "child-a", path: "nestedState" },
        },
      }],
    }],
  };
}

function outerWorkflow(id: string, order: "forward" | "reversed" | undefined) {
  return defineWorkflow({
    id,
    version: 1,
    code: "fdo",
    label: "Operation Display Parent",
    icon: "Search",
    category: "operations",
    input: DisplayInput,
    canonicalInput: DisplayCanonicalInput,
    inputSubject: "eid",
    surface: { shape: "single" },
    enqueue: "reject-active",
    actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {},
    details: [],
    identity: { matchKey: (input) => `parent:${input.firstEid}/${input.secondEid}` },
    presentation: { title: () => "Operation display parent" },
    scenarios: ["fixture-operation-display/parent"],
    role: defineWorkflowRole({ kind: "standalone" }),
    ...(order === undefined ? {} : { operationDisplay: outerDisplay(order) }),
    steps: ({ task, delegate, result }) => {
      const first = task({
        id: "first-search",
        contract: SearchPersonOrg,
        label: "First search",
        replay: "checkpoint",
      }, [], ({ input }) => ({ kind: "by-eid" as const, emplId: input.firstEid }));
      const second = task({
        id: "second-search",
        contract: SearchPersonOrg,
        label: "Second search",
        replay: "checkpoint",
      }, [first], ({ input }) => ({ kind: "by-eid" as const, emplId: input.secondEid }));
      const childA = delegate({
        id: "child-a",
        label: "Child A",
        target: ChildARef,
        edgeId: "fixture-display-child-a",
        cardinality: "one",
        await: "terminal",
        join: "one",
        policy: DelegationPolicy,
      }, [second], {
        bind: ({ input }) => input,
        deriveChildItemId: () => ItemIdSchema.parse("00000000-0000-4000-8000-000000000da2"),
      });
      const childB = delegate({
        id: "child-b",
        label: "Child B",
        target: ChildBRef,
        edgeId: "fixture-display-child-b",
        cardinality: "one",
        await: "terminal",
        join: "one",
        policy: DelegationPolicy,
      }, [first], {
        bind: ({ input }) => input,
        deriveChildItemId: () => ItemIdSchema.parse("00000000-0000-4000-8000-000000000da3"),
      });
      return {
        steps: [[{ key: "display", label: "Display" }, [first, second, childA, childB]]],
        result: result(DisplayResult, [], () => ({ done: true })),
      };
    },
  });
}

const forwardWorkflow = outerWorkflow(DISPLAY_FORWARD_ID, "forward");
const reversedWorkflow = outerWorkflow(DISPLAY_REVERSED_ID, "reversed");
const legacyWorkflow = outerWorkflow(DISPLAY_LEGACY_ID, undefined);
const displayManifest = fixtureBuildManifest([
  DISPLAY_NESTED_ID,
  DISPLAY_CHILD_A_ID,
  DISPLAY_CHILD_B_ID,
  DISPLAY_FORWARD_ID,
  DISPLAY_REVERSED_ID,
  DISPLAY_LEGACY_ID,
]);

function compileDisplayWorkflow(definition: Parameters<typeof compileWorkflow>[0]) {
  return compileWorkflow(definition, { manifest: displayManifest });
}

const SearchEntry = {
  id: "search",
  kind: "task" as const,
  dependsOn: [],
  contracts: [{ role: "task" as const, contract: SearchPersonOrg }],
  output: SearchPersonOrg.output,
};

function minimalDisplay(): WorkflowOperationDisplayDeclaration {
  return {
    capability: "complete",
    version: OPERATION_DISPLAY_FORMAT_VERSION,
    invocations: [searchInvocation("search-operation", "search", "firstEid")],
    presentation: [{
      id: "search-session",
      kind: "session-lifecycle",
      children: [{ id: "search-operation-node", kind: "operation", invocationId: "search-operation" }],
    }],
  };
}

function compileMinimal(
  declaration: WorkflowOperationDisplayDeclaration,
  entries: readonly WorkflowOperationEntryProjection[] = [SearchEntry],
) {
  return compileWorkflowOperationDisplay({
    workflowId: "fixture-operation-display-negative",
    input: DisplayInput,
    entries,
    declaration,
  });
}

function withReference(value: WorkflowValueReference): WorkflowOperationDisplayDeclaration {
  const declaration = minimalDisplay();
  return {
    ...declaration,
    presentation: [...declaration.presentation, {
      id: "reference-check",
      kind: "verify",
      outcomes: [{
        id: "reference-present",
        label: "Reference is present",
        when: { kind: "is-present", value },
      }],
    }],
  };
}

describe("workflow operation display declarations", () => {
  it("binds a fill field to its exact task-owned template and refuses invented associations", () => {
    const fill = operation.actions.find((action) => action.id === "fill-eid");
    if (fill === undefined) throw new Error("SearchPersonOrg fill-eid missing");
    const bound = { ...operation, actions: operation.actions.map((action) => action === fill ? { ...action, templateId: "search-summary" } : action) };
    expect(() => assertTaskOperationDeclaration(bound, SearchPersonOrg)).not.toThrow();
    expect(() => assertTaskOperationDeclaration({ ...bound, actions: [{ ...fill, templateId: "invented" }] }, SearchPersonOrg)).toThrow(/references missing template "invented"/u);
    expect(() => assertTaskOperationDeclaration({ ...bound, actions: [{ ...fill, kind: "read-field", templateId: "search-summary" }] }, SearchPersonOrg)).toThrow(/cannot declare a fill template/u);
  });

  it("freezes the template-to-field reference and rejects corrupt or digest-altered historical bindings", () => {
    const bound = { ...operation, actions: operation.actions.map((action) => action.id === "fill-eid" ? { ...action, templateId: "search-summary" } : action) };
    const display = compileMinimal(minimalDisplay(), [{ ...SearchEntry, contracts: [{ role: "task", contract: { ...SearchPersonOrg, operation: bound } }] }]);
    const identity = { workflowId: "fixture-operation-display-negative", definitionFingerprint: "a".repeat(64) };
    const snapshot = freezeWorkflowOperationDisplaySnapshot({ ...identity, display });
    if (snapshot === undefined) throw new Error("complete template fixture snapshot missing");
    expect(snapshot.invocations[0]?.operation.actions.find((action) => action.id === "fill-eid")?.templateId).toBe("search-summary");
    expect(requireWorkflowOperationDisplaySnapshot(snapshot, identity)).toEqual(snapshot);
    const changed = (templateId: string | undefined, kind = "fill-field") => ({ ...snapshot, invocations: snapshot.invocations.map((invocation) => ({ ...invocation, operation: { ...invocation.operation, actions: invocation.operation.actions.map((action) => {
      if (action.id !== "fill-eid") return action;
      const { templateId: originalTemplateId, ...unbound } = action;
      expect(originalTemplateId).toBe("search-summary");
      return { ...unbound, kind, ...(templateId === undefined ? {} : { templateId }) };
    }) } })) });
    expect(WorkflowOperationDisplaySnapshotSchema.safeParse(changed("invented")).success).toBe(false);
    expect(WorkflowOperationDisplaySnapshotSchema.safeParse(changed("search-summary", "read-field")).success).toBe(false);
    expect(() => requireWorkflowOperationDisplaySnapshot(changed(undefined), identity)).toThrow(/digest/u);
  });

  it("freezes a human invocation label from the sealed entry and protects its digest", () => {
    const display = compileMinimal(minimalDisplay(), [{ ...SearchEntry, label: "Find employee" }]);
    const snapshot = freezeWorkflowOperationDisplaySnapshot({ workflowId: "fixture-operation-display-negative", definitionFingerprint: FingerprintSchema.parse("a".repeat(64)), display });
    expect(snapshot?.invocations[0]?.label).toBe("Find employee");
    expect(() => requireWorkflowOperationDisplaySnapshot({ ...snapshot, invocations: snapshot?.invocations.map((item) => ({ ...item, label: "Different" })) }, { workflowId: "fixture-operation-display-negative", definitionFingerprint: "a".repeat(64) })).toThrow(/digest/u);
  });
  it("admits optional exact computed output slots and refuses undeclared or input slots", () => {
    const computed: TaskOperationDeclaration = { version: 1, id: "computed-result", system: "local", session: { kind: "local", id: "computed-local" }, values: [
      { id: "result", presentation: "local-operator", source: { kind: "contract-output", path: "selection.status" } },
      { id: "input", source: { kind: "contract-input", path: "kind" } },
    ], transforms: [{ id: "derive-result", input: z.strictObject({ text: z.string() }), output: z.strictObject({ result: z.string() }), example: { text: "resolved" }, derive: (input) => ({ result: z.strictObject({ text: z.string() }).parse(input).text }) }], actions: [{ id: "compute-result", kind: "compute", transform: "derive-result", valueSlot: "result" }] };
    const contract = { id: "ocr/extract-form-page", input: SearchPersonOrg.input, output: SearchPersonOrg.output };
    expect(() => assertTaskOperationDeclaration(computed, contract)).not.toThrow();
    expect(() => assertTaskOperationDeclaration({ ...computed, actions: [{ ...computed.actions[0], valueSlot: undefined }] }, contract)).not.toThrow();
    for (const valueSlot of ["missing", "input"]) expect(() => assertTaskOperationDeclaration({ ...computed, actions: [{ ...computed.actions[0], valueSlot }] }, contract)).toThrow(/declared contract-output value slot/u);
  });

  it("models every required action kind and renders task-owned templates without scenario coupling", () => {
    expect(OPERATION_ACTION_KINDS).toEqual([
      "open-page",
      "resume-page",
      "click",
      "keypress",
      "read-field",
      "fill-field",
      "select-field",
      "check-field",
      "compute",
      "verify",
      "branch",
      "join",
      "operator-gate",
      "delegate",
      "session-lifecycle",
    ]);
    const template = operation.templates?.find(({ id }) => id === "search-summary");
    expect(template).toBeDefined();
    if (template === undefined) throw new Error("SearchPersonOrg search-summary template is missing");
    expect(renderOperationTemplate(template, { kind: "by-eid" })).toBe("Search mode: by-eid");
    expect(Object.hasOwn(operation, "scenarios")).toBe(false);
  });

  it("compiles reusable task operations at two occurrences with two child workflows and one nested child", () => {
    const nested = compileDisplayWorkflow(nestedWorkflow);
    const childA = compileDisplayWorkflow(childAWorkflow);
    const childB = compileDisplayWorkflow(childBWorkflow);
    const parent = compileDisplayWorkflow(forwardWorkflow);

    expect(nested.operationDisplay).toMatchObject({ capability: "complete", version: 1 });
    expect(childA.operationDisplay).toMatchObject({ capability: "complete", version: 1 });
    expect(childB.operationDisplay).toMatchObject({ capability: "complete", version: 1 });
    expect(parent.operationDisplay).toMatchObject({ capability: "complete", version: 1 });
    if (parent.operationDisplay.capability !== "complete") throw new Error("parent display did not compile");
    expect(parent.descriptor.operationDisplay).toBe(parent.operationDisplay);
    expect(parent.operationDisplay.invocations.map(({ id, occurrencePath, operation: taskOperation }) => ({
      id,
      occurrencePath,
      operation: taskOperation.id,
    }))).toEqual([
      { id: "first-search", occurrencePath: ["first-search"], operation: "person-org-search" },
      { id: "second-search", occurrencePath: ["second-search"], operation: "person-org-search" },
    ]);
    expect(parent.operationDisplay.presentation
      .flatMap((node) => node.kind === "session-lifecycle" ? node.children ?? [] : [])
      .map(({ invocationId }) => invocationId))
      .toEqual(["first-search", "second-search"]);
    expect(parent.operationDisplay.execution).toEqual([
      { entryId: "first-search", dependsOn: [] },
      { entryId: "second-search", dependsOn: ["first-search"] },
      { entryId: "child-a", dependsOn: ["second-search"] },
      { entryId: "child-b", dependsOn: ["first-search"] },
    ]);
  });

  it("leaves execution dependencies unchanged when only display presentation order changes", () => {
    const forward = compileDisplayWorkflow(forwardWorkflow);
    const reversed = compileDisplayWorkflow(reversedWorkflow);
    if (forward.operationDisplay.capability !== "complete" || reversed.operationDisplay.capability !== "complete") {
      throw new Error("complete display fixture compiled as legacy");
    }
    const presentationOrder = (display: typeof forward.operationDisplay) => display.presentation
      .flatMap((node) => node.kind === "session-lifecycle" ? node.children ?? [] : [])
      .map(({ invocationId }) => invocationId);
    const dependencies = (definition: typeof forwardWorkflow) => descriptorRuntimeNodes(
      compileDisplayWorkflow(definition).descriptor,
    ).map((node) => ({ id: String(node.id), dependsOn: node.dependsOn.map(String) }));

    expect(presentationOrder(forward.operationDisplay)).toEqual(["first-search", "second-search"]);
    expect(presentationOrder(reversed.operationDisplay)).toEqual(["second-search", "first-search"]);
    expect(reversed.operationDisplay.execution).toEqual(forward.operationDisplay.execution);
    expect(dependencies(reversedWorkflow)).toEqual(dependencies(forwardWorkflow));
  });

  it("marks a definition without the optional declaration as legacy without changing its descriptor", () => {
    const legacy = compileDisplayWorkflow(legacyWorkflow);
    expect(legacy.operationDisplay).toEqual({ capability: "legacy", version: 0 });
    expect(legacy.descriptor.operationDisplay).toBeUndefined();
  });

  it("mints, reopens, and integrity-checks a redacted serializable complete display snapshot", () => {
    const compiled = compileDisplayWorkflow(forwardWorkflow);
    const snapshot = freezeWorkflowOperationDisplaySnapshot({
      workflowId: compiled.descriptor.id,
      definitionFingerprint: compiled.descriptor.contractFingerprint,
      display: compiled.descriptor.operationDisplay,
    });
    expect(snapshot).toMatchObject({
      capability: "complete",
      declarationVersion: OPERATION_DISPLAY_FORMAT_VERSION,
      snapshotVersion: 2,
      workflowId: DISPLAY_FORWARD_ID,
      definitionFingerprint: compiled.descriptor.contractFingerprint,
    });
    if (snapshot === undefined) throw new Error("complete descriptor did not produce a snapshot");
    expect(snapshot.invocations.map(({ taskId }) => taskId)).toEqual([
      SearchPersonOrg.id,
      SearchPersonOrg.id,
    ]);
    expect(requireWorkflowOperationDisplaySnapshot(snapshot, {
      workflowId: compiled.descriptor.id,
      definitionFingerprint: compiled.descriptor.contractFingerprint,
    })).toEqual(snapshot);

    const serialized = canonicalJsonStringify(snapshot);
    expect(serialized).not.toContain("\"example\"");
    expect(serialized).not.toContain("10800000");
    expect(serialized).not.toContain("\"normal\"");
    const historical = requireWorkflowOperationDisplaySnapshot(JSON.parse(serialized), {
      workflowId: compiled.descriptor.id,
      definitionFingerprint: compiled.descriptor.contractFingerprint,
    });
    const taskCondition = historical.invocations[0]?.operation.actions
      .find(({ id }) => id === "choose-search-mode")?.outcomes?.[0]?.when;
    expect(taskCondition).toMatchObject({
      kind: "equals",
      variable: "search-kind",
      value: "by-eid",
    });
    const workflowCondition = historical.presentation
      .find(({ id }) => id === "selection-outcome")?.outcomes?.[0]?.when;
    expect(workflowCondition).toMatchObject({
      kind: "equals",
      expected: "resolved",
    });
    const configurationReference = snapshot.transforms[0]?.inputs[2]?.value;
    if (configurationReference?.kind !== "configuration") throw new Error("configuration reference was not frozen");
    expect(configurationReference.key).toBe("explorer.search.mode");
    expect(configurationReference.schemaHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(configurationReference).not.toHaveProperty("example");
    const constantReference = snapshot.invocations[0]?.bindings[0]?.value;
    if (constantReference?.kind !== "constant") throw new Error("constant reference was not redacted");
    expect(constantReference.valueDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(constantReference).not.toHaveProperty("value");

    const protectedComparison = {
      ...snapshot,
      invocations: snapshot.invocations.map((invocation) => ({
        ...invocation,
        operation: {
          ...invocation.operation,
          actions: invocation.operation.actions.map((action) => action.id === "choose-search-mode"
            ? {
              ...action,
              outcomes: action.outcomes?.map((outcome) => outcome.id === "by-eid"
                ? { ...outcome, when: { ...outcome.when, value: "10800000" } }
                : outcome),
            }
            : action),
        },
      })),
    };
    expect(WorkflowOperationDisplaySnapshotSchema.safeParse(protectedComparison).success).toBe(false);

    expect(() => requireWorkflowOperationDisplaySnapshot(undefined, {
      workflowId: compiled.descriptor.id,
      definitionFingerprint: compiled.descriptor.contractFingerprint,
    })).toThrow(/missing its frozen operation display snapshot/u);
    expect(() => requireWorkflowOperationDisplaySnapshot({
      ...snapshot,
      contentDigest: "0".repeat(64),
    }, {
      workflowId: compiled.descriptor.id,
      definitionFingerprint: compiled.descriptor.contractFingerprint,
    })).toThrow(/corrupt frozen operation display snapshot digest/u);
  });

  it("serves the exact compiled complete structure through the real Explorer projection", () => {
    const compiled = compileDisplayWorkflow(forwardWorkflow);
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

  it("attaches the complete snapshot when buildQueuedRun mints the immutable envelope", () => {
    const compiled = compileDisplayWorkflow(forwardWorkflow);
    const run = buildQueuedRun({
      descriptor: compiled.descriptor,
      appVersion: "0.1.0",
      runId: "aaaaaaaa-0001-4000-8000-000100000000",
      itemId: "aaaaaaaa-0002-4000-8000-000200000000",
      traceId: "fdo-170000-aaaa",
      rawInput: { firstEid: "10800000", secondEid: "10800001" },
      canonicalInput: {
        schemaHash: deriveSchemaHash(DisplayCanonicalInput, "output"),
        value: { firstEid: "10800000", secondEid: "10800001" },
      },
      ingressSchemaHash: deriveSchemaHash(DisplayInput, "input"),
      configFingerprint: "a".repeat(64),
      configSnapshotId: "aaaaaaaa-0003-4000-8000-000300000000",
      resolvedInstance: { ucpath: "prod" },
      shape: "single",
      priority: "bulk",
      dryRun: false,
      attempt: 1,
      runNumber: 1,
      now: "2026-09-27T12:00:00.000Z",
    });
    const snapshot = run.envelope.operationDisplaySnapshot;
    expect(snapshot).toBeDefined();
    expect(requireWorkflowOperationDisplaySnapshot(snapshot, {
      workflowId: compiled.descriptor.id,
      definitionFingerprint: compiled.descriptor.contractFingerprint,
    }).contentDigest).toBe(snapshot?.contentDigest);
    if (snapshot === undefined) throw new Error("complete run envelope has no snapshot");
    expect(() => RunEnvelopeSchema.parse({
      ...run.envelope,
      operationDisplaySnapshot: { ...snapshot, contentDigest: "0".repeat(64) },
    })).toThrow(/corrupt frozen operation display snapshot digest/u);
  });
});

describe("operation display compiler refusals", () => {
  it("refuses duplicate operation ids and continuation cycles", () => {
    const duplicate = minimalDisplay();
    const first = duplicate.invocations[0];
    if (first === undefined) throw new Error("negative fixture lost its invocation");
    expect(() => compileMinimal({
      ...duplicate,
      invocations: [...duplicate.invocations, first],
    })).toThrow(/repeats invocation "search-operation"/u);

    const cyclic = minimalDisplay();
    expect(() => compileMinimal({
      ...cyclic,
      presentation: [...cyclic.presentation, {
        id: "first-branch",
        kind: "branch",
        outcomes: [{
          id: "to-second",
          label: "To second",
          when: { kind: "is-present", value: { kind: "run-input", path: "firstEid" } },
          continuation: "second-branch",
        }],
      }, {
        id: "second-branch",
        kind: "branch",
        outcomes: [{
          id: "to-first",
          label: "To first",
          when: { kind: "is-present", value: { kind: "run-input", path: "secondEid" } },
          continuation: "first-branch",
        }],
      }],
    })).toThrow(/continuation cycle/u);
  });

  it.each([
    ["run input", withReference({ kind: "run-input", path: "missing" }), /unknown schema field missing/u],
    ["task output", withReference({ kind: "task-output", entryId: "missing", path: "selection.status" }), /unavailable entry "missing"/u],
    ["transformation", withReference({ kind: "transformation", transformId: "missing", path: "text" }), /unavailable transform "missing"/u],
    ["child output", withReference({ kind: "child-output", entryId: "missing-child", path: "done" }), /unavailable entry "missing-child"/u],
  ])("refuses an unavailable %s reference", (_kind, declaration, message) => {
    expect(() => compileMinimal(declaration)).toThrow(message);
  });

  it("refuses malformed configuration and constant references", () => {
    const invalidConfiguration = minimalDisplay();
    expect(() => compileMinimal({
      ...invalidConfiguration,
      transforms: [{
        id: "bad-config",
        input: z.strictObject({ value: z.string() }),
        output: z.strictObject({ value: z.string() }),
        inputs: [{
          id: "value",
          inputPath: "value",
          value: { kind: "configuration", key: "explorer.mode", schema: z.string(), example: 7 },
        }],
        example: { value: "normal" },
        derive: (value) => value,
      }],
    })).toThrow();

    const invalidConstant = minimalDisplay();
    expect(() => compileMinimal({
      ...invalidConstant,
      transforms: [{
        id: "bad-constant",
        input: z.strictObject({ value: z.string() }),
        output: z.strictObject({ value: z.string() }),
        inputs: [{
          id: "value",
          inputPath: "value",
          value: { kind: "constant", value: undefined },
        }],
        example: { value: "normal" },
        derive: (value) => value,
      }],
    })).toThrow();
  });

  it("refuses wrong systems, missing template variables, invalid branch targets and invalid page continuations", () => {
    const wrongSystem = { ...operation, system: "crm" } as unknown as TaskOperationDeclaration;
    expect(() => assertTaskOperationDeclaration(wrongSystem, SearchPersonOrg)).toThrow(/belongs to "ucpath"/u);

    const template = operation.templates?.[0];
    if (template === undefined) throw new Error("SearchPersonOrg must carry a template for this refusal fixture");
    const missingTemplateVariable = {
      ...operation,
      templates: [{
        ...template,
        segments: [{ kind: "variable" as const, variable: "missing" }],
      }],
    } as TaskOperationDeclaration;
    expect(() => assertTaskOperationDeclaration(missingTemplateVariable, SearchPersonOrg))
      .toThrow(/references missing template variable "missing"/u);

    const invalidTarget = minimalDisplay();
    expect(() => compileMinimal({
      ...invalidTarget,
      presentation: [...invalidTarget.presentation, {
        id: "bad-branch",
        kind: "branch",
        outcomes: [{
          id: "unknown-target",
          label: "Unknown target",
          when: { kind: "is-present", value: { kind: "run-input", path: "firstEid" } },
          continuation: "not-present",
        }],
      }],
    })).toThrow(/invalid branch target "not-present"/u);

    const invalidContinuation = {
      ...operation,
      actions: [...operation.actions, {
        id: "resume-missing-page",
        kind: "resume-page",
        page: { screen: UCPATH_PERSON_ORG_SEARCH_SCREEN, form: "person-org-search" },
        continuedFrom: "not-opened",
      }],
    } as TaskOperationDeclaration;
    expect(() => assertTaskOperationDeclaration(invalidContinuation, SearchPersonOrg))
      .toThrow(/invalid page continuation "not-opened"/u);

    const taskActionInComposition = minimalDisplay();
    expect(() => compileMinimal({
      ...taskActionInComposition,
      presentation: [...taskActionInComposition.presentation, {
        id: "redeclared-click",
        kind: "click",
      } as unknown as typeof taskActionInComposition.presentation[number]],
    })).toThrow(/cannot redeclare a task action/u);
  });

  it("refuses a delegate presentation that names an unavailable child workflow", () => {
    const declaration = minimalDisplay();
    expect(() => compileMinimal({
      ...declaration,
      presentation: [...declaration.presentation, {
        id: "wrong-child",
        kind: "delegate",
        entryId: "child",
        targetWorkflowId: DISPLAY_CHILD_A_ID,
      }],
    }, [
      SearchEntry,
      {
        id: "child",
        kind: "delegate" as const,
        dependsOn: [],
        contracts: [],
        child: { workflowId: DISPLAY_CHILD_B_ID, result: ChildBResult },
      },
    ])).toThrow(/targets unavailable child/u);
  });

  it("accepts only the explicit legacy capability when no complete declaration is supplied", () => {
    const legacy = compileWorkflowOperationDisplay({
      workflowId: "fixture-operation-display-legacy",
      input: DisplayInput,
      entries: [SearchEntry],
    } satisfies WorkflowOperationDisplayCompileInput);
    expect(legacy).toEqual({ capability: "legacy", version: 0 });
  });

  it("refuses a hand-authored descriptor projection outside the compiler", () => {
    expect(() => assertCompiledWorkflowOperationDisplay({
      capability: "complete",
      version: OPERATION_DISPLAY_FORMAT_VERSION,
      transforms: [],
      invocations: [],
      presentation: [],
      execution: [],
    })).toThrow(/compiler-produced complete projection/u);
  });
});


describe("exact pure transformation inputs", () => {
  it("executes the declared derive and retains both equal-valued producer identities", () => {
    const base = minimalDisplay();
    const invocation = base.invocations[0];
    const transform = { id: "selection-eid", input: z.strictObject({ left: z.string(), right: z.string() }), output: z.strictObject({ eid: EidSchema }),
      inputs: [ { id: "left", inputPath: "left", value: { kind: "task-output" as const, entryId: "left", path: "selection.status" } },
        { id: "right", inputPath: "right", value: { kind: "task-output" as const, entryId: "right", path: "selection.status" } } ],
      example: { left: "resolved", right: "resolved" }, derive: (value: unknown) => {
        const parsed = z.strictObject({ left: z.string(), right: z.string() }).parse(value);
        return { eid: parsed.left === "resolved" && parsed.right === "resolved" ? "10800000" : "10800001" };
      } };
    const display = compileWorkflowOperationDisplay({ workflowId: DISPLAY_FORWARD_ID, input: DisplayInput,
      entries: [{ ...SearchEntry, id: "left" }, { ...SearchEntry, id: "right" }, { ...SearchEntry, dependsOn: ["left", "right"] }],
      declaration: { ...base, transforms: [transform], invocations: [
        searchInvocation("left-operation", "left", "firstEid"), searchInvocation("right-operation", "right", "secondEid"),
        { ...invocation, bindings: invocation.bindings?.map((binding) => binding.slot === "empl-id" ? { ...binding, value: { kind: "transformation" as const, transformId: transform.id, path: "eid" } } : binding) },
      ], presentation: [ { id: "left-node", kind: "operation", invocationId: "left-operation" }, { id: "right-node", kind: "operation", invocationId: "right-operation" }, ...base.presentation ] } });
    if (display.capability !== "complete") throw new Error("fixture display incomplete");
    const snapshot = freezeWorkflowOperationDisplaySnapshot({ workflowId: DISPLAY_FORWARD_ID, definitionFingerprint: FingerprintSchema.parse("a".repeat(64)), display });
    const identity = (nodeId: string) => DeclaredActionIdentitySchema.parse({ runId: "aaaaaaaa-0001-4000-8000-000100000000", definitionFingerprint: "a".repeat(64),
      nodeId, taskId: SearchPersonOrg.id, attempt: 1, claimGeneration: 1, taskAttempt: 1, invocationId: `${nodeId}-operation`, occurrencePath: [nodeId], logicalActionId: "read-selection",
      occurrence: 1, logicalSessionId: operation.session.id, physicalSessionId: "aaaaaaaa-0002-4000-8000-000200000000", state: "completed" });
    const sources = new Map([ ["left/selection.status", { identity: identity("left"), value: "resolved" }], ["right/selection.status", { identity: identity("right"), value: "resolved" }] ]);
    const create = () => createDeclaredActionBinder({ snapshot, runId: identity("left").runId, attempt: 1, claimGeneration: 1, taskAttempt: 1,
      nodeId: "search", taskId: SearchPersonOrg.id, contractRole: "task", parsedInput: { kind: "by-eid", emplId: "10800000" }, protectedBindings: [], sources,
      transforms: display.transforms, runInput: { firstEid: "10800000", secondEid: "10800001" }, outputs: { left: { selection: { status: "resolved" } }, right: { selection: { status: "resolved" } } } });
    const action = { kind: "typed" as const, targetId: "ucpath.person-org.eid-input", value: "10800000", physicalSessionId: identity("left").physicalSessionId };
    const observed = create()(action).operation?.value?.producer;
    expect(observed?.kind).toBe("transformation");
    if (observed?.kind !== "transformation") throw new Error("fixture producer missing");
    expect(observed.inputs?.map((input) => input.identities[0]?.nodeId)).toEqual(["left", "right"]);
    const capturedOccurrence = create()(action).operation;
    if (capturedOccurrence?.value === undefined) throw new Error("fixture value missing");
    const wire = { state: "observed", runId: capturedOccurrence.runId, definition: snapshot, observations: [{ logId: "aaaaaaaa-0009-4000-8000-000900000000", at: "2026-08-03T09:00:00.000Z", action: "typed", targetId: action.targetId, occurrence: { ...capturedOccurrence, value: { slot: capturedOccurrence.value.slot, fieldPath: capturedOccurrence.value.fieldPath, producer: observed, state: "observed", classification: "local-operator", value: "10800000" } } }] };
    expect(ObservedOperationStructureWireSchema.safeParse(wire).success).toBe(true);
    const swapped = { ...observed, inputs: observed.inputs?.map((input) => input.inputId !== "left" ? input : { ...input, identities: input.identities.map((identity) => ({ ...identity, logicalActionId: "read-rows" })) }) };
    expect(ObservedOperationStructureWireSchema.safeParse({ ...wire, observations: wire.observations.map((observation) => ({ ...observation, occurrence: { ...observation.occurrence, value: { ...observation.occurrence.value, producer: swapped } } })) }).success).toBe(false);

    expect(() => create()({ ...action, value: "10800001" })).toThrow(/does not match declared field path/u);
    sources.set("right/selection.status", { identity: identity("left"), value: "resolved" });
    const ambiguous = create()(action).operation?.value?.producer;
    if (ambiguous?.kind !== "transformation") throw new Error("fixture producer missing");
    expect(ambiguous.inputs?.[1]).toMatchObject({ state: "unavailable", identities: [] });
    expect(create()(action).operation?.value?.consumed.state).toBe("withheld");
  });
});


it("refuses undeclared read roles, transform cycles and invocation continuation targets", () => {
  const declaration = minimalDisplay();
  expect(() => compileMinimal({ ...declaration, invocations: declaration.invocations.map((invocation) => ({ ...invocation, contractRole: "probe" })) })).toThrow(/unavailable contract occurrence search\/probe/u);
  const schema = z.strictObject({ text: z.string() });
  const transform = (id: string, target: string) => ({ id, input: schema, output: schema, inputs: [{ id: "text", inputPath: "text", value: { kind: "transformation" as const, transformId: target, path: "text" } }], example: { text: "sample" }, derive: (value: unknown) => schema.parse(value) });
  expect(() => compileMinimal({ ...declaration, transforms: [transform("first", "second"), transform("second", "first")] })).toThrow(/transformation cycle/u);
  expect(() => compileMinimal({ ...declaration, invocations: declaration.invocations.map((invocation) => ({ ...invocation, outcomes: [{ id: "done", label: "Done", when: { kind: "is-present" as const, value: { kind: "run-input" as const, path: "firstEid" } }, continuation: "missing" }] })) })).toThrow(/invalid branch target/u);
});

it("retains historical v2 snapshot digest when optional classification and result sources are absent", () => {
  const display = compileMinimal(minimalDisplay());
  const frozen = freezeWorkflowOperationDisplaySnapshot({ workflowId: DISPLAY_FORWARD_ID, definitionFingerprint: FingerprintSchema.parse("a".repeat(64)), display });
  if (frozen === undefined) throw new Error("fixture snapshot missing");
  const { contentDigest: _digest, resultSources: _sources, ...payload } = frozen;
  const historical = { ...payload, invocations: payload.invocations.map((invocation) => ({ ...invocation, operation: { ...invocation.operation, values: invocation.operation.values?.map(({ presentation: _presentation, ...slot }) => slot) } })) };
  const digest = sha256Hex(`hrauto:operation-display-snapshot:v2\0${canonicalJsonStringify(historical)}`);
  expect(requireWorkflowOperationDisplaySnapshot({ ...historical, contentDigest: digest }, { workflowId: DISPLAY_FORWARD_ID, definitionFingerprint: "a".repeat(64) }).contentDigest).toBe(digest);
  expect(WorkflowOperationDisplaySnapshotSchema.parse({ ...historical, contentDigest: digest })).toEqual({ ...historical, contentDigest: digest });
});


it("compiles a sealed transaction probe role and refuses missing, mismatched, duplicate or unavailable read contracts", () => {
  const declaration = (id: string) => ({ version: 1 as const, id, system: "ucpath" as const, session: { kind: "browser" as const, id: "role-browser", system: "ucpath" as const }, actions: [{ id: "verify", kind: "verify" as const }] });
  const { __sealed: _prepareSeal, ...prepareSpec } = WriteFixturePrepare;
  const { __sealed: _commitSeal, ...commitSpec } = WriteFixtureCommit;
  const { __sealed: _probeSeal, ...probeSpec } = WriteFixtureProbe;
  const { __sealed: _wrongSeal, ...wrongSpec } = WriteFixtureVerify;
  const prepare = defineTaskContract({ ...prepareSpec, operation: declaration("prepare-operation") });
  const commit = defineTaskContract({ ...commitSpec, operation: declaration("commit-operation") });
  const probe = defineTaskContract({ ...probeSpec, operation: declaration("probe-operation") });
  const wrong = defineTaskContract({ ...wrongSpec, operation: declaration("wrong-operation") });
  const reads = [{ entryId: "write", role: "probe" as const, contract: probe }];
  const build = (transactionReads: typeof reads) => compileWorkflow(defineWorkflow({ ...outerWorkflow(DISPLAY_FORWARD_ID, undefined), operationDisplay: { capability: "complete", version: 1, transactionReads,
    invocations: (["probe", "prepare", "commit"] as const).map((contractRole) => ({ id: `${contractRole}-invocation`, entryId: "write", contractRole, occurrencePath: ["write", contractRole] })),
    presentation: (["probe", "prepare", "commit"] as const).map((role) => ({ id: `${role}-node`, kind: "operation" as const, invocationId: `${role}-invocation` })) },
    steps: ({ transaction, result }) => {
      const write = transaction({ id: "write", prepare, commit, dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 1000 }, [], { prepareBind: ({ input }) => ({ eid: input.firstEid }), commitBind: ({ input }) => ({ eid: input.firstEid }) });
      return { steps: [[{ key: "write", label: "Write" }, [write]]], result: result(z.strictObject({ done: z.boolean() }), [], () => ({ done: true })) };
    } }), { manifest: fixtureBuildManifest([DISPLAY_FORWARD_ID]) });
  expect(build(reads).descriptor.operationDisplay?.capability).toBe("complete");
  expect(() => build([])).toThrow(/requires one probe contract/u);
  expect(() => build([...reads, ...reads])).toThrow(/requires one probe contract/u);
  expect(() => build([{ ...reads[0], contract: wrong }])).toThrow(/does not match.*writeSafety/u);
  expect(() => build([{ ...reads[0], entryId: "missing" }])).toThrow(/unavailable transaction/u);
});
