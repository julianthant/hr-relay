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
  ExplorerWorkflowOverrideSchema,
  type ExplorerWorkflowOverride,
} from "../../../src/domain/dashboard/explorer.js";
import {
  createExplorerOverrideStore,
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
): ExplorerWorkflowOverride {
  return ExplorerWorkflowOverrideSchema.parse({
    overrideVersion: 1,
    workflowId: "person-lookup",
    descriptorVersion: 1,
    contractFingerprint: "a".repeat(64),
    revision,
    appliedCommandId: commandId,
    commandFingerprint: revision === 1 ? "b".repeat(64) : "c".repeat(64),
    presentation: { label },
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
  it("refuses a live exclusive claim before it can compare or replace a revision", () => {
    const path = fixturePath();
    writeFileSync(`${path}.claim`, `${JSON.stringify({
      claimVersion: 1,
      pid: process.pid,
      workflowId: "person-lookup",
      commandId: "22222222-2222-4222-8222-222222222222",
    })}\n`, "utf8");

    assert.throws(
      () => createExplorerOverrideStore(path).replace(0, override(1, "People search")),
      ExplorerOverrideBusyError,
    );
    assert.equal(existsSync(path), false);
  });

  it("reclaims a dead claim and stale pending bytes before one serialized CAS", () => {
    const path = fixturePath();
    writeFileSync(`${path}.claim`, `${JSON.stringify({
      claimVersion: 1,
      pid: 99_999_999,
      workflowId: "person-lookup",
      commandId: "22222222-2222-4222-8222-222222222222",
    })}\n`, "utf8");
    writeFileSync(`${path}.pending`, "{malformed-stale-stage", "utf8");

    const persisted = createExplorerOverrideStore(path).replace(0, override(1, "People search"));
    assert.equal(persisted.revision, 1);
    assert.equal(existsSync(`${path}.pending`), false);
    assert.equal(existsSync(`${path}.claim`), false);
  });

  it("reconciles a rename that landed and then threw as applied with exact readback", () => {
    const path = fixturePath();
    const operations = realOperations((from, to) => {
      renameSync(from, to);
      throw new Error("injected throw after rename landed");
    });

    const persisted = createExplorerOverrideStore(path, operations).replace(0, override(1, "People search"));
    assert.equal(persisted.presentation.label, "People search");
    assert.equal(existsSync(`${path}.pending`), false);
    assert.equal(existsSync(`${path}.claim`), false);
  });

  it("cleans a staged write when rename throws before changing live bytes", () => {
    const path = fixturePath();
    const first = createExplorerOverrideStore(path).replace(0, override(1, "People search"));
    const before = readFileSync(path, "utf8");
    const operations = realOperations(() => {
      throw new Error("injected throw before rename");
    });

    assert.throws(
      () => createExplorerOverrideStore(path, operations).replace(
        first.revision,
        override(2, "Directory search", "33333333-3333-4333-8333-333333333333"),
      ),
      /injected throw before rename/u,
    );
    assert.equal(readFileSync(path, "utf8"), before);
    assert.equal(existsSync(`${path}.pending`), false);
    assert.equal(existsSync(`${path}.claim`), false);
  });

  it("leaves the claim as evidence and throws state-uncertain when rename damages live bytes", () => {
    const path = fixturePath();
    createExplorerOverrideStore(path).replace(0, override(1, "People search"));
    const operations = realOperations((_from, to) => {
      writeFileSync(to, "{damaged-live", "utf8");
      throw new Error("injected ambiguous rename failure");
    });

    assert.throws(
      () => createExplorerOverrideStore(path, operations).replace(
        1,
        override(2, "Directory search", "33333333-3333-4333-8333-333333333333"),
      ),
      ExplorerOverrideStateUncertainError,
    );
    assert.equal(existsSync(`${path}.claim`), true);
  });
});
