/**
 * A task node's declared `when` (D228).
 *
 * The point of the declaration is that ONE value is both the rule the executor
 * applies and the sentence the explorer prints, so these cases pin the two
 * halves against each other and pin every way a condition can fail to resolve
 * — because "the field is missing" and "the condition is false" are different
 * facts, and a node that silently stops running is the failure this replaces.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { flow } from "../../../../src/base/flow.js";
import { defineWorkflowDescriptor } from "../../../../src/base/workflow.js";
import { EidSchema, FingerprintSchema } from "../../../../src/domain/ids.js";
import { defineCanonicalInput } from "../../../../src/domain/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/domain/workflow/presentation.js";
import { FixtureReadReceipt } from "../../../fixtures/descriptor-fixtures.js";
import type { NodeConditionSpec } from "../../../../src/domain/workflow/node-condition.js";
import {
  describeNodeCondition,
  evaluateNodeCondition,
  nodeConditionDependency,
  parseNodeCondition,
} from "../../../../src/domain/workflow/node-condition.js";

const SCOPE = {
  input: { includeCrmDates: true, mode: "terminate", note: null },
  outputs: {
    searching: { selection: { status: "resolved", selected: { emplId: "12345678" } } },
  },
} as const;

describe("a declared node condition", () => {
  it("renders every arm in words, from the same value the executor reads", () => {
    const cases = [
      [{ kind: "is-true", of: { from: "input", path: "includeCrmDates" } },
        "runs when the run's input field includeCrmDates is true"],
      [{ kind: "is-false", of: { from: "input", path: "includeCrmDates" } },
        "runs when the run's input field includeCrmDates is false"],
      [{ kind: "equals", of: { from: "input", path: "mode" }, value: "terminate" },
        'runs when the run\'s input field mode is exactly "terminate"'],
      [{ kind: "not-equals", of: { from: "input", path: "mode" }, value: "hire" },
        'runs when the run\'s input field mode is anything but "hire"'],
      [{ kind: "is-present", of: { from: "node", nodeId: "searching", path: "selection.selected" } },
        "runs when searching's output field selection.selected carries a value"],
      [{ kind: "is-absent", of: { from: "node", nodeId: "searching", path: "selection.selected" } },
        "runs when searching's output field selection.selected carries no value"],
    ] as const;
    for (const [spec, sentence] of cases) {
      assert.equal(describeNodeCondition(parseNodeCondition(spec)), sentence);
    }
  });

  it("evaluates the input and upstream-output arms the executor uses", () => {
    const evaluate = (spec: Parameters<typeof parseNodeCondition>[0]): boolean =>
      evaluateNodeCondition(parseNodeCondition(spec), SCOPE);
    assert.equal(evaluate({ kind: "is-true", of: { from: "input", path: "includeCrmDates" } }), true);
    assert.equal(evaluate({ kind: "is-false", of: { from: "input", path: "includeCrmDates" } }), false);
    assert.equal(
      evaluate({ kind: "equals", of: { from: "input", path: "mode" }, value: "terminate" }),
      true,
    );
    assert.equal(
      evaluate({ kind: "not-equals", of: { from: "input", path: "mode" }, value: "terminate" }),
      false,
    );
    assert.equal(
      evaluate({
        kind: "equals",
        of: { from: "node", nodeId: "searching", path: "selection.status" },
        value: "resolved",
      }),
      true,
    );
  });

  it("treats a null and a missing field as ABSENT for the two arms that ask about absence", () => {
    const absent = { kind: "is-absent", of: { from: "input", path: "note" } } as const;
    const present = { kind: "is-present", of: { from: "input", path: "note" } } as const;
    assert.equal(evaluateNodeCondition(parseNodeCondition(absent), SCOPE), true);
    assert.equal(evaluateNodeCondition(parseNodeCondition(present), SCOPE), false);
    const missing = { kind: "is-absent", of: { from: "input", path: "nothingHere" } } as const;
    assert.equal(evaluateNodeCondition(parseNodeCondition(missing), SCOPE), true);
  });

  it("REFUSES an absent field on every arm that reads a value", () => {
    // The whole reason `is-present` exists. Answering `false` here would make a
    // descriptor defect indistinguishable from an ordinary skipped node.
    assert.throws(
      () => evaluateNodeCondition(
        parseNodeCondition({ kind: "is-true", of: { from: "input", path: "nothingHere" } }),
        SCOPE,
      ),
      /which is absent; use is-present \/ is-absent/u,
    );
  });

  it("REFUSES a non-boolean under is-true rather than guessing whether the node runs", () => {
    assert.throws(
      () => evaluateNodeCondition(
        parseNodeCondition({ kind: "is-true", of: { from: "input", path: "mode" } }),
        SCOPE,
      ),
      /refusing to guess whether the node runs/u,
    );
  });

  it("REFUSES a path that traverses a non-object, and an upstream node with no output", () => {
    assert.throws(
      () => evaluateNodeCondition(
        parseNodeCondition({ kind: "is-true", of: { from: "input", path: "mode.nested" } }),
        SCOPE,
      ),
      /traverses a non-object/u,
    );
    assert.throws(
      () => evaluateNodeCondition(
        parseNodeCondition({ kind: "is-true", of: { from: "node", nodeId: "absent-node", path: "x" } }),
        SCOPE,
      ),
      /produced no output in this scope/u,
    );
  });

  it("names the upstream node a condition depends on, and nothing for an input read", () => {
    assert.equal(
      nodeConditionDependency(parseNodeCondition({
        kind: "is-true",
        of: { from: "node", nodeId: "searching", path: "hdh" },
      })),
      "searching",
    );
    assert.equal(
      nodeConditionDependency(parseNodeCondition({
        kind: "is-true",
        of: { from: "input", path: "includeCrmDates" },
      })),
      undefined,
    );
  });

  it("refuses a condition shape outside the closed vocabulary", () => {
    assert.throws(
      // @ts-expect-error — the point of the closed union: an unrenderable shape
      // is a compile error in a descriptor, and a refusal at parse besides.
      () => parseNodeCondition({ kind: "matches", of: { from: "input", path: "mode" } }),
    );
  });
});

/* ── the factory refuses a condition that names nothing (D228) ───────────── */

describe("defineWorkflowDescriptor over a declared condition", () => {
  const Input = z.strictObject({
    eid: EidSchema,
    includeExtras: z.boolean(),
    note: z.string().min(1).optional(),
  });
  const CanonicalInput = defineCanonicalInput(
    Input,
    z.strictObject({
      eid: EidSchema,
      includeExtras: z.boolean(),
      note: z.string().min(1).optional(),
    }),
    [{ eid: "10800000", includeExtras: true }, { eid: "10800001", includeExtras: false }],
  );

  const descriptorWith = (when: NodeConditionSpec, dependsOn: readonly string[] = ["probe"]) =>
    () => defineWorkflowDescriptor({
      id: "condition-fixture",
      version: 1,
      contractFingerprint: FingerprintSchema.parse("a".repeat(64)),
      code: "cf",
      label: "Condition Fixture",
      icon: "ShieldCheck",
      category: "operations",
      canonicalInput: CanonicalInput,
      inputSubject: "eid",
      surface: { shape: "single" },
      enqueue: "reject-active",
      actions: STANDARD_WORKFLOW_ACTIONS,
      surfaces: {},
      details: [],
      identity: { matchKey: (input) => `eid:${input.eid}` },
      presentation: { title: (input) => `Fixture ${input.eid}` },
      scenarios: ["ucpath/person-org-happy"],
      flow: flow(Input)
        .step("probe", FixtureReadReceipt, {
          dependsOn: [],
          replay: "checkpoint",
          bind: ({ input }) => ({ eid: input.eid }),
        })
        .step("second", FixtureReadReceipt, {
          dependsOn: dependsOn as [],
          replay: "checkpoint",
          when,
          bind: ({ input }) => ({ eid: input.eid }),
        })
        .build({
          schema: z.strictObject({ present: z.boolean() }),
          dependsOn: ["probe"],
          derive: ({ outputs }) => ({ present: outputs.probe.present }),
        }),
    });

  it("accepts a condition whose path the input schema owns", () => {
    assert.doesNotThrow(descriptorWith({
      kind: "is-true",
      of: { from: "input", path: "includeExtras" },
    }));
  });

  it("REFUSES a condition naming a field no schema owns — at module load, not mid-run", () => {
    assert.throws(
      descriptorWith({ kind: "is-true", of: { from: "input", path: "nothingHere" } }),
      /when references unknown schema field nothingHere/u,
    );
  });

  it("REFUSES a condition reading a node it does not depend on", () => {
    // The condition would be evaluated before that node had an answer, which
    // the executor's own scope would then report as "produced no output".
    assert.throws(
      descriptorWith(
        { kind: "is-true", of: { from: "node", nodeId: "probe", path: "present" } },
        [],
      ),
      /which it does not depend on/u,
    );
  });

  it("accepts an upstream read it DOES depend on, and refuses an unknown field of it", () => {
    assert.doesNotThrow(descriptorWith({
      kind: "is-true",
      of: { from: "node", nodeId: "probe", path: "present" },
    }));
    assert.throws(
      descriptorWith({ kind: "is-true", of: { from: "node", nodeId: "probe", path: "absentLeaf" } }),
      /when references unknown schema field absentLeaf/u,
    );
  });

  it("lets is-present reach a field only SOME union arms carry, where a value arm may not", () => {
    // `owns` for the arms that read a value, `offers` for the two whose whole
    // question is whether the field is there.
    assert.doesNotThrow(descriptorWith({
      kind: "is-present",
      of: { from: "input", path: "note" },
    }));
  });
});
