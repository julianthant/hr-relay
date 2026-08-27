/**
 * T2 — the two wired squares that live OUTSIDE the descriptor: the needs-you
 * notification a park produces (D262, `src/services/notifications/gate-park.ts`
 * wired in `compose.ts`) and the write-ledger presentation a separations run's
 * filings resolve through (`LEDGER_PRESENTATION_DECLARATIONS`).
 *
 * Both are seams the unit lane deliberately could not close. The notifier holds
 * no authority handle — its unit test hands it a park set, because that is the
 * half a fake inbox can pin — so nothing had ever checked that
 * `runs.listParkedAtGate()` produces the shape it takes, or that resolving the
 * gate through the real command service is what makes a park stop standing.
 * And the ledger's declarations were pinned one contract at a time against a
 * synthetic partition; what a separations run actually files is THREE lines in
 * one partition, and the Write-ledger card renders them as one ordered vector
 * with a declared absence sitting between two present confirmations.
 *
 * The `readGateParks` fold below is `compose.ts`'s, verbatim including its
 * refusal: a row listed as parked that reads otherwise throws by name rather
 * than being narrowed past.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { LEDGER_PRESENTATION_DECLARATIONS, LedgerLinePointerSchema } from "../../../../src/domain/archive/ledger-resolution.js";
import { localDatePart } from "../../../../src/domain/clock.js";
import { KualiSaveSeparationFinalization } from "../../../../src/domain/contracts/kuali/save-separation-finalization.js";
import { UcpathCreateTermination } from "../../../../src/domain/contracts/ucpath/create-termination.js";
import { UcpathDeletePendingTerminations } from "../../../../src/domain/contracts/ucpath/delete-pending-terminations.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/domain/ids.js";
import { deriveSchemaHash } from "../../../../src/domain/schema-bound-value.js";
import { deriveIdempotencyKeyDigest } from "../../../../src/domain/write-safety.js";
import { ledgerFilePath } from "../../../../src/infra/ledger/ledger-projector.js";
import {
  GateParkObservationSchema,
  createGateParkNotifier,
} from "../../../../src/services/notifications/gate-park.js";
import { EMPTY_IDENTITY_GATE_DRAFT, identityCeremonyFor, identityGateAnswer } from "../../../../src/dashboard/app/identity-ceremony.js";
import { buildRunSection } from "../../../../src/server/dashboard/queries/run-detail.js";
import { HASH_A, HASH_B, UUID_4 } from "../../../unit/fixtures/phase1c-contract-fixtures.js";
import {
  DOCUMENT_NUMBER,
  GATE_ID,
  commandEnvelope,
  createSeparationsWorld,
  disposeWorlds,
  parkAtIdentityGate,
  separationsIdentityPacket,
  seedIdentityPacketCheckpoint,
  startFromTypedText,
  type SeparationsDashboardWorld,
} from "./world.js";

afterEach(disposeWorlds);

/**
 * `compose.ts`'s own read, refusal included. Copying the fold rather than
 * asserting on the repository directly is the point: the notifier is only wired
 * to authority through these five lines, and a park whose lifecycle disagreed
 * with the listing must throw here rather than reach the inbox as a guess.
 */
function readGateParks(world: SeparationsDashboardWorld): readonly unknown[] {
  return world.database.authority.runs.listParkedAtGate().map((run) => {
    if (run.lifecycle.state !== "parked-gate") {
      throw new Error(`run ${run.envelope.runId} was listed as parked at a gate but reads ${run.lifecycle.state}`);
    }
    return GateParkObservationSchema.parse({
      runId: run.envelope.runId,
      workflowId: run.envelope.workflow,
      gateId: run.lifecycle.gateId,
    });
  });
}

/** One separations run, started from the typed box and parked with its packet. */
function parkOne(world: SeparationsDashboardWorld, text: string): string {
  const [started] = startFromTypedText(world, text);
  assert.ok(started);
  parkAtIdentityGate(world, started.runId);
  seedIdentityPacketCheckpoint(world, started.runId, separationsIdentityPacket());
  world.projection.refreshRun(started.runId);
  return started.runId;
}

describe("separations dashboard — the needs-you alert a parked gate produces", () => {
  it("publishes ONE durable gate-waiting row for a park, and nothing for the same park again", async () => {
    const world = createSeparationsWorld();
    const runId = parkOne(world, DOCUMENT_NUMBER);
    const notifier = createGateParkNotifier({ inbox: world.inbox });

    const first = await notifier.observed(readGateParks(world));
    assert.deepEqual(first.published.map(({ park }) => park.runId), [runId]);
    assert.deepEqual(first.standing, []);

    const rows = world.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID);
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.ok(row);
    assert.equal(row.trigger, "gate-waiting");
    // §2.6's rule: the alert names WHERE to look and carries no HR data.
    assert.deepEqual(row.links.map((link) => (link.kind === "run" ? link.runId : "")), [runId]);

    // A STANDING park is not news again; re-publishing it every tick is the
    // unreadable-forever row §2.6 forbids.
    const second = await notifier.observed(readGateParks(world));
    assert.deepEqual(second.published, []);
    assert.deepEqual(second.standing.map(({ runId: id }) => id), [runId]);
    assert.equal(world.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID).length, 1);
  });

  it("serves the alert on the day wire the operator's bell reads", async () => {
    const world = createSeparationsWorld();
    const runId = parkOne(world, DOCUMENT_NUMBER);
    await createGateParkNotifier({ inbox: world.inbox }).observed(readGateParks(world));

    const day = world.projection.buildDashboardDayWire(localDatePart(world.clock.now()));
    assert.equal(day.notifications.length, 1);
    const [alert] = day.notifications;
    assert.ok(alert);
    assert.equal(alert.state, "unread");
    assert.equal(alert.severity, "warning");
    assert.match(alert.title, /Needs you — separations/u);
    // The row LINKS to the waiting run — §2.6's "names where to look".
    assert.deepEqual({ ...alert.link }, { kind: "run", runId });
  });

  it("counts two parked runs as two alerts, one per run", async () => {
    const world = createSeparationsWorld();
    const first = parkOne(world, DOCUMENT_NUMBER);
    const second = parkOne(world, "4510");
    const notifier = createGateParkNotifier({ inbox: world.inbox });

    const report = await notifier.observed(readGateParks(world));
    assert.deepEqual(
      [...report.published.map(({ park }) => park.runId)].sort(),
      [first, second].sort(),
    );
    assert.equal(world.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID).length, 2);
  });

  it("RELEASES the park when the gate is resolved through the real command service", async () => {
    const world = createSeparationsWorld();
    const runId = parkOne(world, DOCUMENT_NUMBER);
    const notifier = createGateParkNotifier({ inbox: world.inbox });
    await notifier.observed(readGateParks(world));

    const response = buildRunSection(world.runDetail, runId, "identity-gate");
    assert.equal(response.section, "identity-gate");
    if (response.section !== "identity-gate" || response.payload.state !== "available") {
      throw new Error("the parked run served no identity gate");
    }
    const gate = response.payload.value;
    const ceremony = identityCeremonyFor(gate, "approved");
    const answer = identityGateAnswer(ceremony, EMPTY_IDENTITY_GATE_DRAFT);
    assert.ok(answer);
    if (answer.decision !== "approved") throw new Error("unreachable");
    const applied = world.commands.execute({
      ...commandEnvelope(),
      family: "gate",
      type: "resolve-gate",
      target: { runId, gateId: GATE_ID, expectedVersion: gate.expectedVersion },
      payload: {
        result: {
          schemaHash: gate.resultSchemaHash,
          value: {
            decision: "approved",
            eid: answer.eid,
            chosenFrom: "checked",
            evidenceDigest: gate.evidenceDigest,
          },
        },
      },
    });
    assert.equal(applied.state, "applied");

    // The park is gone from authority, so the watch reports it released — the
    // notifier FORGETS it, which is what makes a later re-park news again. The
    // row itself is deliberately untouched: read state is the operator's axis,
    // and erasing it would erase the record that a human was ever asked.
    const report = await notifier.observed(readGateParks(world));
    assert.deepEqual(report.released.map((park) => park.runId), [runId]);
    assert.deepEqual(report.published, []);
    assert.equal(world.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID).length, 1);
  });
});

/* ── the write ledger a separations run leaves behind ────────────────────── */

const SWEEP_KEY = "ucpath:pending-terminations|10001754";
const TERMINATION_KEY = "ucpath:termination|10001754|04/01/2026";
const LEDGER_DAY = "2026-07-31";

/**
 * One ledger line, as the projector writes it. The proof is bound to a REAL
 * commit contract's completion schema, so a contract that changed its proof
 * changes its hash and this fixture stops matching its declaration — loudly, as
 * an undeclared line, which is the behaviour the declarations exist for.
 */
function ledgerLine(input: Readonly<{
  seq: number;
  system: "ucpath" | "kuali";
  idempotencyKey: string;
  proofSchema: Parameters<typeof deriveSchemaHash>[0];
  proofValue: unknown;
  completionKind: "receipt" | "save-verify" | "upload-verify";
}>): unknown {
  return {
    outboxId: `aa11bb22-000${String(input.seq)}-4000-8000-aa11bb22000${String(input.seq)}`,
    seq: input.seq,
    payload: {
      workflowId: "separations",
      itemId: UUID_4,
      system: input.system,
      idempotencyKey: input.idempotencyKey,
      idempotencyKeyDigest: deriveIdempotencyKeyDigest(input.system, input.idempotencyKey),
      writeIntentId: `aa11bb22-100${String(input.seq)}-4000-8000-aa11bb22100${String(input.seq)}`,
      intentGeneration: 1,
      proof: { schemaHash: deriveSchemaHash(input.proofSchema, "output"), value: input.proofValue },
      completionKind: input.completionKind,
      proofSource: "normal-output",
      bindingProofDigest: HASH_B,
      runId: "aa11bb22-0002-4000-8000-aa11bb220002",
      traceId: "sp-081217-e1b8",
      attempt: 1,
      operator: LOCAL_OPERATOR_ACTOR_ID,
      instance: "prod",
      configFingerprint: HASH_A,
      dryRun: false,
      subject: { state: "absent" },
      fencedAt: "2026-07-31T17:00:00.000Z",
      confirmedAt: `2026-07-31T17:0${String(input.seq)}:00.000Z`,
      externalOccurredAt: { state: "absent" },
    },
  };
}

/** The two UCPath writes a separation files, in the order the graph files them. */
function writeUcpathPartition(world: SeparationsDashboardWorld): void {
  mkdirSync(join(world.stateRoot, "ledger"), { recursive: true });
  writeFileSync(
    ledgerFilePath(world.stateRoot, "ucpath", LEDGER_DAY),
    `${[
      ledgerLine({
        seq: 0,
        system: "ucpath",
        idempotencyKey: SWEEP_KEY,
        proofSchema: UcpathDeletePendingTerminations.writeSafety.completion.proofSchema,
        completionKind: UcpathDeletePendingTerminations.writeSafety.completion.kind,
        proofValue: {
          kind: "ucpath-pending-terminations-clear",
          emplId: "10001754",
          scannedRowCount: 2,
          observedAt: "2026-07-31T17:00:30.000Z",
          source: "ss-smart-hr-detail-read",
        },
      }),
      ledgerLine({
        seq: 1,
        system: "ucpath",
        idempotencyKey: TERMINATION_KEY,
        proofSchema: UcpathCreateTermination.writeSafety.completion.proofSchema,
        completionKind: UcpathCreateTermination.writeSafety.completion.kind,
        proofValue: {
          kind: "ucpath-termination",
          emplId: "10001754",
          effectiveDate: "04/01/2026",
          transactionId: "T002209631",
          approvalStatus: "Pending",
          displayedName: "Cramia, Dreitho",
          source: "ss-smart-hr-detail-read",
        },
      }),
    ].map((line) => JSON.stringify(line)).join("\n")}\n`,
    "utf8",
  );
}

function at(system: string, sequence: number): unknown {
  return LedgerLinePointerSchema.parse({ system, date: LEDGER_DAY, sequence });
}

describe("separations dashboard — the write ledger the archive resolves", () => {
  it("declares exactly the three contracts a separation files, and no two share a proof identity", () => {
    assert.deepEqual(LEDGER_PRESENTATION_DECLARATIONS.map(({ taskId }) => taskId), [
      String(UcpathDeletePendingTerminations.id),
      String(UcpathCreateTermination.id),
      String(KualiSaveSeparationFinalization.id),
    ]);
  });

  it("resolves a run's UCPath lines in file order, with the sweep's absence between them", () => {
    const world = createSeparationsWorld();
    writeUcpathPartition(world);

    // The SAME read-through instance the projection was composed with — a
    // second reader over an append-only audit file would be a second parse
    // discipline over the record of what was filed into a live HR system.
    const [sweep, termination] = world.ledger.resolve([at("ucpath", 0), at("ucpath", 1)] as never);
    assert.ok(sweep && termination);
    assert.equal(sweep.state, "resolved");
    assert.equal(termination.state, "resolved");
    if (sweep.state !== "resolved" || termination.state !== "resolved") return;

    assert.deepEqual({ ...sweep.action }, {
      state: "present",
      value: "Cleared pending terminations for 10001754 (grid scanned 2 rows)",
    });
    // A DECLARED absence, not an undeclared one: somebody looked and found that
    // UCPath issues no receipt for a grid delete.
    assert.equal(sweep.confirmation.state, "absent");
    const reason = sweep.confirmation.state === "absent" ? sweep.confirmation.reason : "";
    assert.match(reason, /issues no confirmation number for an in-progress-grid delete/u);
    assert.doesNotMatch(reason, /no commit contract declares/u);

    assert.deepEqual({ ...termination.action }, {
      state: "present",
      value: "Termination for 10001754 effective 04/01/2026 (Pending)",
    });
    assert.deepEqual({ ...termination.confirmation }, { state: "present", value: "T002209631" });
  });

  it("names an unread pointer rather than dropping a filing out of the list", () => {
    const world = createSeparationsWorld();
    writeUcpathPartition(world);

    // The one list an operator must never see silently short. A third pointer
    // into a two-line partition is a row with a reason on it.
    const [, , missing] = world.ledger.resolve([at("ucpath", 0), at("ucpath", 1), at("ucpath", 2)] as never);
    assert.ok(missing);
    assert.equal(missing.state, "unresolved");
    if (missing.state !== "unresolved") return;
    assert.equal(missing.failure, "sequence-missing");
    assert.match(missing.reason, /holds 2 lines and this record points at sequence 2/u);
  });

  it("folds the same partition into the Activity report's write-ledger block", () => {
    const world = createSeparationsWorld();
    writeUcpathPartition(world);

    // D236's carve-out, through the REAL projection: the report and the archive
    // read one corpus, so "what was filed" cannot have two answers.
    const report = world.projection.buildActivityReportWire(LEDGER_DAY, LEDGER_DAY);
    assert.deepEqual(report.ledger.systems.map(({ system, entries, prod, test }) => ({ system, entries, prod, test })), [
      { system: "ucpath", entries: 2, prod: 2, test: 0 },
    ]);
  });
});
