import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { closeContextWithProof, observeContextLifecycle, type BrowserRoots, type BrowserRootLaunchInput, type BrowserProfileProbeOptions } from "../../../../src/backend/storage/browser-roots.js";
import type { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";

// Consumer tests mock this port; registry authority is exercised by the storage integration tests.
export function mockBrowserRootPort() {
  let generation = 0;
  const probe = async (input: BrowserRootLaunchInput, options: BrowserProfileProbeOptions) => {
    if (options.launcher === undefined) throw new Error("mock-browser-root-launcher-required");
    mkdirSync(input.profileDirectory, { recursive: true, mode: 0o700 });
    const context = await options.launcher.launch({ profileDirectory: input.profileDirectory, extensionDirectory: "", downloadsPath: input.profileDirectory,
      viewport: { width: 800, height: 600 }, timeoutMs: options.launchTimeoutMs, headless: true, acceptDownloads: false, nativeOnly: true });
    await closeContextWithProof(options, context, observeContextLifecycle(context), "mock native profile probe", "profile-reset");
  };
  const browserRoots: BrowserRoots = {
    inventory: () => ({ schemaVersion: 1, installationId: randomUUID(), revision: 0, nextGeneration: generation + 1, roots: [] }),
    beginLaunch: () => ({ launchId: randomUUID(), generation: ++generation, opened() {}, closing() {}, closed() {}, uncertain(error): never { throw error; } }),
    probe,
    async withUnused(directory, options, body, owner) {
      if (owner === undefined) throw new Error("mock-browser-root-owner-required");
      await probe(owner, options);
      return body({ assertCurrent() {}, remove() { rmSync(directory, { recursive: true }); mkdirSync(dirname(directory), { recursive: true, mode: 0o700 }); } });
    },
  };
  return { browserRoots, browserOwner: { profileId: randomUUID(), database: {} as AuthorityDatabase } };
}
