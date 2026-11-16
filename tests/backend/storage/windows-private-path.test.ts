import assert from "node:assert/strict";
import { it } from "vitest";
import { parseWindowsAcl, parseWindowsSid, windowsSecurityRejects, type WindowsAce, type WindowsSecurity } from "../../../src/backend/storage/windows-private-path.js";

const USER = "S-1-5-21-1-2-3-1001", EVERYONE = "S-1-1-0";
const allow = (sid: string, mask: number, flags = 0): WindowsAce => ({ type: 0, sid, mask, flags });
const owned = (aces: readonly WindowsAce[], directory = false): WindowsSecurity => ({ owner: USER, directory, aces });

it("requires the current SID for leaves and permits only exact trusted ancestor owners", () => {
  const aces = [allow(USER, 0x1f01ff)];
  for (const owner of [USER, "S-1-5-18", "S-1-5-32-544", "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464"]) {
    assert.equal(windowsSecurityRejects({ owner, directory: true, aces }, USER, "ancestor"), false);
    assert.equal(windowsSecurityRejects({ owner, directory: true, aces }, USER, "directory-0700"), owner !== USER);
  }
  assert.equal(windowsSecurityRejects({ owner: EVERYONE, directory: true, aces }, USER, "ancestor"), true);
});

it("maps generic rights and keeps readable data separate from private data", () => {
  const aces = [allow(USER, 0x10000000), allow(EVERYONE, 0x80000000)];
  assert.equal(windowsSecurityRejects(owned(aces), USER, "file-0600"), true);
  assert.equal(windowsSecurityRejects(owned(aces), USER, "group-write"), false);
  for (const right of [2, 4, 0x10, 0x40, 0x100, 0x10000, 0x40000, 0x80000, 0x40000000, 0x10000000]) {
    assert.equal(windowsSecurityRejects(owned([allow(USER, 0x10000000), allow(EVERYONE, right)]), USER, "group-write"), true);
  }
  assert.equal(windowsSecurityRejects(owned([allow(USER, 0x80000000)]), USER, "file-0400"), false);
  assert.equal(windowsSecurityRejects(owned([allow(USER, 0xc0000000)]), USER, "file-0400"), true);
  assert.equal(windowsSecurityRejects(owned([allow(USER, 0x80000000)]), USER, "private-read-write"), true);
  assert.equal(windowsSecurityRejects(owned([allow(USER, 0x10000000)]), USER, "directory-0700"), true);
  assert.equal(windowsSecurityRejects(owned([allow(USER, 0x10000000)], true), USER, "file-0600"), true);
});

it("allows ancestor create-subdirectory rights while refusing replacement and other mutation", () => {
  const parent = (mask: number) => owned([allow(USER, 0x1f01ff), allow(EVERYONE, mask)], true);
  assert.equal(windowsSecurityRejects(parent(0x1200ad), USER, "ancestor"), false);
  for (const mask of [2, 0x10, 0x40, 0x100, 0x10000, 0x40000, 0x80000]) {
    assert.equal(windowsSecurityRejects(parent(mask), USER, "ancestor"), true);
  }
});

it("ignores inherit-only access on ancestors but refuses unsafe inheritable private ACLs", () => {
  const security = owned([allow(USER, 0x1f01ff, 3), allow(EVERYONE, 0xe0010000, 11)], true);
  assert.equal(windowsSecurityRejects(security, USER, "ancestor"), false);
  assert.equal(windowsSecurityRejects(security, USER, "directory-0700", true), true);
  assert.equal(windowsSecurityRejects(owned([allow(USER, 0x1f01ff, 3)], true), USER, "directory-0700", true), false);
  assert.equal(windowsSecurityRejects(owned([], true), USER, "directory-0700"), true);
  assert.throws(() => windowsSecurityRejects(owned([{ ...allow(USER, 1), type: 1 }]), USER, "private"), /Windows storage/u);
  assert.throws(() => windowsSecurityRejects(owned([allow(USER, 0x2000000)]), USER, "private"), /Windows storage/u);
});

it("bounds SID and ACL parsing and refuses unsupported ACE semantics", () => {
  const sid = Buffer.from([1, 1, 0, 0, 0, 0, 0, 5, 18, 0, 0, 0]);
  assert.equal(parseWindowsSid(sid), "S-1-5-18");
  assert.throws(() => parseWindowsSid(sid.subarray(0, 11)), /Windows storage/u);
  const acl = Buffer.alloc(28);
  acl[0] = 2; acl.writeUInt16LE(28, 2); acl.writeUInt16LE(1, 4);
  acl.writeUInt16LE(20, 10); acl.writeUInt32LE(0x1f01ff, 12); sid.copy(acl, 16);
  assert.deepEqual(parseWindowsAcl(acl), [allow("S-1-5-18", 0x1f01ff)]);
  for (const type of [1, 5, 9, 0xff]) {
    acl[8] = type;
    assert.throws(() => parseWindowsAcl(acl), /Windows storage/u);
  }
  acl[8] = 0; acl[9] = 0x80;
  assert.throws(() => parseWindowsAcl(acl), /Windows storage/u);
  assert.throws(() => parseWindowsAcl(acl.subarray(0, 20)), /Windows storage/u);
});
