import { sha256Hex } from "../validation/sha256.js";
import { ItemIdSchema } from "./ids.js";

/** Stable across runtime and browser-safe workflow binds for the same workflow and match key. */
export function deriveItemId(workflowId: string, matchKey: string): string {
  const digest = sha256Hex(`hrauto:logical-item:v1\0${workflowId}\0${matchKey}`);
  const version = "5";
  const variant = "89ab"[Number.parseInt(digest[16], 16) % 4];
  return ItemIdSchema.parse([
    digest.slice(0, 8),
    digest.slice(8, 12),
    `${version}${digest.slice(13, 16)}`,
    `${variant}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-"));
}
