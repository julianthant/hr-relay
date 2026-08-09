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
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { IntakeSessionSchema } from "../../src/domain/intake/session.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { HASH_A, LATER, NOW, UUID_2, UUID_7 } from "./fixtures/phase1c-contract-fixtures.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function database(): AuthorityDatabase {
  const clock = manualClock(new Date(NOW));
  const root = mkdtempSync(join(tmpdir(), "hrauto-intake-session-"));
  disposers.push(() => rmSync(root, { recursive: true, force: true }));
  const opened = AuthorityDatabase.open(
    { path: join(root, "state.db"), busyTimeoutMs: 250, migrationOwner: "intake-session-test" },
    clock,
  );
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
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
}

describe("intake session record", () => {
  it("requires an enqueued session to name its manifest, and only an enqueued one to carry it", () => {
    assert.throws(
      () => session({ state: "enqueued", validation: { state: "validated", validatedAt: NOW, readAt: NOW } }),
      /names the manifest/u,
    );
    assert.throws(() => session({ intakeManifestId: UUID_2 }), /only an enqueued session/u);
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
});

describe("intake session repository", () => {
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
