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
      reconcilePending: () => undefined,
      replace: () => {
        throw new Error("validation must not write an override");
      },
    },
  });
}

describe("Explorer edit service", () => {
  it("attests every registered workflow through the same live validation seam", () => {
    const query = explorerQueryDeps(CLOCK, HASH);
    const edit = service();
    for (const descriptor of query.modules.map(({ descriptor }) => descriptor)) {
      const result = edit.validate({
        draftVersion: 1,
        workflowId: descriptor.id,
        baseDescriptorVersion: descriptor.version,
        baseContractFingerprint: descriptor.contractFingerprint,
        baseOverrideRevision: 0,
        changes: [{ kind: "workflow-label", value: `${descriptor.label} reviewed` }],
      });
      assert.equal(result.state, "ready-to-apply", String(descriptor.id));
      if (result.state !== "ready-to-apply") continue;
      assert.equal(result.compileAttestation.workflowId, descriptor.id);
      assert.deepEqual(
        Object.values(result.compileAttestation.checks).map(({ state }) => state),
        ["held", "held", "held", "held", "held"],
      );
    }
  });

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
    assert.equal(result.compileAttestation.workflowId, descriptor.id);
    assert.equal(result.compileAttestation.descriptorVersion, descriptor.version);
    assert.equal(result.compileAttestation.contractFingerprint, descriptor.contractFingerprint);
    assert.deepEqual(
      Object.values(result.compileAttestation.checks).map(({ state }) => state),
      ["held", "held", "held", "held", "held"],
    );
    assert.deepEqual(
      result.compileAttestation.checks.scenario.registrations.map(({ scenarioId }) => scenarioId),
      [...result.impactedScenarios],
    );
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
    assert.equal(result.brief.nextDescriptor.version, descriptor.version + 1);
    assert.deepEqual(result.brief.nextDescriptor.contractFingerprint, {
      state: "must-change",
      current: descriptor.contractFingerprint,
    });
    assert.equal(
      result.brief.patch.canonicalDescriptorJson,
      JSON.stringify({
        baseContractFingerprint: descriptor.contractFingerprint,
        baseDescriptorVersion: descriptor.version,
        changes: [{ kind: "enqueue-policy", value: "allow-parallel" }],
        patchVersion: 1,
        workflowId: descriptor.id,
      }),
    );
    assert.deepEqual(result.brief.patch.typescript.operations, [{
      propertyPath: "enqueue",
      beforeExpression: '"reject-active"',
      afterExpression: '"allow-parallel"',
    }]);
    assert.deepEqual(result.brief.semanticDiff.policies, [{
      path: "enqueue",
      before: "reject-active",
      after: "allow-parallel",
    }]);
    assert.deepEqual(result.brief.semanticDiff.nodes, { added: [], removed: [], changed: [] });
    assert.deepEqual(result.brief.semanticDiff.edges, { added: [], removed: [], changed: [] });
    assert.deepEqual(result.brief.semanticDiff.effects, { added: [], removed: [] });
    assert.deepEqual(result.brief.semanticDiff.uiIds, { added: [], removed: [] });
    assert.deepEqual(result.brief.impacts.workflows, [descriptor.id]);
    assert.deepEqual(result.brief.impacts.tasks, result.brief.baseAttestation.checks.schema.tasks.map(({ taskId }) => taskId));
    assert.deepEqual(result.brief.impacts.scenarios, result.brief.baseAttestation.checks.scenario.registrations.map(({ scenarioId }) => scenarioId));
    assert.deepEqual(
      result.brief.requiredChecks.map(({ check, state }) => [check, state]),
      [
        ["builder", "required"],
        ["schema", "required"],
        ["graph", "required"],
        ["guard", "required"],
        ["scenario", "required"],
      ],
    );
  });

  it("emits an exact Edit Data source patch and refuses a mixed apply level", () => {
    const query = explorerQueryDeps(CLOCK, HASH);
    const descriptor = query.modules.find(({ descriptor }) => String(descriptor.id) === "person-lookup")?.descriptor;
    assert.ok(descriptor !== undefined);
    const base = {
      draftVersion: 1,
      workflowId: "person-lookup",
      baseDescriptorVersion: descriptor.version,
      baseContractFingerprint: descriptor.contractFingerprint,
      baseOverrideRevision: 0,
    } as const;

    const brief = service().validate({
      ...base,
      changes: [{
        kind: "edit-data-fields",
        fields: [{ nodeId: "crm-dates", fieldPath: "startsOn.value", label: "Starts on" }],
      }],
    });
    assert.equal(brief.state, "code-change-required");
    if (brief.state !== "code-change-required") return;
    assert.equal(brief.brief.patch.typescript.operations[0]?.propertyPath, "capabilities.editData.fields");
    assert.deepEqual(brief.brief.semanticDiff.nodes.changed, ["crm-dates"]);
    assert.deepEqual(brief.brief.semanticDiff.policies, [{
      path: "capabilities.editData.fields",
      before: JSON.stringify([
        { fieldPath: "invitedOn.value", label: "Invited on", nodeId: "crm-dates" },
        { fieldPath: "startsOn.value", label: "Starts on", nodeId: "crm-dates" },
        { fieldPath: "completedOn.value", label: "Completed on", nodeId: "crm-dates" },
      ]),
      after: JSON.stringify([{ fieldPath: "startsOn.value", label: "Starts on", nodeId: "crm-dates" }]),
    }]);

    const mixed = service().validate({
      ...base,
      changes: [
        { kind: "workflow-label", value: "People search" },
        { kind: "enqueue-policy", value: "allow-parallel" },
      ],
    });
    assert.equal(mixed.state, "refused");
    if (mixed.state === "refused") assert.equal(mixed.category, "mixed-apply-levels");

    const noOp = service().validate({
      ...base,
      changes: [{ kind: "enqueue-policy", value: "reject-active" }],
    });
    assert.equal(noOp.state, "refused");
    if (noOp.state === "refused") assert.equal(noOp.category, "empty-diff");
  });

  it("refuses a source draft that mixes a no-op with an effective change", () => {
    const query = explorerQueryDeps(CLOCK, HASH);
    const descriptor = query.modules.find(({ descriptor }) => String(descriptor.id) === "person-lookup")?.descriptor;
    assert.ok(descriptor !== undefined);

    const result = service().validate({
      draftVersion: 1,
      workflowId: descriptor.id,
      baseDescriptorVersion: descriptor.version,
      baseContractFingerprint: descriptor.contractFingerprint,
      baseOverrideRevision: 0,
      changes: [
        { kind: "enqueue-policy", value: "reject-active" },
        {
          kind: "edit-data-fields",
          fields: [{ nodeId: "crm-dates", fieldPath: "startsOn.value", label: "Starts on" }],
        },
      ],
    });

    assert.equal(result.state, "refused");
    if (result.state !== "refused") return;
    assert.equal(result.category, "partial-no-op");
    assert.match(result.message, /enqueue-policy.*no effective source change/u);
  });

  it("fails validation when exact scenario source attestation cannot be made", () => {
    const query = explorerQueryDeps(CLOCK, HASH);
    const descriptor = query.modules.find(({ descriptor }) => String(descriptor.id) === "person-lookup")?.descriptor;
    assert.ok(descriptor !== undefined);
    const edit = createExplorerEditService({
      explorer: { ...query, listScenarioSources: () => [] },
      overrides: {
        read: () => undefined,
        reconcilePending: () => undefined,
        replace: () => { throw new Error("validation must not write"); },
      },
    });
    assert.throws(() => edit.validate({
      draftVersion: 1,
      workflowId: descriptor.id,
      baseDescriptorVersion: descriptor.version,
      baseContractFingerprint: descriptor.contractFingerprint,
      baseOverrideRevision: 0,
      changes: [{ kind: "workflow-label", value: "People search" }],
    }), /compile attestation.*scenario.*unresolved/u);
  });

  it("applies a presentation draft by atomic replace and returns its exact persisted readback", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-explorer-edit-"));
    roots.push(root);
    const query = explorerQueryDeps(CLOCK, HASH);
    const descriptor = query.modules.find(({ descriptor }) => String(descriptor.id) === "person-lookup")?.descriptor;
    assert.ok(descriptor !== undefined);
    const path = join(root, "explorer-overrides.json");
    const backingStore = createExplorerOverrideStore(path);
    let replacementCalls = 0;
    const store = {
      read: (workflowId: string) => backingStore.read(workflowId),
      reconcilePending: (...args: Parameters<typeof backingStore.reconcilePending>) =>
        backingStore.reconcilePending(...args),
      replace: (...args: Parameters<typeof backingStore.replace>) => {
        replacementCalls += 1;
        return backingStore.replace(...args);
      },
    };
    const edit = createExplorerEditService({ explorer: query, overrides: store });

    const request = {
      commandId: "11111111-1111-4111-8111-111111111111",
      requestedAt: "2026-08-28T12:00:00.000Z",
      requestedBy: "local-operator",
      source: "dashboard",
      reason: "Apply the reviewed presentation label",
      family: "explorer",
      type: "apply-explorer-edit",
      target: {
        workflowId: "person-lookup",
        expectedVersion: descriptor.version,
        contractFingerprint: descriptor.contractFingerprint,
        expectedOverrideRevision: 0,
      },
      payload: {
        changes: [{ kind: "workflow-label", value: "People search" }],
      },
    };
    const applied = edit.apply(request);
    const result = applied.result;

    assert.equal(result.state, "applied");
    if (result.state !== "applied") return;
    assert.deepEqual(result.readback, result.override);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {
      documentVersion: 1,
      workflows: [result.override],
    });
    assert.equal(result.override.appliedCommandId, request.commandId);

    assert.equal(existsSync(`${path}.claim`), true);
    const replayed = edit.apply(structuredClone(request));
    const replay = replayed.result;
    assert.equal(replay.state, "applied");
    if (replay.state === "applied") assert.deepEqual(replay.readback, result.readback);
    assert.equal(replacementCalls, 2, "crash replay must re-enter the serialized repository claim");
    replayed.finalizeAfterCommit?.();
    assert.equal(existsSync(`${path}.claim`), false);
  });

  it.each([
    ["actor", { requestedBy: "another-operator" }],
    ["source", { source: "automation" }],
    ["request time", { requestedAt: "2026-08-28T12:01:00.000Z" }],
    ["reason", { reason: "A different explanation" }],
  ])("refuses a changed %s while the original envelope is pending", (_field, divergentFields) => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-explorer-envelope-replay-"));
    roots.push(root);
    const query = explorerQueryDeps(CLOCK, HASH);
    const descriptor = query.modules.find(({ descriptor }) => String(descriptor.id) === "person-lookup")?.descriptor;
    assert.ok(descriptor !== undefined);
    const edit = createExplorerEditService({
      explorer: query,
      overrides: createExplorerOverrideStore(join(root, "explorer-overrides.json")),
    });
    const request = {
      commandId: "44444444-4444-4444-8444-444444444444",
      requestedAt: "2026-08-28T12:00:00.000Z",
      requestedBy: "local-operator",
      source: "dashboard",
      reason: "Apply the reviewed presentation label",
      family: "explorer",
      type: "apply-explorer-edit",
      target: {
        workflowId: "person-lookup",
        expectedVersion: descriptor.version,
        contractFingerprint: descriptor.contractFingerprint,
        expectedOverrideRevision: 0,
      },
      payload: { changes: [{ kind: "workflow-label", value: "People search" }] },
    } as const;
    const pending = edit.apply(request);
    assert.equal(pending.result.state, "applied");

    assert.throws(
      () => edit.apply({ ...request, ...divergentFields }),
      /reused with a different complete command envelope/u,
    );
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
      commandId: "22222222-2222-4222-8222-222222222222",
      requestedAt: "2026-08-28T12:00:00.000Z",
      requestedBy: "local-operator",
      source: "dashboard",
      family: "explorer",
      type: "apply-explorer-edit",
      target: {
        workflowId: "person-lookup",
        expectedVersion: descriptor.version,
        contractFingerprint: descriptor.contractFingerprint,
        expectedOverrideRevision: 0,
      },
      payload: {
        changes: [{ kind: "workflow-label", value: "People search" }],
      },
    });
    assert.equal(first.result.state, "applied");
    first.finalizeAfterCommit?.();
    const before = readFileSync(path, "utf8");
    const sync = (target: string): void => {
      if (target === `${path}.pending`) throw new Error("injected staged fsync failure");
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
      commandId: "33333333-3333-4333-8333-333333333333",
      requestedAt: "2026-08-28T12:01:00.000Z",
      requestedBy: "local-operator",
      source: "dashboard",
      family: "explorer",
      type: "apply-explorer-edit",
      target: {
        workflowId: "person-lookup",
        expectedVersion: descriptor.version,
        contractFingerprint: descriptor.contractFingerprint,
        expectedOverrideRevision: 1,
      },
      payload: {
        changes: [{ kind: "workflow-label", value: "Directory search" }],
      },
    }), /injected staged fsync failure/u);
    assert.equal(readFileSync(path, "utf8"), before);
    assert.equal(existsSync(`${path}.pending`), false);
  });
});
