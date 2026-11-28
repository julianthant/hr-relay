import assert from "node:assert/strict";
import { ChildProcess, fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { it, vi } from "vitest";
import { createProfileSettingsProcesses } from "../../../../../src/backend/app/composition/dashboard/profile-settings-processes.js";
import { deriveSettingsPatchFingerprint, SETTINGS_SCHEMA_HASH } from "../../../../../src/models/config/settings.js";
import { SettingsCommandRequestSchema } from "../../../../../src/rules/commands/commands.js";

vi.mock("node:child_process", async original => ({
  ...await original<typeof import("node:child_process")>(), fork: vi.fn(),
}));

function command() {
  const patch = { "concurrency.defaultWorkers": { set: 3 } };
  return SettingsCommandRequestSchema.parse({
    commandId: randomUUID(), requestedAt: "2026-10-01T12:00:00.000Z", requestedBy: "local-operator", source: "settings-surface",
    family: "settings", type: "apply-settings", target: { expectedRevision: 1 },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch },
  });
}

function fixture() {
  const child = new ChildProcess();
  let connected = true;
  Object.defineProperty(child, "connected", { get: () => connected });
  const send = vi.fn<(_message: unknown) => boolean>(() => true);
  child.send = send;
  vi.mocked(fork).mockReset().mockReturnValue(child);
  let profileOpen = true;
  const settings = createProfileSettingsProcesses(
    { profileBinding: { installationId: randomUUID(), profileId: randomUUID() } },
    { port: 12345, share: async () => undefined, observeOwnedChildClosure() {}, assertOwnedChildClosed() {} },
    1, { primaryDisplay: null }, () => { if (!profileOpen) throw new Error("profile-session-stale"); },
  );
  return { child, send, settings,
    beginClosurePreparation() { profileOpen = false; },
    closeChild(code: number) { connected = false; child.emit("close", code, null); },
  };
}

it("drains one admitted save and leaves a queued save unsent when the profile starts closing", async () => {
  const f = fixture();
  const first = command(), second = command();
  const firstResult = f.settings.execute(first), secondResult = f.settings.execute(second);
  void secondResult.catch(() => {});
  await setImmediate();
  f.child.emit("message", { kind: "ready" });
  await setImmediate();
  const calls = f.send.mock.calls;
  assert.equal(calls.length, 1);
  const request = calls[0]?.[0];
  assert.ok(request && typeof request === "object" && "id" in request);
  assert.deepEqual(request, { kind: "apply", id: request.id, command: first, hostFacts: { primaryDisplay: null } });

  f.beginClosurePreparation();
  const closing = f.settings.closeCommands();
  const result = { state: "applied", commandId: first.commandId, affectedTargets: [{ family: "settings", revision: 2 }],
    restartRequired: false, settingsRevision: 2, settingsFingerprint: "a".repeat(64) };
  f.child.emit("message", { kind: "command", id: request.id, result, committed: true });
  assert.deepEqual(await firstResult, result);
  await assert.rejects(secondResult, /profile-settings-worker-unavailable/);
  assert.deepEqual(calls.slice(1).map(([message]) => message), [{ kind: "stop" }]);
  f.closeChild(0);
  await closing;
});

it("admits no save waiting for worker startup once the profile starts closing", async () => {
  const f = fixture();
  const result = f.settings.execute(command());
  await setImmediate();
  f.beginClosurePreparation();
  f.child.emit("message", { kind: "ready" });
  await assert.rejects(result, /profile-session-stale/);
  assert.equal(f.send.mock.calls.length, 0);
  const closing = f.settings.closeCommands();
  await setImmediate();
  assert.deepEqual(f.send.mock.calls.map(([message]) => message), [{ kind: "stop" }]);
  f.closeChild(0);
  await closing;
});

it("waits for the command worker to install its stop handler when shutdown starts during startup", async () => {
  const f = fixture();
  const starting = assert.rejects(f.settings.execute(command()), /profile-settings-worker-unavailable/);
  await setImmediate();
  assert.equal(vi.mocked(fork).mock.calls.length, 1);
  const closing = f.settings.closeCommands();
  const queued = assert.rejects(f.settings.execute(command()), /profile-settings-worker-unavailable/);
  try {
    assert.equal(f.send.mock.calls.length, 0);
    f.child.emit("message", { kind: "ready" });
    await Promise.all([starting, queued]);
    assert.deepEqual(f.send.mock.calls.map(([message]) => message), [{ kind: "stop" }]);
  } finally {
    f.closeChild(0);
    await Promise.all([closing, starting, queued]);
  }
});

it("reports unproved closure when a closing command worker exits before ready", async () => {
  const f = fixture();
  const starting = assert.rejects(f.settings.execute(command()), /profile-settings-worker-unavailable/);
  await setImmediate();
  const closing = assert.rejects(f.settings.closeCommands(), /settings-command-worker-close-unproved/);
  f.closeChild(1);
  await Promise.all([starting, closing]);
  assert.equal(f.send.mock.calls.length, 0);
});

it("retains abnormal command worker exit as unproved closure when shutdown starts later", async () => {
  const f = fixture();
  const result = f.settings.execute(command());
  await setImmediate();
  f.child.emit("message", { kind: "ready" });
  await setImmediate();
  assert.equal(f.send.mock.calls.length, 1);
  f.closeChild(1);
  await assert.rejects(result, /profile-settings-worker-unavailable/);
  await assert.rejects(f.settings.execute(command()), /profile-settings-worker-unavailable/);
  assert.equal(vi.mocked(fork).mock.calls.length, 1);
  f.beginClosurePreparation();
  await assert.rejects(f.settings.closeCommands(), /settings-command-worker-close-unproved/);
});
