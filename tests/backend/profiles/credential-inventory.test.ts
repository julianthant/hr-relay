import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { assessCredentialInventory } from "../../../src/backend/profiles/credential-inventory.js";

it.each(["backup", "stage"] as const)("requires complete capture to certify an existing clean %s copy, while absence permits completion", kind => {
  const root = mkdtempSync(join(tmpdir(), "inventory-capture-"));
  try {
    mkdirSync(join(root, "credentials"), { mode: 0o700 });
    const path = kind === "backup" ? join(root, "copy.json") : join(root, "credentials", ".protected.fixture.tmp");
    writeFileSync(path, JSON.stringify({ schemaVersion: 3, record: { entries: { timekeeperName: { value: "ordinary-name" } } }, history: [] }), { mode: 0o600 });
    const input = { profileRoot: root, entriesAbsent: true, backupPaths: kind === "backup" ? [path] : [], loginDataPaths: [], capturedSecrets: ["absent-disposable-secret"] };
    const complete = assessCredentialInventory({ ...input, capturedSecretsComplete: true });
    assert.equal(complete.logoutComplete, true);
    const incomplete = assessCredentialInventory({ ...input, capturedSecretsComplete: false });
    assert.equal(incomplete.logoutComplete, false);
    if (kind === "backup") assert.deepEqual(incomplete.unknownFormats, [path]);
    else assert.equal(incomplete.stagePlaintext, true);
    rmSync(path);
    assert.equal(assessCredentialInventory({ ...input, capturedSecrets: [], capturedSecretsComplete: false }).logoutComplete, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("a complete capture still refuses a clean-shaped copy containing captured bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "inventory-capture-hit-"));
  try {
    const path = join(root, "copy.json"), secret = "disposable-retained-value";
    writeFileSync(path, JSON.stringify({ schemaVersion: 3, record: { entries: { timekeeperName: { value: secret } } }, history: [] }), { mode: 0o600 });
    const inventory = assessCredentialInventory({ profileRoot: root, entriesAbsent: true, backupPaths: [path], loginDataPaths: [], capturedSecrets: [secret], capturedSecretsComplete: true });
    assert.equal(inventory.logoutComplete, false);
    assert.deepEqual(inventory.unknownFormats, []);
    assert.deepEqual(inventory.backupPlaintext, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
