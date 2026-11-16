import assert from "node:assert/strict";
import { it, vi } from "vitest";

vi.mock("../../../src/backend/app/composition/storage-compose.js", () => {
  throw new Error("storage CLI composition loaded eagerly");
});
vi.mock("../../../src/backend/app/test-data/compose.js", () => {
  throw new Error("test-data CLI composition loaded eagerly");
});

it("imports synthetic database fixtures without loading unrelated CLI compositions", async () => {
  const { AuthorityDatabase } = await import("./synthetic-storage-admission.js");
  assert.equal(typeof AuthorityDatabase.open, "function");
});
