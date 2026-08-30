import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { SettingsRuntimeIdentitySchema } from "../../src/domain/config/settings.js";
import {
  createSettingsRuntimeGeneration,
  type SettingsRuntimeIdentity,
} from "../../src/server/settings/settings-runtime-generation.js";

const roots: string[] = [];

function generationPath(): string {
  const root = mkdtempSync(join(tmpdir(), "hrauto-settings-generation-"));
  roots.push(root);
  return join(root, "runtime-generation.json");
}

function identity(revision: number, digit: string): SettingsRuntimeIdentity {
  return SettingsRuntimeIdentitySchema.parse({
    settingsRevision: revision,
    settingsSchemaHash: digit.repeat(64),
    settingsFingerprint: digit.repeat(64),
    configFingerprint: digit.repeat(64),
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("settings runtime-generation barrier", () => {
  it("keeps a persisted revision restart-required until the dashboard activates that exact identity", () => {
    const generation = createSettingsRuntimeGeneration({ path: generationPath() });
    const first = identity(1, "1");
    const next = identity(2, "2");

    assert.deepEqual(generation.activate(first), first);
    assert.deepEqual(generation.status(first), { state: "current", identity: first });
    assert.deepEqual(generation.status(next), {
      state: "restart-required",
      active: first,
      persisted: next,
    });
    assert.throws(
      () => generation.assertCurrent(next, "worker person-lookup-worker-1 start"),
      /restart is required.*active settings revision 1.*persisted revision 2/,
    );

    assert.deepEqual(generation.activate(next), next);
    assert.deepEqual(generation.status(next), { state: "current", identity: next });
    assert.throws(
      () => generation.assertCurrent(first, "old worker next claim"),
      /active settings revision 2.*persisted revision 1/,
    );
  });

  it("fails loud on malformed activation evidence instead of adopting a candidate", () => {
    const path = generationPath();
    writeFileSync(path, "{\"settingsRevision\":", "utf8");
    const generation = createSettingsRuntimeGeneration({ path });

    assert.throws(() => generation.status(identity(1, "1")), /is not valid JSON/);
    assert.throws(() => generation.activate(identity(1, "1")), /is not valid JSON/);
  });
});
