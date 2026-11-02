import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync, existsSync, readdirSync, rmdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ProfileRegistryDocumentSchema } from "../../../../src/models/profiles/profile.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";

export function writeStoppedProfileControlPredecessor(paths: { registryPath: string; controlPath: string; markerPath: string }, version: 1 | 2 | 3 | 4): Buffer {
  const currentRegistry = readFileSync(paths.registryPath);
  const registry = ProfileRegistryDocumentSchema.parse(JSON.parse(currentRegistry.toString("utf8")));
  if (version === 4) return currentRegistry;
  const { installationId: _installation, revision: _revision, ...content } = registry;
  const document = { ...content, schemaVersion: 2 };
  const control = z.looseObject({ schemaVersion: z.literal(4), revision: z.number(), duo: z.array(z.unknown()), completedRestores: z.array(z.unknown()),
    operations: z.array(z.strictObject({ operationId: z.string(), digest: z.string() })) }).parse(JSON.parse(readFileSync(paths.controlPath, "utf8")));
  assert.equal(control.completedRestores.length, 0);
  const { revision: _controlRevision, duo, completedRestores, ...base } = control;
  if (version === 1) {
    const duoDirectory = join(dirname(paths.registryPath), "duo-credentials");
    if (existsSync(duoDirectory)) { assert.deepEqual(readdirSync(duoDirectory), []); rmdirSync(duoDirectory); }
  }
  writeFileSync(paths.registryPath, JSON.stringify(document));
  const info = statSync(paths.registryPath);
  const operations = control.operations.map(row => {
    const metadata = statSync(join(dirname(paths.registryPath), "operations", `${row.operationId}.json`));
    return { ...row, device: metadata.dev, inode: metadata.ino };
  });
  writeFileSync(paths.controlPath, JSON.stringify({ ...base, schemaVersion: version, digest: createHash("sha256").update(canonicalJsonStringify(document)).digest("hex"),
    device: info.dev, inode: info.ino, operations, ...(version >= 2 ? { duo } : {}), ...(version === 3 ? { completedRestores } : {}) }));
  writeFileSync(paths.markerPath, JSON.stringify({ schemaVersion: version + 1 }));
  return currentRegistry;
}
