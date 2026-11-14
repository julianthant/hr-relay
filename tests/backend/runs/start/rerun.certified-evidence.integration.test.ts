import assert from "node:assert/strict";
import { it } from "vitest";
import { predecessorSeparationsRerun } from "../../../support/helpers/backend/predecessor-separations-rerun.js";

it("reads retained predecessor Separations values, warnings and fresh plans with exact source certificates", async () => {
  const f = await predecessorSeparationsRerun({ keepOpen: true });
  try {
    const { collectEvidenceSchemaAdmissions } = await import("../../../../src/backend/storage/sqlite/evidence-schema-upgrade.js");
    const { evidenceSchemaSourceDigest } = await import("../../../../src/models/storage/evidence-schema-admission.js");
    const { canonicalJsonStringify } = await import("../../../../src/rules/validation/canonical-json.js");
    const { separationsDescriptor: descriptor } = await import("../../../support/helpers/registered-workflows.js");
    const { readRerunValues } = await import("../../../../src/backend/runs/start/rerun-values.js");
    const { createStartPlanService } = await import("../../../../src/backend/runs/commands/start-plan-service.js");
    const { sequentialIdFactory } = await import("../../../support/fixtures/phase1f-run-fixtures.js");
    const { protectedSecretSource } = await import("../../../support/helpers/protected-secret-source.js");
    const { repeatEvidenceDigest } = await import("../../../../src/models/run/rerun.js");
    const { admissions, retirements } = collectEvidenceSchemaAdmissions({ descriptors: [descriptor], runs: [f.run], writes: f.writes,
      checkpoints: f.checkpoints, results: [f.result], gates: [] });
    // The pre-initials Separations input is retired history, so its sealed retirement answers with the stored hash, as production does.
    assert.ok(retirements.some(entry => entry.owner.id === f.run.envelope.runId));
    const schemaReader: import("../../../../src/models/storage/evidence-schema-admission.js").EvidenceSchemaReader = (owner, source, oldHash, currentHash) => {
      if (oldHash === currentHash) return oldHash;
      const retired = retirements.find(entry => canonicalJsonStringify(entry.owner) === canonicalJsonStringify(owner));
      if (retired !== undefined) {
        assert.equal(retired.sourceDigest, evidenceSchemaSourceDigest(owner, source)); assert.equal(retired.sourceSchemaHash, oldHash); return oldHash;
      }
      const proof = admissions.find(entry => canonicalJsonStringify(entry.owner) === canonicalJsonStringify(owner));
      assert.ok(proof); assert.equal(proof.sourceDigest, evidenceSchemaSourceDigest(owner, source));
      assert.equal(proof.sourceSchemaHash, oldHash); assert.equal(proof.currentSchemaHash, currentHash); return currentHash;
    };
    const request = { runId: f.run.envelope.runId, expectedVersion: f.run.version };
    const descriptors = { resolve: () => descriptor }, reader = { read: () => ({ state: "present" as const, disposition: "live" as const, run: f.run }) };
    const database = { authority: f.database.authority, withAuthorityReadSnapshot: f.database.withAuthorityReadSnapshot.bind(f.database) };
    assert.deepEqual(readRerunValues({ database, reader, descriptors }, request), { state: "refused", code: "source-invalid" });
    const invalidReaders: (typeof schemaReader)[] = [];
    for (const defect of ["missing", "changed-source", "foreign-owner", "future-selector"] as const) {
      const entries = admissions.map(entry => ({ ...entry }));
      if (defect === "missing") entries.splice(0);
      else if (defect === "changed-source") for (const entry of entries) entry.sourceDigest = "f".repeat(64) as typeof entry.sourceDigest;
      else if (defect === "foreign-owner") for (const entry of entries) entry.owner = { kind: "run-input", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
      else for (const entry of entries) entry.currentSchemaHash = "f".repeat(64) as typeof entry.currentSchemaHash;
      const invalidReader: typeof schemaReader = (owner, source, oldHash, currentHash) => {
        if (oldHash === currentHash) return oldHash;
        const proof = entries.find(entry => canonicalJsonStringify(entry.owner) === canonicalJsonStringify(owner));
        if (proof === undefined || proof.sourceDigest !== evidenceSchemaSourceDigest(owner, source)
          || proof.sourceSchemaHash !== oldHash || proof.currentSchemaHash !== currentHash) throw new Error(`invalid-certificate-${defect}`);
        return currentHash;
      };
      invalidReaders.push(invalidReader);
      assert.deepEqual(readRerunValues({ database: { ...database, evidenceSchemaHash: invalidReader }, reader, descriptors }, request),
        { state: "refused", code: "source-invalid" }, defect);
    }
    const certified = { ...database, evidenceSchemaHash: schemaReader };
    const values = readRerunValues({ database: certified, reader, descriptors }, request);
    assert.equal(values.state, "available"); if (values.state !== "available") throw new Error("certified-rerun-values-refused");
    const settled = f.writes.find(intent => intent.status === "committed"); assert.ok(settled);
    const digest = repeatEvidenceDigest(settled, f.run.input.parsed.protectedBindings);
    assert.ok(values.snapshot.transactions.some(transaction => transaction.writeIntentId === settled.writeIntentId && transaction.evidenceDigest === digest));
    const active = f.database.authority.runtimeConfig.get(); assert.ok(active);
    const service = (certify: boolean, certificateReader = schemaReader, repositories = f.database.authority) => createStartPlanService({ authority: { withAuthorityTransaction: work => f.database.withAuthorityTransaction(() => work(repositories)) },
      authorityRead: { authority: repositories, ...(certify ? { evidenceSchemaHash: certificateReader } : {}) }, descriptors,
      clock: f.clock, ids: sequentialIdFactory("b"), planTtlMs: 600_000, configFingerprint: active.configFingerprint,
      configSnapshotId: active.configSnapshotId, plannedBy: "local-operator", protectedSecrets: protectedSecretSource({ profileName: "Current Admitted Full Name" }) });
    const source = { ...request, intent: "rerun", selectedStepKeys: descriptor.timeline.map(step => step.key) };
    assert.throws(() => service(false).previewWarnings({ workflowId: descriptor.id, source }));
    const planner = service(true), warning = planner.previewWarnings({ workflowId: descriptor.id, source });
    assert.ok(warning.rerun.warnings.some(entry => entry.evidenceDigest === digest));
    const documentNumber: unknown = Reflect.get(Object(f.run.input.parsed.value), "documentNumber");
    const submission = { documentNumber };
    const input = { workflowId: descriptor.id, submissions: [submission], dryRun: true, selectedStepKeys: source.selectedStepKeys,
      rerunSource: source, warningAcknowledgment: warning.rerun.warningDigest };
    for (const invalidReader of invalidReaders) {
      const invalid = service(true, invalidReader);
      assert.throws(() => invalid.previewWarnings({ workflowId: descriptor.id, source }), error => error instanceof Error && "code" in error && error.code === "schema-mismatch");
      assert.throws(() => invalid.plan(input), error => error instanceof Error && "code" in error && error.code === "schema-mismatch");
    }
    assert.ok(settled.status === "committed");
    const { completionProof: _proof, confirmedAt: _confirmed, ...attempt } = settled;
    const { WriteIntentRecordSchema } = await import("../../../../src/rules/write-safety/write-safety.js");
    const parked = WriteIntentRecordSchema.parse({ ...attempt, status: "parked", parkedCode: "unknown", message: "synthetic unknown submit",
      authorityReason: { version: 1, code: "post-click-verifier-unknown", evidence: { kind: "probe", digest: "e".repeat(64) } } });
    const uncertain = { ...f.database.authority, writeIntents: { ...f.database.authority.writeIntents, listByRun: () => [parked] } };
    assert.deepEqual(readRerunValues({ database: { ...certified, authority: uncertain }, reader, descriptors }, request), { state: "refused", code: "source-ineligible" });
    const unknown = service(true, schemaReader, uncertain);
    assert.throws(() => unknown.previewWarnings({ workflowId: descriptor.id, source }), error => error instanceof Error && "code" in error && error.code === "invalid-state");
    assert.throws(() => unknown.plan(input), error => error instanceof Error && "code" in error && error.code === "invalid-state");
    const plan = planner.plan(input); assert.equal(plan.refused.length, 0); assert.equal(plan.rerun?.warningDigest, warning.rerun.warningDigest);
    const retained = f.database.authority.startPlans.get(plan.startPlanId); assert.ok(retained);
    assert.equal(Reflect.get(Object(retained.planned[0]?.input.value), "timekeeperName"), "Current Admitted Full Name");
    const { descriptorRuntimeNodes } = await import("../../../../src/workflow-kit/workflow.js");
    const transaction = descriptorRuntimeNodes(descriptor).find(node => node.kind === "transaction" && node.commit.uses.id === "kuali/save-separation-finalization");
    assert.ok(transaction?.kind === "transaction");
    const freshInput = retained.planned[0]?.input.value; assert.ok(freshInput);
    const mapped = transaction.commit.uses.input.parse(transaction.commit.bind({ input: freshInput,
      outputs: Object.fromEntries(f.checkpoints.map(checkpoint => [checkpoint.nodeId, checkpoint.output.value])) }));
    const variables: unknown = Reflect.get(Object(mapped), "variables");
    assert.match(String(Reflect.get(Object(variables), "timekeeperComments")), /-CAFN(?:\s|$)/u);
    assert.throws(() => planner.plan({ ...input, submissions: [{ ...submission, timekeeperName: "Caller Override" }] }));
    for (const wire of [values, warning, plan]) {
      assert.equal(JSON.stringify(wire).includes("Deterministic Timekeeper"), false);
      assert.equal(JSON.stringify(wire).includes("Current Admitted Full Name"), false);
    }
    assert.deepEqual(f.database.authority.runs.get(f.run.envelope.runId), f.run);
    assert.deepEqual(f.database.authority.writeIntents.listByRun(f.run.envelope.runId), f.writes);
  } finally { await f.cleanup(); }
});
