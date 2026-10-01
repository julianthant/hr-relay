/** Historical presentation remains schema-bound; archive reads now consume frozen rows. */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ArchivedTransactionsSchema } from "../../../../src/domain/archive/model.js";
import {
  LEDGER_PRESENTATION_DECLARATIONS,
  LedgerLinePointerSchema,
  resolveLedgerLine,
  unresolvedLedgerLine,
  type LedgerLinePointer,
} from "../../../../src/domain/archive/ledger-resolution.js";
import { KualiSaveSeparationFinalization } from "../../../../src/domain/contracts/kuali/save-separation-finalization.js";
import { UcpathCreateTermination } from "../../../../src/domain/contracts/ucpath/create-termination.js";
import { deriveSchemaHash } from "../../../../src/domain/schema-bound-value.js";
import { directIdentifierDisplay } from "../../../../src/domain/redaction.js";
import { UcpathPendingSweepProofSchema } from "../../../../src/domain/ui/ucpath-smart-hr-termination.js";
import { deriveIdempotencyKeyDigest } from "../../../../src/domain/write-safety.js";
import { HASH_A, HASH_B, UUID_4 } from "../../../fixtures/phase1c-contract-fixtures.js";

const KEY = "kuali:4444|finalization|T009000001";
const TERMINATION_KEY = "ucpath:termination|10800000|06/11/2026";
const SWEEP_KEY = "ucpath:pending-terminations|10800000";

/** The pointer, through its own schema — `sequence` is a branded non-negative. */
function at(system: string, date: string, sequence: number): LedgerLinePointer {
  return LedgerLinePointerSchema.parse({ system, date, sequence });
}

/**
 * The base facts, `as const` so the closed-enum leaves (`completionKind`,
 * `proofSource`, `instance`, the two absent arms) keep their literal types
 * through the spread. Without it every one of them widens to `string` and the
 * fixture stops satisfying `LedgerEntryFacts` — a fixture that cannot be
 * passed to the function it exercises.
 */
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

describe("frozen archive transaction presentation", () => {
  it("retains sequence zero and identity digests without exposing the natural key", () => {
    const line = resolveLedgerLine(at("kuali", "2026-08-04", 0), entryPayload());
    assert.equal(line.state, "resolved"); if (line.state !== "resolved") return;
    assert.equal(line.pointer.sequence, 0); assert.equal(line.system, "kuali"); assert.equal(line.instance, "prod");
    assert.equal(line.idempotencyKeyDigest, deriveIdempotencyKeyDigest("kuali", KEY));
    assert.equal("idempotencyKey" in line, false); assert.equal(JSON.stringify(line).includes(KEY), false);
    assert.equal(line.confirmedAt, "2026-08-04T17:00:16.000Z");
  });
  it("serves Action and Confirmation as reasoned absences for a proof no contract declares", () => {
    // Not an oversight: a ledger entry declares neither leaf, and its `proof`
    // is schema-bound to whichever commit contract wrote it, so reading a
    // field NAME out of it is the guess D204 bans on an HR record. This
    // fixture's proof is bound to a hash nothing declares.
    const resolved = resolveLedgerLine(
      at("kuali", "2026-08-04", 0),
      entryPayload(),
    );
    assert.equal(resolved.state, "resolved");
    if (resolved.state !== "resolved") return;
    assert.equal(resolved.action.state, "absent");
    assert.equal(resolved.confirmation.state, "absent");
    assert.match(resolved.action.state === "absent" ? resolved.action.reason : "", /no commit contract declares/);
  });

  /* ── the declared readings (D223's `LEDGER_PRESENTATION_DECLARATIONS`) ─── */

  it("declares exactly separations' three commit contracts, keyed by PROOF SCHEMA", () => {
    /*
     * The key matters and `(system, completionKind)` could not have worked:
     * two of the three are `save-verify` writes on `ucpath`, so one key would
     * have named two contracts. `proof.schemaHash` is the contract's own
     * identity and it is already on every line.
     */
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
    }));
    assert.equal(resolved.state, "resolved");
    if (resolved.state !== "resolved") return;
    assert.deepEqual({ ...resolved.action }, {
      state: "present",
      value: `Termination for ${directIdentifierDisplay("10800000")} effective 06/11/2026 (Pending)`,
    });
    assert.deepEqual({ ...resolved.confirmation }, { state: "present", value: "T002209631" });
  });

  it("says a UCPath grid delete HAS no confirmation, which is not the same as undeclared", () => {
    /*
     * The load-bearing difference. "Nothing declares this" means nobody looked;
     * this reason means somebody did and found the external system issues no
     * receipt. An operator reading a blank cell must be able to tell them apart.
     */
    const resolved = resolveLedgerLine(at("ucpath", "2026-08-04", 0), entryPayload({
      system: "ucpath",
      idempotencyKey: SWEEP_KEY,
      idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", SWEEP_KEY),
      proof: {
        schemaHash: deriveSchemaHash(UcpathPendingSweepProofSchema, "output"),
        value: {
          kind: "ucpath-pending-terminations-clear",
          emplId: "10800000",
          scannedRowCount: 3,
          observedAt: "2026-08-13T10:18:00.000Z",
          source: "ss-smart-hr-detail-read",
        },
      },
    }));
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
    // The hash says which contract wrote the line; the contract's own schema
    // refuses the value. Reading the leaves anyway would present a value
    // nothing validated, on a record about a real person's employment.
    const resolved = resolveLedgerLine(at("kuali", "2026-08-04", 0), entryPayload({
      proof: {
        schemaHash: deriveSchemaHash(KualiSaveSeparationFinalization.writeSafety.completion.proofSchema, "output"),
        value: { kind: "kuali-saved-finalization" },
      },
    }));
    assert.equal(resolved.state, "resolved");
    if (resolved.state !== "resolved") return;
    assert.equal(resolved.action.state, "absent");
    assert.match(
      resolved.action.state === "absent" ? resolved.action.reason : "",
      /kuali\/save-separation-finalization's schema and does not satisfy it/u,
    );
  });


  it.each(["partition-missing", "sequence-missing", "line-malformed", "sequence-mismatch"] as const)("freezes explicit historical %s instead of dropping the citation", (failure) => {
    const pointer = at("kuali", "2026-08-04", 0);
    const absent = unresolvedLedgerLine(pointer, failure, "Historical source could not resolve this exact citation");
    const section = ArchivedTransactionsSchema.parse({ version: 1, runId: ENTRY_PAYLOAD_BASE.runId, contentDigest: HASH_A,
      capturedAt: ENTRY_PAYLOAD_BASE.confirmedAt, lines: [absent], eventIds: [], sourceDigests: [] });
    assert.deepEqual(section.lines, [absent]); assert.equal(section.lines[0].state, "unresolved");
    assert.deepEqual(section.lines[0].pointer, pointer);
  });
  it("keeps resolved and unknown rows in their frozen order", () => {
    const lines = [resolveLedgerLine(at("kuali", "2026-08-04", 1), entryPayload({ instance: "test" })),
      unresolvedLedgerLine(at("ucpath", "2026-08-04", 0), "partition-missing", "Historical citation unavailable"),
      resolveLedgerLine(at("kuali", "2026-08-04", 0), entryPayload())];
    const section = ArchivedTransactionsSchema.parse({ version: 1, runId: ENTRY_PAYLOAD_BASE.runId, contentDigest: HASH_A,
      capturedAt: ENTRY_PAYLOAD_BASE.confirmedAt, lines, eventIds: [], sourceDigests: [] });
    assert.deepEqual(section.lines, lines); assert.deepEqual(section.lines.map((line) => line.state), ["resolved", "unresolved", "resolved"]);
  });
});
