import { sha256Hex } from "../validation/sha256.js";

export function deriveStableUuid(namespace: string, key: string): string {
  const digest = sha256Hex(`${namespace}\0${key}`);
  const variant = "89ab"[Number.parseInt(digest[16], 16) % 4];
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `${variant}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}
