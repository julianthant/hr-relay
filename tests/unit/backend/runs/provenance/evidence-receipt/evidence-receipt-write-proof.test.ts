
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  buildRunEvidenceReceipt,
  deriveActionWriteProof,
  ensureRunEvidenceReceipt,
  type EvidenceReceiptStore,
  type ReceiptWriteEvidence,
} from "../../../../../../src/backend/runs/provenance/evidence-receipt.js";
import { RunEvidenceReceiptSchema, type RunEvidenceReceipt } from "../../../../../../src/models/trust/evidence.js";
import { deriveIdempotencyKeyDigest, WriteIntentRecordSchema } from "../../../../../../src/rules/write-safety/write-safety.js";
import { KualiSaveSeparationFinalization } from "../../../../../../src/models/systems/kuali/save-separation-finalization.js";
import { separationsKualiFinalizationDescriptor } from "../../../../../support/helpers/registered-workflows.js";
import {
  KUALI_CONFIRMED_AT,
  KUALI_IDEMPOTENCY_KEY,
  KUALI_DOCUMENT_NUMBER,
  KUALI_EID,
  KUALI_VALUE,
  KUALI_RUN_ID,
  kualiReceiptEvidence,
} from "../../../../../support/fixtures/receipt-run-fixtures.js";

function commitActionOfReceipt(receipt: RunEvidenceReceipt) {
  const commit = receipt.actions.find((action) => action.kind === "commit");
  assert.ok(commit, "the kuali run derives exactly one commit action");
  return commit;
}

function alreadyPresentReceiptEvidence() {
  const evidence = kualiReceiptEvidence();
  const committed = evidence.writes[0]?.intent;
  const transaction = evidence.checkpoints[2];
  assert.ok(committed?.status === "committed");
  assert.ok(transaction !== null && typeof transaction === "object");
  const {
    currentAttemptId,
    runId,
    runAttempt,
    bindingProof,
    bindingProofDigest,
    fencedAt,
    status,
    completionProof,
    confirmedAt,
    ...identity
  } = committed;
  void currentAttemptId;
  void runId;
  void runAttempt;
  void bindingProof;
  void bindingProofDigest;
  void fencedAt;
  void status;
  const observed = WriteIntentRecordSchema.parse({
    ...identity,
    status: "observed-present",
    observedProof: completionProof,
    observedAt: confirmedAt,
  });
  const stored = (transaction as { output: { value: Record<string, unknown> } }).output.value;
  const alreadyPresent = {
    ...transaction,
    output: {
      ...(transaction as { output: object }).output,
      value: {
        disposition: "already-present",
        proofSource: "durable-intent",
        proof: stored["proof"],
        output: stored["output"],
        observedAt: confirmedAt,
      },
    },
  };
  return {
    evidence,
    observed,
    checkpoints: [...evidence.checkpoints.slice(0, 2), alreadyPresent],
  };
}

describe("current receipt — the commit action carries what proved the write", () => {
  const evidence = kualiReceiptEvidence();
  const receipt = buildRunEvidenceReceipt({
    descriptor: separationsKualiFinalizationDescriptor,
    run: evidence.run,
    result: evidence.result,
    checkpoints: evidence.checkpoints,
    writes: evidence.writes,
  }, 5);

  it("stamps the composition it derived under", () => {
    assert.equal(receipt.composition, 5);
  });

  it("retains the current transaction digest and exact private fence identity", () => {
    const proved = commitActionOfReceipt(receipt).proved;
    assert.ok(proved, "the settled kuali commit must carry its proof");
    assert.equal(proved.system, "kuali");
    assert.equal(
      proved.idempotencyKeyDigest,
      deriveIdempotencyKeyDigest("kuali", KUALI_IDEMPOTENCY_KEY),
    );
    assert.equal(evidence.writes[0]?.intent.idempotencyKeyDigest, deriveIdempotencyKeyDigest("kuali", KUALI_IDEMPOTENCY_KEY));
    assert.ok(
      !JSON.stringify(proved).includes(KUALI_IDEMPOTENCY_KEY),
      "the raw idempotency key embeds identifiers and stays in authority",
    );
  });

  it("carries the declared completion arm and the durable outcome's proof source and instant", () => {
    const proved = commitActionOfReceipt(receipt).proved;
    assert.ok(proved);
    assert.equal(proved.completion, "save-verify");
    assert.equal(proved.proofSource, "normal-output");
    assert.equal(proved.recordedAt, KUALI_CONFIRMED_AT);
  });

  it("preserves complete current declared document, person and signer fields", () => {
    const proved = commitActionOfReceipt(receipt).proved;
    assert.ok(proved);
    const byKey = new Map(proved.values.map((value) => [value.key, value]));
    const documentNumber = byKey.get("documentNumber");
    assert.ok(documentNumber !== undefined && documentNumber.state === "allowed");
    assert.equal(documentNumber.classification, "safe-diagnostic");
    assert.equal(documentNumber.value, KUALI_DOCUMENT_NUMBER);
    assert.equal(documentNumber.rawValue, undefined);
    const observedEid = byKey.get("observedEid");
    assert.ok(observedEid !== undefined, "the proof's person leaf is carried");
    assert.equal(observedEid.state, "allowed");
    assert.equal(observedEid.value, KUALI_EID);
    assert.equal(observedEid.rawValue, undefined);
    const timekeeper = byKey.get("fields.timekeeperName");
    assert.ok(timekeeper !== undefined && timekeeper.state === "allowed");
    assert.equal(timekeeper.rawValue, undefined);
    assert.equal(timekeeper.value, KUALI_VALUE);
  });

  it("puts no proof on the prepare action — a prepare fences nothing", () => {
    const prepare = receipt.actions.find((action) => action.kind === "prepare");
    assert.ok(prepare);
    assert.equal(prepare.proved, undefined);
  });

  it("REFUSES a settled outcome no intent row pairs with — corruption may not render as documented absence", () => {
    // A settled transaction checkpoint requires its durable intent, recorded before settlement.
    assert.throws(
      () => buildRunEvidenceReceipt({
        descriptor: separationsKualiFinalizationDescriptor,
        run: evidence.run,
        result: evidence.result,
        checkpoints: evidence.checkpoints,
        writes: [],
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /finalize-kuali/u, "names the unpaired node");
        assert.match(error.message, /committed/u, "names the settled disposition");
        assert.match(error.message, /no durable write intent/u);
        return true;
      },
    );
  });
});

describe("the intent join — one commit contract, exactly one intent row", () => {
  const evidence = kualiReceiptEvidence();

  it("REFUSES two intents for one commit contract instead of attributing the first one's fence identity", () => {
    const first = evidence.writes[0];
    assert.ok(first !== undefined);

    const duplicateKey = `${KUALI_IDEMPOTENCY_KEY}::duplicate`;
    const duplicate = WriteIntentRecordSchema.parse({
      ...first.intent,
      writeIntentId: "0f0e0d0c-0b0a-4a11-8f6e-2b8c0d3f1a99",
      idempotencyKey: duplicateKey,
      idempotencyKeyDigest: deriveIdempotencyKeyDigest("kuali", duplicateKey),
    });
    assert.throws(
      () => buildRunEvidenceReceipt({
        descriptor: separationsKualiFinalizationDescriptor,
        run: evidence.run,
        result: evidence.result,
        checkpoints: evidence.checkpoints,
        writes: [first, { intent: duplicate, attempts: [] }],
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /2 write intents/u);
        assert.match(error.message, /kuali\/save-separation-finalization/u);
        assert.match(error.message, /refusing/u);
        return true;
      },
    );
  });
});

describe("current receipt identity", () => {
  const evidence = kualiReceiptEvidence();
  const deriveCurrent = () => buildRunEvidenceReceipt({
    descriptor: separationsKualiFinalizationDescriptor,
    run: evidence.run,
    result: evidence.result,
    checkpoints: evidence.checkpoints,
    writes: evidence.writes,
  }, 5);

  it("is deterministic — the property the immutable insert stands on", () => {
    assert.deepEqual(deriveCurrent(), deriveCurrent());
  });

  it("withholds the transaction key in the already-present identity sentence", () => {
    const { evidence: observedEvidence, observed, checkpoints } = alreadyPresentReceiptEvidence();
    const receipt = buildRunEvidenceReceipt({
      descriptor: separationsKualiFinalizationDescriptor,
      run: observedEvidence.run,
      result: observedEvidence.result,
      checkpoints,
      writes: [{ intent: observed, attempts: [] }],
    }, 5);
    const decision = receipt.decisions.find(({ kind }) => kind === "identity");
    assert.equal(
      decision?.reason,
      `the permanent ${observed.system} key digest ${observed.idempotencyKeyDigest.slice(0, 12)}… was already satisfied and `
        + "observed present; this run bound no fresh subject because it performed no write",
    );
    assert.equal(decision?.reason.includes(observed.idempotencyKey), false);
  });
});

describe("ensureRunEvidenceReceipt", () => {
  const evidence = kualiReceiptEvidence();

  function storeWith(
    stored: RunEvidenceReceipt | undefined,
    source: ReturnType<typeof kualiReceiptEvidence> = evidence,
    writes: readonly ReceiptWriteEvidence[] = source.writes,
  ): EvidenceReceiptStore & {
    readonly inserted: RunEvidenceReceipt[];
  } {
    const inserted: RunEvidenceReceipt[] = [];
    return {
      inserted,
      getRun: () => source.run,
      getResult: () => source.result,
      getFailure: () => { throw new Error("the kuali run did not fail"); },
      listCheckpointsByRun: () => source.checkpoints,
      listWritesByRun: () => writes,
      listGateResultsByRun: () => [],
      findReceiptByRun: () => stored,
      insertReceipt: (receipt: unknown) => {
        const record = RunEvidenceReceiptSchema.parse(receipt);
        if (stored !== undefined) {
          // The real immutable insert refuses divergent bytes by name; this
          // fake enforces exactly that so a derivation drift fails HERE.
          assert.deepEqual(record, stored, "insert must reproduce the stored receipt byte for byte");
          return { state: "existing", record: stored };
        }
        inserted.push(record);
        return { state: "inserted", record };
      },
    };
  }

  it("derives a run with NO stored receipt at the latest composition", () => {
    const currentEvidence = kualiReceiptEvidence();
    const store = storeWith(undefined, currentEvidence);
    const outcome = ensureRunEvidenceReceipt(
      store,
      separationsKualiFinalizationDescriptor,
      KUALI_RUN_ID,
    );
    assert.equal(outcome.state, "derived");
    assert.equal(outcome.receipt.composition, 5);
    const commit = outcome.receipt.actions.find((action) => action.kind === "commit");
    assert.ok(commit?.proved, "a fresh derivation carries the write proof");
  });
});

describe("deriveActionWriteProof — the already-present arms", () => {
  const evidence = kualiReceiptEvidence();
  const record = evidence.checkpoints[2];
  const write = evidence.writes[0];
  assert.ok(record !== undefined && write !== undefined);

  it("an already-present outcome carries its probe's proof source and OBSERVED instant", () => {
    const stored = (record as { output: { value: Record<string, unknown> } }).output.value;
    const observedAt = "2026-08-14T17:08:50.000Z";
    const alreadyPresent = {
      ...record as object,
      output: {
        ...(record as { output: object }).output,
        value: {
          disposition: "already-present",
          proofSource: "durable-intent",
          proof: stored["proof"],
          output: stored["output"],
          observedAt,
        },
      },
    };
    const proved = deriveActionWriteProof({
      commitContract: KualiSaveSeparationFinalization,
      record: alreadyPresent,
      intent: write.intent,
    });
    assert.ok(proved);
    assert.equal(proved.proofSource, "durable-intent");
    assert.equal(proved.recordedAt, observedAt);
  });

  it("refuses a settled outcome handed no intent row, naming the disposition and the fail-loud reason", () => {
    assert.throws(
      () => deriveActionWriteProof({
        commitContract: KualiSaveSeparationFinalization,
        record,
        intent: undefined,
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /settled/u);
        assert.match(error.message, /no durable write intent/u);
        assert.match(error.message, /recorder|store/u);
        return true;
      },
    );
  });

  it("refuses a transaction checkpoint whose outcome is not a recorded transaction outcome", () => {
    const broken = {
      ...record as object,
      output: { ...(record as { output: object }).output, value: { disposition: "committed" } },
    };
    assert.throws(
      () => deriveActionWriteProof({
        commitContract: KualiSaveSeparationFinalization,
        record: broken,
        intent: write.intent,
      }),
      /transaction outcome/u,
    );
  });
});
