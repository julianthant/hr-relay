
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach,describe,it } from "vitest";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { PersonLookupCanonicalInput,PersonLookupInput } from "../../../src/workflows/person-lookup/workflow.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";
const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe("derived identity", () => {

  it("hashes a schema by its shape, and reads ingress and canonical as different shapes", () => {
    const ingress = deriveSchemaHash(PersonLookupInput, "input");
    const canonical = deriveSchemaHash(PersonLookupCanonicalInput, "output");
    assert.notEqual(ingress, canonical, "defaults applied is not the same shape as defaults resolved");
    assert.equal(ingress, deriveSchemaHash(PersonLookupInput, "input"));
  });
});
