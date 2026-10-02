import assert from "node:assert/strict";
import { z } from "zod";
import { describe, it } from "vitest";
import { flow } from "../../../../src/base/flow.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../../../src/domain/contracts/base.js";
import {
  DelegationEdgeIdSchema,
  EidSchema,
  ItemIdSchema,
  ObservationIdSchema,
  ScenarioIdSchema,
  TaskIdSchema,
  WorkflowIdSchema,
  taskId,
} from "../../../../src/domain/ids.js";
import type { ItemId } from "../../../../src/domain/ids.js";
import {
  assertGraphScenarioCoverage,
  auditGraphScenarioCoverage,
  deriveGraphCoveragePoints,
} from "../../../../src/domain/workflow/scenario-coverage.js";
import type { ScenarioCoverageClaim } from "../../../../src/domain/workflow/scenario-coverage.js";
import type { DelegationPolicy } from "../../../../src/domain/workflow/delegation-policy.js";
import type { RuntimeFlowNode, WorkflowRef } from "../../../../src/domain/workflow/graph.js";

const SCENARIO = ScenarioIdSchema.parse("workflow/coverage");
const INPUT = z.strictObject({ eid: EidSchema });

const read = defineTaskContract({
  id: taskId("ucpath/search-person-org"),
  title: "Search Person Org",
  effect: "read",
  input: INPUT,
  output: z.strictObject({ eid: EidSchema }),
  errorCodes: ["eid-not-found"] as const,
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("eid"), identity: "eid" },
    observe: ObservationIdSchema.parse("ucpath.person-org.displayed-eid"),
    match: "normalized-exact-eid",
    requiredAt: "before-subject-read",
  },
  scenarios: [SCENARIO],
  freshness: { defaultMaxAgeMs: 0 },
  provenance: { default: "live" },
  example: { eid: "10800000" },
});

const readTwo = defineTaskContract({
  id: taskId("crm/read-contact"),
  title: "Read CRM contact",
  effect: "read",
  input: INPUT,
  output: z.strictObject({ eid: EidSchema }),
  errorCodes: ["contact-missing"] as const,
  subject: { kind: "none", reason: "keyed by EID" },
  scenarios: [SCENARIO],
  freshness: { defaultMaxAgeMs: 0 },
  provenance: { default: "live" },
  example: { eid: "10800000" },
});

const prepare = defineTaskContract({
  id: taskId("ucpath/fill-termination"),
  title: "Fill termination",
  effect: "prepare",
  input: INPUT,
  output: z.strictObject({ stagedRows: z.number().int() }),
  errorCodes: ["fill-failed"] as const,
  subject: { kind: "none", reason: "prepare fixture" },
  scenarios: [SCENARIO],
  checkpoint: "in-memory-only",
  example: { stagedRows: 1 },
});

const PROOF = z.strictObject({ transactionId: z.string() });
const commit = defineTaskContract({
  id: taskId("ucpath/submit-termination"),
  title: "Submit termination",
  effect: "commit",
  input: INPUT,
  output: PROOF,
  errorCodes: ["submit-failed"] as const,
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("eid"), identity: "eid" },
    observe: ObservationIdSchema.parse("ucpath.person-org.displayed-eid"),
    match: "normalized-exact-eid",
    requiredAt: "after-prepare-before-fence",
  },
  scenarios: [SCENARIO],
  writeSafety: {
    completion: {
      kind: "receipt" as const,
      proofSchema: PROOF,
      proofFromOutput: (output: z.output<typeof PROOF>) => output,
      proofFromPresentProbe: ({ proof }: { proof: z.output<typeof PROOF> }) => proof,
      outputFromProof: (proof: z.output<typeof PROOF>) => proof,
    },
    idempotency: {
      probe: { taskId: TaskIdSchema.parse("ucpath/search-person-org"), effect: "read" as const },
      key: ({ eid }: { eid: string }) => `${eid}|termination`,
      recoveryAbsence: {
        kind: "stabilized" as const,
        minSinceFenceMs: 1_000,
        consistentReads: 2 as const,
        minBetweenReadsMs: 500,
        requireSameSourceState: true as const,
      },
    },
  },
  example: { transactionId: "T1" },
});

const child: WorkflowRef<typeof INPUT, z.ZodObject<{ verified: z.ZodBoolean }>> = {
  id: WorkflowIdSchema.parse("verify"),
  input: INPUT,
  result: z.object({ verified: z.boolean() }),
};
const POLICY: DelegationPolicy = {
  onChildFailed: "fail-parent",
  cascadeCancel: "cascade",
  afterChildRetry: "resume-parent",
  visibility: "inline",
};
const childItemId = (): ItemId => ItemIdSchema.parse("00000000-0000-4000-8000-000000000001");

/** A graph with one of every path-bearing node kind. */
function graphNodes(): readonly RuntimeFlowNode[] {
  const built = flow(INPUT)
    .step("search", read, {
      dependsOn: [],
      bind: ({ input }) => ({ eid: input.eid }),
      replay: "checkpoint",
    })
    .step("contact", readTwo, {
      dependsOn: ["search"],
      bind: ({ outputs }) => ({ eid: outputs.search.eid }),
      replay: "checkpoint",
    })
    .branch("mode", {
      dependsOn: ["search"],
      choose: ({ input }) => (input.eid === "10800000" ? "write" : "read-only"),
      cases: { write: ["approval"], "read-only": ["verify-many"] },
    })
    .gate("approval", {
      dependsOn: ["search"],
      label: "Approve",
      resolvedBy: "operator",
      result: z.object({ approved: z.boolean() }),
    })
    .childRun("verify-many", child, {
      dependsOn: ["search"],
      edgeId: DelegationEdgeIdSchema.parse("verify-many"),
      cardinality: "many",
      bind: ({ outputs }) => [{ eid: outputs.search.eid }],
      deriveChildItemId: childItemId,
      await: "terminal",
      join: "all",
      policy: POLICY,
    })
    .childRun("notify", child, {
      dependsOn: ["search"],
      edgeId: DelegationEdgeIdSchema.parse("notify"),
      cardinality: "many",
      bind: ({ outputs }) => [{ eid: outputs.search.eid }],
      deriveChildItemId: childItemId,
      await: "none",
      join: "none",
      policy: POLICY,
    })
    .transaction("terminate", {
      dependsOn: ["search", "approval"],
      prepare: { uses: prepare, bind: ({ outputs }) => ({ eid: outputs.search.eid }) },
      commit: { uses: commit, bind: ({ outputs }) => ({ eid: outputs.search.eid }) },
      dryRun: "stop-after-prepare",
      probePolicy: "always",
      probeToFenceMaxMs: 30_000,
    })
    .build({
      schema: z.object({ eid: EidSchema }),
      dependsOn: ["search"],
      derive: ({ outputs }) => ({ eid: outputs.search.eid }),
    });
  return built.nodes as readonly RuntimeFlowNode[];
}

function fullCoverage(points: readonly { id: string }[]): readonly ScenarioCoverageClaim[] {
  return points.map((point, index) => ({
    scenarioId: ScenarioIdSchema.parse(`workflow/coverage-${String(index)}`),
    covers: [point.id],
  }));
}

describe("graph scenario coverage", () => {
  const points = deriveGraphCoveragePoints(graphNodes());
  const ids = points.map(({ id }) => id);

  it("derives one point per branch arm", () => {
    assert.ok(ids.includes("branch-case:mode/write"));
    assert.ok(ids.includes("branch-case:mode/read-only"));
  });

  it("derives open and resolve points for a gate", () => {
    assert.ok(ids.includes("gate:approval/opened"));
    assert.ok(ids.includes("gate:approval/resolved"));
  });

  it("derives zero/one/many fan-out plus replay for a many-cardinality delegation", () => {
    for (const suffix of ["fan-out-zero", "fan-out-one", "fan-out-many", "replay"]) {
      assert.ok(ids.includes(`delegation:verify-many/${suffix}`), suffix);
    }
  });

  it("derives a point for each declared delegation policy on an awaited edge", () => {
    assert.ok(ids.includes("delegation:verify-many/on-child-failed-fail-parent"));
    assert.ok(ids.includes("delegation:verify-many/cascade-cancel-cascade"));
    assert.ok(ids.includes("delegation:verify-many/after-child-retry-resume-parent"));
  });

  it("derives no join-policy points for an un-awaited fan-out", () => {
    assert.ok(ids.includes("delegation:notify/fan-out-many"));
    assert.ok(!ids.some((id) => id.startsWith("delegation:notify/on-child-failed")));
    assert.ok(!ids.some((id) => id.startsWith("delegation:notify/cascade-cancel")));
  });

  it("derives dry-run, subject-mismatch, committed, and already-present for a transaction", () => {
    for (const suffix of ["dry-run", "subject-mismatch", "committed", "already-present"]) {
      assert.ok(ids.includes(`transaction:terminate/${suffix}`), suffix);
    }
  });

  it("derives nothing for plain task steps — the contract already requires their scenarios", () => {
    assert.ok(!ids.some((id) => id.endsWith(":search/") || id.includes(":contact/")));
  });

  it("passes when every derived point is claimed", () => {
    assert.deepEqual(auditGraphScenarioCoverage(points, fullCoverage(points)), []);
    assert.doesNotThrow(() => {
      assertGraphScenarioCoverage("person-lookup", points, fullCoverage(points));
    });
  });

  it("reports every uncovered path, not just the first", () => {
    const partial = fullCoverage(points).slice(0, 2);
    const violations = auditGraphScenarioCoverage(points, partial);
    assert.equal(violations.length, points.length - 2);
    assert.ok(violations.every((violation) => violation.startsWith("uncovered graph path ")));
  });

  it("rejects a scenario claiming a coverage point that no longer exists", () => {
    const claims = [
      ...fullCoverage(points),
      { scenarioId: ScenarioIdSchema.parse("workflow/stale"), covers: ["branch-case:mode/renamed-arm"] },
    ];
    assert.match(
      auditGraphScenarioCoverage(points, claims).join("; "),
      /workflow\/stale claims unknown coverage point branch-case:mode\/renamed-arm/,
    );
  });

  it("rejects a scenario that claims nothing, or claims the same point twice", () => {
    assert.match(
      auditGraphScenarioCoverage(points, [{ scenarioId: ScenarioIdSchema.parse("workflow/empty"), covers: [] }]).join("; "),
      /workflow\/empty claims no coverage point/,
    );
    const doubled = ids[0];
    assert.ok(doubled !== undefined);
    assert.match(
      auditGraphScenarioCoverage(points, [{ scenarioId: ScenarioIdSchema.parse("workflow/dup"), covers: [doubled, doubled] }]).join("; "),
      /workflow\/dup lists coverage point .* twice/,
    );
  });

  it("fails loud with the workflow named when coverage is incomplete", () => {
    assert.throws(
      () => { assertGraphScenarioCoverage("person-lookup", points, []); },
      /workflow person-lookup scenario coverage is incomplete/,
    );
  });
});
