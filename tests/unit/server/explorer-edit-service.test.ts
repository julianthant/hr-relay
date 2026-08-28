import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { WORKFLOW_MODULES } from "../../../src/control/workflow-registry.js";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import { manualClock } from "../../../src/domain/clock.js";
import type { ExplorerEditApplyRequest } from "../../../src/domain/dashboard/explorer-edit.js";
import { ExplorerEditAuthority } from "../../../src/infra/explorer-edit-authority.js";
import { ExplorerEditService } from "../../../src/server/dashboard/commands/explorer-edit-service.js";

const CLOCK = manualClock(new Date("2026-08-28T15:30:00.000Z"));
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function harness() {
  const root = mkdtempSync(join(tmpdir(), "explorer-edit-"));
  roots.push(root);
  const path = join(root, "explorer-overrides.json");
  const descriptor = WORKFLOW_MODULES.find(({ descriptor: one }) => String(one.id) === "person-lookup")?.descriptor;
  if (descriptor === undefined) throw new Error("test registry has no person-lookup descriptor");
  const authority = new ExplorerEditAuthority(path);
  const service = new ExplorerEditService({
    authority,
    clock: CLOCK,
    descriptors: () => WORKFLOW_MODULES.map((module) => module.descriptor),
  });
  return { path, descriptor, authority, service };
}

function request(
  descriptor: (typeof WORKFLOW_MODULES)[number]["descriptor"],
  overrides: Partial<ExplorerEditApplyRequest["draft"]> = {},
): ExplorerEditApplyRequest {
  return {
    commandVersion: 1,
    commandId: "11111111-1111-4111-8111-111111111111",
    draft: {
      draftVersion: 1,
      workflowId: descriptor.id,
      baseDescriptorVersion: descriptor.version,
      baseContractFingerprint: descriptor.contractFingerprint,
      baseOverrideRevision: 0,
      changes: [{ kind: "workflow-label", value: "People search" }],
      ...overrides,
    },
  };
}

describe("Explorer edit service", () => {
  it("atomically applies and reads back the exact canonical override bytes", () => {
    const { path, descriptor, authority, service } = harness();

    const result = service.apply(request(descriptor));

    assert.equal(result.state, "applied");
    if (result.state !== "applied") return;
    assert.deepEqual(service.read(descriptor.id), { state: "applied", override: result.override });
    assert.equal(
      readFileSync(path, "utf8"),
      `${canonicalJsonStringify(authority.readFile())}\n`,
    );
  });

  it("conflicts on either a stale descriptor version or fingerprint without writing", () => {
    const { descriptor, authority, service } = harness();
    const staleVersion = service.apply(request(descriptor, { baseDescriptorVersion: descriptor.version + 1 }));
    const staleFingerprint = service.apply(request(descriptor, { baseContractFingerprint: "f".repeat(64) }));

    assert.equal(staleVersion.state, "conflict");
    assert.equal(staleFingerprint.state, "conflict");
    assert.deepEqual(authority.readFile().overrides, []);
  });

  it("conflicts on the exact stale override revision and preserves the winning bytes", () => {
    const { descriptor, authority, service } = harness();
    const winner = service.apply(request(descriptor));
    assert.equal(winner.state, "applied");
    const before = canonicalJsonStringify(authority.readFile());

    const stale = service.apply({
      ...request(descriptor),
      commandId: "22222222-2222-4222-8222-222222222222",
      draft: { ...request(descriptor).draft, changes: [{ kind: "workflow-label", value: "Stale" }] },
    });

    assert.equal(stale.state, "conflict");
    assert.equal(canonicalJsonStringify(authority.readFile()), before);
  });

  it("refuses timeline and Edit Data fields the descriptor does not own", () => {
    const { descriptor, authority, service } = harness();
    for (const changes of [
      [{ kind: "timeline-category-label", categoryKey: "invented", value: "Invented" }],
      [{ kind: "timeline-category-order", categoryKeys: ["invented"] }],
      [{ kind: "edit-data-fields", fields: [{ nodeId: "searching", fieldPath: "secret", label: "Secret" }] }],
    ]) {
      assert.throws(
        () => service.apply(request(descriptor, { changes } as Partial<ExplorerEditApplyRequest["draft"]>)),
        /does not declare/u,
      );
    }
    assert.deepEqual(authority.readFile().overrides, []);
  });
});
