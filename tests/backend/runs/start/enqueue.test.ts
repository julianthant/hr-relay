import { describe,expect,it } from "vitest";
import { z } from "zod";
import { buildQueuedRun } from "../../../../src/backend/runs/start/enqueue.js";
import { RunEnvelopeSchema } from "../../../../src/models/run/envelope.js";
import { SearchPersonOrg } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import {
requireWorkflowOperationDisplaySnapshot
} from "../../../../src/models/workflow/operation-display-snapshot.js";
import type {
WorkflowOperationDisplayDeclaration
} from "../../../../src/models/workflow/operation-display.js";
import {
OPERATION_DISPLAY_FORMAT_VERSION
} from "../../../../src/models/workflow/operation-display.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { EidSchema,ItemIdSchema,WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import {
compileWorkflow,
defineWorkflow
} from "../../../../src/workflow-kit/workflow-definition.js";
import { fixtureBuildManifest } from "../../../support/fixtures/workflow-definition-fixtures.js";

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
        protectedBindings: [],
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
