import assert from "node:assert/strict";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { WORKFLOW_MODULES } from "../../../src/control/workflow-registry.js";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import { manualClock } from "../../../src/domain/clock.js";
import {
  deriveExplorerAppliedRecordFingerprint,
  deriveExplorerEditFingerprint,
  ExplorerAppliedOverrideSchema,
  ExplorerEditApplyRequestSchema,
  ExplorerEditAuthorityFileSchema,
  ExplorerEditDraftSchema,
  type ExplorerEditApplyRequest,
} from "../../../src/domain/dashboard/explorer-edit.js";
import { sequentialIdFactory } from "../fixtures/phase1f-run-fixtures.js";
import { FingerprintSchema, IsoInstantSchema } from "../../../src/domain/ids.js";
import { ExplorerEditAuthority } from "../../../src/infra/explorer-edit-authority.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import { ExplorerEditService } from "../../../src/server/dashboard/commands/explorer-edit-service.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function harness() {
  const root = mkdtempSync(join(tmpdir(), "explorer-edit-"));
  const path = join(root, "explorer-overrides.json");
  const descriptor = WORKFLOW_MODULES.find(({ descriptor: one }) => String(one.id) === "person-lookup")?.descriptor;
  if (descriptor === undefined) throw new Error("test registry has no person-lookup descriptor");
  const clock = manualClock(new Date("2026-08-28T15:30:00.000Z"));
  const database = AuthorityDatabase.open(
    { path: join(root, "state.db"), busyTimeoutMs: 250, migrationOwner: "explorer-edit-test" },
    clock,
  );
  const authority = new ExplorerEditAuthority(path);
  const service = new ExplorerEditService({
    authority,
    authorityState: database,
    clock,
    ids: sequentialIdFactory("e"),
    reviewTtlMs: 10 * 60 * 1000,
    descriptors: () => WORKFLOW_MODULES.map((module) => module.descriptor),
  });
  cleanups.push(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { path, descriptor, authority, database, service };
}

function request(
  service: ExplorerEditService,
  descriptor: (typeof WORKFLOW_MODULES)[number]["descriptor"],
  overrides: Partial<ExplorerEditApplyRequest["draft"]> = {},
): ExplorerEditApplyRequest {
  const draft = ExplorerEditDraftSchema.parse({
    draftVersion: 1,
    workflowId: descriptor.id,
    baseDescriptorVersion: descriptor.version,
    baseContractFingerprint: descriptor.contractFingerprint,
    baseOverrideRevision: 0,
    changes: [{ kind: "workflow-label", value: "People search" }],
    ...overrides,
  });
  const review = service.issueReview({
    reviewVersion: 1,
    requestedBy: "local-operator",
    source: "explorer",
    draft,
  });
  return ExplorerEditApplyRequestSchema.parse({
    commandVersion: 1,
    commandId: "11111111-1111-4111-8111-111111111111",
    reviewTokenId: review.reviewTokenId,
    draft,
  });
}

function overrideOf(input: ExplorerEditApplyRequest, appliedAt = "2026-08-28T15:30:00.000Z") {
  const content = {
    recordVersion: 1,
    workflowId: input.draft.workflowId,
    revision: input.draft.baseOverrideRevision + 1,
    baseDescriptorVersion: input.draft.baseDescriptorVersion,
    baseContractFingerprint: input.draft.baseContractFingerprint,
    compiledFingerprint: deriveExplorerEditFingerprint(input.draft),
    changes: input.draft.changes,
    commandId: input.commandId,
    appliedAt,
  } as const;
  return ExplorerAppliedOverrideSchema.parse({
    ...content,
    recordFingerprint: deriveExplorerAppliedRecordFingerprint(content),
  });
}

describe("Explorer edit service", () => {
  it("refuses a caller-computable reviewed fingerprint as apply authority", () => {
    const descriptor = WORKFLOW_MODULES[0]?.descriptor;
    if (descriptor === undefined) throw new Error("test registry is empty");
    const draft = ExplorerEditDraftSchema.parse({
      draftVersion: 1,
      workflowId: descriptor.id,
      baseDescriptorVersion: descriptor.version,
      baseContractFingerprint: descriptor.contractFingerprint,
      baseOverrideRevision: 0,
      changes: [{ kind: "workflow-label", value: "People search" }],
    });

    assert.equal(ExplorerEditApplyRequestSchema.safeParse({
      commandVersion: 1,
      commandId: "11111111-1111-4111-8111-111111111111",
      reviewedFingerprint: deriveExplorerEditFingerprint(draft),
      draft,
    }).success, false);
  });

  it("issues a persisted single-purpose review and compiles the exact draft", () => {
    const { descriptor, database, service } = harness();
    const input = request(service, descriptor);

    const compiled = service.compile(input, 0);

    assert.equal(compiled.state, "compiled");
    assert.equal(
      database.authority.explorerEditReviews.get(String(input.reviewTokenId))?.draftFingerprint,
      deriveExplorerEditFingerprint(input.draft),
    );
  });

  it("conflicts on either a stale descriptor identity or override revision", () => {
    const { descriptor, service } = harness();
    const valid = request(service, descriptor);
    const staleVersion = service.compile({
      ...valid,
      draft: { ...valid.draft, baseDescriptorVersion: descriptor.version + 1 },
    }, 0);
    const staleRevision = service.compile(valid, 1);

    assert.equal(staleVersion.state, "conflict");
    assert.equal(staleRevision.state, "conflict");
  });

  it("refuses timeline and Edit Data fields the descriptor does not own", () => {
    const { descriptor, service } = harness();
    for (const changes of [
      [{ kind: "timeline-category-label", categoryKey: "invented", value: "Invented" }],
      [{ kind: "timeline-category-order", categoryKeys: ["invented"] }],
      [{ kind: "edit-data-fields", fields: [{ nodeId: "searching", fieldPath: "secret", label: "Secret" }] }],
    ]) {
      assert.throws(
        () => request(service, descriptor, { changes } as Partial<ExplorerEditApplyRequest["draft"]>),
        /does not declare/u,
      );
    }
  });

  it("refuses to serve a valid file override that lacks command and audit authority", () => {
    const { descriptor, authority, service } = harness();
    authority.project(overrideOf(request(service, descriptor)));

    assert.throws(() => service.read(descriptor.id), /not a projected journaled outbox|no durable outbox/u);
  });

  it("keeps the projected file byte-exact and rejects content tamper", () => {
    const { path, descriptor, authority, service } = harness();
    authority.project(overrideOf(request(service, descriptor)));
    const before = `${canonicalJsonStringify(authority.readFile())}\n`;
    assert.equal(readFileSync(path, "utf8"), before);
    writeFileSync(path, before.replace("People search", "Tampered label"), "utf8");

    assert.throws(() => authority.readFile(), /fingerprint mismatch/u);
  });

  it("rejects a malformed compiled fingerprint before replacing the file", () => {
    const { path, descriptor, authority, service } = harness();
    const input = request(service, descriptor);
    const malformedContent = {
      recordVersion: 1,
      workflowId: input.draft.workflowId,
      revision: input.draft.baseOverrideRevision + 1,
      baseDescriptorVersion: input.draft.baseDescriptorVersion,
      baseContractFingerprint: input.draft.baseContractFingerprint,
      compiledFingerprint: FingerprintSchema.parse("f".repeat(64)),
      changes: input.draft.changes,
      commandId: input.commandId,
      appliedAt: IsoInstantSchema.parse("2026-08-28T15:30:00.000Z"),
    } as const;
    assert.notEqual(malformedContent.compiledFingerprint, deriveExplorerEditFingerprint(input.draft));
    const malformed = {
      ...malformedContent,
      recordFingerprint: deriveExplorerAppliedRecordFingerprint(malformedContent),
    };

    assert.throws(() => authority.project(malformed), /compiled fingerprint mismatch/u);
    assert.equal(existsSync(path), false);
  });

  it("rejects a malformed record fingerprint before replacing the file", () => {
    const { path, descriptor, authority, service } = harness();
    const valid = overrideOf(request(service, descriptor));
    const malformedFingerprint = FingerprintSchema.parse("f".repeat(64));
    assert.notEqual(malformedFingerprint, valid.recordFingerprint);
    const malformed = {
      ...valid,
      recordFingerprint: malformedFingerprint,
    };

    assert.throws(() => authority.project(malformed), /record fingerprint mismatch/u);
    assert.equal(existsSync(path), false);
  });

  it("rejects provenance tamper even when the file remains canonical JSON", () => {
    const { path, descriptor, authority, service } = harness();
    authority.project(overrideOf(request(service, descriptor)));
    const parsed = ExplorerEditAuthorityFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    const first = parsed.overrides[0];
    if (first === undefined) throw new Error("projected file has no override");
    const tampered = {
      ...parsed,
      overrides: [{ ...first, commandId: "22222222-2222-4222-8222-222222222222" }, ...parsed.overrides.slice(1)],
    };
    writeFileSync(path, `${canonicalJsonStringify(tampered)}\n`, "utf8");

    assert.throws(() => authority.readFile(), /record fingerprint mismatch/u);
  });

  it("keeps the primary error first across temporary-file cleanup failures", () => {
    const cases = [
      { name: "close cleanup", failClose: true, failRemove: false },
      { name: "remove cleanup", failClose: false, failRemove: true },
      { name: "close and remove cleanup", failClose: true, failRemove: true },
    ] as const;

    for (const testCase of cases) {
      const { path, descriptor, service } = harness();
      const override = overrideOf(request(service, descriptor));
      const temporary = `${path}.${String(override.commandId)}.tmp`;
      const primaryError = new Error(`injected ${testCase.name} primary failure`);
      const closeError = new Error(`injected ${testCase.name} close failure`);
      const removeError = new Error(`injected ${testCase.name} remove failure`);
      let removeAttempts = 0;
      const authority = new ExplorerEditAuthority(path, {
        writeFile: () => {
          throw primaryError;
        },
        closeFile: (handle) => {
          closeSync(handle);
          if (testCase.failClose) throw closeError;
        },
        removeFile: (candidate) => {
          removeAttempts += 1;
          if (testCase.failRemove) throw removeError;
          unlinkSync(candidate);
        },
        syncDirectory: () => undefined,
      });

      let caught: unknown;
      try {
        authority.project(override);
      } catch (error) {
        caught = error;
      }

      assert.ok(caught instanceof AggregateError, `${testCase.name} must aggregate cleanup failures`);
      assert.equal(caught.cause, primaryError);
      assert.equal(caught.errors[0], primaryError);
      assert.equal(caught.errors.length, 1 + Number(testCase.failClose) + Number(testCase.failRemove));
      assert.equal(removeAttempts, 1, `${testCase.name} must attempt removal after close cleanup`);
      let failureIndex = 1;
      if (testCase.failClose) {
        const failure: unknown = caught.errors[failureIndex];
        assert.ok(failure instanceof Error);
        assert.ok(failure.message.includes(temporary));
        assert.equal(failure.cause, closeError);
        failureIndex += 1;
      }
      if (testCase.failRemove) {
        const failure: unknown = caught.errors[failureIndex];
        assert.ok(failure instanceof Error);
        assert.ok(failure.message.includes(temporary));
        assert.equal(failure.cause, removeError);
      }
      assert.equal(existsSync(temporary), testCase.failRemove);
      assert.equal(existsSync(path), false);
    }
  });

  it("preserves directory sync failures through atomic replacement", () => {
    const cases = [
      { name: "fsync only", failSync: true, failClose: false },
      { name: "close only", failSync: false, failClose: true },
      { name: "fsync and close", failSync: true, failClose: true },
    ] as const;

    for (const testCase of cases) {
      const { path, descriptor, service } = harness();
      const directory = dirname(path);
      const syncError = new Error(`injected ${testCase.name} directory fsync failure`);
      const closeError = new Error(`injected ${testCase.name} directory close failure`);
      let closeAttempts = 0;
      const authority = new ExplorerEditAuthority(path, {
        syncDirectoryHandle: () => {
          if (testCase.failSync) throw syncError;
        },
        closeDirectory: (handle) => {
          closeAttempts += 1;
          closeSync(handle);
          if (testCase.failClose) throw closeError;
        },
      });

      let caught: unknown;
      try {
        authority.project(overrideOf(request(service, descriptor)));
      } catch (error) {
        caught = error;
      }

      assert.ok(caught instanceof Error, `${testCase.name} must fail projection`);
      assert.ok(caught.message.includes(directory));
      assert.equal(closeAttempts, 1);
      assert.equal(existsSync(path), true, `${testCase.name} happens after atomic replacement`);
      if (testCase.failSync && testCase.failClose) {
        assert.ok(caught instanceof AggregateError);
        assert.equal(caught.cause, syncError);
        assert.equal(caught.errors.length, 2);
        assert.equal(caught.errors[0], syncError);
        const closeFailure: unknown = caught.errors[1];
        assert.ok(closeFailure instanceof Error);
        assert.ok(closeFailure.message.includes(directory));
        assert.equal(closeFailure.cause, closeError);
      } else {
        assert.ok(!(caught instanceof AggregateError));
        assert.equal(caught.cause, testCase.failSync ? syncError : closeError);
      }
    }
  });

  it("rejects a stale fingerprint before a file projection can be formed", () => {
    const { descriptor, service } = harness();
    const valid = request(service, descriptor);
    const input = {
      ...valid,
      draft: { ...valid.draft, baseContractFingerprint: FingerprintSchema.parse("f".repeat(64)) },
    };

    assert.equal(service.compile(input, 0).state, "conflict");
  });
});
