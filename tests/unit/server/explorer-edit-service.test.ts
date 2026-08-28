import assert from "node:assert/strict";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  mkdtempSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../../src/domain/clock.js";
import { FingerprintSchema } from "../../../src/domain/ids.js";
import { createExplorerEditService } from "../../../src/server/dashboard/commands/explorer-edit-service.js";
import { createExplorerOverrideStore } from "../../../src/server/dashboard/commands/explorer-override-store.js";
import { explorerQueryDeps } from "../../fixtures/explorer-seams.js";

const CLOCK = manualClock(new Date("2026-08-28T12:00:00.000Z"));
const HASH = FingerprintSchema.parse("b".repeat(64));
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function service() {
  const query = explorerQueryDeps(CLOCK, HASH);
  return createExplorerEditService({
    explorer: query,
    overrides: {
      read: () => undefined,
      replace: () => {
        throw new Error("validation must not write an override");
      },
    },
  });
}

describe("Explorer edit service", () => {
  it("validates a presentation draft against the exact live descriptor", () => {
    const query = explorerQueryDeps(CLOCK, HASH);
    const descriptor = query.modules.find(({ descriptor }) => String(descriptor.id) === "person-lookup")?.descriptor;
    assert.ok(descriptor !== undefined);

    const result = service().validate({
      draftVersion: 1,
      workflowId: "person-lookup",
      baseDescriptorVersion: descriptor.version,
      baseContractFingerprint: descriptor.contractFingerprint,
      baseOverrideRevision: 0,
      changes: [{ kind: "workflow-label", value: "People search" }],
    });

    assert.equal(result.state, "ready-to-apply");
    if (result.state !== "ready-to-apply") return;
    assert.equal(result.override.presentation.label, "People search");
    assert.deepEqual(result.semanticDiff, [
      { path: "presentation.label", before: "Person Lookup", after: "People search" },
    ]);
  });

  it("turns an operational policy edit with no descriptor allowlist into a reviewed code-change brief", () => {
    const query = explorerQueryDeps(CLOCK, HASH);
    const descriptor = query.modules.find(({ descriptor }) => String(descriptor.id) === "person-lookup")?.descriptor;
    assert.ok(descriptor !== undefined);

    const result = service().validate({
      draftVersion: 1,
      workflowId: "person-lookup",
      baseDescriptorVersion: descriptor.version,
      baseContractFingerprint: descriptor.contractFingerprint,
      baseOverrideRevision: 0,
      changes: [{ kind: "enqueue-policy", value: "allow-parallel" }],
    });

    assert.equal(result.state, "code-change-required");
    if (result.state !== "code-change-required") return;
    assert.match(result.brief.reason, /no descriptor-declared allowlist/u);
    assert.ok(result.brief.requiredFiles.includes("src/workflows/person-lookup/descriptor.ts" as never));
    assert.equal(result.brief.descriptorVersionRequired, descriptor.version + 1);
  });

  it("applies a presentation draft by atomic replace and returns its exact persisted readback", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-explorer-edit-"));
    roots.push(root);
    const query = explorerQueryDeps(CLOCK, HASH);
    const descriptor = query.modules.find(({ descriptor }) => String(descriptor.id) === "person-lookup")?.descriptor;
    assert.ok(descriptor !== undefined);
    const path = join(root, "explorer-overrides.json");
    const store = createExplorerOverrideStore(path);
    const edit = createExplorerEditService({ explorer: query, overrides: store });

    const result = edit.apply({
      draftVersion: 1,
      workflowId: "person-lookup",
      baseDescriptorVersion: descriptor.version,
      baseContractFingerprint: descriptor.contractFingerprint,
      baseOverrideRevision: 0,
      changes: [{ kind: "workflow-label", value: "People search" }],
    });

    assert.equal(result.state, "applied");
    if (result.state !== "applied") return;
    assert.deepEqual(result.readback, result.override);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {
      documentVersion: 1,
      workflows: [result.override],
    });
  });

  it("reports descriptor version, fingerprint and override revision conflicts deterministically", () => {
    const query = explorerQueryDeps(CLOCK, HASH);
    const descriptor = query.modules.find(({ descriptor }) => String(descriptor.id) === "person-lookup")?.descriptor;
    assert.ok(descriptor !== undefined);
    const edit = service();
    const common = {
      draftVersion: 1,
      workflowId: "person-lookup",
      baseDescriptorVersion: descriptor.version,
      baseContractFingerprint: descriptor.contractFingerprint,
      baseOverrideRevision: 0,
      changes: [{ kind: "workflow-label", value: "People search" }],
    } as const;

    assert.equal(edit.validate({ ...common, baseDescriptorVersion: descriptor.version + 1 }).state, "conflict");
    assert.equal(edit.validate({ ...common, baseContractFingerprint: "d".repeat(64) }).state, "conflict");
    assert.equal(edit.validate({ ...common, baseOverrideRevision: 1 }).state, "conflict");
  });

  it("refuses an Edit Data field outside the descriptor allowlist and never produces a partial override", () => {
    const query = explorerQueryDeps(CLOCK, HASH);
    const descriptor = query.modules.find(({ descriptor }) => String(descriptor.id) === "person-lookup")?.descriptor;
    assert.ok(descriptor !== undefined);
    const result = service().validate({
      draftVersion: 1,
      workflowId: "person-lookup",
      baseDescriptorVersion: descriptor.version,
      baseContractFingerprint: descriptor.contractFingerprint,
      baseOverrideRevision: 0,
      changes: [
        { kind: "workflow-label", value: "People search" },
        { kind: "edit-data-fields", fields: [{ nodeId: "crm-dates", fieldPath: "secret", label: "Secret" }] },
      ],
    });

    assert.equal(result.state, "refused");
    if (result.state === "refused") assert.equal(result.category, "edit-data-field-allowlist");
  });

  it("fails loud on malformed persisted JSON and preserves the prior document when staging fails", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-explorer-edit-failure-"));
    roots.push(root);
    const path = join(root, "explorer-overrides.json");
    writeFileSync(path, "{not-json", "utf8");
    assert.throws(() => createExplorerOverrideStore(path).read("person-lookup"), /JSON/u);

    rmSync(path);
    const query = explorerQueryDeps(CLOCK, HASH);
    const descriptor = query.modules.find(({ descriptor }) => String(descriptor.id) === "person-lookup")?.descriptor;
    assert.ok(descriptor !== undefined);
    const initialStore = createExplorerOverrideStore(path);
    const edit = createExplorerEditService({ explorer: query, overrides: initialStore });
    const first = edit.apply({
      draftVersion: 1,
      workflowId: "person-lookup",
      baseDescriptorVersion: descriptor.version,
      baseContractFingerprint: descriptor.contractFingerprint,
      baseOverrideRevision: 0,
      changes: [{ kind: "workflow-label", value: "People search" }],
    });
    assert.equal(first.state, "applied");
    const before = readFileSync(path, "utf8");
    const sync = (target: string): void => {
      if (target.endsWith(".pending")) throw new Error("injected staged fsync failure");
      const descriptorHandle = openSync(target, "r");
      try { fsyncSync(descriptorHandle); } finally { closeSync(descriptorHandle); }
    };
    const failingStore = createExplorerOverrideStore(path, {
      writeExclusive: (target, text) => writeFileSync(target, text, { encoding: "utf8", flag: "wx" }),
      syncPath: sync,
      atomicReplace: renameSync,
      remove: unlinkSync,
    });
    const failingEdit = createExplorerEditService({ explorer: query, overrides: failingStore });
    assert.throws(() => failingEdit.apply({
      draftVersion: 1,
      workflowId: "person-lookup",
      baseDescriptorVersion: descriptor.version,
      baseContractFingerprint: descriptor.contractFingerprint,
      baseOverrideRevision: 1,
      changes: [{ kind: "workflow-label", value: "Directory search" }],
    }), /injected staged fsync failure/u);
    assert.equal(readFileSync(path, "utf8"), before);
    assert.equal(existsSync(`${path}.pending`), false);
  });
});
