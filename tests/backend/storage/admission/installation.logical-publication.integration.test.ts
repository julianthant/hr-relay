import assert from "node:assert/strict";
import fs, { existsSync, readFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { it, vi } from "vitest";
import { z } from "zod";
import { advanceProfileRegistryDocument, LogoutOperationSchema, ProfileRegistryDocumentSchema } from "../../../../src/models/profiles/profile.js";
import { AuthorityDatabase, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";

for (const mutation of ["old-revision", "skipped-revision", "operation-content"] as const) {
  it(`refuses ${mutation} in a durable profile publication without changing source bytes`, async () => {
    const f = await createBoundProfileFixture();
    const registryPath = join(f.machine.stateRoot, "machine", "profiles.json"), controlPath = join(f.workspace, ".tracker", "control", "profile-registry.json"),
      intentPath = join(f.workspace, ".tracker", "control", "profile-publication.json");
    let originalIntent: Buffer | undefined, originalRegistry: Buffer | undefined;
    try {
      const before = f.machine.readProfileRegistry(), rename = fs.renameSync;
      const database = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 1000, migrationOwner: "profile-session-test" });
      let source: ReturnType<typeof database.capturePendingLogoutSource>;
      try { source = database.capturePendingLogoutSource(); } finally { database.close(); }
      let interrupted = false;
      vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
        if (!interrupted && String(target) === controlPath && existsSync(intentPath)) {
          interrupted = true; throw new Error("fixture logical publication before control rename");
        }
        rename(source, target);
      });
      syncBuiltinESMExports();
      try {
        assert.throws(() => mutation === "operation-content"
          ? f.machine.publishProfileOperation(LogoutOperationSchema.parse({ schemaVersion: 2, kind: "logout", operationId: randomUUID(),
            profileId: f.admission.profileBinding.profileId, sessionGeneration: f.machine.readProfileRegistry().sessionGeneration, source, at: "2026-11-01T00:00:00.000Z", phase: "complete" }))
          : f.machine.publishProfileRegistry(before, advanceProfileRegistryDocument(before, {})), /fixture logical publication/u);
      } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); }
      assert.equal(interrupted, true);
      originalIntent = readFileSync(intentPath); originalRegistry = readFileSync(registryPath);
      const intent = z.looseObject({ document: ProfileRegistryDocumentSchema }).parse(JSON.parse(originalIntent.toString("utf8")));
      const document = mutation === "operation-content" ? { ...intent.document,
        profiles: intent.document.profiles.map(row => ({ ...row, firstName: "Tampered" })) }
        : { ...intent.document, revision: before.revision + (mutation === "old-revision" ? 0 : 2) };
      writeFileSync(registryPath, JSON.stringify(document)); writeFileSync(intentPath, JSON.stringify({ ...intent, document }));
      const tampered = storageTree(f.workspace);
      assert.throws(() => f.machine.readProfileRegistry(), mutation === "operation-content"
        ? /profile-operation-publication-uncertain/u : /profile-registry-publication-conflict/u);
      assert.deepEqual(storageTree(f.workspace), tampered);
      writeFileSync(registryPath, originalRegistry); writeFileSync(intentPath, originalIntent);
      assert.equal(f.machine.readProfileRegistry().revision, before.revision + (mutation === "operation-content" ? 0 : 1));
      assert.equal(existsSync(intentPath), false);
    } finally {
      vi.restoreAllMocks(); syncBuiltinESMExports();
      if (originalRegistry !== undefined && originalIntent !== undefined && existsSync(intentPath)) {
        writeFileSync(registryPath, originalRegistry); writeFileSync(intentPath, originalIntent);
      }
      await f.close();
    }
  });
}
