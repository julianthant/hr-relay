import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { it, vi } from "vitest";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import * as identities from "../../../../src/backend/storage/file-identity.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";

vi.mock("../../../../src/backend/storage/private-path.js", async load => {
  const original = await load<typeof import("../../../../src/backend/storage/private-path.js")>();
  return { ...original, privatePathRejects: original.posixPrivatePathRejects,
    assertNoReparsePath(path: string) { assert.equal(fs.lstatSync(path).isSymbolicLink(), false); },
  };
});

it("opens existing profile authority with an exact high Windows file ID and refuses substitution during open", async () => {
  const f = await createBoundProfileFixture(), lstat = fs.lstatSync;
  const credentials = boundProfileCredentials(f.admission);
  let reads = 0, substitute = false;
  const host = process.platform, status = identities.fileStatus;
  const platform = vi.spyOn(process, "platform", "get").mockReturnValue(host);
  vi.spyOn(identities, "fileStatus").mockImplementation((path, missing?: true) => {
    platform.mockReturnValue(path === f.path ? "win32" : host);
    try { return missing ? status(path, true) : status(path); } finally { platform.mockReturnValue(host); }
  });
  vi.spyOn(fs, "lstatSync").mockImplementation((path, options) => {
    const info = lstat(path, options);
    if (path === f.path && info !== undefined && typeof options === "object" && options.bigint) {
      reads++; info.ino = substitute && reads > 1 ? 21_110_623_253_370_484n : 21_110_623_253_370_483n;
    }
    return info;
  });
  syncBuiltinESMExports();
  try {
    const open = () => AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "exact-file-id" }, undefined,
      undefined, undefined, undefined, credentials);
    const database = open();
    try { assert.equal(database.getMeta().schemaVersion > 0, true); assert.ok(reads >= 2); }
    finally { database.close(); }
    reads = 0; substitute = true;
    assert.throws(open, /profile-database-open-source-changed/u);
  } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); await f.close(); }
});
