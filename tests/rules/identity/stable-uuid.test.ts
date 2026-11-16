import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "vitest";
import { deriveStableUuid } from "../../../src/rules/identity/stable-uuid.js";
import { deriveStableUuid as runtimeStableUuid } from "../../../src/rules/identity/identifiers.js";

function nativeUuid(namespace: string, key: string) {
  const digest = createHash("sha256").update(namespace).update("\0").update(key).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${"89ab"[Number.parseInt(digest[16], 16) % 4]}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

it("preserves native stable UUID bytes and bits for browser and runtime callers", () => {
  for (const namespace of ["run-workbook-row-resolution", "fixture\0namespace", ""]) {
    for (const key of ["00000000-0000-4000-8000-000000000001", "", "row\0key", "row:\u00c9xample\u{1f4c4}", "x".repeat(280), "\ud800"]) {
      assert.equal(deriveStableUuid(namespace, key), nativeUuid(namespace, key));
      assert.equal(runtimeStableUuid(namespace, key), nativeUuid(namespace, key));
      assert.match(deriveStableUuid(namespace, key), /^[a-f\d]{8}-[a-f\d]{4}-5[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/u);
    }
  }
});
