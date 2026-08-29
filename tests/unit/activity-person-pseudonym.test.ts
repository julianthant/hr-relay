import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import {
  ACTIVITY_PERSON_PSEUDONYM_SECRET_REFERENCE,
  requireActivityPersonPseudonymDomain,
} from "../../src/domain/secrets.js";
import {
  ActivityPersonPseudonymEvidenceSchema,
  createActivityPersonPseudonymDomain,
} from "../../src/domain/trust/activity-person-pseudonym.js";
import { RunRecordSchema } from "../../src/domain/run/record.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import {
  ACTIVITY_PERSON_PSEUDONYM_KEY_HEX,
  activityPersonPseudonymResultRecord,
  seedTerminalSeparationsResult,
  TERMINAL_SEPARATIONS_RUN,
} from "./fixtures/activity-person-pseudonym-fixtures.js";
import { COMPOSITION_EID } from "./fixtures/separations-composition-fixtures.js";

const RUN_ID = TERMINAL_SEPARATIONS_RUN.envelope.runId;
const KEY_HEX = ACTIVITY_PERSON_PSEUDONYM_KEY_HEX;
const NOW = "2026-08-28T20:00:00.000Z";
const roots: string[] = [];

function databasePath(): string {
  const root = mkdtempSync(join(tmpdir(), "hrauto-pseudonym-"));
  roots.push(root);
  return join(root, "authority.sqlite");
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("activity person pseudonym domain", () => {
  it("derives the reviewed generation-bound HMAC evidence for one canonical subject", () => {
    const domain = createActivityPersonPseudonymDomain({
      keyGeneration: "activity-person-g1",
      keyHex: KEY_HEX,
    });

    const evidence = domain.deriveEvidence({
      runId: RUN_ID,
      workflowId: "separations",
      canonicalSubject: "10873698",
    });

    assert.deepEqual(evidence, {
      runId: RUN_ID,
      workflowId: "separations",
      keyGeneration: "activity-person-g1",
      pseudonym: "010d6acdd7e42d681de6849d727d0afca66a6a0f8ce82b8df48fd768b3f9d8f2",
      derivation: "hmac-sha-256/activity-person/v1",
    });
  });

  it("composes the HMAC domain from its exact secret reference and public generation", () => {
    const domain = requireActivityPersonPseudonymDomain({
      HRAUTO_ACTIVITY_PERSON_PSEUDONYM_HMAC_KEY: KEY_HEX,
      HRAUTO_ACTIVITY_PERSON_PSEUDONYM_KEY_GENERATION: "activity-person-g1",
    });

    assert.deepEqual({
      reference: ACTIVITY_PERSON_PSEUDONYM_SECRET_REFERENCE,
      generation: domain.keyGeneration,
      pseudonym: domain.deriveEvidence({
        runId: RUN_ID,
        workflowId: "separations",
        canonicalSubject: "10873698",
      }).pseudonym,
    }, {
      reference: {
        key: {
          name: "activityPersonPseudonymHmacKey",
          env: "HRAUTO_ACTIVITY_PERSON_PSEUDONYM_HMAC_KEY",
        },
        generation: {
          env: "HRAUTO_ACTIVITY_PERSON_PSEUDONYM_KEY_GENERATION",
        },
      },
      generation: "activity-person-g1",
      pseudonym: "010d6acdd7e42d681de6849d727d0afca66a6a0f8ce82b8df48fd768b3f9d8f2",
    });
  });

  it("fails loud for missing or invalid key material without echoing supplied secrets", () => {
    assert.throws(
      () => requireActivityPersonPseudonymDomain({
        HRAUTO_ACTIVITY_PERSON_PSEUDONYM_HMAC_KEY: KEY_HEX,
      }),
      /HRAUTO_ACTIVITY_PERSON_PSEUDONYM_KEY_GENERATION/u,
    );
    assert.throws(
      () => requireActivityPersonPseudonymDomain({
        HRAUTO_ACTIVITY_PERSON_PSEUDONYM_KEY_GENERATION: "activity-person-g1",
      }),
      /HRAUTO_ACTIVITY_PERSON_PSEUDONYM_HMAC_KEY/u,
    );
    const invalidKey = "invalid-key-material-must-not-escape";
    assert.throws(
      () => requireActivityPersonPseudonymDomain({
        HRAUTO_ACTIVITY_PERSON_PSEUDONYM_HMAC_KEY: invalidKey,
        HRAUTO_ACTIVITY_PERSON_PSEUDONYM_KEY_GENERATION: "activity-person-g1",
      }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        return message.includes("32 bytes encoded as lowercase hex") && !message.includes(invalidKey);
      },
    );
  });
});

describe("activity person pseudonym authority", () => {
  it("exposes only reads so a caller cannot mint schema-valid false evidence", () => {
    const database = AuthorityDatabase.open(
      { path: databasePath(), busyTimeoutMs: 250, migrationOwner: "pseudonym-test" },
      manualClock(new Date(NOW)),
    );

    const repository = database.authority.activityPersonPseudonyms;

    assert.equal(Reflect.has(repository, "insert"), false);
    assert.equal(Reflect.get(repository, "insert"), undefined);
    assert.deepEqual(repository.listByRuns([]), []);
    const authentic = createActivityPersonPseudonymDomain({
      keyGeneration: "activity-person-g1",
      keyHex: KEY_HEX,
    });
    assert.throws(
      () => database.createActivityPersonPseudonymBackfillWriteCapability({
        keyGeneration: authentic.keyGeneration,
        generationBinding: authentic.generationBinding,
        deriveEvidence: (input: unknown) => ActivityPersonPseudonymEvidenceSchema.parse({
          ...authentic.deriveEvidence(input),
          pseudonym: "f".repeat(64),
        }),
      }),
      /lacks the reviewed HMAC capability/u,
    );
    database.close();
  });

  it("inserts and reads one immutable row for a run and key generation", () => {
    const path = databasePath();
    const database = AuthorityDatabase.open(
      { path, busyTimeoutMs: 250, migrationOwner: "pseudonym-test" },
      manualClock(new Date(NOW)),
    );
    seedTerminalSeparationsResult(database, path);
    const domain = createActivityPersonPseudonymDomain({
      keyGeneration: "activity-person-g1",
      keyHex: KEY_HEX,
    });
    const evidence = domain.deriveEvidence({
      runId: RUN_ID,
      workflowId: "separations",
      canonicalSubject: COMPOSITION_EID,
    });

    const inserted = database.createActivityPersonPseudonymBackfillWriteCapability(domain)
      .reviewAndInsert([RUN_ID]);

    assert.deepEqual(inserted, [{
      runId: RUN_ID,
      state: "inserted",
      keyGeneration: "activity-person-g1",
    }]);
    assert.deepEqual(
      database.authority.activityPersonPseudonyms.get(RUN_ID, "activity-person-g1"),
      evidence,
    );
    database.close();
  });

  it("returns exact replay without advancing authority generation", () => {
    const path = databasePath();
    const database = AuthorityDatabase.open(
      { path, busyTimeoutMs: 250, migrationOwner: "pseudonym-test" },
      manualClock(new Date(NOW)),
    );
    seedTerminalSeparationsResult(database, path);
    const domain = createActivityPersonPseudonymDomain({
      keyGeneration: "activity-person-g1",
      keyHex: KEY_HEX,
    });
    const capability = database.createActivityPersonPseudonymBackfillWriteCapability(domain);
    const first = capability.reviewAndInsert([RUN_ID]);
    const generationAfterInsert = database.getMeta().authorityGeneration;

    const replay = capability.reviewAndInsert([RUN_ID]);

    assert.deepEqual({
      first: first[0]?.state,
      replay: replay[0]?.state,
      generationAfterInsert,
      generationAfterReplay: database.getMeta().authorityGeneration,
    }, {
      first: "inserted",
      replay: "existing",
      generationAfterInsert,
      generationAfterReplay: generationAfterInsert,
    });
    database.close();
  });

  it("refuses divergent replay for the same run and key generation", () => {
    const path = databasePath();
    const database = AuthorityDatabase.open(
      { path, busyTimeoutMs: 250, migrationOwner: "pseudonym-test" },
      manualClock(new Date(NOW)),
    );
    seedTerminalSeparationsResult(database, path);
    const domain = createActivityPersonPseudonymDomain({
      keyGeneration: "activity-person-g1",
      keyHex: KEY_HEX,
    });
    const original = domain.deriveEvidence({
      runId: RUN_ID,
      workflowId: "separations",
      canonicalSubject: COMPOSITION_EID,
    });
    database.createActivityPersonPseudonymBackfillWriteCapability(domain).reviewAndInsert([RUN_ID]);
    const divergentDomain = createActivityPersonPseudonymDomain({
      keyGeneration: "activity-person-g1",
      keyHex: "ff".repeat(32),
    });

    assert.throws(
      () => database.createActivityPersonPseudonymBackfillWriteCapability(divergentDomain)
        .reviewAndInsert([RUN_ID]),
      /generation activity-person-g1 is already bound to different key material/u,
    );
    assert.deepEqual(
      database.authority.activityPersonPseudonyms.get(RUN_ID, "activity-person-g1"),
      original,
    );
    database.close();
  });

  it("refuses a changed key for an established generation before inserting any unseen run", () => {
    const path = databasePath();
    const database = AuthorityDatabase.open(
      { path, busyTimeoutMs: 250, migrationOwner: "pseudonym-test" },
      manualClock(new Date(NOW)),
    );
    const unseenRuns = [
      {
        runId: "33333333-3333-4333-8333-333333333333",
        itemId: "44444444-4444-4444-8444-444444444444",
        traceId: "sp-100001-3333",
      },
      {
        runId: "55555555-5555-4555-8555-555555555555",
        itemId: "66666666-6666-4666-8666-666666666666",
        traceId: "sp-100001-5555",
      },
    ].map((identity) => RunRecordSchema.parse({
      ...TERMINAL_SEPARATIONS_RUN,
      envelope: { ...TERMINAL_SEPARATIONS_RUN.envelope, ...identity },
    }));
    seedTerminalSeparationsResult(database, path);
    for (const run of unseenRuns) {
      seedTerminalSeparationsResult(
        database,
        path,
        run,
        activityPersonPseudonymResultRecord(run),
      );
    }
    database.createActivityPersonPseudonymBackfillWriteCapability(
      createActivityPersonPseudonymDomain({
        keyGeneration: "activity-person-g1",
        keyHex: KEY_HEX,
      }),
    ).reviewAndInsert([RUN_ID]);
    const generationBefore = database.getMeta().authorityGeneration;
    const changedKey = createActivityPersonPseudonymDomain({
      keyGeneration: "activity-person-g1",
      keyHex: "ff".repeat(32),
    });

    assert.throws(
      () => database.createActivityPersonPseudonymBackfillWriteCapability(changedKey)
        .reviewAndInsert(unseenRuns.map(({ envelope }) => envelope.runId)),
      /generation activity-person-g1 is already bound to different key material/u,
    );
    assert.deepEqual(
      database.authority.activityPersonPseudonyms.listByRuns(
        unseenRuns.map(({ envelope }) => envelope.runId),
      ),
      [],
    );
    assert.equal(database.getMeta().authorityGeneration, generationBefore);
    database.close();
  });

  it("appends a distinct public generation when the pseudonym domain rotates", () => {
    const path = databasePath();
    const database = AuthorityDatabase.open(
      { path, busyTimeoutMs: 250, migrationOwner: "pseudonym-test" },
      manualClock(new Date(NOW)),
    );
    seedTerminalSeparationsResult(database, path);
    const generationOne = createActivityPersonPseudonymDomain({
      keyGeneration: "activity-person-g1",
      keyHex: KEY_HEX,
    });
    const generationTwo = createActivityPersonPseudonymDomain({
      keyGeneration: "activity-person-g2",
      keyHex: KEY_HEX,
    });
    database.createActivityPersonPseudonymBackfillWriteCapability(generationOne).reviewAndInsert([RUN_ID]);
    database.createActivityPersonPseudonymBackfillWriteCapability(generationTwo).reviewAndInsert([RUN_ID]);

    const records = database.authority.activityPersonPseudonyms.listByRun(RUN_ID);
    assert.deepEqual(records.map(({ keyGeneration }) => keyGeneration), [
      "activity-person-g1",
      "activity-person-g2",
    ]);
    assert.notEqual(records[0]?.pseudonym, records[1]?.pseudonym);
    database.close();
  });

  it("refuses raw SQL update and deletion of pseudonym evidence", () => {
    const path = databasePath();
    const database = AuthorityDatabase.open(
      { path, busyTimeoutMs: 250, migrationOwner: "pseudonym-test" },
      manualClock(new Date(NOW)),
    );
    seedTerminalSeparationsResult(database, path);
    const domain = createActivityPersonPseudonymDomain({
      keyGeneration: "activity-person-g1",
      keyHex: KEY_HEX,
    });
    database.createActivityPersonPseudonymBackfillWriteCapability(domain).reviewAndInsert([RUN_ID]);
    database.close();
    const raw = new DatabaseSync(path);

    assert.throws(
      () => raw.prepare(`
        UPDATE activity_person_pseudonyms SET pseudonym = ? WHERE run_id = ?
      `).run("f".repeat(64), RUN_ID),
      /activity person pseudonym evidence is immutable/u,
    );
    assert.throws(
      () => raw.prepare(`
        DELETE FROM activity_person_pseudonyms WHERE run_id = ?
      `).run(RUN_ID),
      /activity person pseudonym evidence is never deleted/u,
    );
    raw.close();
  });

  it("refuses raw INSERT OR REPLACE conflicts when recursive triggers are disabled", () => {
    const path = databasePath();
    const database = AuthorityDatabase.open(
      { path, busyTimeoutMs: 250, migrationOwner: "pseudonym-test" },
      manualClock(new Date(NOW)),
    );
    seedTerminalSeparationsResult(database, path);
    const domain = createActivityPersonPseudonymDomain({
      keyGeneration: "activity-person-g1",
      keyHex: KEY_HEX,
    });
    database.createActivityPersonPseudonymBackfillWriteCapability(domain).reviewAndInsert([RUN_ID]);
    const original = database.authority.activityPersonPseudonyms.get(
      RUN_ID,
      domain.keyGeneration,
    );
    if (original === undefined) throw new Error("pseudonym replacement fixture was not stored");
    database.close();
    const raw = new DatabaseSync(path);
    try {
      raw.exec("PRAGMA recursive_triggers = OFF");
      const replacement = ActivityPersonPseudonymEvidenceSchema.parse({
        ...original,
        pseudonym: "f".repeat(64),
      });

      assert.throws(
        () => raw.prepare(`
          INSERT OR REPLACE INTO activity_person_pseudonyms
            (record_key, run_id, workflow, key_generation, pseudonym, derivation, record_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          `${replacement.runId}:${replacement.keyGeneration}`,
          replacement.runId,
          replacement.workflowId,
          replacement.keyGeneration,
          replacement.pseudonym,
          replacement.derivation,
          JSON.stringify(replacement),
          NOW,
        ),
        /activity person pseudonym evidence insert conflicts with immutable evidence/u,
      );
      const stored = raw.prepare(`
        SELECT pseudonym FROM activity_person_pseudonyms WHERE run_id = ? AND key_generation = ?
      `).get(RUN_ID, domain.keyGeneration);
      assert.equal(Reflect.get(stored ?? {}, "pseudonym"), original.pseudonym);
    } finally {
      raw.close();
    }
  });
});
