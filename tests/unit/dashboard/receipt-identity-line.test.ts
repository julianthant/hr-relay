/**
 * The receipt's verdict-band folds — 03a fidelity ledger 2 rows D8 and D9,
 * ported under D273 item 7 ("port every served receipt cue").
 *
 * Both are pure exported folds precisely so the operator-facing words are
 * pinned here rather than only in the parity corpus (the standing argument in
 * `evidence-source-meta.test.ts`). Every confidence arm is enumerated rather
 * than sampled — the whole finding was that two of the three arms had no
 * sentence at all — and every identity segment is asserted in ORDER, because
 * the finding on D9 was scatter, not absence.
 *
 * Every id goes through its own schema, so a fixture cannot pin a shape the
 * wire would refuse.
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  EvidenceReceiptIdSchema,
  FailureIdSchema,
  IsoInstantSchema,
  PositiveIntSchema,
  RunIdSchema,
} from "../../../src/domain/ids.js";
import { RunEvidenceReceiptSchema } from "../../../src/domain/trust/evidence.js";
import { CONFIDENCE_COPY, receiptConfidenceChip, receiptIdentityItems } from "../../../src/dashboard/surfaces/run-detail/failure/receipt-model.js";
import { fmtClock } from "../../../src/dashboard/surfaces/shared/status/format.js";
import { ReceiptView } from "../../../src/dashboard/surfaces/run-detail/failure/receipt.js";

const RECEIPT_ID = EvidenceReceiptIdSchema.parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const RUN_ID = RunIdSchema.parse("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const RETRY_OF = RunIdSchema.parse("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
const FAILURE_ID = FailureIdSchema.parse("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
const GENERATED_AT = IsoInstantSchema.parse("2026-08-26T18:04:00.000Z");
const COMPLETED_AT = IsoInstantSchema.parse("2026-08-26T18:05:30.000Z");

const BARE = {
  receiptId: RECEIPT_ID,
  runId: RUN_ID,
  generatedAt: GENERATED_AT,
  attempt: PositiveIntSchema.parse(1),
  retryOf: { state: "absent" } as const,
  failure: { state: "absent" } as const,
};

describe("receiptConfidenceChip", () => {
  it("says what `verified` MEANS, and reads as chrome", () => {
    expect(receiptConfidenceChip("verified")).toStrictEqual({
      tone: "neutral",
      text: "verified — read back from the system of record",
    });
  });

  it("warns on `partial`, and names which half read back", () => {
    expect(receiptConfidenceChip("partial")).toStrictEqual({
      tone: "warning",
      text: "partial — some of it read back",
    });
  });

  it("warns on `unknown`, and says nothing was read back", () => {
    expect(receiptConfidenceChip("unknown")).toStrictEqual({
      tone: "warning",
      text: "unknown — nothing was read back",
    });
  });

  it("gives every served arm a sentence — a bare word is the finding, not the fix", () => {
    for (const [word, sentence] of Object.entries(CONFIDENCE_COPY)) {
      expect(sentence.length).toBeGreaterThan(0);
      expect(receiptConfidenceChip(word as keyof typeof CONFIDENCE_COPY).text).toBe(`${word} — ${sentence}`);
    }
  });
});

describe("receiptIdentityItems", () => {
  it("leads with the demo's four facts, in the demo's order", () => {
    expect(receiptIdentityItems({ receipt: BARE })).toStrictEqual([
      `receipt ${RECEIPT_ID}`,
      `generated ${fmtClock(GENERATED_AT)}`,
      "attempt 1",
      `run ${RUN_ID}`,
    ]);
  });

  it("prints `retry of` between the attempt and the run id when the receipt carries one", () => {
    const items = receiptIdentityItems({
      receipt: { ...BARE, attempt: PositiveIntSchema.parse(2), retryOf: { state: "present", value: RETRY_OF } },
    });
    expect(items).toStrictEqual([
      `receipt ${RECEIPT_ID}`,
      `generated ${fmtClock(GENERATED_AT)}`,
      "attempt 2",
      `retry of ${RETRY_OF}`,
      `run ${RUN_ID}`,
    ]);
  });

  it("names the failure record beside the receipt on a failed run", () => {
    const items = receiptIdentityItems({
      receipt: { ...BARE, failure: { state: "present", value: FAILURE_ID } },
      completedAt: COMPLETED_AT,
    });
    expect(items).toStrictEqual([
      `receipt ${RECEIPT_ID}`,
      `generated ${fmtClock(GENERATED_AT)}`,
      "attempt 1",
      `run ${RUN_ID}`,
      `failure ${FAILURE_ID}`,
      `completed ${fmtClock(COMPLETED_AT)}`,
    ]);
  });

  it("keeps `generated` and `completed` as two distinct instants", () => {
    const items = receiptIdentityItems({ receipt: BARE, completedAt: COMPLETED_AT });
    expect(items).toContain(`generated ${fmtClock(GENERATED_AT)}`);
    expect(items).toContain(`completed ${fmtClock(COMPLETED_AT)}`);
    expect(fmtClock(GENERATED_AT)).not.toBe(fmtClock(COMPLETED_AT));
  });

  it("carries the terminal instant alone when no receipt was served", () => {
    expect(receiptIdentityItems({ completedAt: COMPLETED_AT })).toStrictEqual([
      `completed ${fmtClock(COMPLETED_AT)}`,
    ]);
  });

  it("returns nothing at all when neither fact exists — no placeholder segments", () => {
    expect(receiptIdentityItems({})).toStrictEqual([]);
  });
});

/**
 * F8d finding 1 (MED, `receipt.tsx:121`) — `bandCarriesIdentity` was hardcoded
 * `true`, but a receipt-available + non-terminal-outcome state renders no
 * `VerdictBand` at all. The body was told a band it does not draw already
 * carries confidence, so `!bandCarriesIdentity && \`confidence ...\`` never
 * fired and confidence rendered NOWHERE — contradicting the surface's own
 * "facts are never dropped" comment. `bandCarriesIdentity` must track whether
 * a band actually rendered (`outcome.state === "terminal"`), not a constant.
 */
describe("ReceiptView — confidence must render somewhere, even with no band (row D8, finding 1)", () => {
  const AVAILABLE_RECEIPT = RunEvidenceReceiptSchema.parse({
    receiptId: RECEIPT_ID,
    runId: RUN_ID,
    traceId: "on-120000-2222",
    workflowId: "onboarding",
    attempt: 1,
    generatedAt: GENERATED_AT,
    descriptorFingerprint: "a".repeat(64),
    configFingerprint: "a".repeat(64),
    retryOf: { state: "absent" },
    failure: { state: "absent" },
    input: [],
    observations: [],
    decisions: [],
    actions: [],
    verification: [],
    output: [],
    reuse: [],
    warnings: [],
    confidence: "partial",
    result: "partial",
  });

  it("prints the confidence fact when the run has NOT terminalized but a receipt is already available", () => {
    const html = renderToStaticMarkup(createElement(ReceiptView, {
      outcome: { state: "absent", reason: "still running" },
      receipt: { state: "available", value: AVAILABLE_RECEIPT },
      dryRun: false,
    }));
    // No VerdictBand renders for a non-terminal outcome, so the body must be
    // the one place confidence lands — `bandCarriesIdentity` false, not true.
    assert.match(html, /confidence partial/u);
  });

  it("does NOT repeat confidence in the body once a band exists to carry it", () => {
    const html = renderToStaticMarkup(createElement(ReceiptView, {
      outcome: { state: "terminal", result: "partial", completedAt: COMPLETED_AT },
      receipt: { state: "available", value: AVAILABLE_RECEIPT },
      dryRun: false,
    }));
    // The band prints `confidence partial — some of it read back` via the
    // qualifying chip; the body's own trailing MetaLine must not restate the
    // bare `confidence partial` a second time underneath it.
    assert.match(html, /partial — some of it read back/u);
    assert.doesNotMatch(html, /confidence partial(?!\s*—)/u);
  });
});

/**
 * The dry-run Banner — 03a fidelity ledger 2 row D13, ruled in under D273
 * item 7 ("port every served receipt cue"). F8a could not land this one row:
 * `dryRun` reaches `ReceiptView` only through `log-panel.tsx`'s call site,
 * which a parallel unit (the dry-run worker supervisor) owned at the time.
 *
 * `dryRun` is a REQUIRED prop, not an optional flag defaulting to `false`
 * (`log-panel.tsx`'s own `surface` is genuinely absent when a panel is opened
 * for a run outside the day currently loaded — a deep link across a day
 * boundary is the real, reachable case, not a defensive type). Defaulting to
 * `false` would print "not a rehearsal" about a run nobody asked, which is
 * exactly the silent-fallback shape CLAUDE.md's fail-loud rule forbids: the
 * false arm and the "we do not know" arm must both draw nothing, and only a
 * genuine `true` may draw the banner.
 */
describe("ReceiptView — the dry-run banner (row D13)", () => {
  const AVAILABLE_RECEIPT = RunEvidenceReceiptSchema.parse({
    receiptId: RECEIPT_ID,
    runId: RUN_ID,
    traceId: "on-120000-2222",
    workflowId: "onboarding",
    attempt: 1,
    generatedAt: GENERATED_AT,
    descriptorFingerprint: "a".repeat(64),
    configFingerprint: "a".repeat(64),
    retryOf: { state: "absent" },
    failure: { state: "absent" },
    input: [],
    observations: [],
    decisions: [],
    actions: [],
    verification: [],
    output: [],
    reuse: [],
    warnings: [],
    confidence: "verified",
    result: "verified-done",
  });

  it("draws the rehearsal banner when the run really was a dry run", () => {
    const html = renderToStaticMarkup(createElement(ReceiptView, {
      outcome: { state: "terminal", result: "verified-done", completedAt: COMPLETED_AT },
      receipt: { state: "available", value: AVAILABLE_RECEIPT },
      dryRun: true,
    }));
    assert.match(html, /Dry run — this run was a rehearsal/u);
    assert.match(html, /reads everything and writes nothing/u);
  });

  it("draws nothing when the run genuinely was not a dry run", () => {
    const html = renderToStaticMarkup(createElement(ReceiptView, {
      outcome: { state: "terminal", result: "verified-done", completedAt: COMPLETED_AT },
      receipt: { state: "available", value: AVAILABLE_RECEIPT },
      dryRun: false,
    }));
    assert.doesNotMatch(html, /rehearsal/u);
  });

  it("draws nothing when the call site genuinely does not know — never defaults to a claim", () => {
    const html = renderToStaticMarkup(createElement(ReceiptView, {
      outcome: { state: "terminal", result: "verified-done", completedAt: COMPLETED_AT },
      receipt: { state: "available", value: AVAILABLE_RECEIPT },
      dryRun: undefined,
    }));
    assert.doesNotMatch(html, /rehearsal/u);
  });
});
