import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import {
  ContractFieldPathSchema,
  assertTaskContractReferences,
  auditContractBoundarySchema,
  defineTaskContract,
} from "../../../../../src/models/task/task-contract.js";
import {
  REVIEWED_UNVERIFIABLE_BY_PAGE_POLICY,
  defineReviewedUnverifiableByPagePolicy,
} from "../../../../../src/models/task/write-safety.js";
import { EidSchema, ObservationIdSchema, ScenarioIdSchema, TaskIdSchema } from "../../../../../src/rules/identity/ids.js";
import { taskFailer } from "../../../../../src/workflow-kit/task.js";
import { TaskError, wrapUnhandledTaskError } from "../../../../../src/workflow-kit/errors.js";
import type { TaskOperationDeclaration } from "../../../../../src/models/workflow/operation-display.js";

const INPUT = z.strictObject({ eid: EidSchema });
const READ_OUTPUT = z.strictObject({ eid: EidSchema, found: z.literal(true) });
const COMMIT_OUTPUT = z.strictObject({ transactionId: z.string().min(1) });
const PROOF = z.strictObject({ transactionId: z.string().min(1) });
const OBSERVATION = ObservationIdSchema.parse("ucpath.person-org.displayed-eid");
const SCENARIO = ScenarioIdSchema.parse("ucpath/person-org-happy");

function personSubject(requiredAt: "before-subject-read" | "after-prepare-before-fence") {
  return {
    kind: "person" as const,
    expected: {
      fromInput: ContractFieldPathSchema.parse("eid"),
      identity: "eid" as const,
    },
    observe: OBSERVATION,
    match: "normalized-exact-eid" as const,
    requiredAt,
  };
}

function readDefinition() {
  return {
    id: TaskIdSchema.parse("ucpath/search-person-org"),
    title: "Search Person Organizational Summary",
    effect: "read" as const,
    input: INPUT,
    output: READ_OUTPUT,
    errorCodes: ["eid-not-found", "unexpected-page-state"] as const,
    subject: personSubject("before-subject-read"),
    scenarios: [SCENARIO],
    freshness: {
      defaultMaxAgeMs: 0,
      byField: [{ path: ContractFieldPathSchema.parse("eid"), maxAgeMs: 0 }],
    },
    provenance: {
      default: "live" as const,
      byField: [{ path: ContractFieldPathSchema.parse("eid"), source: "live" as const }],
    },
    example: { eid: "10800000", found: true as const },
  };
}

function readContract() {
  return defineTaskContract(readDefinition());
}

function prepareDefinition() {
  return {
    id: TaskIdSchema.parse("ucpath/fill-person-org"),
    title: "Fill Person Organizational Summary",
    effect: "prepare" as const,
    input: INPUT,
    output: z.strictObject({ staged: z.literal(true) }),
    errorCodes: ["unexpected-page-state"] as const,
    subject: personSubject("after-prepare-before-fence"),
    scenarios: [SCENARIO],
    checkpoint: "in-memory-only" as const,
    example: { staged: true as const },
  };
}

function prepareContract() {
  return defineTaskContract(prepareDefinition());
}

function commitDefinition() {
  return {
    id: TaskIdSchema.parse("ucpath/submit-person-org"),
    title: "Submit Person Organizational Summary",
    effect: "commit" as const,
    input: INPUT,
    output: COMMIT_OUTPUT,
    errorCodes: ["submit-failed", "wrong-subject"] as const,
    subject: personSubject("after-prepare-before-fence"),
    scenarios: [SCENARIO],
    writeSafety: {
      completion: {
        kind: "receipt" as const,
        proofSchema: PROOF,
        proofFromOutput: (output: z.output<typeof COMMIT_OUTPUT>) => output,
        proofFromPresentProbe: ({ proof }: { proof: z.output<typeof PROOF> }) => proof,
        outputFromProof: (proof: z.output<typeof PROOF>) => proof,
      },
      idempotency: {
        probe: { taskId: TaskIdSchema.parse("ucpath/search-person-org"), effect: "read" as const },
        key: ({ eid }: z.output<typeof INPUT>) => `${eid}|person-org`,
        recoveryAbsence: {
          kind: "stabilized" as const,
          minSinceFenceMs: 1_000,
          consistentReads: 2 as const,
          minBetweenReadsMs: 500,
          requireSameSourceState: true as const,
        },
      },
    },
    example: { transactionId: "T123" },
  };
}

function commitContract() {
  return defineTaskContract(commitDefinition());
}

describe("sealed task contracts", () => {
  it("seals a reusable operation declaration and refuses a cross-system one", () => {
    const operation = {
      version: 1,
      id: "search-person",
      system: "ucpath",
      session: { kind: "browser", id: "ucpath-browser", system: "ucpath" },
      page: { screen: "ucpath.person-org.search", form: "person-org" },
      values: [
        { id: "eid", source: { kind: "contract-input", path: "eid" } },
        { id: "found", source: { kind: "contract-output", path: "found" } },
      ],
      actions: [{ id: "open", kind: "open-page" }],
    } satisfies TaskOperationDeclaration;
    const contract = defineTaskContract({ ...readDefinition(), operation });
    assert.equal(contract.operation?.id, "search-person");
    assert.throws(() => defineTaskContract({
      ...readDefinition(),
      operation: { ...operation, system: "crm" } as unknown as TaskOperationDeclaration,
    }), /belongs to "ucpath"/);
  });

  it("seals and freezes all three effect contracts", () => {
    for (const contract of [readContract(), prepareContract(), commitContract()]) {
      assert.equal(contract.__sealed, true);
      assert.equal(Object.isFrozen(contract), true);
      assert.equal(contract.output.safeParse(contract.example).success, true);
    }
  });

  it("rejects open schemas, effect/verb drift, and malformed examples", () => {
    assert.throws(() => defineTaskContract({
      ...readDefinition(),
      input: z.object({ eid: EidSchema }),
    }), /strictObject/);
    assert.throws(() => defineTaskContract({
      ...readDefinition(),
      id: TaskIdSchema.parse("ucpath/submit-person-org"),
    }), /verb does not agree/);
    assert.throws(() => defineTaskContract({
      ...readDefinition(),
      output: z.strictObject({ count: z.number().int().positive() }),
      example: { count: 0 },
    }), /too_small|Too small/);
  });

  it("rejects raw-JS outer-shape and effect-specific escapes", () => {
    assert.throws(() => Reflect.apply(defineTaskContract, undefined, [{
      ...readDefinition(),
      unexpected: true,
    }]), /unrecognized|Unrecognized/);
    assert.throws(() => Reflect.apply(defineTaskContract, undefined, [{
      ...readDefinition(),
      errorCodes: [],
    }]), /too_small|Too small/);
    assert.throws(() => Reflect.apply(defineTaskContract, undefined, [{
      ...prepareDefinition(),
      checkpoint: "durable",
    }]), /invalid_value|Invalid input/);
    assert.throws(() => Reflect.apply(defineTaskContract, undefined, [{
      ...commitDefinition(),
      artifacts: "content-addressed",
    }]), /unrecognized|Unrecognized/);
  });

  it("recursively rejects nested open, any/unknown, record, and lazy schema escapes", () => {
    const recursive = z.strictObject({
      variants: z.array(z.union([
        z.strictObject({ safe: z.string() }),
        z.lazy(() => z.object({ escaped: z.string() })),
      ])),
      arbitrary: z.unknown(),
      decisions: z.record(z.string(), z.string()),
      anything: z.any(),
    });
    const issues = auditContractBoundarySchema(recursive, "contract output").join("\n");
    assert.match(issues, /must use z\.strictObject/);
    assert.match(issues, /z\.unknown/);
    assert.match(issues, /decision-bearing record/);
    assert.match(issues, /z\.any/);
    assert.throws(() => defineTaskContract({
      ...readDefinition(),
      input: z.strictObject({ nested: z.object({ eid: EidSchema }) }),
    }), /must use z\.strictObject/);
  });

  it("rejects unknown freshness/provenance paths and cross-system subjects", () => {
    assert.throws(() => defineTaskContract({
      ...readDefinition(),
      freshness: {
        defaultMaxAgeMs: 0,
        byField: [{ path: ContractFieldPathSchema.parse("missing"), maxAgeMs: 0 }],
      },
    }), /unknown schema field missing/);
    assert.throws(() => defineTaskContract({
      ...readDefinition(),
      subject: {
        ...personSubject("before-subject-read"),
        observe: ObservationIdSchema.parse("crm.person.displayed-eid"),
      },
    }), /crosses systems/);
    assert.throws(() => defineTaskContract({
      ...readDefinition(),
      subject: {
        ...personSubject("before-subject-read"),
        expected: {
          fromInput: ContractFieldPathSchema.parse("toString"),
          identity: "eid",
        },
      },
    }), /unknown schema field toString/);
    assert.throws(() => defineTaskContract({
      ...readDefinition(),
      subject: {
        ...personSubject("before-subject-read"),
        match: "normalized-exact-name",
      },
    }), /identity and match are incompatible/);
  });

  it("rejects provider leakage and unsafe commit subject/proof wiring", () => {
    assert.throws(() => defineTaskContract({
      ...readDefinition(),
      providers: ["ocr.extract"],
    }), /only for service-store reads/);
    assert.throws(() => defineTaskContract({
      ...commitDefinition(),
      subject: personSubject("before-subject-read"),
    }), /after prepare and before fence/);
    assert.throws(() => defineTaskContract({
      ...commitDefinition(),
      writeSafety: {
        ...commitDefinition().writeSafety,
        idempotency: {
          ...commitDefinition().writeSafety.idempotency,
          probe: { taskId: TaskIdSchema.parse("crm/search-person"), effect: "read" },
        },
      },
    }), /probe crosses stores/);
    assert.throws(() => defineTaskContract({
      ...commitDefinition(),
      writeSafety: {
        ...commitDefinition().writeSafety,
        idempotency: {
          ...commitDefinition().writeSafety.idempotency,
          probe: { taskId: TaskIdSchema.parse("ucpath/submit-person-org"), effect: "read" },
        },
      },
    }), /read-effect task id/);
    assert.throws(() => defineTaskContract({
      ...commitDefinition(),
      subject: { kind: "none", reason: "the page has no subject" },
    }), /reviewed UnscopedCommitReasonId, not free text/);
    assert.doesNotThrow(() => defineTaskContract({
      ...commitDefinition(),
      subject: { kind: "none", reviewedReasonId: "catalog-global-write" },
    }));
  });

  it("parses closed write safety and requires canonical proof/output agreement", () => {
    const withExtra = commitDefinition();
    assert.throws(() => Reflect.apply(defineTaskContract, undefined, [{
      ...withExtra,
      writeSafety: {
        ...withExtra.writeSafety,
        completion: { ...withExtra.writeSafety.completion, unchecked: true },
      },
    }]), /unrecognized|Unrecognized/);
    assert.throws(() => defineTaskContract({
      ...commitDefinition(),
      writeSafety: {
        ...commitDefinition().writeSafety,
        completion: {
          ...commitDefinition().writeSafety.completion,
          outputFromProof: () => ({ transactionId: "DIFFERENT" }),
        },
      },
    }), /does not reconstruct the canonical output/);
    assert.throws(() => defineTaskContract({
      ...commitDefinition(),
      writeSafety: {
        ...commitDefinition().writeSafety,
        completion: {
          ...commitDefinition().writeSafety.completion,
          proofFromPresentProbe: () => ({ transactionId: "DIFFERENT" }),
        },
      },
    }), /present-probe proof disagrees/);
    assert.throws(() => defineTaskContract({
      ...commitDefinition(),
      writeSafety: {
        ...commitDefinition().writeSafety,
        completion: {
          ...commitDefinition().writeSafety.completion,
          kind: "upload-verify",
          verify: { taskId: TaskIdSchema.parse("ucpath/verify-person-org"), effect: "read" },
          unverifiableByPage: {
            policy: "always-park",
            reason: "unreviewed escape hatch",
            operatorAttestationExample: { transactionId: "T123" },
          },
        },
      },
    }), /not in the reviewed always-park policy/);
  });

  it("deep-copies and freezes parsed metadata without freezing schemas or functions", () => {
    const scenarios = [SCENARIO];
    const byField = [{ path: ContractFieldPathSchema.parse("eid"), maxAgeMs: 0 }];
    const example = { eid: "10800000", found: true as const };
    const contract = defineTaskContract({
      ...readDefinition(),
      scenarios,
      freshness: { defaultMaxAgeMs: 0, byField },
      example,
    });
    scenarios.push(ScenarioIdSchema.parse("ucpath/person-org-empty"));
    byField[0].maxAgeMs = 99;
    example.eid = "10999999";
    assert.equal(contract.scenarios.length, 1);
    assert.equal(contract.freshness.byField?.[0]?.maxAgeMs, 0);
    assert.equal(contract.example.eid, "10800000");
    assert.equal(Object.isFrozen(contract.scenarios), true);
    assert.equal(Object.isFrozen(contract.freshness.byField?.[0]), true);
    assert.equal(contract.output, READ_OUTPUT);
    assert.equal(Object.isFrozen(contract.output), false);
    const commitDefinitionValue = commitDefinition();
    const commit = defineTaskContract(commitDefinitionValue);
    assert.equal(
      commit.writeSafety.completion.proofFromOutput,
      commitDefinitionValue.writeSafety.completion.proofFromOutput,
    );
    assert.equal(Object.isFrozen(commit.writeSafety.completion.proofFromOutput), false);

    const transformedOutput = z.strictObject({
      label: z.string().default(" padded ").transform((value) => value.trim()),
    });
    const transformed = defineTaskContract({
      id: TaskIdSchema.parse("workflow:verify/read-label"),
      title: "Read normalized label",
      effect: "read",
      input: z.strictObject({}),
      output: transformedOutput,
      errorCodes: ["invalid-label"] as const,
      subject: { kind: "none", reason: "pure workflow transform" },
      scenarios: [],
      freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY },
      provenance: { default: "derived" },
      example: {},
    });
    assert.deepEqual(transformed.example, { label: "padded" });
    assert.equal(Object.isFrozen(transformed.example), true);
    assert.equal(transformed.output, transformedOutput);
  });

  it("recursively freezes reviewed unverifiable-by-page policy entries", () => {
    const policy = defineReviewedUnverifiableByPagePolicy({
      schemaVersion: 1,
      contracts: [{
        taskId: TaskIdSchema.parse("onbase/upload-document"),
        reason: "the reviewed page cannot expose a durable receipt",
      }],
    });
    assert.equal(Object.isFrozen(policy), true);
    assert.equal(Object.isFrozen(policy.contracts), true);
    assert.equal(Object.isFrozen(policy.contracts[0]), true);
    assert.equal(Reflect.set(policy.contracts[0], "reason", "mutated"), false);
    assert.equal(policy.contracts[0]?.reason, "the reviewed page cannot expose a durable receipt");
    assert.equal(Object.isFrozen(REVIEWED_UNVERIFIABLE_BY_PAGE_POLICY), true);
    assert.equal(Object.isFrozen(REVIEWED_UNVERIFIABLE_BY_PAGE_POLICY.contracts), true);
  });

  it("enforces derived scenario tiers and resolves scenario/probe references when a corpus exists", () => {
    assert.throws(() => defineTaskContract({ ...readDefinition(), scenarios: [] }), /derived declaration tier/);
    const read = readContract();
    const commit = commitContract();
    const corpus = {
      scenarioIds: [SCENARIO],
      tasks: [{ id: read.id, effect: "read" as const }, { id: commit.id, effect: "commit" as const }],
    };
    assert.doesNotThrow(() => assertTaskContractReferences(read, corpus));
    assert.doesNotThrow(() => assertTaskContractReferences(commit, corpus));
    assert.throws(
      () => assertTaskContractReferences(commit, { ...corpus, tasks: [{ id: read.id, effect: "commit" }] }),
      /not a read contract/,
    );
    assert.throws(
      () => assertTaskContractReferences(read, { ...corpus, scenarioIds: [] }),
      /unresolved scenario/,
    );
    const saveVerify = defineTaskContract({
      ...commitDefinition(),
      writeSafety: {
        ...commitDefinition().writeSafety,
        completion: {
          ...commitDefinition().writeSafety.completion,
          kind: "save-verify",
          verify: { taskId: TaskIdSchema.parse("ucpath/verify-person-org"), effect: "read" },
        },
      },
    });
    assert.throws(
      () => assertTaskContractReferences(saveVerify, corpus),
      /unresolved read task ucpath\/verify-person-org/,
    );
  });

  it("defers dynamic idempotency-key validation until execution has parsed input", () => {
    assert.doesNotThrow(() => defineTaskContract({
      ...commitDefinition(),
      writeSafety: {
        ...commitDefinition().writeSafety,
        idempotency: {
          ...commitDefinition().writeSafety.idempotency,
          key: () => { throw new Error("execution-only input"); },
        },
      },
    }));
  });

  it("emits typed task errors and wraps unknown failures without claiming transient", () => {
    const contract = readContract();
    const fail = taskFailer(contract);
    assert.throws(
      () => fail("eid-not-found", "no row for EID 10800000", { subject: "10800000" }),
      (error) => error instanceof TaskError
        && error.message === "[ucpath/search-person-org] eid-not-found: no row for EID 10800000"
        && error.subject === "10800000"
        && error.transient === false,
    );
    const wrapped = wrapUnhandledTaskError(contract.id, new Error("boom"));
    assert.equal(wrapped.code, "unhandled");
    assert.equal(wrapped.transient, false);
    assert.match(wrapped.message, /\[ucpath\/search-person-org\] unhandled: boom/);
  });
});
