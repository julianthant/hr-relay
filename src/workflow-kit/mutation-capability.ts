/**
 * The ONE mutation-capability registry (ref write-safety beat ⑤, D111).
 *
 * A `MutationCapability` is what stands between a commit task and a real HR
 * write. Its type brand is declare-only, so a structurally identical literal
 * type-checks — unforgeability is the module-private WeakSet below, and nothing
 * else. Only an object THIS module minted is in the set.
 *
 * ## Why it lives in `src/workflow-kit/`
 *
 * Minting needs a type assertion, and no source under `src/models/` may
 * contain one (`strict-boundary-schemas`). Verification has to run inside a
 * `src/backend/systems/<system>/driver/` module immediately before its click.
 * `src/workflow-kit/` owns the shared capability that both layers import.
 *
 * ## The single-minter rule
 *
 * `mintMutationCapability` has exactly one permitted caller —
 * `src/backend/runtime/writes/write-sequencer.ts`, immediately after its fence CAS wins and
 * immediately before the commit impl runs. `task-driver-boundary` fails if any
 * other module so much as names it, and fails on any attempt to conjure the
 * brand through `as` / `satisfies` anywhere else in the tree.
 */
import type { MutationCapability } from "../models/ui/driver.js";
import type { Fingerprint, PositiveInt } from "../rules/identity/ids.js";

const MINTED_MUTATION_CAPABILITIES = new WeakSet<object>();

interface MintedCapabilityShape {
  readonly intentGeneration: PositiveInt;
  readonly bindingDigest: Fingerprint;
}

/** DO NOT CALL. `src/backend/runtime/writes/write-sequencer.ts` is the only permitted caller. */
export function mintMutationCapability(
  intentGeneration: PositiveInt,
  bindingDigest: Fingerprint,
): MutationCapability {
  const value: MintedCapabilityShape = Object.freeze({ intentGeneration, bindingDigest });
  const capability = value as MutationCapability;
  MINTED_MUTATION_CAPABILITIES.add(capability);
  return capability;
}

/**
 * The driver-side verification seam. A commit-capable driver method calls this
 * BEFORE resolving a locator, let alone clicking. A capability nobody minted,
 * or one bound to a different intent generation / binding-proof digest, throws
 * — ref write-safety §7 row 10: "the mutation primitive fired without a fence ⇒ the
 * primitive throws — corruption, loud".
 */
export function assertMintedMutationCapability(
  capability: unknown,
  expected?: Readonly<{ intentGeneration: number; bindingDigest: string }>,
): void {
  if (capability === null || typeof capability !== "object"
    || !MINTED_MUTATION_CAPABILITIES.has(capability)) {
    throw new Error("mutation capability was not minted by the fenced write sequencer; refusing to click");
  }
  if (expected === undefined) return;
  const minted = capability as MintedCapabilityShape;
  if (minted.intentGeneration !== expected.intentGeneration
    || minted.bindingDigest !== expected.bindingDigest) {
    throw new Error(
      "mutation capability is bound to a different intent generation or binding-proof digest; refusing to click",
    );
  }
}
