/**
 * The action-entry RENDER of the write proof (ledger 2 D16–D22): the commit
 * row of the receipt's Actions section draws the fence (system + key digest),
 * the proof's redacted values, the D20 confirmation verdict and the D21
 * read-back verdict BESIDE the write they prove — and a commit with no proof
 * NAMES the absence, differently for a composition-1 receipt (predates the
 * capture) and a composition-2 one (authority holds no proof).
 *
 * `renderToStaticMarkup`, because the claim is about what the section PUTS ON
 * SCREEN — the folds are pinned in `receipt-body-cues.test.ts` and nothing
 * there can see whether the component consumed them (the F6 lesson).
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { RunEvidenceReceiptSchema, type RunEvidenceReceipt } from "../../../src/domain/trust/evidence.js";
import { ReceiptEvidenceBody } from "../../../src/dashboard/surfaces/trust.js";
import { writeProofAbsence } from "../../../src/dashboard/surfaces/trust-model.js";
import { shortHash } from "../../../src/dashboard/surfaces/format.js";

const AT = "2026-08-14T17:08:54.867Z";
const KEY_DIGEST = "d".repeat(64);

const PROVED = Object.freeze({
  system: "kuali",
  idempotencyKeyDigest: KEY_DIGEST,
  completion: "save-verify",
  proofSource: "normal-output",
  values: [
    { key: "documentNumber", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "3407919" },
    { key: "observedEid", state: "transformed", classification: "direct-identifier", transform: "last4", value: "4489" },
  ],
  recordedAt: AT,
});

function receiptWith(input: Readonly<{
  composition?: 2;
  proved?: typeof PROVED;
}>): RunEvidenceReceipt {
  return RunEvidenceReceiptSchema.parse({
    ...(input.composition === 2 ? { composition: 2 } : {}),
    receiptId: "0d3e19b0-3629-482e-ae82-6cd7f244c4bb",
    runId: "d1254233-dd33-4bc5-afaf-c2bf52ea693f",
    traceId: "kt-170848-d125",
    workflowId: "separations-kuali-finalization",
    attempt: 1,
    generatedAt: AT,
    descriptorFingerprint: "a".repeat(64),
    configFingerprint: "b".repeat(64),
    retryOf: { state: "absent" },
    failure: { state: "absent" },
    input: [],
    observations: [],
    decisions: [],
    actions: [
      {
        id: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
        taskId: "kuali/stage-separation-finalization",
        kind: "prepare",
        writeState: "prepared",
        occurredAt: AT,
      },
      {
        id: "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2",
        taskId: "kuali/save-separation-finalization",
        kind: "commit",
        writeState: "verified",
        proofRef: "7f3a1c88-2e44-4b90-8a51-6d2f9c0b4e13",
        occurredAt: AT,
        ...(input.proved === undefined ? {} : { proved: input.proved }),
      },
    ],
    verification: [],
    output: [],
    reuse: [],
    warnings: [],
    confidence: "unknown",
    result: "partial",
  });
}

function render(receipt: RunEvidenceReceipt): string {
  return renderToStaticMarkup(createElement(ReceiptEvidenceBody, { receipt }));
}

describe("the commit row's write-proof block", () => {
  const markup = render(receiptWith({ composition: 2, proved: PROVED }));

  it("draws the fenced system and the key digest, cut through shortHash with the whole value on title", () => {
    assert.ok(markup.includes("KUALI"), "the fence's system tag renders");
    assert.ok(markup.includes(shortHash(KEY_DIGEST)), "the key digest renders short");
    assert.ok(markup.includes(`title="${KEY_DIGEST}"`), "the whole digest rides the title (the D31 treatment)");
  });

  it("draws complete proof values and names historical source absence", () => {
    assert.ok(markup.includes("documentNumber"));
    assert.ok(markup.includes("3407919"));
    assert.ok(markup.includes("observedEid"));
    assert.ok(markup.includes("Complete value unavailable in this historical record"));
    assert.ok(!markup.includes("4489"));
  });

  it("draws the D20 confirmation verdict and the D21 read-back verdict as full sentences", () => {
    assert.ok(markup.includes("KUALI issues no confirmation number for this operation"));
    assert.ok(markup.includes("read back — the independent post-commit read observed the values above"));
  });

  it("puts no proof block under the prepare row", () => {
    const prepareIndex = markup.indexOf("kuali/stage-separation-finalization");
    const commitIndex = markup.indexOf("kuali/save-separation-finalization");
    assert.ok(prepareIndex >= 0 && commitIndex > prepareIndex, "prepare renders before commit");
    const between = markup.slice(prepareIndex, commitIndex);
    assert.ok(!between.includes("confirmation"), "the prepare row carries no confirmation verdict");
    assert.ok(!between.includes("read back"), "the prepare row carries no read-back verdict");
  });
});

describe("the explicit-absent arms — named, never blank", () => {
  it("a composition-2 commit with no proof says authority holds none", () => {
    const markup = render(receiptWith({ composition: 2 }));
    assert.ok(markup.includes(writeProofAbsence(2)));
    assert.ok(!markup.includes(writeProofAbsence(undefined)));
  });

  it("a composition-1 receipt says it predates the capture — a different sentence, not the same blank", () => {
    const markup = render(receiptWith({}));
    assert.ok(markup.includes(writeProofAbsence(undefined)));
    assert.ok(!markup.includes(writeProofAbsence(2)));
  });
});

describe("D358 complete evidence rendering", () => {
  it("renders complete classified values supplied to new receipts", () => {
    const receipt = receiptWith({ composition: 2, proved: PROVED });
    const current = RunEvidenceReceiptSchema.parse({ ...receipt, composition: 5,
      actions: receipt.actions.map(action => action.proved === undefined ? action : { ...action,
        proved: { ...action.proved, values: [
          { key: "credential", state: "allowed", classification: "secret", transform: "allow", value: "synthetic-credential-full" },
          { key: "person", state: "allowed", classification: "direct-identifier", transform: "allow", value: "synthetic-person-full" },
        ] },
      }),
    });
    const markup = render(current);
    assert.ok(markup.includes("synthetic-credential-full"));
    assert.ok(markup.includes("synthetic-person-full"));
  });

  it("renders retained historical source without presenting its suffix as complete", () => {
    const receipt = receiptWith({ composition: 2, proved: PROVED });
    const retained = RunEvidenceReceiptSchema.parse({ ...receipt,
      actions: receipt.actions.map(action => action.proved === undefined ? action : { ...action,
        proved: { ...action.proved, values: [
          { key: "person", state: "transformed", classification: "direct-identifier", transform: "last4", value: "4489", rawValue: "synthetic-person-full" },
        ] },
      }),
    });
    const markup = render(retained);
    assert.ok(markup.includes("synthetic-person-full"));
    assert.ok(!markup.includes("4489"));
  });
});
