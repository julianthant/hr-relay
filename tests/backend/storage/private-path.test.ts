import assert from "node:assert/strict";
import { it } from "vitest";
import { privatePathRejects, type PrivacyRule } from "../../../src/backend/storage/private-path.js";

function stat(mode: number, uid: number | bigint = process.getuid?.() ?? 1000, symlink = false) {
  return { mode, uid, dev: 1, ino: 1, isSymbolicLink: () => symlink };
}

const rules: readonly PrivacyRule[] = ["owner", "ancestor", "group-write", "directory-0700", "file-0600", "owner-write-only"];

it("accepts root-owned readable ancestors and sticky shared temporary directories", () => {
  assert.equal(privatePathRejects("/fixture", stat(0o755, 0), "ancestor"), false);
  assert.equal(privatePathRejects("/fixture", stat(0o1777, 0), "ancestor"), false);
  assert.equal(privatePathRejects("/fixture", stat(0o777, 0), "ancestor"), true);
  assert.equal(privatePathRejects("/fixture", stat(0o755, (process.getuid?.() ?? 1000) + 1), "ancestor"), true);
});

it("keeps readable managed data distinct from exact private leaves", () => {
  assert.equal(privatePathRejects("/fixture", stat(0o644), "group-write"), false);
  assert.equal(privatePathRejects("/fixture", stat(0o664), "group-write"), true);
  assert.equal(privatePathRejects("/fixture", stat(0o600), "file-0600"), false);
  assert.equal(privatePathRejects("/fixture", stat(0o644), "file-0600"), true);
  assert.equal(privatePathRejects("/fixture", stat(0o4600), "file-0600"), true);
  assert.equal(privatePathRejects("/fixture", stat(0o700), "directory-0700"), false);
  assert.equal(privatePathRejects("/fixture", stat(0o1700), "directory-0700"), true);
  assert.equal(privatePathRejects("/fixture", stat(0o755), "directory-0700"), true);
  assert.equal(privatePathRejects("/fixture", stat(0o755), "owner-write-only"), false);
  assert.equal(privatePathRejects("/fixture", stat(0o555), "owner-write-only"), true);
  assert.equal(privatePathRejects("/fixture", stat(0o775), "owner-write-only"), true);
  assert.equal(privatePathRejects("/fixture", stat(0o777), "owner"), false);
});

for (const rule of rules) {
  it(`refuses links and foreign owners for ${rule}`, () => {
    const mode = rule === "file-0600" ? 0o600 : 0o700;
    assert.equal(privatePathRejects("/fixture", stat(mode, process.getuid?.() ?? 1000, true), rule), true);
    assert.equal(privatePathRejects("/fixture", stat(mode, (process.getuid?.() ?? 1000) + 1), rule), true);
  });
}

it("checks bigint metadata without narrowing owner identity", () => {
  const uid = BigInt(process.getuid?.() ?? 1000);
  assert.equal(privatePathRejects("/fixture", { mode: 0o600n, dev: 1n, ino: 1n, uid, isSymbolicLink: () => false }, "file-0600"), false);
  assert.equal(privatePathRejects("/fixture", { mode: 0o600n, dev: 1n, ino: 1n, uid: (1n << 64n) + uid, isSymbolicLink: () => false }, "file-0600"), true);
});

it("refuses unavailable ownership evidence", () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "getuid");
  try {
    Object.defineProperty(process, "getuid", { configurable: true, value: undefined });
    for (const rule of rules) assert.equal(privatePathRejects("/fixture", stat(0o600), rule), true);
  } finally {
    if (descriptor === undefined) delete process.getuid;
    else Object.defineProperty(process, "getuid", descriptor);
  }
});
