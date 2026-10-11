import { describe,expect,it } from "vitest";
import { z } from "zod";
import { taskStoreRegistry } from "../../src/backend/app/registries/task-registry.js";
import { buildWorkflowExplorer } from "../../src/backend/runs/queries/explorer.js";
import { SearchPersonOrg } from "../../src/models/systems/ucpath/search-person-org.js";
import { defineCanonicalInput } from "../../src/models/workflow/canonical-input.js";
import {
freezeWorkflowOperationDisplaySnapshot
} from "../../src/models/workflow/operation-display-snapshot.js";
import type {
WorkflowOperationDisplayDeclaration
} from "../../src/models/workflow/operation-display.js";
import {
OPERATION_DISPLAY_FORMAT_VERSION
} from "../../src/models/workflow/operation-display.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../src/models/workflow/presentation.js";
import { EidSchema,FingerprintSchema,ItemIdSchema,WorkflowIdSchema } from "../../src/rules/identity/ids.js";
import { manualClock } from "../../src/rules/time/clock.js";
import { defineWorkflowRole } from "../../src/workflow-kit/validation/module-role.js";
import {
compileWorkflow,
composeWorkflowModule,
defineWorkflow,
} from "../../src/workflow-kit/workflow-definition.js";
import { explorerQueryDeps } from "../support/fixtures/explorer-seams.js";
import { fixtureBuildManifest } from "../support/fixtures/workflow-definition-fixtures.js";

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
const ChildAResult = z.strictObject({ nestedState: z.enum(["done", "failed", "cancelled", "blocked"]) });
const ChildBResult = z.strictObject({ approved: z.boolean() });
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

describe("workflow operation display declarations", () => {

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
});
