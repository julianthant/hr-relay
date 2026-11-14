import { createDryRunPreviewResultTestWorld } from "../../../support/helpers/backend/dry-run-preview-result-world.js";
import assert from "node:assert/strict";

import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { ReadWorkbookResult } from "../../../../src/models/processing/workbooks/read-result.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { DelegationEdgeIdSchema, EidSchema, ItemIdSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { buildRunPreviewResult } from "../../../../src/backend/runs/lifecycle/run-result.js";
import { WRITE_FIXTURE_EID, WRITE_FIXTURE_FINGERPRINT, WRITE_FIXTURE_NODE_ID, WRITE_FIXTURE_NOW, writeFixtureQueuedRun, WRITE_FIXTURE_RUN_ID, WRITE_FIXTURE_WORKER_ID, writeFixtureDescriptor } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const {PREVIEW_RESULT_SCHEMA_HASH, harness, cleanup } = createDryRunPreviewResultTestWorld();


afterEach(cleanup);

function terminalRun(database: AuthorityDatabase) {
  const record = database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
  assert.ok(record, "the run row must exist");
  return record;
}

describe("a dry run retains transaction preview accounting", () => {

  it("refuses to build a preview result for a run the operator did not ask to preview", async () => {
    const h = await harness();
    await h.run({ dryRun: false });

    // The run committed for real, so its terminal record is the derived result.
    const result = h.database.authority.runResults.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(result);
    assert.notEqual(result.resultSchemaHash, PREVIEW_RESULT_SCHEMA_HASH);


    assert.throws(
      () => buildRunPreviewResult(
        writeFixtureDescriptor,
        { ...terminalRun(h.database), completion: undefined, lifecycle: { state: "running", workerId: WRITE_FIXTURE_WORKER_ID,
          claimedAt: WRITE_FIXTURE_NOW, heartbeatAt: WRITE_FIXTURE_NOW } },
        {
          kind: "transaction-dry-run-preview",
          nodeId: WRITE_FIXTURE_NODE_ID,
          prepare: { schemaHash: "a".repeat(64), value: {} },
          subject: { state: "unscoped", reviewedReasonId: "unscoped" },
          observedAt: WRITE_FIXTURE_NOW,
        },
        [],
        h.clock,
      ),
      /is not a dry run; a preview result may not be built for it/,
    );
  });
});

describe("a publication preview is built only for a declared publication node", () => {
  const Input = z.strictObject({ eid: EidSchema });
  const command = () => ({ name: "Results", table: { name: "Results", columns: ["a"], rows: [{ id: "1", values: ["v"] }] } });
  const descriptor = (delegating: boolean) => {
    const saved = flow(Input).step("save", ReadWorkbookResult, { dependsOn: [], replay: "checkpoint", bind: command, dryRun: "stop-before-publish" })
      .step("read", ReadWorkbookResult, { dependsOn: ["save"], replay: "checkpoint", bind: command });
    const built = delegating ? saved.childRun("members", {
      id: WorkflowIdSchema.parse("person-lookup"), input: z.strictObject({ emplId: z.string().min(1) }), result: z.strictObject({ ok: z.boolean() }),
    }, { dependsOn: [], edgeId: DelegationEdgeIdSchema.parse("members"), cardinality: "one", bind: () => ({ emplId: WRITE_FIXTURE_EID }),
      deriveChildItemId: () => ItemIdSchema.parse(UUID_7), await: "terminal", join: "one",
      policy: { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" } })
      .build({ schema: z.strictObject({ ok: z.boolean() }), dependsOn: ["read"], derive: () => ({ ok: true }) })
      : saved.build({ schema: z.strictObject({ ok: z.boolean() }), dependsOn: ["read"], derive: () => ({ ok: true }) });
    return defineWorkflowDescriptor({ id: "write-fixture", version: 1, contractFingerprint: WRITE_FIXTURE_FINGERPRINT, code: "wf", label: "Publication fixture",
      icon: "ShieldCheck", category: "operations", canonicalInput: defineCanonicalInput(Input, Input, [{ eid: WRITE_FIXTURE_EID }]), inputSubject: "eid",
      surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, details: [],
      identity: { matchKey: (input: z.output<typeof Input>) => `eid:${input.eid}` }, presentation: { title: (input: z.output<typeof Input>) => input.eid },
      scenarios: ["write-fixture/happy"], flow: built } as never);
  };
  const running = () => RunRecordSchema.parse({ ...writeFixtureQueuedRun({ dryRun: true }), claimGeneration: 1, version: 2,
    lifecycle: { state: "running", workerId: WRITE_FIXTURE_WORKER_ID, claimedAt: WRITE_FIXTURE_NOW, heartbeatAt: WRITE_FIXTURE_NOW } });
  const build = (steps: unknown, delegating = false) =>
    buildRunPreviewResult(descriptor(delegating), running(), steps, [], manualClock(new Date(WRITE_FIXTURE_NOW)));
  const read = { nodeId: "read", state: "unavailable", reason: "requires-unsubmitted-output" };
  const publication = { nodeId: "save", state: "publication-preview" };

  it("builds a publication-dry-run-preview result for a declared node", () => {
    const { record } = build([publication, read]);
    assert.equal((record.result.value as { kind: string }).kind, "publication-dry-run-preview");
  });

  it("refuses a publication-preview step on a node that does not declare stop-before-publish", () => {
    assert.throws(() => build([publication, { nodeId: "read", state: "publication-preview" }]),
      /dry-run preview publication membership mismatch/u);
  });

  it("refuses an exercised step on a declared publication node", () => {
    assert.throws(() => build([{ nodeId: "save", state: "exercised" }, read]), /a preview cannot claim a publication executed/u);
  });

  it("refuses a publication preview combined with a delegated preview", () => {
    assert.throws(() => build([publication, read, { nodeId: "members", state: "delegation-preview" }], true),
      /dry-run preview cannot combine publication and delegated previews/u);
  });
});
