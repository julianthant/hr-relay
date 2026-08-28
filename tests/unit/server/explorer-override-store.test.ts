import assert from "node:assert/strict";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import {
  ExplorerEditApplyRequestSchema,
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

afterEach(() => {
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
    workflowId: "person-lookup",
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

describe("Explorer override atomic repository", () => {
  it("retains the complete-envelope claim until the authority commit is finalized", () => {
    const path = fixturePath();
    const committed = createExplorerOverrideStore(path).replace(command(), override(1, "People search"));

    assert.equal(existsSync(`${path}.claim`), true);
    assert.equal(committed.override.revision, 1);
    committed.finalizeAfterCommit();
    assert.equal(existsSync(`${path}.claim`), false);
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
