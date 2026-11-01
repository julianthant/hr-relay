import assert from "node:assert/strict";
import { it } from "vitest";
import { advanceProfileRegistryDocument, ProfileRegistryDocumentSchema } from "../../../src/models/profiles/profile.js";

const installationId = "d97b0682-b67a-492a-a182-98696356dbd7";
const current = ProfileRegistryDocumentSchema.parse({ schemaVersion: 3, installationId, revision: 0,
  profiles: [], sessionGeneration: 0, activeProfileId: null });

it("keeps registry revisions independent from session epochs", () => {
  const first = advanceProfileRegistryDocument(current, {});
  const second = advanceProfileRegistryDocument(first, { sessionGeneration: 1 });
  assert.equal(first.revision, 1); assert.equal(first.sessionGeneration, 0);
  assert.equal(second.revision, 2); assert.equal(second.sessionGeneration, 1);
  assert.equal(second.installationId, installationId); assert.equal(current.revision, 0);
});

it("keeps the installation and format immutable even for malformed runtime patches", () => {
  const next = advanceProfileRegistryDocument(current, {
    // @ts-expect-error immutable identity is not a registry patch
    installationId: "0194a462-08fb-7eb8-9a82-7bd1fdaf9ab6", schemaVersion: 2, revision: 500,
  });
  assert.equal(next.installationId, installationId); assert.equal(next.schemaVersion, 3); assert.equal(next.revision, 1);
});

it("refuses revision exhaustion before returning a successor", () => {
  const exhausted = { ...current, revision: Number.MAX_SAFE_INTEGER };
  assert.throws(() => advanceProfileRegistryDocument(exhausted, {}));
  assert.equal(exhausted.revision, Number.MAX_SAFE_INTEGER);
});

it("admits only the current complete registry format", () => {
  const { installationId: _installationId, revision: _revision, ...prior } = current;
  assert.equal(ProfileRegistryDocumentSchema.safeParse({ ...prior, schemaVersion: 2 }).success, false);
  assert.equal(ProfileRegistryDocumentSchema.safeParse({ ...current, schemaVersion: 4 }).success, false);
  assert.equal(ProfileRegistryDocumentSchema.safeParse({ ...current, revision: Number.MAX_SAFE_INTEGER + 1 }).success, false);
});
