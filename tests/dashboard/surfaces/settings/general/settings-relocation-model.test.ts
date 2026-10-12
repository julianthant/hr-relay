// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { type Root } from "react-dom/client";
import { afterEach,describe,it } from "vitest";
import { cancelRelocationCommand,desiredRelocationPair,planRelocationCommand,useStorageRelocation } from "../../../../../src/dashboard/surfaces/settings/general/settings-relocation-model.js";
import { StorageRelocationPlanViewSchema } from "../../../../../src/rules/commands/commands.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const SOURCE = { stateRoot: "/tmp/fixture-state", artifactRoot: "/tmp/fixture-artifacts" };
const INITIAL = StorageRelocationPlanViewSchema.parse({ revision: 0, installationId: "11111111-1111-4111-8111-111111111111",
  sourceGeneration: 0, sourcePair: SOURCE, pending: null });
let root: Root | undefined;
let host: HTMLElement | undefined;
let _currentController: ReturnType<typeof useStorageRelocation> | undefined;
afterEach(() => { if (root !== undefined) act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined; _currentController = undefined; });

describe("storage relocation Paths controls", () => {

  it("binds cancel to the pending plan and preserves the desired partner on later edits", () => {
    const planned = planRelocationCommand(INITIAL, { stateRoot: "/tmp/next-state", artifactRoot: SOURCE.artifactRoot }, "local-operator");
    if (planned.type !== "plan-storage-relocation") throw new Error("expected plan");
    const view = StorageRelocationPlanViewSchema.parse({ ...INITIAL, revision: 1, pending: { commandId: planned.commandId,
      writeId: planned.payload.writeId, desiredPair: planned.payload.desiredPair,
      desiredDigest: planned.payload.desiredDigest, requestFingerprint: planned.payload.requestFingerprint } });
    assert.deepEqual(desiredRelocationPair(view, { artifactRoot: "/tmp/next-artifacts" }), { stateRoot: "/tmp/next-state", artifactRoot: "/tmp/next-artifacts" });
    const cancel = cancelRelocationCommand(view, "local-operator");
    if (cancel.type !== "cancel-storage-relocation") throw new Error("expected cancellation");
    assert.equal(cancel.payload.cancelledPlanCommandId, planned.commandId);
    assert.equal(cancel.payload.cancelledPlanDigest, planned.payload.desiredDigest);
  });
});
