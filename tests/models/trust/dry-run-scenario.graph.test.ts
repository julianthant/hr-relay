import assert from "node:assert/strict";
import { it } from "vitest";
import { z } from "zod";
import { LIVE_READ_ADMITTED_NODE_KINDS, liveReadGraphRefusal } from "../../support/helpers/dry-run-scenario-fixtures.js";
import { defineCanonicalInput } from "../../../src/models/workflow/canonical-input.js";
import { GraphNodeKindSchema } from "../../../src/models/workflow/graph.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/models/workflow/presentation.js";
import { DelegationEdgeIdSchema, ItemIdSchema, WorkflowIdSchema } from "../../../src/rules/identity/ids.js";
import { flow } from "../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor, workflowDryRunSupport } from "../../../src/workflow-kit/workflow.js";
import { HASH_A, UUID_7 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { EXECUTOR_EID } from "../../support/helpers/phase1f-executor-harness.js";
import { personLookupDescriptor, separationsDescriptor } from "../../support/helpers/registered-workflows.js";

  it("refuses the live-read arm for a delegating graph: a child run's writes live under its own run, outside this run's zero-delta proof", () => {
    const DelegateInput = z.strictObject({ name: z.string().min(1) });
    const delegatingFlow = flow(DelegateInput)
      .childRun("delegate", {
        id: WorkflowIdSchema.parse("person-lookup"),
        input: z.strictObject({ emplId: z.string().min(1) }),
        result: z.strictObject({ ok: z.boolean() }),
      }, {
        dependsOn: [],
        edgeId: DelegationEdgeIdSchema.parse("live-read-delegate"),
        cardinality: "one",
        bind: () => ({ emplId: EXECUTOR_EID }),
        deriveChildItemId: () => ItemIdSchema.parse(UUID_7),
        await: "terminal",
        join: "one",
        policy: {
          onChildFailed: "fail-parent",
          cascadeCancel: "cascade",
          afterChildRetry: "resume-parent",
          visibility: "inline",
        },
      })
      .build({ schema: z.strictObject({ ok: z.boolean() }), dependsOn: [], derive: () => ({ ok: true }) });
    const delegating = defineWorkflowDescriptor({
      id: "live-read-delegating-fixture",
      version: 1,
      contractFingerprint: HASH_A,
      code: "ld",
      label: "Delegating fixture",
      icon: "Search",
      category: "operations",
      canonicalInput: defineCanonicalInput(DelegateInput, DelegateInput, [{ name: "Battistessa, Johnnie" }]),
      inputSubject: "name",
      surface: { shape: "single" },
      enqueue: "reject-active",
      actions: STANDARD_WORKFLOW_ACTIONS,
      surfaces: {},
      details: [],
      identity: { matchKey: (input: z.output<typeof DelegateInput>) => `name:${input.name}` },
      presentation: { title: (input: z.output<typeof DelegateInput>) => input.name },
      scenarios: ["live-read-delegating-fixture/happy"],
      flow: delegatingFlow,
    });
    // No transaction node, so the transaction refusal cannot be what fires.
    assert.deepEqual(workflowDryRunSupport(delegating), { state: "unsupported", reason: "no-transaction-node" });
    assert.match(
      liveReadGraphRefusal(delegating, "fixture/live-read") ?? "",
      /live-read manifest fixture\/live-read names workflow live-read-delegating-fixture, whose compiled graph carries child-run node\(s\) delegate; a delegating graph runs its child under its own run and write intents, which this run's zero-delta proof cannot see — no live-read arm admits it/u,
    );
    assert.equal(liveReadGraphRefusal(personLookupDescriptor, "person-lookup/live-read"), undefined);
    assert.match(liveReadGraphRefusal(separationsDescriptor, "separations/live-read") ?? "", /transaction node\(s\)/u);
  });

  it("classifies every graph node kind for the live-read arm: admitted kinds plus the two refused kinds are exactly the vocabulary", () => {

    const refused = ["transaction", "child-run"] as const;
    for (const kind of refused) assert.equal(LIVE_READ_ADMITTED_NODE_KINDS.has(kind), false);
    assert.deepEqual(
      [...GraphNodeKindSchema.options].sort(),
      [...LIVE_READ_ADMITTED_NODE_KINDS, ...refused].sort(),
    );
  });
