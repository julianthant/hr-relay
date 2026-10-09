import { timingSafeEqual } from "node:crypto";
import { canonicalJsonStringify } from "./canonical-json.js";

/** Canonical private encoding shared by the credential store and the private test-data writer. */
export function encodePrivate(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${canonicalJsonStringify(value)}\n`);
}

/** Constant-time equality of two private values through a fixed-size padded comparison, so neither the length nor the content of a secret leaks timing. */
export function privateEqual(left: unknown, right: unknown, maximumBytes = 64_000): boolean {
  const leftBytes = encodePrivate(left);
  const rightBytes = encodePrivate(right);
  if (leftBytes.byteLength > maximumBytes || rightBytes.byteLength > maximumBytes) {
    throw new Error("private comparison exceeds its fixed bound");
  }
  const leftPadded = Buffer.alloc(maximumBytes + 4);
  const rightPadded = Buffer.alloc(maximumBytes + 4);
  leftPadded.writeUInt32BE(leftBytes.byteLength);
  rightPadded.writeUInt32BE(rightBytes.byteLength);
  leftPadded.set(leftBytes, 4);
  rightPadded.set(rightBytes, 4);
  return timingSafeEqual(leftPadded, rightPadded);
}
