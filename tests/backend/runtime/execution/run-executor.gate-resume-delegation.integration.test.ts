import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { DelegationTerminalEvidenceSchema, terminalEvidenceResult } from "../../../../src/models/run/result.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);

for (const mutation of ["missing-proof", "foreign-parent", "altered-schema", "changed-after-plan"] as const) {
  it(`refuses ${mutation} child proof before replaying an approved same-run gate resume`, async () => {
    const f = await world.fixture({ record: true, release: true });
    assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "applied");
    const approval = f.approval();
    assert.equal(f.canonical.kernel.execute(approval).state, "applied");
    const snapshot = f.database.authority.ocrReviews.snapshot(approval.commandId); assert.ok(snapshot);
    const manifests = f.database.authority.delegationManifests.listByParentRun(f.run.envelope.runId);
    const children = manifests.flatMap(manifest => manifest.children.map(child => f.database.authority.runs.get(child.childRunId)));
    let childCalls = 0, reads = 0;
    const execute = f.canonical.childRuns.executeChildRuns.bind(f.canonical.childRuns);
    f.canonical.childRuns.executeChildRuns = context => { childCalls += 1; return execute(context); };
    const transact = f.database.withAuthorityTransaction.bind(f.database);
    f.database.withAuthorityTransaction = work => transact(repositories => work({ ...repositories,
      ...(mutation === "missing-proof" ? {
        delegationManifests: { ...repositories.delegationManifests, listByParentRun: parentRunId =>
          parentRunId === f.run.envelope.runId ? [] : repositories.delegationManifests.listByParentRun(parentRunId) },
        lifecycleJournal: { ...repositories.lifecycleJournal, listDelegationInvocations: parentRunId =>
          parentRunId === f.run.envelope.runId ? [] : repositories.lifecycleJournal.listDelegationInvocations(parentRunId) },
      } : {}),
      dependencies: { ...repositories.dependencies, evidence: (parentRunId, nodeId) => {
        const evidence = repositories.dependencies.evidence(parentRunId, nodeId);
        if (parentRunId !== f.run.envelope.runId || nodeId !== "read-pages") return evidence;
        reads += 1;
        if (mutation === "changed-after-plan" && reads === 1) return evidence;
        return DelegationTerminalEvidenceSchema.parse(mutation === "foreign-parent"
          ? { ...evidence, parentRunId: randomUUID() }
          : { ...evidence, manifest: { ...evidence.manifest, resultSchemaHash: "a".repeat(64) } });
      }, ...(mutation === "missing-proof" ? { listByParentRun: (parentRunId: string) =>
        parentRunId === f.run.envelope.runId ? [] : repositories.dependencies.listByParentRun(parentRunId) } : {}) },
    }));
    try {
      const resumed = await f.canonical.execute(f.run, new AbortController().signal);
      assert.ok(resumed.run?.lifecycle.state === "terminal" && resumed.run.lifecycle.outcome === "failed");
      const failure = resumed.outcomes.find(outcome => outcome.state === "failed"); assert.ok(failure?.state === "failed");
      assert.equal(f.database.authority.failures.get(failure.failureId)?.code, "RUN_CONTINUATION_REFUSED");
      assert.equal(childCalls, 0);
      const result = f.database.authority.runResults.get(f.run.envelope.runId); assert.ok(result);
      assert.equal(terminalEvidenceResult(result)?.kind, "failed-evidence");
    } finally { f.database.withAuthorityTransaction = transact; f.canonical.childRuns.executeChildRuns = execute; }
    assert.deepEqual(f.database.authority.delegationManifests.listByParentRun(f.run.envelope.runId), manifests);
    assert.deepEqual(manifests.flatMap(manifest => manifest.children.map(child => f.database.authority.runs.get(child.childRunId))), children);
    assert.deepEqual(f.database.authority.ocrReviews.snapshot(approval.commandId), snapshot);
  });
}
