// Module-private WeakSet membership authorizes fenced writes; caller-created tokens cannot.
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

/** The driver-side verification seam: a commit-capable driver calls this BEFORE resolving a locator; an unminted or mis-bound capability throws rather than clicking. */
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
