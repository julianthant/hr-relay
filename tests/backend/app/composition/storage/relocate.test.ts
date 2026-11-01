import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { createServer, Server } from "node:net";
import { dirname } from "node:path";
import { afterEach, it, vi } from "vitest";
import { runOfflineStorageRelocation } from "../../../../../src/backend/app/composition/storage/relocate.js";
import { RuntimeLifetimeLock } from "../../../../../src/backend/storage/admission/lifetime-lock.js";

vi.mock("node:net", async importOriginal => {
  const net = await importOriginal<typeof import("node:net")>();
  return { ...net, createServer: vi.fn() };
});
afterEach(() => { vi.restoreAllMocks(); });

async function heldLock() {
  const server = new Server(); let listening = false;
  Object.defineProperty(server, "listening", { get: () => listening });
  vi.spyOn(server, "listen").mockImplementation(() => {
    listening = true; queueMicrotask(() => server.emit("listening")); return server;
  });
  vi.spyOn(server, "address").mockReturnValue({ address: "127.0.0.1", family: "IPv4", port: 12345 });
  vi.spyOn(server, "close").mockImplementation(callback => {
    listening = false; queueMicrotask(() => callback?.()); return server;
  });
  vi.mocked(createServer).mockReturnValue(server);
  const lock = await RuntimeLifetimeLock.acquire(0), workspace = realpathSync(process.cwd());
  lock.initializeWorkspace(workspace, () => {});
  return { lock, workspace };
}

for (const kind of ["plan", "resume"] as const) it(`refuses ownerless relocation ${kind} before creating maintenance`, async () => {
  const f = await heldLock();
  try {
    await assert.rejects(runOfflineStorageRelocation({ workspace: f.workspace, lifetime: f.lock,
      command: { kind, id: "96f78014-4517-4cc0-9518-a9788e4548ee", json: true } }), { code: "PROFILE_STORAGE_RELOCATION_UNSUPPORTED" });
    f.lock.assertRuntimeAvailable();
  } finally { await f.lock.close(); }
});

it("keeps genuine workspace proof ahead of ownerless relocation refusal", async () => {
  const f = await heldLock();
  try {
    await assert.rejects(runOfflineStorageRelocation({ workspace: dirname(f.workspace), lifetime: f.lock,
      command: { kind: "resume", id: "96f78014-4517-4cc0-9518-a9788e4548ee", json: true } }), /runtime-lifetime-workspace-unproved/u);
    f.lock.assertRuntimeAvailable();
  } finally { await f.lock.close(); }
});
