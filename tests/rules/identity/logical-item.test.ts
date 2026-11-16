import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "vitest";
import { deriveItemId } from "../../../src/rules/identity/logical-item.js";
import { deriveItemId as runtimeItemId } from "../../../src/rules/identity/identifiers.js";

function nativeItemId(workflow: string, key: string) {
  const hash = createHash("sha256").update("hrauto:logical-item:v1\0").update(workflow).update("\0").update(key).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${"89ab"[Number.parseInt(hash[16], 16) % 4]}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

describe("browser-safe logical item identity", () => {
  it("keeps the runtime digest and UUID bits for ASCII, Unicode and multi-block keys", () => {
    for (const workflow of ["person-lookup", "ocr-page"]) {
      for (const key of ["eid:10000001", "name:Éxample, Petra", "document:" + "a".repeat(180)]) {
        assert.equal(deriveItemId(workflow, key), nativeItemId(workflow, key));
        assert.equal(runtimeItemId(workflow, key), nativeItemId(workflow, key));
      }
    }
  });
});
