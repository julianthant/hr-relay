import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import {
  applyStartStepSelection,
  projectStartRows,
  resolveStartStepOmissions,
  StartStepOmissionRefusedError,
} from "../../../../src/backend/runs/start/step-selection.js";
import { SearchPersonOrg } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import type { StartRowDeclaration, StepManualDeclaration, StepOmissionField } from "../../../../src/models/workflow/step-omission.js";
import type { RerunValueMappingSpec } from "../../../../src/models/workflow/rerun-values.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { compileWorkflow, defineWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { Plan1Output, plan1Contract } from "../../../support/fixtures/plan1-operation-workflows.js";
import { defineTaskContract } from "../../../../src/models/task/task-contract.js";
import { WriteFixtureCommit, WriteFixturePrepare } from "../../../support/fixtures/write-sequencer-fixtures.js";

const Input = z.strictObject({ emplId: EidSchema, text: z.string(), mode: z.enum(["ok", "fail", "repeat", "confirmed"]), extra: z.boolean() });
const CanonicalInput = defineCanonicalInput(Input, Input, [{ emplId: "10800000", text: "same", mode: "ok", extra: true }]);
const Result = z.strictObject({ eid: EidSchema });

const { __sealed: _sealed, ...plan1Definition } = plan1Contract;
const publishContract = defineTaskContract({ ...plan1Definition, providers: ["geocode.census"] as const });

const SEARCH_RESULT = {
  emplId: "10800000", name: "Person, Example", department: "Dept", jobTitle: "Title", employeeStatus: "active", hdh: true,
  hrStatus: "Active", startDate: "01/02/2000", effectiveDate: "01/02/2000", terminationDate: "", terminationReason: "",
};

interface Options {
  readonly reading?: StepManualDeclaration;
  readonly saving?: StepManualDeclaration;
  readonly extra?: StepManualDeclaration;
  readonly locked?: "bound-read" | "guard-read";
  readonly rows?: readonly StartRowDeclaration[];
  readonly rerunValues?: readonly RerunValueMappingSpec[];
  /** check publishes instead of reading */
  readonly publishCheck?: boolean;
  /** reading gains a switch on `extra`: declared, or inferred from one input condition on each of its tasks */
  readonly readingSwitch?: "declared" | "inferred";
  /** reading gains an operator gate after read: always, or only when `extra` is true */
  readonly readingGate?: "always" | "when-extra";
  /** read's output gains an optional `odd` value under this schema */
  readonly oddLeaf?: z.ZodType<string | number | undefined>;
}

/** reading: search -> read -> check (or a publishing check); saving: save (a transaction) -> receipt; extra: a selection step with one read. */
function fixture(options: Options = {}) {
  return compileWorkflow(defineWorkflow({
    id: "step-manual-fixture", version: 1, code: "smf", label: "Manual entry fixture", icon: "Search", category: "operations",
    input: Input, canonicalInput: CanonicalInput, inputSubject: "eid", surface: { shape: "single" }, enqueue: "reject-active",
    actions: STANDARD_WORKFLOW_ACTIONS, details: [], scenarios: ["write-fixture/happy"], role: defineWorkflowRole({ kind: "standalone" }),
    identity: { matchKey: (input) => `eid:${input.emplId}` }, presentation: { title: (input) => `EID ${input.emplId}` },
    surfaces: { inputRun: { placeholder: "Enter an EID", parser: {
      split: { kind: "whole-text" }, rules: [{ when: { kind: "pattern", pattern: "eid" }, emit: "emplId" }],
      constants: [{ field: "extra", value: { kind: "boolean", value: true } }],
    } } },
    ...(options.rows === undefined ? {} : { rows: options.rows }),
    ...(options.rerunValues === undefined ? {} : { rerunValues: options.rerunValues }),
    steps: ({ task, gate, transaction, group, result }) => {
      const when = options.readingSwitch === "inferred" ? { when: { kind: "is-true" as const, of: { from: "input" as const, path: "extra" } } } : {};
      const search = task({ id: "search", contract: SearchPersonOrg, replay: "checkpoint", ...when }, [], ({ input }) => ({ kind: "by-eid" as const, emplId: input.emplId }));
      const readContract = options.oddLeaf === undefined ? plan1Contract : defineTaskContract({ ...plan1Definition,
        output: z.strictObject({ ...Plan1Output.shape, odd: options.oddLeaf.optional() }), example: { ...plan1Definition.example, odd: "XXXXX" } });
      const read = task({ id: "read", contract: readContract, replay: "checkpoint", ...when }, [search], ({ input }) => input);
      const check = options.publishCheck === true
        ? task({ id: "check", contract: publishContract, replay: "checkpoint", dryRun: "stop-before-publish", ...when }, [read], ({ input }) => input)
        : task({ id: "check", contract: plan1Contract, replay: "checkpoint", ...when }, [read], ({ input }) => input);
      const review = options.readingGate === undefined ? undefined : gate({ id: "review", label: "Review", result: ReviewResult,
        ...(options.readingGate === "when-extra" ? { when: { kind: "is-true" as const, of: { from: "input" as const, path: "extra" } } } : {}) }, [read]);
      const save = transaction({ id: "save", label: "Save", prepare: WriteFixturePrepare, commit: WriteFixtureCommit,
        dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 }, [read], {
        prepareBind: ({ input }) => ({ eid: input.emplId }), commitBind: ({ input }) => ({ eid: input.emplId }),
      });
      const receipt = task({ id: "receipt", contract: plan1Contract, replay: "checkpoint" }, [save], ({ input }) => input);
      const more = task({ id: "more", contract: plan1Contract, replay: "checkpoint" }, [], ({ input }) => input);
      const reading = { key: "reading", label: "Reading",
        ...(options.readingSwitch === "declared" ? { selection: { inputField: "extra", selectedWhen: true } } : {}) };
      const saving = { key: "saving", label: "Saving" };
      const extra = { key: "extra", label: "Extra", selection: { inputField: "extra", selectedWhen: true } };
      return {
        steps: [
          [options.reading === undefined && options.locked === undefined && options.readingSwitch === undefined ? reading : group(reading, {
            ...(options.reading === undefined ? {} : { manual: options.reading }), ...(options.locked === undefined ? {} : { locked: options.locked }),
          }), review === undefined ? [search, read, check] : [search, read, check, review]],
          [options.saving === undefined ? saving : group(saving, { manual: options.saving }), [save, receipt]],
          [options.extra === undefined ? extra : group(extra, { manual: options.extra }), [more]],
        ],
        result: result(Result, [check, receipt, more], ({ outputs }) => ({ eid: outputs.check.eid })),
      };
    },
  })).descriptor;
}

const ReviewResult = z.strictObject({ approved: z.boolean() });
const VALUE: StepOmissionField = { key: "disposition", label: "Disposition", kind: "text", replaces: { nodeId: "read", path: "disposition" } };
const READ_TYPED: StepManualDeclaration = {
  form: { fields: [VALUE] },
  produces: { read: ({ facts, scope }) => Plan1Output.parse({ eid: (scope.input as { emplId: string }).emplId, disposition: facts.disposition, providerState: "typed" }) },
  skips: ["search"],
};
const RECEIPT_TYPED: StepManualDeclaration = {
  form: { fields: [{ key: "disposition", label: "Receipt", kind: "text" }] },
  produces: { receipt: ({ facts }) => ({ eid: "10800000", disposition: facts.disposition, providerState: "typed" }) },
};
const MORE_TYPED: StepManualDeclaration = {
  form: { fields: [{ key: "disposition", label: "More", kind: "text" }] },
  produces: { more: ({ facts }) => ({ eid: "10800000", disposition: facts.disposition, providerState: "typed" }) },
};
const ALL_STEPS = ["reading", "saving", "extra"];
const SUBMISSION = { emplId: "10800000", text: "same", mode: "ok" };

describe("manual entry definition checks", () => {
  it("accepts a step with a selection and typed values together", () => {
    const rows = projectStartRows(fixture({ extra: MORE_TYPED }));
    assert.deepEqual(rows.find(({ key }) => key === "extra"), {
      key: "extra", label: "Extra", includedByDefault: true, kind: "switch",
      members: [{ step: "extra" }], target: { step: "extra" },
      manual: { form: MORE_TYPED.form, forces: [] }, selection: { inputField: "extra" },
    });
  });

  it("refuses skipping a node outside the step, a gate or transaction, and a running node that reads a skipped one", () => {
    assert.throws(() => fixture({ reading: { ...READ_TYPED, skips: ["more"] } }), /skips node "more", which is not a member of that step/u);
    assert.throws(() => fixture({ saving: { ...RECEIPT_TYPED, skips: ["save"] } }), /skips transaction node "save"; a gate or transaction always runs/u);
    assert.throws(() => fixture({ reading: { ...READ_TYPED, produces: {}, skips: ["read"], form: { fields: [] } } }), /workflow entry "save" in step "saving" reads its task entry "read"/u);
    assert.throws(() => fixture({ reading: { form: { fields: [] }, produces: {}, skips: ["search"] } }), /runs node "read", which reads skipped node "search"/u);
    assert.throws(() => fixture({ reading: { ...READ_TYPED, skips: ["search", "read"] } }), /both produces and skips node "read"/u);
  });

  it("refuses a replaced value the declaration does not produce or the node does not offer", () => {
    assert.throws(() => fixture({ reading: { ...READ_TYPED, form: { fields: [{ ...VALUE, replaces: { nodeId: "check", path: "disposition" } }] } } }),
      /replaces a value of node "check", which the declaration does not produce/u);
    assert.throws(() => fixture({ reading: { ...READ_TYPED, form: { fields: [{ ...VALUE, replaces: { nodeId: "read", path: "missing" } }] } } }),
      /replaces "missing", which node "read"'s output does not offer/u);
  });

  it("refuses a field whose stored facts the replaced leaf would not accept unchanged", () => {
    assert.throws(() => fixture({ reading: { ...READ_TYPED, form: { fields: [{ key: "eid", label: "EID", kind: "iso-date", replaces: { nodeId: "read", path: "eid" } }] } } }),
      /field "eid" stores iso-date facts, which "read\.eid" does not provably accept unchanged/u);
    assert.throws(() => fixture({ reading: { ...READ_TYPED, form: { fields: [{ key: "eid", label: "EID", kind: "text", replaces: { nodeId: "read", path: "eid" } }] } } }),
      /field "eid" stores text facts, which "read\.eid" does not provably accept unchanged/u);
    assert.throws(() => fixture({ reading: { ...READ_TYPED, form: { fields: [{ ...VALUE, optional: true }] } } }),
      /field "disposition" is optional, but "read\.disposition" accepts neither null nor absence/u);
  });

  it("refuses a leaf whose wrapper or union could refuse or rewrite a typed value", () => {
    const odd: StepManualDeclaration = { ...READ_TYPED, form: { fields: [{ key: "odd", label: "Odd", kind: "text", replaces: { nodeId: "read", path: "odd" } }] },
      produces: { read: ({ facts, scope }) => ({ eid: (scope.input as { emplId: string }).emplId, disposition: "typed", providerState: "typed", odd: facts.odd }) } };
    for (const oddLeaf of [
      z.string().optional().refine((value) => typeof value === "string" && value.length >= 5),
      z.union([z.string(), z.number()]).refine((value) => typeof value === "string" && value.length >= 5),
      z.union([z.string().transform((value) => value.toUpperCase()), z.string()]),
      z.xor([z.string(), z.literal("blocked")]),
    ]) assert.throws(() => fixture({ oddLeaf, reading: odd }), /field "odd" stores text facts, which "read\.odd" does not provably accept unchanged/u);
    assert.equal(fixture({ oddLeaf: z.union([z.string(), z.number()]), reading: odd }).stepOmissions.length, 1);
  });

  it("accepts a replaced path with an array index segment", () => {
    const declaration: StepManualDeclaration = {
      form: { fields: [{ key: "name", label: "Name", kind: "text", replaces: { nodeId: "search", path: "results.0.name" } }] },
      produces: { search: ({ facts }) => ({ results: [{ ...SEARCH_RESULT, name: facts.name }], selection: { status: "resolved", selected: { ...SEARCH_RESULT, name: facts.name }, candidateEids: ["10800000"] } }) },
    };
    const descriptor = fixture({ reading: declaration });
    assert.deepEqual(descriptor.rerunValues, [
      { nodeId: "search", fieldPath: "results.0.name", label: "Name", targetStepKey: "reading", targetFieldPath: "name" },
    ]);
  });
});

describe("manual entry rerun values", () => {
  it("derives a step's Rerun values from its fields' replaces and refuses a declared step mapping", () => {
    assert.deepEqual(fixture({ reading: READ_TYPED }).rerunValues, [
      { nodeId: "read", fieldPath: "disposition", label: "Disposition", targetStepKey: "reading", targetFieldPath: "disposition" },
    ]);
    assert.throws(() => fixture({ reading: READ_TYPED, rerunValues: [
      { nodeId: "read", fieldPath: "disposition", label: "Disposition", targetStepKey: "reading", targetFieldPath: "disposition" },
    ] }), /step Rerun values are derived from each manual field's replaces/u);
  });
});

describe("declared start rows", () => {
  const SPLIT: readonly StartRowDeclaration[] = [
    { key: "read-row", label: "Read row", members: [{ step: "reading" }], target: { step: "reading" } },
    { key: "fill-row", label: "Fill row", members: [{ step: "saving", nodes: ["save"], phase: "prepare" }] },
    { key: "submit-row", label: "Submit row", members: [{ step: "saving", nodes: ["save"], phase: "commit" }, { step: "saving", nodes: ["receipt"] }] },
    { key: "extra-row", label: "Extra row", members: [{ step: "extra" }], target: { step: "extra" } },
  ];

  it("serves split rows over one step by node and transaction phase, with kinds and lock reasons", () => {
    assert.deepEqual(projectStartRows(fixture({ reading: READ_TYPED, rows: SPLIT })).map(({ key, kind, lockReason, target }) => ({ key, kind, lockReason, target })), [
      { key: "read-row", kind: "locked-manual", lockReason: undefined, target: { step: "reading" } },
      { key: "fill-row", kind: "locked", lockReason: "form-action", target: undefined },
      { key: "submit-row", kind: "locked", lockReason: "form-action", target: undefined },
      { key: "extra-row", kind: "switch", lockReason: undefined, target: { step: "extra" } },
    ]);
  });

  it("refuses each malformed row declaration", () => {
    const refuses = (rows: readonly StartRowDeclaration[], message: RegExp) => assert.throws(() => fixture({ reading: READ_TYPED, rows }), message);
    const [read, fill, submit, extra] = SPLIT as [StartRowDeclaration, StartRowDeclaration, StartRowDeclaration, StartRowDeclaration];
    refuses([read, fill, extra], /no start row shows the commit phase of node "save" of step "saving"/u);
    refuses([read, fill, submit, extra, { key: "again", label: "Again", members: [{ step: "saving", nodes: ["receipt"] }] }], /start rows "submit-row" and "again" both show node "receipt"/u);
    refuses([{ ...read, members: [{ step: "nowhere" }] }, fill, submit, extra], /names step "nowhere", which is not on the timeline/u);
    refuses([read, { ...fill, members: [{ step: "saving", nodes: ["more"] }] }, submit, extra], /names node "more", which is not in step "saving"/u);
    refuses([read, fill, { ...submit, members: [{ step: "saving", nodes: ["save"], phase: "commit" }, { step: "saving", nodes: ["receipt"], phase: "commit" }] }, extra],
      /names the commit phase of task node "receipt"/u);
    refuses([read, { ...fill, target: { step: "saving" } }, submit, extra], /targets step "saving", which is not one of its whole-step members/u);
    refuses([read, fill, submit, { key: "x", label: "X", members: [{ step: "extra" }] }],
      /step "extra" can be switched off, but no start row targets it/u);
    refuses([{ ...read, key: "extra-row" }, fill, submit, extra], /start row key "extra-row" is declared twice/u);
    refuses([read, fill, submit, { ...extra, members: [{ workflow: "child-flow", step: "extra" }] }], /names child workflow "child-flow"/u);
    refuses([read, fill, submit, { ...extra, target: { workflow: "child-flow", step: "extra" } }], /targets child workflow "child-flow"/u);
  });

  it("refuses a target that switches nothing, and two rows targeting one step", () => {
    assert.throws(() => fixture({ rows: [
      { key: "read-row", label: "Read row", members: [{ step: "reading" }], target: { step: "reading" } },
      { key: "save-row", label: "Save row", members: [{ step: "saving" }] },
      { key: "extra-row", label: "Extra row", members: [{ step: "extra" }], target: { step: "extra" } },
    ] }), /targets step "reading", which declares neither a selection nor manual entry/u);
  });
});

describe("start row kinds and lock reasons", () => {
  it("derives form-action from a transaction, approval from a gate, takes a declared reading lock and keeps a pure reading switch", () => {
    const rows = projectStartRows(fixture({ locked: "guard-read" }));
    assert.deepEqual(rows.map(({ key, kind, lockReason }) => ({ key, kind, lockReason })), [
      { key: "reading", kind: "locked", lockReason: "guard-read" },
      { key: "saving", kind: "locked", lockReason: "form-action" },
      { key: "extra", kind: "switch", lockReason: undefined },
    ]);
    const switched = projectStartRows(fixture({ reading: { ...READ_TYPED, skips: ["search"], produces: { ...READ_TYPED.produces, check: () => ({ eid: "10800000", disposition: "x", providerState: "typed" }) } } }));
    assert.equal(switched[0]?.kind, "switch");
  });

  it("never produces or skips a publishing task, and keeps its step locked with Enter manually while its reading is typed", () => {
    assert.throws(() => fixture({ publishCheck: true, reading: { ...READ_TYPED, produces: { ...READ_TYPED.produces, check: () => ({ eid: "10800000", disposition: "x", providerState: "typed" }) } } }),
      /produces publishing task "check"; a publishing task always runs/u);
    assert.throws(() => fixture({ publishCheck: true, reading: { form: { fields: [] }, produces: {}, skips: ["check"] } }),
      /skips publishing task "check"; a publishing task always runs/u);
    const [reading] = projectStartRows(fixture({ publishCheck: true, reading: READ_TYPED }));
    assert.deepEqual([reading?.kind, reading?.lockReason], ["locked-manual", "form-action"]);
  });

  it("refuses a switch on a step whose publishing task keeps running beside typed values, and keeps it on a reading step", () => {
    for (const readingSwitch of ["declared", "inferred"] as const) {
      assert.throws(() => fixture({ publishCheck: true, readingSwitch, reading: READ_TYPED }),
        /step "reading" omission keeps task node "check" running, so the step cannot also be switched off/u);
      const [reading] = projectStartRows(fixture({ readingSwitch, reading: READ_TYPED }));
      assert.deepEqual([reading?.kind, reading?.lockReason], ["switch", undefined]);
    }
    assert.deepEqual(projectStartRows(fixture({ publishCheck: true, readingSwitch: "declared" }))[0]?.kind, "switch");
  });

  it("refuses a switch on a step whose approval gate keeps running beside typed values, and locks it for approval without one", () => {
    for (const readingGate of ["always", "when-extra"] as const) {
      assert.throws(() => fixture({ readingGate, readingSwitch: "declared", reading: READ_TYPED }),
        /step "reading" omission keeps gate node "review" running, so the step cannot also be switched off/u);
      const [reading] = projectStartRows(fixture({ readingGate, reading: READ_TYPED }));
      assert.deepEqual([reading?.kind, reading?.includedByDefault, reading?.lockReason], ["locked-manual", true, "approval"]);
    }
  });

  it("serves a step whose other nodes still run as locked with Enter manually", () => {
    const [, saving] = projectStartRows(fixture({ saving: RECEIPT_TYPED }));
    assert.deepEqual(saving, {
      key: "saving", label: "Saving", includedByDefault: true, kind: "locked-manual", lockReason: "form-action",
      members: [{ step: "saving" }], target: { step: "saving" }, manual: { form: RECEIPT_TYPED.form, forces: [] },
    });
  });
});

describe("manual entry at start", () => {
  it("accepts typed values for a locked step that stays selected, and stamps each field's label", () => {
    const descriptor = fixture({ saving: RECEIPT_TYPED });
    assert.deepEqual(resolveStartStepOmissions(descriptor, ALL_STEPS, [{ step: "saving", facts: { disposition: "done" } }]),
      [{ step: "saving", facts: { disposition: "done" }, labels: { disposition: "Receipt" } }]);
  });

  it("skips a selection step switched off with nothing typed, and runs its values typed with the input on", () => {
    const descriptor = fixture({ extra: MORE_TYPED });
    assert.equal(resolveStartStepOmissions(descriptor, ["reading", "saving"], undefined), undefined);
    assert.deepEqual(applyStartStepSelection(descriptor, SUBMISSION, ["reading", "saving"]), { ...SUBMISSION, extra: false });
    const typed = resolveStartStepOmissions(descriptor, ["reading", "saving"], [{ step: "extra", facts: { disposition: "typed" } }]);
    assert.deepEqual(typed, [{ step: "extra", facts: { disposition: "typed" }, labels: { disposition: "More" } }]);
    assert.deepEqual(applyStartStepSelection(descriptor, SUBMISSION, ["reading", "saving"], typed), { ...SUBMISSION, extra: true });
  });

  it("refuses facts its refine rule rejects, naming the field only", () => {
    const descriptor = fixture({ extra: { ...MORE_TYPED, refine: (facts) => facts.disposition === "bad" ? [{ field: "disposition", message: "not allowed" }] : [] } });
    assert.throws(() => resolveStartStepOmissions(descriptor, ["reading", "saving"], [{ step: "extra", facts: { disposition: "bad" } }]),
      (error: unknown) => error instanceof StartStepOmissionRefusedError && error.code === "facts-invalid" && /invalid at: disposition$/u.test(error.message));
  });

  it("refuses an entry addressed to a child workflow until child targets exist", () => {
    assert.throws(() => resolveStartStepOmissions(fixture({ extra: MORE_TYPED }), ["reading", "saving"], [{ workflow: "child-flow", step: "extra", facts: { disposition: "x" } }]),
      (error: unknown) => error instanceof StartStepOmissionRefusedError && error.code === "unknown-step");
  });
});
