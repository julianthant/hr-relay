import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "vitest";
import { sha256Hex } from "../../../src/rules/validation/sha256.js";

describe("browser-safe SHA-256", () => {
  it("matches known vectors and the platform digest across UTF-8 and block boundaries", () => {
    for (const [text, expected] of [
      ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
      ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
      ["abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"],
    ]) assert.equal(sha256Hex(text), expected);

    const check = (text: string): void => {
      assert.equal(sha256Hex(text), createHash("sha256").update(text, "utf8").digest("hex"));
    };
    for (const length of [1, 2, 3, 7, 31, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 255, 256, 257, 1024]) {
      check("a".repeat(length));
    }
    for (const text of ["é", "𝄞", "😀你好", "a".repeat(54) + "é", "a".repeat(55) + "é", "a".repeat(60) + "😀", "\u0000\uffff", "\ud800", "\udc00"]) check(text);
    let state = 0x12345678;
    for (let sample = 0; sample < 80; sample += 1) {
      let text = "";
      for (let index = 0; index < sample * 17; index += 1) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        text += String.fromCharCode(state & 0xffff);
      }
      check(text);
    }
  });
});
