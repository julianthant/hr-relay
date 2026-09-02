/**
 * D307 — step-omission invariants, swept over every registered workflow
 * descriptor.
 *
 * `src/domain/workflow/step-omission.ts` is pure: the factory
 * (`deriveStepOmissions`, `src/base/workflow.ts`) enforces at DEFINITION TIME
 * that a producer names only TASK nodes of its own step, and the planner
 * (`planStepOmissions`)/cascade (`stepOmissionCascade`) enforce the rest at
 * plan time. This guard proves four things hold for EVERY registered
 * descriptor, and — because the production registry currently declares zero
 * `stepOmissions` (grep confirms no `src/workflows/**` step folder has an
 * `omission:` yet) — also against an in-test fixture shaped like Separations'
 * write half, so the sweep is not vacuous:
 *
 * (a) an omission can never produce a gate or a transaction node; the factory
 *     throws at `defineWorkflowDescriptor()` call time.
 * (b) every omittable step's `stepOmissionCascade` row is `omittable` or
 *     `blocked` — the cascade never throws, which is exactly what happens
 *     when a single-step omission (with placeholder facts) produces a refusal
 *     other than `dependency-omitted` (ref `stepOmissionCascade`'s own
 *     internal check).
 * (c) every declared form has unique field keys and parses through
 *     `StepOmissionFormSchema`.
 * (d) a gate node — the identity-approval gate of `separations` above all —
 *     is never classified `asserted` or `omitted` by `planStepOmissions` for
 *     any descriptor and any single-step omission; the ALWAYS-GATE rule
 *     (D77) is a planner invariant, not a per-descriptor promise.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { flow } from "../../../src/base/flow.js";
import { defineWorkflowDescriptor, descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../src/base/workflow.js";
import { DESCRIPTORS } from "../../../src/control/workflow-registry.js";
import { defineTaskContract } from "../../../src/domain/contracts/base.js";
import { EidSchema, FingerprintSchema, ScenarioIdSchema, TaskIdSchema } from "../../../src/domain/ids.js";
import {
  planStepOmissions,
  stepOmissionCascade,
  StepOmissionFormSchema,
  type StepOmissionDeclaration,
  type StepOmissionField,
  type StepOmissionForm,
  type StepOmissionGraphView,
} from "../../../src/domain/workflow/step-omission.js";
import type { JsonValue } from "../../../src/domain/canonical-json.js";
import { defineCanonicalInput } from "../../../src/domain/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/domain/workflow/presentation.js";
import { FixtureCommit, FixtureStage } from "./helpers/descriptor-fixtures.js";

const FixtureInput = z.strictObject({ eid: EidSchema });
const FixtureCanonicalInput = defineCanonicalInput(
  FixtureInput,
  z.strictObject({ eid: EidSchema }),
  [{ eid: "10800000" }],
);

const ReadContract = defineTaskContract({
  id: TaskIdSchema.parse("ocr/read-step-omission-guard"),
  title: "Step omission guard fixture read",
  effect: "read",
  input: FixtureInput,
  output: z.strictObject({ value: z.string().min(1) }),
  errorCodes: ["unexpected-page-state"] as const,
  subject: { kind: "none", reason: "step omission guard fixture" },
  scenarios: [ScenarioIdSchema.parse("step-omission-guard/happy")],
  freshness: { defaultMaxAgeMs: 0 },
  provenance: { default: "live" as const },
  example: { value: "observed" },
});

const ApproveContract = defineTaskContract({
  id: TaskIdSchema.parse("ocr/verify-step-omission-guard"),
  title: "Step omission guard fixture approve",
  effect: "read",
  input: FixtureInput,
  output: z.strictObject({ approved: z.boolean() }),
  errorCodes: ["unexpected-page-state"] as const,
  subject: { kind: "none", reason: "step omission guard fixture" },
  scenarios: [ScenarioIdSchema.parse("step-omission-guard/happy")],
  freshness: { defaultMaxAgeMs: 0 },
  provenance: { default: "live" as const },
  example: { approved: true },
});

/**
 * A fixture graph shaped like Separations' write half: a read, the
 * `identity-approval` operator gate, a post-gate task, and a transaction —
 * split across the SAME three step keys Separations uses (`reading`,
 * `identity-check`, `writing`) so the fixture stands in for the real
 * descriptor's omission-free `identity-check` step.
 */
function buildStepOmissionFixture(
  id: string,
  code: string,
  overrides: {
    identityCheckOmission?: StepOmissionDeclaration;
    writingOmission?: StepOmissionDeclaration;
  } = {},
): AnyWorkflowDescriptor {
  const fixtureFlow = flow(FixtureInput)
    .step("read", ReadContract, { dependsOn: [], replay: "checkpoint", bind: ({ input }) => ({ eid: input.eid }) })
    .gate("identity-approval", {
      dependsOn: ["read"],
      label: "Identity Approval",
      statusKey: "needsReview",
      resolvedBy: "operator",
      result: z.strictObject({ approved: z.boolean() }),
    })
    .step("approve", ApproveContract, {
      dependsOn: ["read", "identity-approval"],
      replay: "checkpoint",
      bind: ({ input }) => ({ eid: input.eid }),
    })
    .transaction("submit", {
      dependsOn: ["approve"],
      prepare: { uses: FixtureStage, bind: ({ input }) => ({ eid: input.eid }) },
      commit: { uses: FixtureCommit, bind: ({ input }) => ({ eid: input.eid }) },
      dryRun: "stop-after-prepare",
      probePolicy: "always",
      probeToFenceMaxMs: 30_000,
    })
    .build({
      schema: z.strictObject({ transactionId: z.string().min(1) }),
      dependsOn: ["submit"],
      derive: ({ outputs }) => ({ transactionId: outputs.submit.output.transactionId }),
    });

  return defineWorkflowDescriptor({
    id,
    version: 1,
    contractFingerprint: FingerprintSchema.parse("f".repeat(64)),
    code,
    label: "Step omission invariants fixture",
    icon: "ShieldCheck",
    category: "operations",
    canonicalInput: FixtureCanonicalInput,
    inputSubject: "eid",
    surface: { shape: "single" },
    enqueue: "reject-active",
    actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {},
    details: [],
    identity: { matchKey: (input) => `eid:${input.eid}` },
    presentation: { title: (input) => `Fixture ${input.eid}` },
    scenarios: [`${id}/happy`],
    timeline: [
      { key: "reading", label: "Reading", nodes: ["read"] },
      {
        key: "identity-check",
        label: "Identity Check",
        nodes: ["identity-approval", "approve"],
        ...(overrides.identityCheckOmission === undefined ? {} : { omission: overrides.identityCheckOmission }),
      },
      {
        key: "writing",
        label: "Writing",
        nodes: ["submit"],
        ...(overrides.writingOmission === undefined ? {} : { omission: overrides.writingOmission }),
      },
    ],
    flow: fixtureFlow,
  });
}

const VALID_OMISSION: StepOmissionDeclaration = {
  form: { fields: [{ key: "approvedFlag", label: "Approved", kind: "boolean" }] },
  produces: { approve: ({ facts }) => ({ approved: facts.approvedFlag }) },
};

/** The one legitimate fixture descriptor every positive check runs against too. */
const validFixture = buildStepOmissionFixture("step-omission-guard-valid", "sov", {
  identityCheckOmission: VALID_OMISSION,
});

function graphViewOf(descriptor: AnyWorkflowDescriptor): StepOmissionGraphView {
  return {
    nodes: descriptorRuntimeNodes(descriptor),
    timeline: descriptor.timeline,
    stepOmissions: descriptor.stepOmissions,
  };
}

/** Mirrors `stepOmissionCascade`'s own private placeholder generator (step-omission.ts) so this guard can drive `planStepOmissions` directly without importing a module-private function. */
function placeholder(field: StepOmissionField): JsonValue {
  switch (field.kind) {
    case "boolean": return false;
    case "integer": return field.min ?? 0;
    case "text-list": return [];
    case "enum": return field.values[0] ?? "";
    case "us-date": return "01/01/2000";
    case "eid": return "00000000";
    case "text": return "guard";
  }
}
function placeholderFacts(form: StepOmissionForm): Record<string, JsonValue> {
  return Object.fromEntries(form.fields.map((field) => [field.key, placeholder(field)]));
}

/** Every descriptor this guard sweeps: the whole production registry plus the one legitimate fixture. */
const SWEPT_DESCRIPTORS: readonly AnyWorkflowDescriptor[] = [...DESCRIPTORS, validFixture];

describe("step-omission invariants (D307)", () => {
  it("throws at definition time when an omission produces the gate node of its own step", () => {
    const gateOmission: StepOmissionDeclaration = {
      form: { fields: [] },
      produces: { "identity-approval": () => ({ approved: true }) },
    };
    assert.throws(
      () => buildStepOmissionFixture("step-omission-guard-gate", "sog", { identityCheckOmission: gateOmission }),
      /identity-check" omission produces gate node "identity-approval"; only task nodes are ever asserted \(D307\)/u,
    );
  });

  it("throws at definition time when an omission produces the transaction node of its own step", () => {
    const transactionOmission: StepOmissionDeclaration = {
      form: { fields: [] },
      produces: { submit: () => ({ transactionId: "T1" }) },
    };
    assert.throws(
      () => buildStepOmissionFixture("step-omission-guard-txn", "sot", { writingOmission: transactionOmission }),
      /writing" omission produces transaction node "submit"; only task nodes are ever asserted \(D307\)/u,
    );
  });

  it("refuses a descriptor whose omission form declares a duplicate field key (negative arm for check c)", () => {
    const duplicateFieldOmission: StepOmissionDeclaration = {
      form: { fields: [{ key: "value", label: "V1", kind: "text" }, { key: "value", label: "V2", kind: "text" }] },
      produces: { approve: () => ({ approved: true }) },
    };
    assert.throws(
      () => buildStepOmissionFixture("step-omission-guard-dup", "sod", { identityCheckOmission: duplicateFieldOmission }),
      /declared twice/u,
    );
  });

  it("every registered descriptor's omittable steps resolve to a non-throwing omittable/blocked cascade row", () => {
    let audited = 0;
    for (const descriptor of SWEPT_DESCRIPTORS) {
      const view = graphViewOf(descriptor);
      if (view.stepOmissions.length === 0) continue;
      // stepOmissionCascade computes planStepOmissions to a fixpoint for
      // EVERY omittable step and throws internally the moment a refusal
      // other than "dependency-omitted" appears (step-omission.ts). Letting
      // it run un-caught IS the "never throws for any refusal but
      // dependency-omitted" proof for a single-step omission with
      // placeholder facts.
      const rows = stepOmissionCascade(view);
      for (const spec of view.stepOmissions) {
        audited += 1;
        const row = rows.get(spec.step);
        assert.ok(row !== undefined, `${String(descriptor.id)}: no cascade row for step "${spec.step}"`);
        assert.ok(
          row?.state === "omittable" || row?.state === "blocked",
          `${String(descriptor.id)}: step "${spec.step}" cascade row is neither omittable nor blocked`,
        );
      }
    }
    assert.ok(audited > 0, "no omittable step was audited — the sweep would be vacuous");
  });

  it("every declared omission form has unique field keys and parses through StepOmissionFormSchema", () => {
    let audited = 0;
    for (const descriptor of SWEPT_DESCRIPTORS) {
      for (const spec of descriptor.stepOmissions) {
        audited += 1;
        const parsed = StepOmissionFormSchema.parse(spec.form);
        const keys = parsed.fields.map((field) => field.key);
        assert.equal(
          new Set(keys).size,
          keys.length,
          `${String(descriptor.id)}: step "${spec.step}" declares a duplicate form field key`,
        );
      }
    }
    assert.ok(audited > 0, "no declared omission form was audited — the sweep would be vacuous");
  });

  it("never classifies a gate node (the identity-approval gate above all) as asserted or omitted under a single-step omission", () => {
    let audited = 0;
    for (const descriptor of SWEPT_DESCRIPTORS) {
      const view = graphViewOf(descriptor);
      const gateIds = view.nodes.filter((node) => node.kind === "gate").map((node) => node.id);
      if (gateIds.length === 0 || view.stepOmissions.length === 0) continue;
      for (const spec of view.stepOmissions) {
        audited += 1;
        const plan = planStepOmissions(view, [{ step: spec.step, facts: placeholderFacts(spec.form) }]);
        for (const gateId of gateIds) {
          assert.ok(
            !plan.asserted.has(gateId),
            `${String(descriptor.id)}: step "${spec.step}" asserts gate "${gateId}"`,
          );
          assert.ok(
            !plan.omitted.has(gateId),
            `${String(descriptor.id)}: step "${spec.step}" omits gate "${gateId}"`,
          );
        }
      }
    }
    assert.ok(audited > 0, "no descriptor combining a gate and a declared omission was audited — the sweep would be vacuous");
  });

  it("keeps the real separations identity-approval gate out of every currently declared omission", () => {
    const separations = DESCRIPTORS.find((descriptor) => String(descriptor.id) === "separations");
    assert.ok(separations !== undefined, "the separations descriptor must be registered");
    for (const spec of separations?.stepOmissions ?? []) {
      assert.ok(
        !Object.keys(spec.produces).includes("identity-approval"),
        `separations step "${spec.step}" must never produce identity-approval`,
      );
    }
  });
});
