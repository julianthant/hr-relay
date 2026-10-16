import { CrmSearchOnboardingRecords } from "../../../../src/models/systems/crm/search-onboarding-records.js";
import { openPersonLookupReceiptDatabase } from "../../../support/helpers/backend/person-lookup-receipt-database.js";

import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach,describe,it } from "vitest";
import { buildRunEvidenceReceipt } from "../../../../src/backend/runs/provenance/evidence-receipt.js";
import { RunRecordSchema,type RunRecord } from "../../../../src/models/run/record.js";
import type { RunEvidenceReceipt } from "../../../../src/models/trust/evidence.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { WriteIntentRecordSchema,deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-safety.js";
import {
EXIT_CRM_RECORD_ID,
EXIT_RUN_ID,
EXIT_TRACE_ID,
KUALI_CONFIRMED_AT,
KUALI_DOCUMENT_NUMBER,
KUALI_EID,
KUALI_INTENT_ID,
KUALI_RUN_ID,
kualiReceiptEvidence,
seedPersonLookupExitRun,
} from "../../../support/fixtures/receipt-run-fixtures.js";
import { personLookupDescriptor,separationsKualiFinalizationDescriptor } from "../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function openDatabase(): AuthorityDatabase {
  return openPersonLookupReceiptDatabase(roots, databases, "hrauto-receipt-", "receipt-test");
}


function ordinaryRun(value: unknown): RunRecord {
  return RunRecordSchema.parse(value);
}

/* ── receipt-only reading helpers ────────────────────────────────────────── */

function fact(receipt: RunEvidenceReceipt, lane: "input" | "observations" | "output", key: string) {
  const found = receipt[lane].find((entry) => (
    entry.state === "satisfied" && entry.value.key === key
  ));
  assert.ok(found !== undefined, `receipt ${lane} carries no satisfied fact keyed "${key}"`);
  return found;
}

function shownValue(receipt: RunEvidenceReceipt, lane: "input" | "observations" | "output", key: string) {
  const entry = fact(receipt, lane, key);
  assert.equal(entry.state, "satisfied");
  if (entry.state !== "satisfied") throw new Error("unreachable");
  return entry.value;
}

/** The displayed value of a fact the receipt did not drop outright. */
function shownScalar(receipt: RunEvidenceReceipt, lane: "input" | "observations" | "output", key: string) {
  const value = shownValue(receipt, lane, key);
  assert.notEqual(value.state, "redacted", `receipt dropped "${key}" instead of showing it`);
  if (value.state === "redacted") throw new Error("unreachable");
  return value.value;
}

function verdictOf(receipt: RunEvidenceReceipt, obligation: string) {
  const entry = receipt.verification.find((row) => row.obligation === obligation);
  assert.ok(entry !== undefined, `receipt declares no verdict for obligation "${obligation}"`);
  return entry;
}

function decisionOf(receipt: RunEvidenceReceipt, kind: string, contains: string) {
  const entry = receipt.decisions.find((row) => row.kind === kind && row.reason.includes(contains));
  assert.ok(entry !== undefined, `receipt records no ${kind} decision mentioning "${contains}"`);
  return entry;
}

/** No credential, cookie, storage state, or raw SSN may appear anywhere. */
function assertNoLeakage(receipt: RunEvidenceReceipt): void {
  const serialized = JSON.stringify(receipt);
  for (const canary of ["password", "Cookie", "storageState", "sessionid", "920-74-1459", "PRIVATE KEY"]) {
    assert.ok(!serialized.includes(canary), `receipt leaked ${canary}`);
  }
}

/* ── run 1: the live person-lookup exit run ──────────────────────────────── */

describe("the live person-lookup exit run explains itself", () => {
  it("answers the operator's whole double-check from the receipt alone", () => {
    const database = openDatabase();
    const seeded = seedPersonLookupExitRun(database);
    const receipt = buildRunEvidenceReceipt({
      descriptor: personLookupDescriptor,
      run: ordinaryRun(seeded.run),
      result: database.authority.runResults.get(EXIT_RUN_ID),
      checkpoints: seeded.checkpoints,
    });

    // ── "which run am I looking at, and did it finish?" ──────────────────
    assert.equal(receipt.runId, EXIT_RUN_ID);
    assert.equal(receipt.traceId, EXIT_TRACE_ID);
    assert.equal(receipt.attempt, 1, "recovery retains the original attempt");
    assert.equal(receipt.result, "verified-done");
    assert.equal(receipt.confidence, "verified");
    assert.deepEqual(receipt.failure, { state: "absent" });
    assert.deepEqual(receipt.warnings, []);

    // ── "which person did it ask about?" ─────────────────────────────────
    const askedFor = shownValue(receipt, "input", "emplId");
    assert.deepEqual(askedFor, {
      state: "allowed",
      key: "emplId",
      classification: "direct-identifier",
      transform: "allow",
      value: "10873698",
    });

    // ── "did UCPath resolve exactly one person?" ─────────────────────────
    assert.deepEqual(shownValue(receipt, "observations", "selection.status"), {
      state: "allowed", key: "selection.status", classification: "safe-diagnostic",
      transform: "allow", value: "resolved",
    });
    assert.deepEqual(shownValue(receipt, "observations", "selection.candidateEids"), {
      state: "allowed", key: "selection.candidateEids", classification: "sensitive-hr",
      transform: "allow", value: ["10873698"],
    }, "exactly ONE candidate — the fact that makes the selection unambiguous");
    assert.equal(verdictOf(receipt, "identity.ucpath-selection-is-unambiguous").verdict, "verified");

    // ── "is it the SAME person in both systems?" — the receipt did the
    //    comparison, so the operator never opens UCPath to compare two ids.
    const identity = verdictOf(receipt, "identity.eid-agrees-across-sources");
    assert.equal(identity.verdict, "verified");
    assert.equal(identity.mandatory, true);
    assert.ok(identity.evidence.length >= 2, "the verdict cites both sides it compared");

    // ── "what did CRM actually show?" ────────────────────────────────────
    const observed = CrmSearchOnboardingRecords.output.parse({ state: "checked", records: shownScalar(receipt, "observations", "records") });
    assert.equal(observed.state, "checked");
    if (observed.state !== "checked") throw new Error("unreachable");
    const records = observed.records;
    assert.equal(records[0]?.recordId, EXIT_CRM_RECORD_ID);
    assert.equal(records[0]?.emplId, "10873698");
    assert.equal(records[0]?.firstDayOfService, "07/15/2026");

    // ── "what is the answer, and why?" ───────────────────────────────────
    assert.equal(shownScalar(receipt, "output", "activeStatus.state"), "active");
    assert.equal(shownScalar(receipt, "output", "activeStatus.hdh"), true);
    assert.equal(shownScalar(receipt, "output", "activeStatus.details.eid"), "10873698");
    assert.equal(shownScalar(receipt, "output", "activeStatus.details.crm"), "Found");
    assert.equal(shownScalar(receipt, "output", "activeStatus.details.startDate"), "07/15/2026");


    const searchReuse = receipt.reuse.find((entry) => entry.freshnessLimitMs === 4 * 60 * 60 * 1000);
    assert.ok(searchReuse !== undefined, "the UCPath search's freshness budget is on the receipt");
    assert.equal(searchReuse.kind, "checkpoint", "attempt 1's search was REPLAYED, not re-observed");
    assert.ok(searchReuse.ageMs > 0 && searchReuse.ageMs < searchReuse.freshnessLimitMs);
    const crmObservation = fact(receipt, "observations", "records");
    assert.equal(crmObservation.source.kind, "system", "the CRM read was fresh-live after the second claim");

    // ── "what did it NOT do, and why?" ───────────────────────────────────
    const skipped = decisionOf(receipt, "branch", "crm-dates");
    assert.equal(skipped.outcome, "not-taken");
    assert.match(skipped.reason, /`when` condition was false/);
    assert.equal(
      shownScalar(receipt, "output", "crmDates.state"),
      "not-requested",
      "the absence reaches the OUTPUT too, named rather than omitted",
    );

    // ── "did it write anything?" ─────────────────────────────────────────
    assert.deepEqual(
      [...new Set(receipt.actions.map(({ writeState }) => writeState))],
      ["not-attempted"],
      "a read-only workflow states that it attempted no write",
    );
    assert.ok(receipt.actions.some((action) => action.kind === "external-read"));
    assert.ok(
      receipt.actions.some((action) => action.kind === "local-projection"),
      "the pure fold is marked as a local projection, not as a system read",
    );

    assertNoLeakage(receipt);
  });

  it("is a pure function of authority: re-deriving the same run yields the same bytes", () => {
    const database = openDatabase();
    const seeded = seedPersonLookupExitRun(database);
    const build = () => buildRunEvidenceReceipt({
      descriptor: personLookupDescriptor,
      run: database.authority.runs.get(EXIT_RUN_ID),
      result: database.authority.runResults.get(EXIT_RUN_ID),
      checkpoints: seeded.checkpoints,
    });
    assert.equal(JSON.stringify(build()), JSON.stringify(build()));
    // And the derivation reads authority through the repositories, not the
    // seeded objects: the checkpoint list the database returns is equivalent.
    const fromDatabase = buildRunEvidenceReceipt({
      descriptor: personLookupDescriptor,
      run: database.authority.runs.get(EXIT_RUN_ID),
      result: database.authority.runResults.get(EXIT_RUN_ID),
      checkpoints: database.authority.runCheckpoints.listByItem(
        personLookupDescriptor.id,
        seeded.run.envelope.itemId,
      ),
    });
    assert.equal(JSON.stringify(fromDatabase), JSON.stringify(build()));
    const permute = (value: unknown): unknown => Array.isArray(value) ? value.map(permute)
      : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, permute(child)])) : value;
    const originalCheckpoints = seeded.checkpoints.map(input => RunCheckpointRecordSchema.parse(input));
    const permutedCheckpoints = originalCheckpoints.map(checkpoint => ({ ...checkpoint,
      output: { ...checkpoint.output, value: permute(checkpoint.output.value) } }));
    assert.notEqual(JSON.stringify(permutedCheckpoints.map(({ output }) => output.value)),
      JSON.stringify(originalCheckpoints.map(({ output }) => output.value)));
    assert.deepEqual(permutedCheckpoints.map(({ output }) => output.value),
      originalCheckpoints.map(({ output }) => output.value));
    const permuted = buildRunEvidenceReceipt({ descriptor: personLookupDescriptor,
      run: database.authority.runs.get(EXIT_RUN_ID), result: database.authority.runResults.get(EXIT_RUN_ID),
      checkpoints: permutedCheckpoints });
    assert.equal(JSON.stringify(permuted), JSON.stringify(build()));
  });
});

/* ── run 2: the Kuali separation finalization ────────────────────────────── */

describe("the Kuali finalization write explains itself", () => {
  it("answers the write double-check from the receipt alone", () => {
    const evidence = kualiReceiptEvidence();
    const receipt = buildRunEvidenceReceipt({
      descriptor: separationsKualiFinalizationDescriptor,
      run: ordinaryRun(evidence.run),
      result: evidence.result,
      checkpoints: evidence.checkpoints,
      writes: evidence.writes,
    });

    assert.equal(receipt.runId, KUALI_RUN_ID);
    assert.equal(receipt.result, "verified-done");
    assert.equal(receipt.confidence, "verified");


    const commit = receipt.actions.find((action) => action.kind === "commit");
    assert.ok(commit !== undefined, "the receipt names the commit action");
    assert.equal(commit.writeState, "verified", "committed AND proved, not merely clicked");
    assert.equal(
      commit.proofRef,
      evidence.writes[0].intent.status === "committed"
        ? evidence.writes[0].intent.bindingProof.proofId
        : undefined,
      "the filed binding proof is referenced by id",
    );
    assert.equal(commit.occurredAt, KUALI_CONFIRMED_AT);
    assert.ok(
      receipt.actions.some((action) => action.kind === "prepare" && action.writeState === "prepared"),
      "the staged prepare is on the receipt beside the commit it preceded",
    );

    const dedupe = decisionOf(receipt, "dedupe", "permanent key");
    assert.equal(dedupe.outcome, "taken");
    assert.match(dedupe.reason, /not already satisfied/);
    assert.match(dedupe.reason, /normal-output/);


    const identityDecision = decisionOf(receipt, "identity", "binding digest");
    assert.equal(identityDecision.outcome, "approved");
    assert.match(identityDecision.reason, /eid ending "0000"/);
    assert.match(identityDecision.reason, /kuali\.rrss-document\.finalization-staged/);
    assert.match(identityDecision.reason, /matched the expected subject exactly/);
    assert.equal(verdictOf(receipt, "identity.eid-agrees-across-sources").verdict, "verified");

    // ── "is the value on the document the value I asked for?" ────────────
    assert.equal(verdictOf(receipt, "write.timekeeper-matches-request").verdict, "verified");
    assert.equal(verdictOf(receipt, "write.transaction-matches-request").verdict, "verified");
    assert.equal(verdictOf(receipt, "write.document-matches-request").verdict, "verified");
    assert.equal(
      shownScalar(receipt, "output", "finalization.proof.documentNumber"),
      KUALI_DOCUMENT_NUMBER,
    );
    assert.deepEqual(shownValue(receipt, "output", "finalization.proof.fields.timekeeperName"), {
      state: "allowed", key: "finalization.proof.fields.timekeeperName", classification: "direct-identifier",
      transform: "allow", value: "Deterministic Timekeeper",
    });
    assert.equal(shownScalar(receipt, "output", "finalization.disposition"), "committed");

    // ── "how do you KNOW it saved?" ──────────────────────────────────────
    assert.equal(verdictOf(receipt, "write.proof-is-a-read-back").verdict, "verified");
    assert.equal(shownScalar(receipt, "output", "finalization.proof.source"), "reload-read-back");

    // ── "did it leave anything unsettled behind?" ────────────────────────
    assert.deepEqual(receipt.warnings, [], "no residual write intent, so no warning");
    assert.ok(
      !receipt.actions.some((action) => action.writeState === "unknown" || action.writeState === "attempting"),
    );
    void KUALI_INTENT_ID;
    assertNoLeakage(receipt);
  });

  it("degrades loudly when the same write is left parked instead of committed", () => {
    const evidence = kualiReceiptEvidence();
    const committed = evidence.writes[0].intent;
    if (committed.status !== "committed") throw new Error("the kuali fixture must start committed");
    const { completionProof, confirmedAt, status, ...carried } = committed;
    void completionProof;
    void confirmedAt;
    void status;
    const parked = WriteIntentRecordSchema.parse({
      ...carried,
      status: "parked",
      parkedCode: "unknown",
      authorityReason: deriveWriteAuthorityReason("post-click-verifier-unknown", "probe", "the save response never arrived; the document was not read back"),
      message: "the save response never arrived; the document was not read back",
    });
    const receipt = buildRunEvidenceReceipt({
      descriptor: separationsKualiFinalizationDescriptor,
      run: ordinaryRun(evidence.run),
      result: evidence.result,
      checkpoints: evidence.checkpoints,
      writes: [{ intent: parked, attempts: [] }],
    });
    const commit = receipt.actions.find((action) => action.kind === "commit");
    assert.equal(commit?.writeState, "unknown");
    assert.ok(receipt.warnings.some((warning) => warning.code === "RESIDUAL_WRITE_INTENT"));
    assert.ok(receipt.warnings.every((warning) => warning.loadBearing));
    const receiptBytes = JSON.stringify(receipt);
    assert.equal(receiptBytes.includes(parked.idempotencyKey), false);
    assert.equal(receiptBytes.includes(KUALI_EID), true);
    assert.ok(receiptBytes.includes(parked.idempotencyKeyDigest.slice(0, 12)));
    assert.equal(receipt.result, "partial", "a parked external write is never a clean done");
  });
});
