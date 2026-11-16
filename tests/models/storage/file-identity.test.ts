import assert from "node:assert/strict";
import { it } from "vitest";
import { FileIdentitySchema } from "../../../src/models/storage/file-identity.js";

it.each([0, Number.MAX_SAFE_INTEGER, "0", "9007199254740993"])("retains the exact JSON identity value %s", inode => {
  assert.deepEqual(FileIdentitySchema.parse({ device: 1, inode }), { device: 1, inode });
});

it.each([Number.MAX_SAFE_INTEGER + 1, -1, 1.5, NaN, Infinity, "01", "-1", "+1", "1.0", "1e4", "", 1n])("refuses a non-exact JSON identity value %s", inode => {
  assert.equal(FileIdentitySchema.safeParse({ device: 1, inode }).success, false);
  assert.equal(FileIdentitySchema.safeParse({ device: inode, inode: 1 }).success, false);
});
