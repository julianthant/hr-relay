import { createOperationDisplayFixtures } from "../../support/helpers/operation-display-fixtures.js";
import { describe, expect, it } from "vitest";
import { SearchPersonOrg } from "../../../src/models/systems/ucpath/search-person-org.js";
import { freezeWorkflowOperationDisplaySnapshot, requireWorkflowOperationDisplaySnapshot, WorkflowOperationDisplaySnapshotError, WorkflowOperationDisplaySnapshotSchema } from "../../../src/models/workflow/operation-display-snapshot.js";
import { OPERATION_DISPLAY_FORMAT_VERSION } from "../../../src/models/workflow/operation-display.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { compileWorkflow } from "../../../src/workflow-kit/workflow-definition.js";

const { DISPLAY_FORWARD_ID, outerWorkflow, displayManifest } = createOperationDisplayFixtures();


const operation = SearchPersonOrg.operation;
if (operation === undefined) throw new Error("SearchPersonOrg must declare its reusable display operation");

const forwardWorkflow = outerWorkflow(DISPLAY_FORWARD_ID, "forward");

function compileDisplayWorkflow(definition: Parameters<typeof compileWorkflow>[0]) {
  return compileWorkflow(definition, { manifest: displayManifest });
}

describe("workflow operation display declarations", () => {

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

    const identity = { workflowId: compiled.descriptor.id, definitionFingerprint: compiled.descriptor.contractFingerprint };
    for (const stored of [undefined, {}, { ...snapshot, workflowId: `${snapshot.workflowId}-other` }, { ...snapshot, contentDigest: "0".repeat(64) }]) {
      expect(() => requireWorkflowOperationDisplaySnapshot(stored, identity)).toThrow(WorkflowOperationDisplaySnapshotError);
    }
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
});
