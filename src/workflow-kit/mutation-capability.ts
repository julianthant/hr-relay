import type { MutationCapability } from "../models/ui/driver.js";
import type { Fingerprint, PositiveInt } from "../rules/identity/ids.js";

const remainingProbeBudgets = new WeakMap<object, () => number>();

interface MintedCapabilityShape {
  readonly intentGeneration: PositiveInt;
  readonly bindingDigest: Fingerprint;
}

/** DO NOT CALL. `src/backend/runtime/writes/write-sequencer.ts` is the only permitted caller. */
export function mintMutationCapability(
  intentGeneration: PositiveInt,
  bindingDigest: Fingerprint,
  remainingProbeMs: () => number,
): MutationCapability {
  const value: MintedCapabilityShape = Object.freeze({ intentGeneration, bindingDigest });
  const capability = value as MutationCapability;
  remainingProbeBudgets.set(capability, remainingProbeMs);
  return capability;
}

function remainingClickMs(capability: unknown, controlTimeoutMs?: number): number {
  const budget = capability !== null && typeof capability === "object" ? remainingProbeBudgets.get(capability) : undefined;
  if (budget === undefined) throw new Error("mutation capability was not minted by the fenced write sequencer; refusing to click");
  const remaining = Math.floor(Math.min(budget(), controlTimeoutMs ?? Infinity));
  // A zero Playwright timeout disables the deadline.
  if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("probe deadline expired before the commit click");
  return remaining;
}

export function clickWithMutationCapability(
  capability: MutationCapability,
  control: { click(options: { timeout: number }): Promise<void> },
  controlTimeoutMs?: number,
): Promise<void> {
  return control.click({ timeout: remainingClickMs(capability, controlTimeoutMs) });
}

/** The driver-side verification seam: a commit-capable driver calls this BEFORE resolving a locator; an unminted or mis-bound capability throws rather than clicking. */
export function assertMintedMutationCapability(
  capability: unknown,
  expected?: Readonly<{ intentGeneration: number; bindingDigest: string }>,
): void {
  remainingClickMs(capability);
  if (expected === undefined) return;
  const minted = capability as MintedCapabilityShape;
  if (minted.intentGeneration !== expected.intentGeneration
    || minted.bindingDigest !== expected.bindingDigest) {
    throw new Error(
      "mutation capability is bound to a different intent generation or binding-proof digest; refusing to click",
    );
  }
}
