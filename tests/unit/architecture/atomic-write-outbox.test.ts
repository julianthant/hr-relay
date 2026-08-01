import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../../src/domain/clock.js";
import { AtomicOutboxRecordSchema } from "../../../src/domain/outbox.js";
import {
  AtomicWriteCommitReportSchema,
  AtomicWriteCommitStorageStepSchema,
  AuthorityDatabase,
  type AuthorityWriteCommitHooks,
} from "../../../src/infra/sqlite/index.js";
import {
  ATOMIC_WRITE_COMMIT,
  LEDGER_OUTBOX_RECORD,
  NOW,
  SPAN_OUTBOX_RECORD,
  UUID_4,
  UUID_7,
  UUID_8,
  WRITE_ATTEMPT,
  WRITE_INTENT_ATTEMPTING,
} from "../fixtures/phase1c-contract-fixtures.js";
import { gitVisibleFiles, REPO_ROOT } from "./helpers/guard-files.js";

const CLOCK = manualClock(new Date(NOW));
const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

function databasePath(): string {
  const root = mkdtempSync(join(tmpdir(), "hrauto-atomic-write-"));
  roots.push(root);
  return join(root, "state.sqlite");
}

function open(path: string, hooks?: AuthorityWriteCommitHooks): AuthorityDatabase {
  const database = AuthorityDatabase.open(
    { path, busyTimeoutMs: 250, migrationOwner: "atomic-write-test" },
    CLOCK,
    hooks,
  );
  databases.push(database);
  return database;
}

function fence(database: AuthorityDatabase): void {
  const result = database.authority.writeIntents.fenceAttempt({
    intent: WRITE_INTENT_ATTEMPTING,
    attempt: WRITE_ATTEMPT,
  });
  assert.equal(result.state, "fenced");
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe("Phase 1c atomic write authority commit", () => {
  it("commits intent, attempt, ledger outbox, and terminal outcome span all-or-none", () => {
    const database = open(databasePath());
    fence(database);
    const generationBeforeCommit = database.getMeta().authorityGeneration;
    const report = database.commitWriteAttempt(ATOMIC_WRITE_COMMIT);

    assert.equal(AtomicWriteCommitReportSchema.safeParse(report).success, true);
    assert.equal(report.intent.status, "committed");
    assert.equal(report.attempt.outcome.state, "committed");
    assert.equal(AtomicOutboxRecordSchema.safeParse(report.ledgerOutbox).success, true);
    assert.equal(AtomicOutboxRecordSchema.safeParse(report.terminalSpanOutbox).success, true);
    assert.deepEqual(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId), report.intent);
    assert.deepEqual(database.authority.writeAttempts.get(UUID_4), report.attempt);
    assert.deepEqual(database.authority.durableOutbox.get(UUID_7), LEDGER_OUTBOX_RECORD);
    assert.deepEqual(database.authority.durableOutbox.get(UUID_8), SPAN_OUTBOX_RECORD);
    assert.equal(database.getMeta().authorityGeneration, generationBeforeCommit + 1);
  });

  for (const failedStep of AtomicWriteCommitStorageStepSchema.options) {
    it(`rolls back every authority row and generation after ${failedStep} failure`, () => {
      const hooks: AuthorityWriteCommitHooks = {
        afterStorageStep(step) {
          if (step === failedStep) throw new Error(`injected failure after ${step}`);
        },
      };
      const path = databasePath();
      const database = open(path, hooks);
      fence(database);
      const generationBeforeCommit = database.getMeta().authorityGeneration;

      assert.throws(
        () => database.commitWriteAttempt(ATOMIC_WRITE_COMMIT),
        new RegExp(`injected failure after ${failedStep}`),
      );
      assert.equal(database.getMeta().authorityGeneration, generationBeforeCommit);
      assert.equal(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)?.status, "attempting");
      assert.equal(database.authority.writeAttempts.get(UUID_4)?.outcome.state, "attempting");
      assert.equal(database.authority.durableOutbox.get(UUID_7), undefined);
      assert.equal(database.authority.durableOutbox.get(UUID_8), undefined);
      assert.equal(AuthorityDatabase.inspectExistingReadOnly(path).invariants.state, "valid");
    });
  }

  it("rejects mismatched generic outcome and outbox identities before changing authority", () => {
    const database = open(databasePath());
    fence(database);
    const generationBeforeCommit = database.getMeta().authorityGeneration;
    assert.throws(() => database.commitWriteAttempt({
      ...ATOMIC_WRITE_COMMIT,
      terminalSpanOutbox: {
        ...SPAN_OUTBOX_RECORD,
        payload: {
          ...SPAN_OUTBOX_RECORD.payload,
          outcome: {
            ...SPAN_OUTBOX_RECORD.payload.outcome,
            output: { schemaHash: "a".repeat(64), value: "different-output" },
          },
        },
      },
    }), /terminal span outcome must equal/);
    assert.equal(database.getMeta().authorityGeneration, generationBeforeCommit);
    assert.equal(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)?.status, "attempting");
    assert.equal(database.authority.durableOutbox.get(UUID_7), undefined);
  });

  it("keeps standalone attempt/outbox mutation private and routes the commit through one authority transaction", () => {
    const database = open(databasePath());
    assert.deepEqual(Object.keys(database.authority.writeAttempts), ["get"]);
    assert.deepEqual(Object.keys(database.authority.durableOutbox), ["get"]);

    const adapterPath = join(REPO_ROOT, "src/infra/sqlite/authority-database.ts");
    const adapter = readFileSync(adapterPath, "utf8");
    assert.match(adapter, /commitWriteAttempt\(input: unknown\)[\s\S]*?return this\.withAuthorityTransaction\(\(\) => \{/);
    assert.doesNotMatch(adapter, /writeAttempts:\s*Object\.freeze\(\{\s*insert:/);
    assert.doesNotMatch(adapter, /durableOutbox:\s*Object\.freeze\(\{\s*insert:/);

    const sourceText = gitVisibleFiles(["src"])
      .filter((path) => path.endsWith(".ts") || path.endsWith(".tsx"))
      .map((path) => readFileSync(join(REPO_ROOT, path), "utf8"))
      .join("\n");
    assert.doesNotMatch(sourceText, /\.authority\.writeAttempts\.insert\s*\(/);
    assert.doesNotMatch(sourceText, /\.authority\.durableOutbox\.insert\s*\(/);
  });
});
