import { insertImportedArtifact } from "../../../../src/backend/storage/sqlite/imported-artifacts.js";
import { importedArtifact } from "../../../../src/models/intake/imported-artifact.js";

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,it } from "vitest";
import { IntakeSessionSchema,type IntakeSession } from "../../../../src/models/intake/session.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { HASH_A,LATER,NOW,UUID_2,UUID_3,UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { openBoundDatabaseFixture } from "../../../support/helpers/admission-fixture.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const disposers: (() => void | Promise<void>)[] = [];
const databasePaths = new WeakMap<AuthorityDatabase, string>();
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

async function database(legacySession?: IntakeSession): Promise<AuthorityDatabase> {
  const clock = manualClock(new Date(NOW));
  const opened = await openBoundDatabaseFixture("intake-session-test", clock);
  const path = opened.path;
  databasePaths.set(opened.database, path);
  if (legacySession !== undefined) {
    const legacy = new DatabaseSync(path);
    try {
      insertImportedArtifact(legacy, importedArtifact(JSON.stringify(legacySession), null));
    } finally {
      legacy.close();
    }
  }
  disposers.push(async () => await opened.close());
  return opened.database;
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

  it("reads a pre-reservation stored session forward without inventing a manifest identity", async () => {
    const db = await database(preReservationSession());

    const stored = db.authority.intakeSessions.get(UUID_7);

    assert.notEqual(stored, undefined);
    assert.equal(stored?.reservedManifestId, undefined);
  });
});

describe("intake session repository", () => {
  it("refuses to create a new session without a reserved manifest identity", async () => {
    const db = await database();

    assert.throws(
      () => db.authority.intakeSessions.create(preReservationSession()),
      new RegExp(`intake session ${UUID_7} cannot be created with reserved manifest id absent`, "u"),
    );
  });

  it("refuses to delete a present reserved manifest identity through update", async () => {
    const db = await database();
    db.authority.intakeSessions.create(session());

    assert.throws(
      () => db.authority.intakeSessions.update(preReservationSession({ version: 2, updatedAt: LATER })),
      new RegExp(
        `intake session ${UUID_7} cannot change reserved manifest id from ${UUID_2} to absent`,
        "u",
      ),
    );
  });

  it("refuses to replace a present reserved manifest identity through update", async () => {
    const db = await database();
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

  it("lets a legacy session retain an absent reservation through ordinary update", async () => {
    const db = await database(preReservationSession());
    const updated = preReservationSession({ version: 2, updatedAt: LATER });

    db.authority.intakeSessions.update(updated);

    assert.deepEqual(db.authority.intakeSessions.get(UUID_7), updated);
  });

  it("refuses to acquire a reservation for a legacy session through ordinary update", async () => {
    const db = await database(preReservationSession());

    assert.throws(
      () => db.authority.intakeSessions.update(session({ version: 2, updatedAt: LATER })),
      new RegExp(
        `intake session ${UUID_7} cannot change reserved manifest id from absent to ${UUID_2}`,
        "u",
      ),
    );
  });

  it("creates in mapping at version 1 and round-trips; refuses any other creation", async () => {
    const db = await database();
    const created = db.authority.intakeSessions.create(session());
    assert.deepEqual(db.authority.intakeSessions.get(UUID_7), created);

    assert.throws(
      () => db.authority.intakeSessions.create(session({ intakeSessionId: UUID_2, version: 2, updatedAt: LATER })),
      /created in mapping state at version 1/u,
    );
  });

  it("updates under a version CAS, keeps the state column in step, and refuses a raced write", async () => {
    const db = await database();
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

it("keeps a workbook source link immutable through repository and native import updates", async () => {
  const db = await database();
  const original = session({ workbookSource: { libraryId: "library", version: 1 } });
  db.authority.intakeSessions.create(original);
  const generation = db.getMeta().authorityGeneration;
  for (const workbookSource of [undefined, { libraryId: "other", version: 1 }, { libraryId: "library", version: 2 }]) {
    assert.throws(() => db.authority.intakeSessions.update({ ...original, workbookSource, version: 2, updatedAt: LATER }), /imported-artifact-workbook-source-immutable/u);
    assert.equal(db.getMeta().authorityGeneration, generation);
    assert.deepEqual(db.authority.intakeSessions.get(original.intakeSessionId), original);
  }
  db.authority.intakeSessions.update({ ...original, version: 2, updatedAt: LATER });
  const retained = db.authority.intakeSessions.get(original.intakeSessionId); assert.ok(retained);
  const path = databasePaths.get(db); assert.ok(path);
  const raw = new DatabaseSync(path);
  try {
    const record = importedArtifact(JSON.stringify({ ...retained, workbookSource: { libraryId: "forged", version: 1 }, version: 3 }), null);
    assert.throws(() => raw.prepare("UPDATE artifacts SET payload_json=?,version=3 WHERE session_id=?").run(JSON.stringify(record), original.intakeSessionId), /imported-artifact-workbook-source-immutable/u);
  } finally { raw.close(); }
  assert.deepEqual(db.authority.intakeSessions.get(original.intakeSessionId), retained);
});
