
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { z } from "zod";
import {
LEDGER_PRESENTATION_DECLARATIONS,
LedgerLinePointerSchema,
ResolvedLedgerLineWireSchema,
resolveLedgerLine,
type LedgerLinePointer,
} from "../../../src/models/run/transaction-resolution.js";
import { KualiSaveSeparationFinalization } from "../../../src/models/systems/kuali/save-separation-finalization.js";
import { UcpathCreateTermination } from "../../../src/models/systems/ucpath/create-termination.js";
import { UcpathPendingSweepSettlementProofSchema } from "../../../src/models/ui/ucpath-smart-hr-termination.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { directIdentifierDisplay } from "../../../src/rules/redaction/redaction.js";
import { deriveIdempotencyKeyDigest } from "../../../src/rules/write-safety/write-safety.js";
import { HASH_A,HASH_B,UUID_4 } from "../../support/fixtures/phase1c-contract-fixtures.js";

const KEY = "kuali:4444|finalization|T009000001";
const TERMINATION_KEY = "ucpath:termination|10800000|06/11/2026";
const SWEEP_KEY = "ucpath:pending-terminations|10800000";

/** The pointer, through its own schema — `sequence` is a branded non-negative. */
function at(system: string, date: string, sequence: number): LedgerLinePointer {
  return LedgerLinePointerSchema.parse({ system, date, sequence });
}


const ENTRY_PAYLOAD_BASE = {
  workflowId: "separations-kuali-finalization",
  itemId: UUID_4,
  system: "kuali",
  idempotencyKey: KEY,
  idempotencyKeyDigest: deriveIdempotencyKeyDigest("kuali", KEY),
  writeIntentId: "aa11bb22-0001-4000-8000-aa11bb220001",
  intentGeneration: 1,
  proof: { schemaHash: HASH_A, value: { source: "reload-read-back", transactionNumber: "T009000001" } },
  completionKind: "save-verify",
  proofSource: "normal-output",
  bindingProofDigest: HASH_B,
  subject: { state: "absent" },
  runId: "aa11bb22-0002-4000-8000-aa11bb220002",
  traceId: "sf-090400-aa11",
  attempt: 1,
  operator: "local-operator",
  instance: "prod",
  configFingerprint: HASH_B,
  dryRun: false,
  fencedAt: "2026-08-04T17:00:00.000Z",
  confirmedAt: "2026-08-04T17:00:16.000Z",
  externalOccurredAt: { state: "absent" },
} as const;

function entryPayload(overrides: Record<string, unknown> = {}) {
  return { ...ENTRY_PAYLOAD_BASE, ...overrides };
}

describe("current proof-bound transaction presentation", () => {
  it("retains sequence zero and identity digests without exposing the natural key", () => {
    const line = resolveLedgerLine(at("kuali", "2026-08-04", 0), entryPayload(), "public");
    assert.equal(line.state, "resolved"); if (line.state !== "resolved") return;
    assert.ok("sequence" in line.pointer); if (!("sequence" in line.pointer)) throw new Error("live pointer unavailable"); assert.equal(line.pointer.sequence, 0); assert.equal(line.system, "kuali"); assert.equal(line.instance, "prod");
    assert.equal(line.idempotencyKeyDigest, deriveIdempotencyKeyDigest("kuali", KEY));
    assert.equal("idempotencyKey" in line, false); assert.equal(JSON.stringify(line).includes(KEY), false);
    assert.equal(line.confirmedAt, "2026-08-04T17:00:16.000Z");
  });
  it("serves Action and Confirmation as reasoned absences for a proof no contract declares", () => {

    const resolved = resolveLedgerLine(
      at("kuali", "2026-08-04", 0),
      entryPayload(),
      "public",
    );
    assert.equal(resolved.state, "resolved");
    if (resolved.state !== "resolved") return;
    assert.equal(resolved.action.state, "absent");
    assert.equal(resolved.confirmation.state, "absent");
    assert.match(resolved.action.state === "absent" ? resolved.action.reason : "", /no commit contract declares/);
  });



  it("declares exactly separations' three commit contracts, keyed by PROOF SCHEMA", () => {

    assert.deepEqual(
      LEDGER_PRESENTATION_DECLARATIONS.map(({ taskId }) => taskId),
      [
        "ucpath/delete-pending-terminations",
        "ucpath/create-termination",
        "kuali/save-separation-finalization",
      ],
    );
    const hashes = LEDGER_PRESENTATION_DECLARATIONS.map(({ proofSchema }) => deriveSchemaHash(proofSchema, "output"));
    assert.equal(new Set(hashes).size, hashes.length, "two declarations share a proof-schema hash");
  });

  it("reads the UCPath termination's action and its transaction id as the CONFIRMATION", () => {
    const resolved = resolveLedgerLine(at("ucpath", "2026-08-04", 0), entryPayload({
      system: "ucpath",
      idempotencyKey: TERMINATION_KEY,
      idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", TERMINATION_KEY),
      proof: {
        schemaHash: deriveSchemaHash(UcpathCreateTermination.writeSafety.completion.proofSchema, "output"),
        value: {
          kind: "ucpath-termination",
          emplId: "10800000",
          effectiveDate: "06/11/2026",
          transactionId: "T002209631",
          approvalStatus: "Pending",
          displayedName: "Deterministic Person",
          source: "ss-smart-hr-detail-read",
        },
      },
    }), "public");
    assert.equal(resolved.state, "resolved");
    if (resolved.state !== "resolved") return;
    assert.deepEqual({ ...resolved.action }, {
      state: "present",
      value: `Termination for ${directIdentifierDisplay("10800000")} effective 06/11/2026 (Pending)`,
    });
    assert.deepEqual({ ...resolved.confirmation }, { state: "present", value: "T002209631" });
  });

  it("says a UCPath grid delete HAS no confirmation, which is not the same as undeclared", () => {

    const resolved = resolveLedgerLine(at("ucpath", "2026-08-04", 0), entryPayload({
      system: "ucpath",
      idempotencyKey: SWEEP_KEY,
      idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", SWEEP_KEY),
      proof: {
        schemaHash: deriveSchemaHash(UcpathPendingSweepSettlementProofSchema, "output"),
        value: {
          kind: "ucpath-pending-terminations-clear",
          version: 2, selectedTransactionIds: "T002200001", protectedTransactionIds: "none", setDigest: HASH_A,
          emplId: "10800000",
          scannedRowCount: 3,
          observedAt: "2026-08-13T10:18:00.000Z",
          source: "ss-smart-hr-detail-read",
        },
      },
    }), "public");
    assert.equal(resolved.state, "resolved");
    if (resolved.state !== "resolved") return;
    assert.equal(
      resolved.action.state === "present" ? resolved.action.value : "",
      `Cleared pending terminations for ${directIdentifierDisplay("10800000")} (grid scanned 3 rows)`,
    );
    assert.equal(resolved.confirmation.state, "absent");
    const reason = resolved.confirmation.state === "absent" ? resolved.confirmation.reason : "";
    assert.match(reason, /issues no confirmation number/u);
    assert.doesNotMatch(reason, /no commit contract declares/u);
  });

  it("REFUSES a line whose proof names a declared schema and does not satisfy it", () => {

    const resolved = resolveLedgerLine(at("kuali", "2026-08-04", 0), entryPayload({
      proof: {
        schemaHash: deriveSchemaHash(KualiSaveSeparationFinalization.writeSafety.completion.proofSchema, "output"),
        value: { kind: "kuali-saved-finalization" },
      },
    }), "public");
    assert.equal(resolved.state, "resolved");
    if (resolved.state !== "resolved") return;
    assert.equal(resolved.action.state, "absent");
    assert.match(
      resolved.action.state === "absent" ? resolved.action.reason : "",
      /kuali\/save-separation-finalization's schema and does not satisfy it/u,
    );
  });


  it("keeps authenticated deleted confirmation resolved while withholding unavailable disclosure and cursor", () => {
    const pointer = { state: "unavailable" as const, reason: "delivery cursor removed by authenticated run deletion" as const };
    const line = resolveLedgerLine(pointer, entryPayload(), "unavailable");
    assert.deepEqual(line.pointer, pointer);
    assert.equal(line.state, "resolved");
    assert.equal(line.idempotencyKeyDigest, "withheld-protected-input");
    assert.equal(line.action.state, "absent"); assert.equal(line.confirmation.state, "absent");
    assert.match(line.action.state === "absent" ? line.action.reason : "", /original transaction disclosure classification unavailable/u);
    assert.equal(JSON.stringify(line).includes(KEY), false);
    assert.equal(JSON.stringify(line).includes(deriveIdempotencyKeyDigest("kuali", KEY)), false);
    assert.deepEqual(z.array(ResolvedLedgerLineWireSchema).parse([line]), [line]);
  });
});
