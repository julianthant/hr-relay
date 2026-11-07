import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { readTestDataLocalConfig } from "../../../../src/backend/storage/configuration/test-data-local.js";

for (const fault of ["foreign-owner", "shared-read"] as const) {
  it(`refuses ${fault} private test inputs before reading their contents`, () => {
    const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "private-test-input-")), path = join(root, "input.json");
    fs.writeFileSync(path, JSON.stringify({ schemaVersion: 1, inputs: {}, files: {} }), { mode: 0o600 });
    let reads = 0, closes = 0;
    try {
      assert.equal(readTestDataLocalConfig(path).state, "valid");
      assert.throws(() => readTestDataLocalConfig(path, {
        open: fs.openSync,
        inspect(descriptor) {
          const metadata = fs.fstatSync(descriptor);
          if (fault === "foreign-owner") metadata.uid++;
          else metadata.mode = (metadata.mode & ~0o7777) | 0o640;
          return metadata;
        },
        read(descriptor) { reads++; return fs.readFileSync(descriptor); },
        close(descriptor) { closes++; fs.closeSync(descriptor); },
      }), /must be private to its owner/u);
      assert.equal(reads, 0);
      assert.equal(closes, 1);
      assert.equal(readTestDataLocalConfig(path).state, "valid");
    } finally { fs.rmSync(root, { recursive: true }); }
  });
}
