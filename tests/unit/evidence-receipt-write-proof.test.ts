/**
 * The derivation half of the action write proof (Track F's BE line, ledger 2
 * D16–D22): `buildRunEvidenceReceipt` at composition 2 puts what PROVED the
 * write on the commit action itself, read only from durable authority rows —
 * the fenced intent's identity, the transaction outcome's proof source,
 * proof value and instant, and the commit contract's declared completion arm.
 *
 * The other half of this file is the DURABILITY argument (D141/D199, the D13
 * lesson): a receipt already stored at composition 1 must keep re-deriving
 * byte-identically under its own composition, so growing the derivation can
 * strand no settled run. `ensureRunEvidenceReceipt` re-derives a stored
 * receipt AT THE COMPOSITION IT WAS STORED UNDER and only a run with no
 * stored receipt gets the latest one.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  buildRunEvidenceReceipt,
  deriveActionWriteProof,
  ensureRunEvidenceReceipt,
  type EvidenceReceiptStore,
} from "../../src/core/evidence-receipt.js";
import { RunEvidenceReceiptSchema, type RunEvidenceReceipt } from "../../src/domain/trust/evidence.js";
import { deriveIdempotencyKeyDigest, WriteIntentRecordSchema } from "../../src/domain/write-safety.js";
import { KualiSaveSeparationFinalization } from "../../src/domain/contracts/kuali/save-separation-finalization.js";
import { separationsKualiFinalizationDescriptor } from "../../src/workflows/separations/kuali-finalization/descriptor.js";
import {
  KUALI_CONFIRMED_AT,
  KUALI_IDEMPOTENCY_KEY,
  KUALI_RUN_ID,
  kualiReceiptEvidence,
} from "./fixtures/receipt-run-fixtures.js";

function commitActionOfReceipt(receipt: RunEvidenceReceipt) {
  const commit = receipt.actions.find((action) => action.kind === "commit");
  assert.ok(commit, "the kuali run derives exactly one commit action");
  return commit;
}

describe("composition 2 — the commit action carries what proved the write", () => {
  const evidence = kualiReceiptEvidence();
  const receipt = buildRunEvidenceReceipt({
    descriptor: separationsKualiFinalizationDescriptor,
    run: evidence.run,
    result: evidence.result,
    checkpoints: evidence.checkpoints,
    writes: evidence.writes,
  });

  it("stamps the composition it derived under", () => {
    assert.equal(receipt.composition, 2);
  });

  it("carries the fence identity — the system and the exact key's digest, never the raw key", () => {
    const proved = commitActionOfReceipt(receipt).proved;
    assert.ok(proved, "the settled kuali commit must carry its proof");
    assert.equal(proved.system, "kuali");
    assert.equal(
      proved.idempotencyKeyDigest,
      deriveIdempotencyKeyDigest("kuali", KUALI_IDEMPOTENCY_KEY),
    );
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

  it("carries the completion proof's leaves, redacted by declaration — the document verbatim, the person last-4", () => {
    const proved = commitActionOfReceipt(receipt).proved;
    assert.ok(proved);
    const byKey = new Map(proved.values.map((value) => [value.key, value]));
    const documentNumber = byKey.get("documentNumber");
    assert.ok(documentNumber !== undefined && documentNumber.state === "allowed");
    const observedEid = byKey.get("observedEid");
    assert.ok(observedEid !== undefined, "the proof's person leaf is carried");
    assert.equal(observedEid.state, "transformed");
    assert.ok("transform" in observedEid && observedEid.transform === "last4");
    const timekeeper = byKey.get("fields.timekeeperName");
    assert.ok(timekeeper !== undefined && timekeeper.state === "transformed");
  });

  it("puts no proof on the prepare action — a prepare fences nothing", () => {
    const prepare = receipt.actions.find((action) => action.kind === "prepare");
    assert.ok(prepare);
    assert.equal(prepare.proved, undefined);
  });

  it("REFUSES a settled outcome no intent row pairs with — corruption may not render as documented absence", () => {
    // The checkpoint stores a SETTLED TransactionOutcome, so a durable intent
    // row MUST exist: the sequencer records the intent before it settles.
    // Deriving `proved: undefined` here made a recorder/store failure print as
    // "no settled write intent reached it" — both halves false.
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

  it("composition 1 with no intent row still derives — the stored shape never carried the proof", () => {
    const bare = buildRunEvidenceReceipt({
      descriptor: separationsKualiFinalizationDescriptor,
      run: evidence.run,
      result: evidence.result,
      checkpoints: evidence.checkpoints,
      writes: [],
    }, 1);
    assert.equal(bare.composition, undefined);
    assert.equal(commitActionOfReceipt(bare).proved, undefined);
  });
});

describe("the intent join — one commit contract, exactly one intent row", () => {
  const evidence = kualiReceiptEvidence();

  it("REFUSES two intents for one commit contract instead of attributing the first one's fence identity", () => {
    const first = evidence.writes[0];
    assert.ok(first !== undefined);
    // A second, genuinely distinct durable intent for the SAME task: a
    // different natural key mints a different intent id and digest. Authority
    // keys an intent by (workflow, item, task, system, key), so two rows for
    // one commit contract is a supply/recorder defect — and the checkpoint
    // carries no intent id, so nothing can say WHICH fence proved the write.
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

  it("refuses at composition 1 too — the stored shape's commit action reads the same join", () => {
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
      }, 1),
      /2 write intents/u,
    );
  });
});

describe("composition 1 — the stored shape, unchanged", () => {
  const evidence = kualiReceiptEvidence();
  const deriveAt1 = () => buildRunEvidenceReceipt({
    descriptor: separationsKualiFinalizationDescriptor,
    run: evidence.run,
    result: evidence.result,
    checkpoints: evidence.checkpoints,
    writes: evidence.writes,
  }, 1);

  it("emits neither a composition stamp nor any proved block", () => {
    const receipt = deriveAt1();
    assert.equal(receipt.composition, undefined);
    for (const action of receipt.actions) assert.equal(action.proved, undefined);
  });

  it("is deterministic — the property the immutable insert stands on", () => {
    assert.deepEqual(deriveAt1(), deriveAt1());
  });
});

describe("ensureRunEvidenceReceipt — a stored composition-1 receipt is never stranded", () => {
  const evidence = kualiReceiptEvidence();

  function storeWith(stored: RunEvidenceReceipt | undefined): EvidenceReceiptStore & {
    readonly inserted: RunEvidenceReceipt[];
  } {
    const inserted: RunEvidenceReceipt[] = [];
    return {
      inserted,
      getRun: () => evidence.run,
      getResult: () => evidence.result,
      getFailure: () => { throw new Error("the kuali run did not fail"); },
      listCheckpointsByRun: () => evidence.checkpoints,
      listWritesByRun: () => evidence.writes,
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

  it("re-derives a stored composition-1 receipt under composition 1 and serves it unchanged", () => {
    const storedV1 = buildRunEvidenceReceipt({
      descriptor: separationsKualiFinalizationDescriptor,
      run: evidence.run,
      result: evidence.result,
      checkpoints: evidence.checkpoints,
      writes: evidence.writes,
    }, 1);
    const outcome = ensureRunEvidenceReceipt(
      storeWith(storedV1),
      separationsKualiFinalizationDescriptor,
      KUALI_RUN_ID,
    );
    assert.equal(outcome.state, "existing");
    assert.equal(outcome.receipt.composition, undefined);
    for (const action of outcome.receipt.actions) assert.equal(action.proved, undefined);
  });

  it("derives a run with NO stored receipt at the latest composition", () => {
    const store = storeWith(undefined);
    const outcome = ensureRunEvidenceReceipt(
      store,
      separationsKualiFinalizationDescriptor,
      KUALI_RUN_ID,
    );
    assert.equal(outcome.state, "derived");
    assert.equal(outcome.receipt.composition, 2);
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
