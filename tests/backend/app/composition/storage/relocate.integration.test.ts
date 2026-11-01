import { default as assert } from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { copyNativeSnapshot } from "../../../../../src/backend/app/composition/storage/relocate.js";
import { RuntimeAdmission } from "../../../../../src/backend/storage/admission/admission.js";

import { parseRelocationCommand } from "../../../../../src/backend/app/composition/storage/relocate.js";

{

it("replays only the exact interrupted native snapshot publication", () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "relocation-native-publication-")));
  const sourceRoot = join(workspace, "source");
  const destinationRoot = join(workspace, "destination");
  mkdirSync(sourceRoot, { mode: 0o700 });
  mkdirSync(destinationRoot, { mode: 0o700 });
  const source = join(sourceRoot, "source.sqlite");
  const destination = join(destinationRoot, "state.db");
  const operationId = randomUUID();
  const candidate = join(destinationRoot, `.relocation-${operationId}-state.db.tmp`);
  const bytes = Buffer.from("synthetic native snapshot bytes");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const admission = RuntimeAdmission.syntheticRoots(destinationRoot, join(destinationRoot, "artifacts"));
  try {
    writeFileSync(source, bytes, { mode: 0o600 });
    assert.throws(() => copyNativeSnapshot(source, destination, sha256, operationId, admission,
      () => { throw new Error("simulated crash after native link"); }), /simulated crash after native link/u);
    assert.equal(lstatSync(destination).nlink, 2);
    assert.equal(lstatSync(candidate).ino, lstatSync(destination).ino);
    copyNativeSnapshot(source, destination, sha256, operationId, admission);
    assert.equal(lstatSync(destination).nlink, 1);
    assert.equal(lstatSync(candidate, { throwIfNoEntry: false }), undefined);
    assert.deepEqual(readFileSync(destination), bytes);
    copyNativeSnapshot(source, destination, sha256, operationId, admission);
  } finally { admission.release(); rmSync(workspace, { recursive: true, force: true }); }
});
}

{

describe("secure environment bootstrap", () => {
  it("parses only exact offline relocation selectors", () => {
    assert.deepEqual(parseRelocationCommand(["--status", "--json"]), { kind: "status", json: true });
    assert.throws(() => parseRelocationCommand(["--status", "extra"]), /storage-relocation-usage/u);
    assert.throws(() => parseRelocationCommand(["--resume", "latest"]), /storage-relocation-usage/u);
  });
});
}
