import assert from "node:assert/strict";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it, vi } from "vitest";
import { CommandAuditRecordSchema } from "../../../src/domain/commands.js";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import {
  ExplorerEditApplyRequestSchema,
  ExplorerOverrideDocumentSchema,
  ExplorerWorkflowOverrideSchema,
  type ExplorerEditApplyRequest,
  type ExplorerWorkflowOverride,
} from "../../../src/domain/dashboard/explorer.js";
import {
  createExplorerOverrideStore,
  explorerEditCommandFingerprint,
  ExplorerOverrideBusyError,
  ExplorerOverrideStateUncertainError,
  type ExplorerOverrideFileOperations,
} from "../../../src/server/dashboard/commands/explorer-override-store.js";

const roots: string[] = [];

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    fsyncSync: vi.fn(actual.fsyncSync),
    closeSync: vi.fn(actual.closeSync),
    lstatSync: vi.fn(actual.lstatSync),
  };
});

afterEach(() => {
  vi.mocked(fsyncSync).mockReset();
  vi.mocked(closeSync).mockReset();
  vi.mocked(lstatSync).mockReset();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixturePath(): string {
  const root = mkdtempSync(join(tmpdir(), "hrauto-explorer-override-store-"));
  roots.push(root);
  return join(root, "explorer-overrides.json");
}

function override(
  revision: number,
  label: string,
  commandId = "11111111-1111-4111-8111-111111111111",
  request = command(revision - 1, commandId, label),
): ExplorerWorkflowOverride {
  return ExplorerWorkflowOverrideSchema.parse({
    overrideVersion: 1,
    workflowId: request.target.workflowId,
    descriptorVersion: 1,
    contractFingerprint: "a".repeat(64),
    revision,
    appliedCommandId: commandId,
    commandFingerprint: explorerEditCommandFingerprint(request),
    presentation: { label },
  });
}

function command(
  expectedOverrideRevision = 0,
  commandId = "11111111-1111-4111-8111-111111111111",
  label = expectedOverrideRevision === 0 ? "People search" : "Directory search",
): ExplorerEditApplyRequest {
  return ExplorerEditApplyRequestSchema.parse({
    commandId,
    requestedAt: "2026-08-28T12:00:00.000Z",
    requestedBy: "local-operator",
    source: "dashboard",
    reason: "Apply the reviewed presentation label",
    family: "explorer",
    type: "apply-explorer-edit",
    target: {
      workflowId: "person-lookup",
      expectedVersion: 1,
      contractFingerprint: "a".repeat(64),
      expectedOverrideRevision,
    },
    payload: { changes: [{ kind: "workflow-label", value: label }] },
  });
}

function realOperations(atomicReplace: ExplorerOverrideFileOperations["atomicReplace"]): ExplorerOverrideFileOperations {
  return {
    writeExclusive: (path, text) => writeFileSync(path, text, { encoding: "utf8", mode: 0o600, flag: "wx" }),
    syncPath: (path) => {
      const descriptor = openSync(path, "r");
      try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
    },
    atomicReplace,
    remove: unlinkSync,
  };
}

function pendingWithPrior(path: string) {
  const store = createExplorerOverrideStore(path);
  const priorRequest = ExplorerEditApplyRequestSchema.parse({
    ...command(),
    payload: { changes: [
      { kind: "workflow-label", value: "People search" },
      { kind: "workflow-icon", value: "Search" },
      { kind: "workflow-category", value: "search" },
    ] },
  });
  const prior = ExplorerWorkflowOverrideSchema.parse({
    ...override(1, "People search", priorRequest.commandId, priorRequest),
    presentation: { label: "People search", icon: "Search", category: "search" },
  });
  store.replace(priorRequest, prior).finalizeAfterCommit();
  const otherBase = command(0, "22222222-2222-4222-8222-222222222222", "Prior separations");
  const otherRequest = ExplorerEditApplyRequestSchema.parse({
    ...otherBase, target: { ...otherBase.target, workflowId: "separations" },
  });
  const other = override(1, "Prior separations", otherRequest.commandId, otherRequest);
  store.replace(otherRequest, other).finalizeAfterCommit();
  const request = ExplorerEditApplyRequestSchema.parse({
    ...command(1, "33333333-3333-4333-8333-333333333333"),
    payload: { changes: [
      { kind: "workflow-label", value: "Directory search" },
      { kind: "workflow-icon", value: "Users" },
    ] },
  });
  const replacement = ExplorerWorkflowOverrideSchema.parse({
    ...override(2, "Directory search", request.commandId, request),
    presentation: { label: "Directory search", icon: "Users", category: "search" },
  });
  store.replace(request, replacement);
  const target = { family: "explorer", workflowId: "person-lookup", revision: 2 } as const;
  const audit = CommandAuditRecordSchema.parse({
    auditId: "99999999-9999-4999-8999-999999999999", request,
    result: { state: "applied", commandId: request.commandId, affectedTargets: [target] },
    completedAt: "2026-08-28T12:00:01.000Z",
    versionChanges: [{ target, before: 1, after: 2 }], affectedDependencyIds: [],
  });
  return { request, replacement, other, audit };
}

describe("Explorer override atomic repository", () => {
  it.each([
    { label: "reading a claim", failAt: 1 },
    { label: "proving claim absence after directory sync", failAt: 2 },
  ])("refuses an access error while $label instead of treating it as absence", async ({ failAt }) => {
    const path = fixturePath();
    const claimPath = `${path}.claim`;
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    const accessError = Object.assign(new Error("injected claim access refusal"), { code: "EACCES" });
    let claimObservations = 0;
    vi.mocked(lstatSync).mockImplementation((target) => {
      if (target === claimPath) {
        claimObservations += 1;
        if (claimObservations === failAt) throw accessError;
      }
      return actual.lstatSync(target);
    });

    assert.throws(
      () => createExplorerOverrideStore(path).reconcilePending(undefined, () => ({
        request: undefined,
        audit: undefined,
      })),
      (error: unknown) => {
        assert.ok(error instanceof ExplorerOverrideStateUncertainError);
        assert.ok(error.message.includes(claimPath));
        assert.ok(error.cause === accessError
          || (error.cause instanceof Error && error.cause.cause === accessError));
        return true;
      },
    );
    assert.equal(claimObservations, failAt);
  });

  it("returns an immutable whole-document view that stays stable across later replacements", () => {
    const store = createExplorerOverrideStore(fixturePath());
    assert.deepEqual(store.readAll(), []);
    const before = override(1, "People search");
    store.replace(command(), before).finalizeAfterCommit();
    const view = store.readAll();
    const entry = view[0];
    assert.ok(entry !== undefined);
    assert.throws(() => { entry.presentation.label = "Mutated label"; }, TypeError);
    assert.throws(() => { Object.assign(entry, { revision: 99 }); }, TypeError);
    assert.throws(() => { Object.assign(view, { 0: before }); }, TypeError);

    const request = command(1, "22222222-2222-4222-8222-222222222222");
    const after = override(2, "Directory search", request.commandId, request);
    store.replace(request, after).finalizeAfterCommit();

    assert.deepEqual(view, [before]);
    assert.deepEqual(store.readAll(), [after]);
  });

  it.each(["fsync", "close"] as const)("preserves a %s-only failure with its exact cause, path and retained claim", async (fault) => {
    const path = fixturePath();
    const primary = new Error(`injected ${fault}-only failure`);
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    if (fault === "fsync") {
      vi.mocked(fsyncSync).mockImplementationOnce(() => { throw primary; });
    } else {
      vi.mocked(closeSync).mockImplementationOnce((handle) => {
        actual.closeSync(handle);
        throw primary;
      });
    }
    assert.throws(
      () => createExplorerOverrideStore(path).replace(command(), override(1, "People search")),
      (error: unknown) => {
        assert.ok(error instanceof ExplorerOverrideStateUncertainError);
        assert.ok(error.cause instanceof Error);
        assert.equal(error.cause instanceof AggregateError, false);
        assert.equal(error.cause.cause, primary);
        assert.ok(error.cause.message.includes(`${path}.claim`));
        assert.ok(error.cause.message.includes(fault));
        return true;
      },
    );
    const closed = vi.mocked(closeSync).mock.calls[0]?.[0];
    assert.ok(closed !== undefined);
    assert.throws(() => actual.fstatSync(closed), { code: "EBADF" });
    assert.equal(existsSync(`${path}.claim`), true);
    assert.equal(existsSync(path), false);
  });

  it("refuses a claim appearing during absence sync without removing that writer's evidence", () => {
    const path = fixturePath();
    const real = realOperations(renameSync);
    const store = createExplorerOverrideStore(path, {
      ...real,
      syncPath: (target) => {
        createExplorerOverrideStore(path).replace(command(), override(1, "People search"));
        real.syncPath(target);
      },
    });
    assert.throws(
      () => store.reconcilePending(undefined, () => ({ request: undefined, audit: undefined })),
      /absence could not be proven durably/u,
    );
    assert.equal(existsSync(`${path}.claim`), true);
    assert.equal(createExplorerOverrideStore(path).read("person-lookup")?.presentation.label, "People search");
  });

  it("retries durable absence on cold reopen after real claim unlink followed by failed directory sync", () => {
    const path = fixturePath();
    const claimPath = `${path}.claim`;
    const real = realOperations(renameSync);
    const syncError = new Error("injected directory failure after real claim unlink");
    let failAbsenceSync = true;
    let absenceSyncAttempts = 0;
    let claimUnlinks = 0;
    let writes = 0;
    const operations: ExplorerOverrideFileOperations = {
      ...real,
      writeExclusive: (target, text) => { writes += 1; real.writeExclusive(target, text); },
      remove: (target) => {
        real.remove(target);
        if (target === claimPath) {
          claimUnlinks += 1;
          assert.equal(existsSync(claimPath), false);
        }
      },
      syncPath: (target) => {
        if (target === dirname(path) && !existsSync(claimPath)) {
          absenceSyncAttempts += 1;
          if (failAbsenceSync) throw syncError;
        }
        real.syncPath(target);
      },
    };
    const committed = createExplorerOverrideStore(path, operations).replace(command(), override(1, "People search"));
    const preparedWrites = writes;
    const assertSyncFailure = (error: unknown): boolean => {
      assert.ok(error instanceof ExplorerOverrideStateUncertainError);
      assert.equal(error.cause, syncError);
      assert.ok(error.message.includes(claimPath));
      return true;
    };
    assert.throws(() => committed.finalizeAfterCommit(), assertSyncFailure);
    assert.equal(claimUnlinks, 1);
    assert.equal(existsSync(claimPath), false);
    const bytes = readFileSync(path, "utf8");

    // A fresh instance has no memory of finalization. Continued fsync failure
    // must still refuse; mere filesystem absence is not durable recovery.
    const reopened = createExplorerOverrideStore(path, operations);
    assert.throws(
      () => reopened.reconcilePending(undefined, () => ({ request: undefined, audit: undefined })),
      assertSyncFailure,
    );
    assert.throws(() => committed.finalizeAfterCommit(), assertSyncFailure);
    failAbsenceSync = false;
    createExplorerOverrideStore(path, operations).reconcilePending(undefined, () => ({ request: undefined, audit: undefined }));
    assert.equal(absenceSyncAttempts, 4);
    assert.equal(claimUnlinks, 1);
    assert.equal(writes, preparedWrites, "no restoration write or marker is attempted");
    assert.equal(existsSync(claimPath), false);
    assert.equal(readFileSync(path, "utf8"), bytes);
  });

  it.each(["requested-label", "unrelated-insert", "unrelated-mutation", "unrelated-removal"] as const)(
    "refuses journaled next bytes that change %s beyond the prior document plus command",
    (tampering) => {
      const path = fixturePath();
      const { request, audit, other } = pendingWithPrior(path);
      const next = ExplorerOverrideDocumentSchema.parse(JSON.parse(readFileSync(path, "utf8")));
      if (tampering === "requested-label") {
        next.workflows = next.workflows.map((entry) => entry.workflowId === request.target.workflowId
          ? { ...entry, presentation: { ...entry.presentation, label: "Unrequested directory label" } } : entry);
      } else if (tampering === "unrelated-insert") {
        next.workflows.push(ExplorerWorkflowOverrideSchema.parse({ ...other, workflowId: "onboarding" }));
        next.workflows.sort((left, right) => left.workflowId.localeCompare(right.workflowId));
      } else if (tampering === "unrelated-mutation") {
        next.workflows = next.workflows.map((entry) => entry.workflowId === other.workflowId
          ? { ...entry, presentation: { label: "Unrequested separations label" } } : entry);
      } else {
        next.workflows = next.workflows.filter((entry) => entry.workflowId !== other.workflowId);
      }
      const claim: unknown = JSON.parse(readFileSync(`${path}.claim`, "utf8"));
      assert.ok(typeof claim === "object" && claim !== null);
      const tamperedBytes = `${canonicalJsonStringify(next)}\n`;
      writeFileSync(path, tamperedBytes, "utf8");
      writeFileSync(`${path}.claim`, JSON.stringify({ ...claim, next }), "utf8");

      assert.throws(
        () => createExplorerOverrideStore(path).reconcilePending(undefined, () => ({ request, audit })),
        /prior document plus command/u,
      );
      assert.equal(existsSync(`${path}.claim`), true);
      assert.equal(readFileSync(path, "utf8"), tamperedBytes);
    },
  );

  it("refuses recovered audit dependency effects without changing the prepared claim or override", () => {
    const path = fixturePath();
    const { request, audit } = pendingWithPrior(path);
    const foreignAudit = CommandAuditRecordSchema.parse({
      ...audit,
      affectedDependencyIds: ["44444444-4444-4444-8444-444444444444"],
    });
    const claimBytes = readFileSync(`${path}.claim`, "utf8");
    const overrideBytes = readFileSync(path, "utf8");

    assert.throws(
      () => createExplorerOverrideStore(path).reconcilePending(undefined, () => ({ request, audit: foreignAudit })),
      (error: unknown) => {
        assert.ok(error instanceof ExplorerOverrideStateUncertainError);
        assert.ok(error.message.includes(audit.auditId));
        assert.match(error.message, /nonempty affectedDependencyIds/u);
        return true;
      },
    );
    assert.equal(readFileSync(`${path}.claim`, "utf8"), claimBytes);
    assert.equal(readFileSync(path, "utf8"), overrideBytes);
  });

  it("replays legitimate multiple edits while retaining prior presentation and untouched workflows", () => {
    const path = fixturePath();
    const { request, replacement, other, audit } = pendingWithPrior(path);
    const before = readFileSync(path, "utf8");
    const restarted = createExplorerOverrideStore(path);
    const replay = restarted.replace(request, replacement);
    assert.deepEqual(replay.override.presentation, { label: "Directory search", icon: "Users", category: "search" });
    assert.deepEqual(restarted.read("separations"), other);
    restarted.reconcilePending(undefined, () => ({ request, audit }));
    assert.equal(existsSync(`${path}.claim`), false);
    assert.equal(readFileSync(path, "utf8"), before);
  });

  it.each(["descriptorVersion", "contractFingerprint"] as const)("refuses prepared next bytes with a divergent %s", (field) => {
    const path = fixturePath();
    const request = command();
    const replacement = override(1, "People search");
    createExplorerOverrideStore(path).replace(request, replacement);
    const claim: unknown = JSON.parse(readFileSync(`${path}.claim`, "utf8"));
    assert.ok(typeof claim === "object" && claim !== null);
    const next = {
      documentVersion: 1,
      workflows: [{ ...replacement, [field]: field === "descriptorVersion" ? 2 : "b".repeat(64) }],
    };
    // Corrupt the two filesystem records consistently: byte equality alone
    // must not bless a next override that violates the command's descriptor basis.
    writeFileSync(path, `${canonicalJsonStringify(next)}\n`, "utf8");
    writeFileSync(`${path}.claim`, JSON.stringify({ ...claim, next }), "utf8");
    assert.throws(
      () => createExplorerOverrideStore(path).reconcilePending(request, () => ({ request: undefined, audit: undefined })),
      /does not bind its next document/u,
    );
    assert.equal(existsSync(`${path}.claim`), true);
  });

  it("retains an exactly journaled claim until recovery repeats the directory durability barrier", () => {
    const path = fixturePath();
    const request = command();
    createExplorerOverrideStore(path).replace(request, override(1, "People search"));
    const target = { family: "explorer", workflowId: "person-lookup", revision: 1 } as const;
    const audit = CommandAuditRecordSchema.parse({
      auditId: "99999999-9999-4999-8999-999999999999", request,
      result: { state: "applied", commandId: request.commandId, affectedTargets: [target] },
      completedAt: "2026-08-28T12:00:01.000Z",
      versionChanges: [{ target, before: 0, after: 1 }], affectedDependencyIds: [],
    });
    const real = realOperations(renameSync);
    const store = createExplorerOverrideStore(path, {
      ...real,
      syncPath: (targetPath) => {
        if (targetPath === dirname(path)) throw new Error("injected recovery directory fsync failure");
        real.syncPath(targetPath);
      },
    });
    assert.throws(() => store.reconcilePending(undefined, () => ({ request, audit })), ExplorerOverrideStateUncertainError);
    assert.equal(existsSync(`${path}.claim`), true);
    createExplorerOverrideStore(path).reconcilePending(undefined, () => ({ request, audit }));
    assert.equal(existsSync(`${path}.claim`), false);
  });

  it("repeats directory fsync before returning a landed exact replay as applied", () => {
    const path = fixturePath();
    const request = command();
    const replacement = override(1, "People search");
    const real = realOperations(renameSync);
    let failDirectory = true;
    let landedSyncAttempts = 0;
    const operations = {
      ...real,
      syncPath: (target: string) => {
        if (target === dirname(path) && existsSync(path)) {
          landedSyncAttempts += 1;
          if (failDirectory) throw new Error("injected landed directory fsync failure");
        }
        real.syncPath(target);
      },
    };
    assert.throws(
      () => createExplorerOverrideStore(path, operations).replace(request, replacement),
      /landed but its directory sync failed/u,
    );
    const bytes = readFileSync(path, "utf8");
    const restarted = createExplorerOverrideStore(path, operations);

    assert.throws(
      () => restarted.replace(request, replacement),
      /landed but its directory sync failed/u,
    );
    assert.equal(existsSync(`${path}.claim`), true);
    failDirectory = false;
    const replay = restarted.replace(request, replacement);
    assert.equal(landedSyncAttempts, 3);
    assert.deepEqual(replay.override, replacement);
    assert.equal(readFileSync(path, "utf8"), bytes);
    replay.finalizeAfterCommit();
    assert.equal(existsSync(`${path}.claim`), false);
  });

  it("preserves primary and named cleanup causes at every claim and rename boundary", () => {
    const cases = [
      { stage: "claim", operation: "sync" },
      { stage: "claim", operation: "rename-before" },
      { stage: "claim", operation: "rename-after" },
      { stage: "override", operation: "rename-before" },
      { stage: "override", operation: "rename-after" },
      { stage: "claim", operation: "write" },
    ] as const;
    for (const testCase of cases) {
      const path = fixturePath();
      const stage = testCase.stage === "claim" ? `${path}.claim.pending` : `${path}.pending`;
      const cleanupPath = testCase.operation === "write" ? `${path}.claim` : stage;
      const primary = new Error(`injected ${testCase.stage} ${testCase.operation}`);
      const cleanup = new Error("injected cleanup refusal");
      const real = realOperations(renameSync);
      const operations: ExplorerOverrideFileOperations = {
        ...real,
        writeExclusive: (target, text) => {
          if (target === stage && testCase.operation === "write") throw primary;
          real.writeExclusive(target, text);
        },
        syncPath: (target) => {
          if (target === stage && testCase.operation === "sync") throw primary;
          real.syncPath(target);
        },
        atomicReplace: (from, to) => {
          if (from !== stage) return real.atomicReplace(from, to);
          if (testCase.operation === "rename-before") throw primary;
          real.atomicReplace(from, to);
          if (testCase.operation === "rename-after") {
            writeFileSync(from, readFileSync(to));
            throw primary;
          }
        },
        remove: (target) => {
          if (target === cleanupPath) throw cleanup;
          real.remove(target);
        },
      };
      assert.throws(
        () => createExplorerOverrideStore(path, operations).replace(command(), override(1, "People search")),
        (error: unknown) => {
          assert.ok(error instanceof ExplorerOverrideStateUncertainError);
          assert.ok(error.cause instanceof AggregateError);
          assert.equal(error.cause.cause, primary);
          assert.equal(error.cause.errors[0], primary);
          const secondary: unknown = error.cause.errors[1];
          assert.ok(secondary instanceof Error);
          assert.ok(secondary.message.includes(cleanupPath));
          assert.ok(secondary.cause === cleanup
            || (secondary.cause instanceof Error && secondary.cause.cause === cleanup));
          return true;
        },
      );
      assert.equal(existsSync(cleanupPath), true);
      assert.equal(existsSync(`${path}.claim`), true);
    }
  });

  it("keeps a staged sync failure primary when removing that stage also fails", () => {
    const path = fixturePath();
    const primary = new Error("injected stage fsync failure");
    const cleanup = new Error("injected stage removal failure");
    const real = realOperations(renameSync);
    const operations = {
      ...real,
      syncPath: (target: string) => {
        if (target === `${path}.pending`) throw primary;
        real.syncPath(target);
      },
      remove: (target: string) => {
        if (target === `${path}.pending`) throw cleanup;
        real.remove(target);
      },
    };

    assert.throws(
      () => createExplorerOverrideStore(path, operations).replace(command(), override(1, "People search")),
      (error: unknown) => {
        assert.ok(error instanceof ExplorerOverrideStateUncertainError);
        assert.ok(error.cause instanceof AggregateError);
        assert.equal(error.cause.cause, primary);
        assert.equal(error.cause.errors[0], primary);
        const removal: unknown = error.cause.errors[1];
        assert.ok(removal instanceof Error);
        assert.equal(removal.cause, cleanup);
        assert.ok(removal.message.includes(`${path}.pending`));
        return true;
      },
    );
    assert.equal(existsSync(`${path}.pending`), true);
    assert.equal(existsSync(`${path}.claim`), true);
    assert.equal(existsSync(path), false);
  });

  it("preserves fsync as primary when closing the same path also fails", async () => {
    const path = fixturePath();
    const syncError = new Error("injected fsync failure");
    const closeError = new Error("injected close failure");
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    vi.mocked(fsyncSync).mockImplementationOnce(() => { throw syncError; });
    vi.mocked(closeSync).mockImplementationOnce((handle) => {
      actual.closeSync(handle);
      throw closeError;
    });

    assert.throws(
      () => createExplorerOverrideStore(path).replace(command(), override(1, "People search")),
      (error: unknown) => {
        assert.ok(error instanceof ExplorerOverrideStateUncertainError);
        assert.ok(error.cause instanceof AggregateError);
        assert.equal(error.cause.cause, syncError);
        assert.equal(error.cause.errors[0], syncError);
        const cleanup: unknown = error.cause.errors[1];
        assert.ok(cleanup instanceof Error);
        assert.equal(cleanup.cause, closeError);
        assert.ok(cleanup.message.includes(`${path}.claim`));
        assert.equal(error.cause.errors.length, 2);
        return true;
      },
    );
    assert.equal(existsSync(`${path}.claim`), true);
    assert.equal(existsSync(path), false);
  });

  it("retains the complete-envelope claim until the authority commit is finalized", () => {
    const path = fixturePath();
    const committed = createExplorerOverrideStore(path).replace(command(), override(1, "People search"));

    assert.equal(existsSync(`${path}.claim`), true);
    assert.equal(committed.override.revision, 1);
    committed.finalizeAfterCommit();
    assert.equal(existsSync(`${path}.claim`), false);
  });

  it("refuses a foreign audit-result identity without releasing the pending claim", () => {
    const path = fixturePath();
    const request = command();
    const store = createExplorerOverrideStore(path);
    store.replace(request, override(1, "People search", request.commandId, request));
    const target = { family: "explorer", workflowId: "person-lookup", revision: 1 } as const;
    const audit = CommandAuditRecordSchema.parse({
      auditId: "99999999-9999-4999-8999-999999999999",
      request,
      result: {
        state: "applied",
        commandId: "22222222-2222-4222-8222-222222222222",
        affectedTargets: [target],
      },
      completedAt: "2026-08-28T12:00:01.000Z",
      versionChanges: [{ target, before: 0, after: 1 }],
      affectedDependencyIds: [],
    });

    assert.throws(
      () => store.reconcilePending(request, () => ({ request, audit })),
      /does not prove the pending override transition/u,
    );
    assert.equal(existsSync(`${path}.claim`), true);
  });

  it("refuses a live exclusive claim before it can compare or replace a revision", () => {
    const path = fixturePath();
    const held = command(0, "22222222-2222-4222-8222-222222222222");
    writeFileSync(`${path}.claim`, `${JSON.stringify({
      claimVersion: 2,
      pid: process.pid,
      state: "acquiring",
      command: held,
      commandFingerprint: explorerEditCommandFingerprint(held),
    })}\n`, "utf8");

    assert.throws(
      () => createExplorerOverrideStore(path).replace(command(), override(1, "People search")),
      ExplorerOverrideBusyError,
    );
    assert.equal(existsSync(path), false);
  });

  it("reclaims a dead claim and stale pending bytes before one serialized CAS", () => {
    const path = fixturePath();
    const held = command(0, "22222222-2222-4222-8222-222222222222");
    writeFileSync(`${path}.claim`, `${JSON.stringify({
      claimVersion: 2,
      pid: 99_999_999,
      state: "acquiring",
      command: held,
      commandFingerprint: explorerEditCommandFingerprint(held),
    })}\n`, "utf8");

    const committed = createExplorerOverrideStore(path).replace(command(), override(1, "People search"));
    assert.equal(committed.override.revision, 1);
    committed.finalizeAfterCommit();
    assert.equal(existsSync(`${path}.pending`), false);
    assert.equal(existsSync(`${path}.claim`), false);
  });

  it("reconciles a rename that landed and then threw as applied with exact readback", () => {
    const path = fixturePath();
    const operations = realOperations((from, to) => {
      renameSync(from, to);
      throw new Error("injected throw after rename landed");
    });

    const committed = createExplorerOverrideStore(path, operations).replace(command(), override(1, "People search"));
    assert.equal(committed.override.presentation.label, "People search");
    committed.finalizeAfterCommit();
    assert.equal(existsSync(`${path}.pending`), false);
    assert.equal(existsSync(`${path}.claim`), false);
  });

  it("cleans a staged write when rename throws before changing live bytes", () => {
    const path = fixturePath();
    const firstCommand = command();
    const firstCommit = createExplorerOverrideStore(path).replace(firstCommand, override(1, "People search", firstCommand.commandId, firstCommand));
    firstCommit.finalizeAfterCommit();
    const before = readFileSync(path, "utf8");
    const operations = realOperations((from, to) => {
      if (to !== path) return renameSync(from, to);
      throw new Error("injected throw before override rename");
    });
    const secondCommand = command(1, "33333333-3333-4333-8333-333333333333", "Directory search");

    assert.throws(
      () => createExplorerOverrideStore(path, operations).replace(secondCommand, override(
        2,
        "Directory search",
        secondCommand.commandId,
        secondCommand,
      )),
      /injected throw before override rename/u,
    );
    assert.equal(readFileSync(path, "utf8"), before);
    assert.equal(existsSync(`${path}.pending`), false);
    assert.equal(existsSync(`${path}.claim`), true);
  });

  it("leaves the claim as evidence and throws state-uncertain when rename damages live bytes", () => {
    const path = fixturePath();
    const firstCommand = command();
    const firstCommit = createExplorerOverrideStore(path).replace(firstCommand, override(1, "People search", firstCommand.commandId, firstCommand));
    firstCommit.finalizeAfterCommit();
    const operations = realOperations((_from, to) => {
      if (to !== path) return renameSync(_from, to);
      writeFileSync(to, "{damaged-live", "utf8");
      throw new Error("injected ambiguous rename failure");
    });
    const secondCommand = command(1, "33333333-3333-4333-8333-333333333333", "Directory search");

    assert.throws(
      () => createExplorerOverrideStore(path, operations).replace(secondCommand, override(
        2,
        "Directory search",
        secondCommand.commandId,
        secondCommand,
      )),
      ExplorerOverrideStateUncertainError,
    );
    assert.equal(existsSync(`${path}.claim`), true);
  });
});
