/**
 * 2i-E1: the durable intake session — created in `mapping` by the upload
 * route, mutated under a version CAS, and findable by its source bytes so a
 * re-upload joins its open session instead of silently forking a second one.
 * The searchable `state` column must move WITH the record: a column that
 * lagged its own JSON would make "open session for this file" a lie.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { IntakeSessionSchema, type IntakeSession } from "../../src/domain/intake/session.js";
import { IntakeSessionWireSchema } from "../../src/domain/intake/wire.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { HASH_A, LATER, NOW, UUID_2, UUID_3, UUID_7 } from "./fixtures/phase1c-contract-fixtures.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function database(legacySession?: IntakeSession): AuthorityDatabase {
  const clock = manualClock(new Date(NOW));
  const root = mkdtempSync(join(tmpdir(), "hrauto-intake-session-"));
  disposers.push(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "state.db");
  const opened = AuthorityDatabase.open(
    { path, busyTimeoutMs: 250, migrationOwner: "intake-session-test" },
    clock,
  );
  if (legacySession !== undefined) {
    const legacy = new DatabaseSync(path);
    try {
      legacy.prepare(`
        INSERT INTO intake_sessions
          (record_key, workflow, source_sha256, state, record_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        legacySession.intakeSessionId,
        legacySession.workflow,
        legacySession.artifact.sha256,
        legacySession.state,
        JSON.stringify(legacySession),
        legacySession.createdAt,
        legacySession.updatedAt,
      );
    } finally {
      legacy.close();
    }
  }
  disposers.push(() => opened.close());
  return opened;
}

function session(overrides: Record<string, unknown> = {}) {
  return IntakeSessionSchema.parse({
    intakeSessionId: UUID_7,
    actorId: "local-operator",
    workflow: "person-lookup",
    artifact: {
      id: UUID_2,
      sha256: HASH_A,
      bytes: 2048,
      mediaType: "text/csv",
    },
    sheet: "default",
    headerRowIndex: null,
    bindings: [],
    constants: [],
    corrections: [],
    exclusions: [],
    state: "mapping",
    validation: { state: "none" },
    reservedManifestId: UUID_2,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
}

function preReservationSession(overrides: Record<string, unknown> = {}): IntakeSession {
  const record: Record<string, unknown> = { ...session(overrides) };
  delete record.reservedManifestId;
  return IntakeSessionSchema.parse(record);
}

function sessionWire(overrides: Record<string, unknown> = {}) {
  return {
    wireVersion: 1,
    intakeSessionId: UUID_7,
    workflow: "person-lookup",
    artifact: {
      id: UUID_2,
      sha256: HASH_A,
      bytes: 2048,
      mediaType: "text/csv",
    },
    sourceName: "people.csv",
    state: "mapping",
    expectedVersion: 1,
    reservedManifestId: UUID_2,
    createdAt: NOW,
    updatedAt: NOW,
    sheets: ["default"],
    sheet: "default",
    headerCandidates: [],
    headerDiscoveryReason: "no-rows",
    headerRowIndex: null,
    headerFingerprint: null,
    columns: [],
    rowCount: 0,
    targets: [],
    bindings: [],
    constants: [],
    corrections: [],
    exclusions: [],
    suggestions: [],
    validation: { state: "none" },
    ...overrides,
  };
}

describe("intake session record", () => {
  it("requires an enqueued session to name its manifest, and only an enqueued one to carry it", () => {
    assert.throws(
      () => session({ state: "enqueued", validation: { state: "validated", validatedAt: NOW, readAt: NOW } }),
      /names the manifest/u,
    );
    assert.throws(() => session({ intakeManifestId: UUID_2 }), /only an enqueued session/u);
    assert.throws(
      () => session({
        state: "enqueued",
        validation: { state: "validated", validatedAt: NOW, readAt: NOW },
        reservedManifestId: UUID_2,
        intakeManifestId: UUID_7,
      }),
      /consumes its reserved manifest id exactly/u,
    );
    assert.throws(
      () => session({ state: "validated" }),
      /retains its validation instant/u,
    );
    // A binding names a column; columns exist only under a settled header row.
    assert.throws(
      () => session({
        bindings: [{
          targetFieldId: "emplId",
          canonicalFieldId: "eid",
          sourceColumnId: "ZW1wbG95ZWVJZDow",
          confirmedAt: NOW,
        }],
      }),
      /settled header row/u,
    );
  });

  it("reads a pre-reservation stored session forward without inventing a manifest identity", () => {
    const db = database(preReservationSession());

    const stored = db.authority.intakeSessions.get(UUID_7);

    assert.notEqual(stored, undefined);
    assert.equal(stored?.reservedManifestId, undefined);
  });
});

describe("intake session wire", () => {
  it("refuses an enqueued session without its terminal manifest identity", () => {
    assert.throws(
      () => IntakeSessionWireSchema.parse(sessionWire({ state: "enqueued" })),
      /an enqueued session names the manifest it fanned out as/u,
    );
  });

  it("refuses a non-enqueued session with a terminal manifest identity", () => {
    assert.throws(
      () => IntakeSessionWireSchema.parse(sessionWire({ intakeManifestId: UUID_2 })),
      /only an enqueued session carries a manifest id/u,
    );
  });

  it("refuses unequal reserved and terminal manifest identities", () => {
    assert.throws(
      () => IntakeSessionWireSchema.parse(sessionWire({
        state: "enqueued",
        intakeManifestId: UUID_3,
      })),
      /an enqueued session consumes its reserved manifest id exactly/u,
    );
  });
});

describe("intake session repository", () => {
  it("refuses to create a new session without a reserved manifest identity", () => {
    const db = database();

    assert.throws(
      () => db.authority.intakeSessions.create(preReservationSession()),
      new RegExp(`intake session ${UUID_7} cannot be created with reserved manifest id absent`, "u"),
    );
  });

  it("refuses to delete a present reserved manifest identity through update", () => {
    const db = database();
    db.authority.intakeSessions.create(session());

    assert.throws(
      () => db.authority.intakeSessions.update(preReservationSession({ version: 2, updatedAt: LATER })),
      new RegExp(
        `intake session ${UUID_7} cannot change reserved manifest id from ${UUID_2} to absent`,
        "u",
      ),
    );
  });

  it("refuses to replace a present reserved manifest identity through update", () => {
    const db = database();
    db.authority.intakeSessions.create(session());

    assert.throws(
      () => db.authority.intakeSessions.update(session({
        reservedManifestId: UUID_3,
        version: 2,
        updatedAt: LATER,
      })),
      new RegExp(
        `intake session ${UUID_7} cannot change reserved manifest id from ${UUID_2} to ${UUID_3}`,
        "u",
      ),
    );
  });

  it("lets a legacy session retain an absent reservation through ordinary update", () => {
    const db = database(preReservationSession());
    const updated = preReservationSession({ version: 2, updatedAt: LATER });

    db.authority.intakeSessions.update(updated);

    assert.deepEqual(db.authority.intakeSessions.get(UUID_7), updated);
  });

  it("refuses to acquire a reservation for a legacy session through ordinary update", () => {
    const db = database(preReservationSession());

    assert.throws(
      () => db.authority.intakeSessions.update(session({ version: 2, updatedAt: LATER })),
      new RegExp(
        `intake session ${UUID_7} cannot change reserved manifest id from absent to ${UUID_2}`,
        "u",
      ),
    );
  });

  it("creates in mapping at version 1 and round-trips; refuses any other creation", () => {
    const db = database();
    const created = db.authority.intakeSessions.create(session());
    assert.deepEqual(db.authority.intakeSessions.get(UUID_7), created);

    assert.throws(
      () => db.authority.intakeSessions.create(session({ intakeSessionId: UUID_2, version: 2, updatedAt: LATER })),
      /created in mapping state at version 1/u,
    );
  });

  it("updates under a version CAS, keeps the state column in step, and refuses a raced write", () => {
    const db = database();
    db.authority.intakeSessions.create(session());

    assert.equal(db.authority.intakeSessions.findActiveBySource(HASH_A).length, 1);

    const settled = session({
      headerRowIndex: 0,
      bindings: [{
        targetFieldId: "emplId",
        canonicalFieldId: "eid",
        sourceColumnId: "ZW1wbG95ZWVJZDow",
        confirmedAt: LATER,
      }],
      version: 2,
      updatedAt: LATER,
    });
    db.authority.intakeSessions.update(settled);
    assert.deepEqual(db.authority.intakeSessions.get(UUID_7), settled);

    // The same version again: its predecessor no longer exists — a raced write.
    assert.throws(() => db.authority.intakeSessions.update(settled), /raced past its expected predecessor/u);

    // Discarding removes it from the active-by-source view THROUGH the column,
    // proving the searchable column moved with the record.
    db.authority.intakeSessions.update(session({
      headerRowIndex: 0,
      state: "discarded",
      version: 3,
      updatedAt: LATER,
    }));
    assert.deepEqual(db.authority.intakeSessions.findActiveBySource(HASH_A), []);
  });
});
