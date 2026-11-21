import { describe, expect, it } from "vitest";
import {
  AUTHORITY_RESTORE_EVENTS,
  AuthorityRestoreJournalSchema,
  authorityRestoreStageOf,
  authorityRestoreTransition,
  type AuthorityRestoreEvent,
  type AuthorityRestoreStage,
  type AuthorityRestoreTransition,
} from "../../../../src/backend/storage/admission/installation.js";

const installationId = "00000000-0000-4000-8000-000000000001", profileId = "00000000-0000-4000-8000-000000000002";
const operationId = "11111111-1111-4111-8111-111111111111", digest = "a".repeat(64), file = { byteSize: 1, sha256: digest };
const stateRoot = "/relay/.tracker/data", root = `${stateRoot}/profiles/${profileId}`;
const locator = { schemaVersion: 3, installationId, generation: 0, stateRoot, artifactRoot: `${stateRoot}/artifacts` };
const continuity = { schemaVersion: 7, installationId, digest, revision: 0, generation: 0, operations: [] };
const document = { schemaVersion: 4, installationId, revision: 0, profiles: [], sessionGeneration: 0, activeProfileId: null };
const restoring = AuthorityRestoreJournalSchema.parse({ schemaVersion: 3, phase: "restoring", installationId, source: locator, restoreAdmissionId: operationId,
  restore: { operationId, profile: { binding: { installationId, profileId }, continuity,
    credentials: { binding: { installationId, profileId }, generation: 1, keyId: operationId, digest, counters: [], retired: [] } },
  authorityPath: `${root}/state.db`, stagedPath: `${root}/.restore-${operationId}.sqlite.tmp`,
  suspectPath: `${root}/backups/suspects/suspect-20261102000000000-${operationId}.sqlite`, manifestPath: `${root}/backups/authority/authority.sqlite.manifest.json`,
  manifestSha256: digest, backupPath: `${root}/backups/authority/authority.sqlite`, backupSha256: digest, sourceDatabaseIdentity: digest, authorityGeneration: 0,
  authorityContentFingerprint: digest, browserMembershipDigest: digest, retainedFilesDigest: digest, unresolvedWriteDigest: digest,
  backupTime: "2026-11-01T00:00:00.000Z", restoredAt: "2026-11-02T00:00:00.000Z", live: file, staged: file, suspect: file, companions: [] } });
const invalidated = AuthorityRestoreJournalSchema.parse({ ...restoring,
  invalidation: { priorDocument: document, document: { ...document, revision: 1, sessionGeneration: 1 }, continuity } });

describe("authority restore stage (design machine 5)", () => {
  it.each([
    [restoring, true, "staged"],
    [restoring, false, "renamed"],
    [invalidated, false, "settling"],
  ] as const)("derives the stage from the journal and whether the staged file exists (%#)", (journal, stagedFilePresent, stage) => {
    expect(authorityRestoreStageOf(journal, stagedFilePresent)).toBe(stage);
  });

  it("refuses a recorded invalidation beside a staged file, which only exists before the rename", () => {
    expect(() => authorityRestoreStageOf(invalidated, true)).toThrow(/restore-recovery-file-changed/u);
  });

  const table: Record<AuthorityRestoreStage | "absent", Record<AuthorityRestoreEvent, AuthorityRestoreTransition>> = {
    absent: {
      begin: { state: "staged" },
      rename: { refused: "not-restoring" },
      "record-invalidation": { refused: "not-restoring" },
      unlink: { refused: "not-restoring" },
      resume: { refused: "not-restoring" },
    },
    staged: {
      begin: { refused: "restore-pending" },
      rename: { state: "renamed" },
      "record-invalidation": { refused: "not-restoring" },
      unlink: { refused: "not-restoring" },
      resume: { state: "staged" },
    },
    renamed: {
      begin: { refused: "restore-pending" },
      rename: { refused: "not-restoring" },
      "record-invalidation": { state: "settling" },
      unlink: { refused: "not-restoring" },
      resume: { state: "renamed" },
    },
    settling: {
      begin: { refused: "restore-pending" },
      rename: { refused: "not-restoring" },
      "record-invalidation": { refused: "not-restoring" },
      unlink: { state: "absent" },
      resume: { state: "settling" },
    },
  };

  it("names every event the table walks", () => {
    expect([...AUTHORITY_RESTORE_EVENTS].sort()).toEqual(Object.keys(table.absent).sort());
  });

  for (const [stage, events] of Object.entries(table) as [AuthorityRestoreStage | "absent", typeof table.absent][]) {
    for (const [event, expected] of Object.entries(events) as [AuthorityRestoreEvent, AuthorityRestoreTransition][]) {
      it(`${stage} + ${event} -> ${"state" in expected ? expected.state : `refused ${expected.refused}`}`, () => {
        expect(authorityRestoreTransition(stage, event)).toEqual(expected);
      });
    }
  }
});
