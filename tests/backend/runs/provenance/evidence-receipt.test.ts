
import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { describe as describe_m0,describe as describe_m1,it as it_m0,it as it_m1 } from "vitest";
import {
buildRunEvidenceReceipt as buildRunEvidenceReceipt_m0,
buildRunEvidenceReceipt as buildRunEvidenceReceipt_m1,
deriveActionWriteProof as deriveActionWriteProof_m0,
ensureRunEvidenceReceipt as ensureRunEvidenceReceipt_m0,
type EvidenceReceiptStore as EvidenceReceiptStore_m0,
type ReceiptWriteEvidence as ReceiptWriteEvidence_m0
} from "../../../../src/backend/runs/provenance/evidence-receipt.js";
import { KualiSaveSeparationFinalization as KualiSaveSeparationFinalization_m0 } from "../../../../src/models/systems/kuali/save-separation-finalization.js";
import { RunEvidenceReceiptSchema as RunEvidenceReceiptSchema_m0,type RunEvidenceReceipt as RunEvidenceReceipt_m0 } from "../../../../src/models/trust/evidence.js";
import { canonicalJsonStringify as canonicalJsonStringify_m1 } from "../../../../src/rules/validation/canonical-json.js";
import { deriveIdempotencyKeyDigest as deriveIdempotencyKeyDigest_m0,WriteIntentRecordSchema as WriteIntentRecordSchema_m0 } from "../../../../src/rules/write-safety/write-safety.js";
import {
KUALI_CONFIRMED_AT as KUALI_CONFIRMED_AT_m0,
KUALI_DOCUMENT_NUMBER as KUALI_DOCUMENT_NUMBER_m0,
KUALI_EID as KUALI_EID_m0,
KUALI_IDEMPOTENCY_KEY as KUALI_IDEMPOTENCY_KEY_m0,
KUALI_RUN_ID as KUALI_RUN_ID_m0,
KUALI_VALUE as KUALI_VALUE_m0,
kualiReceiptEvidence as kualiReceiptEvidence_m0,
kualiReceiptEvidence as kualiReceiptEvidence_m1
} from "../../../support/fixtures/receipt-run-fixtures.js";
import { separationsKualiFinalizationDescriptor as separationsKualiFinalizationDescriptor_m0,separationsKualiFinalizationDescriptor as separationsKualiFinalizationDescriptor_m1 } from "../../../support/helpers/registered-workflows.js";


{


function commitActionOfReceipt(receipt: RunEvidenceReceipt_m0) {
  const commit = receipt.actions.find((action) => action.kind === "commit");
  assert_m0.ok(commit, "the kuali run derives exactly one commit action");
  return commit;
}

function alreadyPresentReceiptEvidence() {
  const evidence = kualiReceiptEvidence_m0();
  const committed = evidence.writes[0]?.intent;
  const transaction = evidence.checkpoints[2];
  assert_m0.ok(committed?.status === "committed");
  assert_m0.ok(transaction !== null && typeof transaction === "object");
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
  const observed = WriteIntentRecordSchema_m0.parse({
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

describe_m0("current receipt — the commit action carries what proved the write", () => {
  const evidence = kualiReceiptEvidence_m0();
  const receipt = buildRunEvidenceReceipt_m0({
    descriptor: separationsKualiFinalizationDescriptor_m0,
    run: evidence.run,
    result: evidence.result,
    checkpoints: evidence.checkpoints,
    writes: evidence.writes,
  }, 5);

  it_m0("stamps the composition it derived under", () => {
    assert_m0.equal(receipt.composition, 5);
  });

  it_m0("carries the declared completion arm and the durable outcome's proof source and instant", () => {
    const proved = commitActionOfReceipt(receipt).proved;
    assert_m0.ok(proved);
    assert_m0.equal(proved.completion, "save-verify");
    assert_m0.equal(proved.proofSource, "normal-output");
    assert_m0.equal(proved.recordedAt, KUALI_CONFIRMED_AT_m0);
  });

  it_m0("preserves complete current declared document, person and signer fields", () => {
    const proved = commitActionOfReceipt(receipt).proved;
    assert_m0.ok(proved);
    const byKey = new Map(proved.values.map((value) => [value.key, value]));
    const documentNumber = byKey.get("documentNumber");
    assert_m0.ok(documentNumber !== undefined && documentNumber.state === "allowed");
    assert_m0.equal(documentNumber.classification, "safe-diagnostic");
    assert_m0.equal(documentNumber.value, KUALI_DOCUMENT_NUMBER_m0);
    assert_m0.equal(documentNumber.rawValue, undefined);
    const observedEid = byKey.get("observedEid");
    assert_m0.ok(observedEid !== undefined, "the proof's person leaf is carried");
    assert_m0.equal(observedEid.state, "allowed");
    assert_m0.equal(observedEid.value, KUALI_EID_m0);
    assert_m0.equal(observedEid.rawValue, undefined);
    const timekeeper = byKey.get("fields.timekeeperName");
    assert_m0.ok(timekeeper !== undefined && timekeeper.state === "allowed");
    assert_m0.equal(timekeeper.rawValue, undefined);
    assert_m0.equal(timekeeper.value, KUALI_VALUE_m0);
  });

  it_m0("puts no proof on the prepare action — a prepare fences nothing", () => {
    const prepare = receipt.actions.find((action) => action.kind === "prepare");
    assert_m0.ok(prepare);
    assert_m0.equal(prepare.proved, undefined);
  });

  it_m0("REFUSES a settled outcome no intent row pairs with — corruption may not render as documented absence", () => {
    // A settled transaction checkpoint requires its durable intent, recorded before settlement.
    assert_m0.throws(
      () => buildRunEvidenceReceipt_m0({
        descriptor: separationsKualiFinalizationDescriptor_m0,
        run: evidence.run,
        result: evidence.result,
        checkpoints: evidence.checkpoints,
        writes: [],
      }),
      (error: unknown) => {
        assert_m0.ok(error instanceof Error);
        assert_m0.match(error.message, /finalize-kuali/u, "names the unpaired node");
        assert_m0.match(error.message, /committed/u, "names the settled disposition");
        assert_m0.match(error.message, /no durable write intent/u);
        return true;
      },
    );
  });
});

describe_m0("the intent join — one commit contract, exactly one intent row", () => {
  const evidence = kualiReceiptEvidence_m0();

  it_m0("REFUSES two intents for one commit contract instead of attributing the first one's fence identity", () => {
    const first = evidence.writes[0];
    assert_m0.ok(first !== undefined);

    const duplicateKey = `${KUALI_IDEMPOTENCY_KEY_m0}::duplicate`;
    const duplicate = WriteIntentRecordSchema_m0.parse({
      ...first.intent,
      writeIntentId: "0f0e0d0c-0b0a-4a11-8f6e-2b8c0d3f1a99",
      idempotencyKey: duplicateKey,
      idempotencyKeyDigest: deriveIdempotencyKeyDigest_m0("kuali", duplicateKey),
    });
    assert_m0.throws(
      () => buildRunEvidenceReceipt_m0({
        descriptor: separationsKualiFinalizationDescriptor_m0,
        run: evidence.run,
        result: evidence.result,
        checkpoints: evidence.checkpoints,
        writes: [first, { intent: duplicate, attempts: [] }],
      }),
      (error: unknown) => {
        assert_m0.ok(error instanceof Error);
        assert_m0.match(error.message, /2 write intents/u);
        assert_m0.match(error.message, /kuali\/save-separation-finalization/u);
        assert_m0.match(error.message, /refusing/u);
        return true;
      },
    );
  });
});

describe_m0("current receipt identity", () => {
  const evidence = kualiReceiptEvidence_m0();
  const deriveCurrent = () => buildRunEvidenceReceipt_m0({
    descriptor: separationsKualiFinalizationDescriptor_m0,
    run: evidence.run,
    result: evidence.result,
    checkpoints: evidence.checkpoints,
    writes: evidence.writes,
  }, 5);

  it_m0("is deterministic — the property the immutable insert stands on", () => {
    assert_m0.deepEqual(deriveCurrent(), deriveCurrent());
  });

  it_m0("withholds the transaction key in the already-present identity sentence", () => {
    const { evidence: observedEvidence, observed, checkpoints } = alreadyPresentReceiptEvidence();
    const receipt = buildRunEvidenceReceipt_m0({
      descriptor: separationsKualiFinalizationDescriptor_m0,
      run: observedEvidence.run,
      result: observedEvidence.result,
      checkpoints,
      writes: [{ intent: observed, attempts: [] }],
    }, 5);
    const decision = receipt.decisions.find(({ kind }) => kind === "identity");
    assert_m0.equal(
      decision?.reason,
      `the permanent ${observed.system} key digest ${observed.idempotencyKeyDigest.slice(0, 12)}… was already satisfied and `
        + "observed present; this run bound no fresh subject because it performed no write",
    );
    assert_m0.equal(decision?.reason.includes(observed.idempotencyKey), false);
  });
});

describe_m0("ensureRunEvidenceReceipt", () => {
  const evidence = kualiReceiptEvidence_m0();

  function storeWith(
    stored: RunEvidenceReceipt_m0 | undefined,
    source: ReturnType<typeof kualiReceiptEvidence_m0> = evidence,
    writes: readonly ReceiptWriteEvidence_m0[] = source.writes,
  ): EvidenceReceiptStore_m0 & {
    readonly inserted: RunEvidenceReceipt_m0[];
  } {
    const inserted: RunEvidenceReceipt_m0[] = [];
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
        const record = RunEvidenceReceiptSchema_m0.parse(receipt);
        if (stored !== undefined) {
          // The real immutable insert refuses divergent bytes by name; this
          // fake enforces exactly that so a derivation drift fails HERE.
          assert_m0.deepEqual(record, stored, "insert must reproduce the stored receipt byte for byte");
          return { state: "existing", record: stored };
        }
        inserted.push(record);
        return { state: "inserted", record };
      },
    };
  }

  it_m0("derives a run with NO stored receipt at the latest composition", () => {
    const currentEvidence = kualiReceiptEvidence_m0();
    const store = storeWith(undefined, currentEvidence);
    const outcome = ensureRunEvidenceReceipt_m0(
      store,
      separationsKualiFinalizationDescriptor_m0,
      KUALI_RUN_ID_m0,
    );
    assert_m0.equal(outcome.state, "derived");
    assert_m0.equal(outcome.receipt.composition, 5);
    const commit = outcome.receipt.actions.find((action) => action.kind === "commit");
    assert_m0.ok(commit?.proved, "a fresh derivation carries the write proof");
  });
});

describe_m0("deriveActionWriteProof — the already-present arms", () => {
  const evidence = kualiReceiptEvidence_m0();
  const record = evidence.checkpoints[2];
  const write = evidence.writes[0];
  assert_m0.ok(record !== undefined && write !== undefined);

  it_m0("an already-present outcome carries its probe's proof source and OBSERVED instant", () => {
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
    const proved = deriveActionWriteProof_m0({
      commitContract: KualiSaveSeparationFinalization_m0,
      record: alreadyPresent,
      intent: write.intent,
    });
    assert_m0.ok(proved);
    assert_m0.equal(proved.proofSource, "durable-intent");
    assert_m0.equal(proved.recordedAt, observedAt);
  });

  it_m0("refuses a settled outcome handed no intent row, naming the disposition and the fail-loud reason", () => {
    assert_m0.throws(
      () => deriveActionWriteProof_m0({
        commitContract: KualiSaveSeparationFinalization_m0,
        record,
        intent: undefined,
      }),
      (error: unknown) => {
        assert_m0.ok(error instanceof Error);
        assert_m0.match(error.message, /settled/u);
        assert_m0.match(error.message, /no durable write intent/u);
        assert_m0.match(error.message, /recorder|store/u);
        return true;
      },
    );
  });

  it_m0("refuses a transaction checkpoint whose outcome is not a recorded transaction outcome", () => {
    const broken = {
      ...record as object,
      output: { ...(record as { output: object }).output, value: { disposition: "committed" } },
    };
    assert_m0.throws(
      () => deriveActionWriteProof_m0({
        commitContract: KualiSaveSeparationFinalization_m0,
        record: broken,
        intent: write.intent,
      }),
      /transaction outcome/u,
    );
  });
});
}

{


describe_m1("receipt composition", () => {
  it_m1("derives complete current classified facts and stable evidence references from exact admitted evidence", () => {
    const evidence = kualiReceiptEvidence_m1();
    const input = { descriptor: separationsKualiFinalizationDescriptor_m1, run: evidence.run,
      result: evidence.result, checkpoints: evidence.checkpoints, writes: evidence.writes };
    const current = buildRunEvidenceReceipt_m1(input);
    assert_m1.equal(current.composition, 5);
    assert_m1.equal(canonicalJsonStringify_m1(buildRunEvidenceReceipt_m1(input)), canonicalJsonStringify_m1(current));
    assert_m1.ok(current.observations.length > 0);
    const valued = current.observations.filter(fact => fact.state === "satisfied");
    assert_m1.ok(valued.length > 0);
    for (const fact of valued) {
      assert_m1.ok(fact.state === "satisfied");
      assert_m1.equal(fact.value.state, "allowed");
      assert_m1.equal(fact.value.transform, "allow");
      assert_m1.ok(fact.value.state === "allowed");
      assert_m1.ok(fact.value.value !== undefined);
      assert_m1.ok(!Object.hasOwn(fact.value, "rawValue"));
      assert_m1.ok(fact.source.kind.length > 0);
    }
    const proof = current.actions.find(action => action.kind === "commit")?.proved;
    assert_m1.ok(proof);
    assert_m1.notEqual(proof.idempotencyKeyDigest, "withheld-protected-input");
    assert_m1.ok(proof.values.every(value => value.state === "allowed" && value.transform === "allow"));
  });
});
}
