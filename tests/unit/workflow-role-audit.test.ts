/**
 * D265 / ref workflow-model §1.2.2 rule 2 — "the rule bites exactly when a
 * timeline is DECLARED."
 *
 * `auditWorkflowModuleRoles` checks a `chunk-harness`'s `step` against its
 * composition's timeline. That timeline is the FACTORY's, and the factory
 * always produces one: a descriptor that declared nothing gets the D225 default
 * of one category per node. So an audit that reads `descriptor.timeline` alone
 * cannot tell "this composition declared `kuali-extraction`" from "this
 * composition declared nothing and happens to own a node called
 * `kuali-extraction`" — and the second is not a step at all. It has no step
 * folder, the harness has nowhere to live, and §1.2.2's whole claim (the tree
 * IS the timeline) is false for it.
 *
 * The descriptor therefore records whether the timeline was DECLARED, and the
 * audit refuses a harness of a composition that declared none, by name, rather
 * than silently accepting a node id as a step key.
 *
 * The real registered tuple is audited by `descriptor-coverage`; these are
 * synthetic descriptors, so the two states can both be built here.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { flow } from "../../src/base/flow.js";
import { defineWorkflowDescriptor } from "../../src/base/workflow.js";
import { auditWorkflowModuleRoles, type WorkflowRoleView } from "../../src/control/workflow-registry.js";
import { defineTaskContract } from "../../src/domain/contracts/base.js";
import { ScenarioIdSchema, taskId } from "../../src/domain/ids.js";
import { defineCanonicalInput } from "../../src/domain/workflow/canonical-input.js";
import { defineWorkflowRole } from "../../src/domain/workflow/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../src/domain/workflow/presentation.js";
import { HASH_A } from "./fixtures/phase1c-contract-fixtures.js";

const FixtureInput = z.strictObject({ name: z.string().min(1) });
const FixtureCanonicalInput = defineCanonicalInput(
  FixtureInput,
  z.strictObject({ name: z.string().min(1) }),
  [{ name: "Battistessa, Johnnie" }],
);
const SCENARIO = ScenarioIdSchema.parse("ocr/capability-wiring-happy");

function fixtureContract(id: string, title: string) {
  return defineTaskContract({
    id: taskId(`ucpath/${id}`),
    title,
    effect: "read",
    input: z.strictObject({ name: z.string().min(1) }),
    output: z.strictObject({ value: z.string().min(1) }),
    errorCodes: ["provider-unavailable"] as const,
    subject: { kind: "none", reason: "workflow role fixture" },
    scenarios: [SCENARIO],
    freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY, defaultOverride: "forbidden" },
    provenance: { default: "live" },
    example: { value: "v" },
  });
}

const READ_ONE = fixtureContract("read-role-one", "Read one");
const READ_TWO = fixtureContract("read-role-two", "Read two");

/** A two-node graph whose node ids are the strings a harness might mistake for step keys. */
function descriptorNamed(
  id: string,
  code: string,
  timeline?: readonly Readonly<{ key: string; label: string; nodes: readonly string[] }>[],
) {
  const fixtureFlow = flow(FixtureInput)
    .step("kuali-extraction", READ_ONE, {
      dependsOn: [], replay: "checkpoint", bind: ({ input }) => ({ name: input.name }),
    })
    .step("identity-check", READ_TWO, {
      dependsOn: ["kuali-extraction"], replay: "checkpoint", bind: ({ input }) => ({ name: input.name }),
    })
    .build({
      schema: z.strictObject({ done: z.boolean() }),
      dependsOn: ["identity-check"],
      derive: () => ({ done: true }),
    });
  return defineWorkflowDescriptor({
    id,
    version: 1,
    contractFingerprint: HASH_A,
    code,
    label: "Role fixture",
    icon: "Search",
    category: "operations",
    canonicalInput: FixtureCanonicalInput,
    inputSubject: "name",
    surface: { shape: "single" },
    enqueue: "reject-active",
    actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {},
    details: [],
    identity: { matchKey: (input: z.output<typeof FixtureInput>) => `name:${input.name}` },
    presentation: { title: (input: z.output<typeof FixtureInput>) => input.name },
    scenarios: ["wiring-projection/happy"],
    ...(timeline === undefined ? {} : { timeline }),
    flow: fixtureFlow,
  });
}

const HARNESS = descriptorNamed("role-fixture-harness", "rfh");

function views(compositionId: string, step: string, composition: WorkflowRoleView["descriptor"]): WorkflowRoleView[] {
  return [
    { descriptor: composition, role: defineWorkflowRole({ kind: "composition" }) },
    {
      descriptor: HARNESS,
      role: defineWorkflowRole({ kind: "chunk-harness", of: compositionId, step }),
    },
  ];
}

describe("auditWorkflowModuleRoles — a harness's step (D265, §1.2.2 rule 2)", () => {
  it("accepts a step its composition DECLARES", () => {
    const composition = descriptorNamed("role-fixture-declared", "rfd", [
      { key: "kuali-extraction", label: "Kuali extraction", nodes: ["kuali-extraction"] },
      { key: "identity-check", label: "Identity check", nodes: ["identity-check"] },
    ]);
    assert.deepEqual(
      auditWorkflowModuleRoles(views("role-fixture-declared", "kuali-extraction", composition)),
      [],
    );
  });

  it("refuses a step its composition does not declare, naming what it does declare", () => {
    const composition = descriptorNamed("role-fixture-declared", "rfd", [
      { key: "kuali-extraction", label: "Kuali extraction", nodes: ["kuali-extraction", "identity-check"] },
    ]);
    const violations = auditWorkflowModuleRoles(views("role-fixture-declared", "identity-check", composition));
    assert.equal(violations.length, 1);
    assert.match(violations[0] ?? "", /role-fixture-harness/);
    assert.match(violations[0] ?? "", /identity-check/);
    assert.match(violations[0] ?? "", /it declares: kuali-extraction/);
  });

  /**
   * The finding this file exists for: `role-fixture-none` declares no timeline,
   * so the factory derived one category per node — `kuali-extraction` and
   * `identity-check` are NODE IDS, not steps. Before the fix the audit read the
   * normalized timeline and accepted either one, admitting a harness of a
   * workflow that has no step folders at all.
   */
  it("refuses ANY step of a composition that declared no timeline", () => {
    const composition = descriptorNamed("role-fixture-none", "rfn");
    for (const step of ["kuali-extraction", "identity-check"]) {
      const violations = auditWorkflowModuleRoles(views("role-fixture-none", step, composition));
      assert.equal(violations.length, 1, `step ${step} must be refused`);
      assert.match(violations[0] ?? "", /role-fixture-harness/);
      assert.match(violations[0] ?? "", /role-fixture-none/);
      assert.match(
        violations[0] ?? "",
        /declares no timeline steps; a harness cannot be a step of it/,
      );
    }
  });
});
