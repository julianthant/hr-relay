import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { countUcsdLoginRows } from "../../../../src/backend/storage/sqlite/profile-local-databases.js";

it("counts UCSD login rows through a read-only database and preserves missing or unreadable states", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "profile-login-count-")));
  const path = join(root, "Login Data");
  try {
    assert.equal(countUcsdLoginRows(path), "absent");
    assert.equal(countUcsdLoginRows(root), "unreadable");
    const database = new DatabaseSync(path);
    try {
      database.exec("CREATE TABLE logins (origin_url TEXT, username_value TEXT)");
      const insert = database.prepare("INSERT INTO logins VALUES (?, ?)");
      insert.run("https://login.ucsd.edu/", "alex@example.edu");
      insert.run("https://example.edu/", "alex@ucsd.edu");
      insert.run("https://example.edu/", "alex@example.edu");
    } finally { database.close(); }
    const before = readFileSync(path);
    assert.equal(countUcsdLoginRows(path), 2);
    assert.deepEqual(readFileSync(path), before);
    const update = new DatabaseSync(path);
    try { update.exec("DELETE FROM logins"); } finally { update.close(); }
    assert.equal(countUcsdLoginRows(path), 0);
    const missingColumn = new DatabaseSync(path);
    try { missingColumn.exec("DROP TABLE logins; CREATE TABLE logins (other TEXT)"); } finally { missingColumn.close(); }
    assert.equal(countUcsdLoginRows(path), "unreadable");
    writeFileSync(path, "not a database");
    assert.equal(countUcsdLoginRows(path), "unreadable");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
