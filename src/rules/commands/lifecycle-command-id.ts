import { canonicalJsonStringify } from "../validation/canonical-json.js";
import { CommandIdSchema } from "../identity/ids.js";
import { sha256Hex } from "../validation/sha256.js";

/** Browser-safe deterministic identity for nested lifecycle commands. */
export function lifecycleCommandId(operation: string, identity: unknown) {
  const hash = sha256Hex(`hrauto:worker-lifecycle:v1\0${operation}\0${canonicalJsonStringify(identity)}`);
  return CommandIdSchema.parse(`${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`);
}
