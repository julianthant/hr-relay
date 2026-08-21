/**
 * The Duo ceremony lease TOKEN and the gate port (ref execution-and-sessions
 * §10.6, D267) — `MutationCapability`'s shape, for the same reason: a rule that
 * can be satisfied by a caller's claim is not a rule.
 *
 * A `DuoCeremonyLeaseToken` is what stands between a login recipe and the SSO
 * form. Its type brand is declare-only, so a structurally identical literal
 * type-checks — unforgeability is the module-private WeakSet below, and nothing
 * else. Only an object THIS module minted is in the set, and only the lease
 * store (`src/infra/sqlite/authority-database.ts`) may mint or retire one;
 * the `duo-ceremony-lease` guard fails any other module that names either
 * function and any attempt to conjure the brand through `as` / `satisfies`.
 *
 * ## Why it lives in `src/base/`
 *
 * Minting needs a type assertion, which no `src/domain/**` boundary source may
 * contain (`strict-boundary-schemas`); the store that mints sits in `infra`
 * and the SSO helpers that assert sit in `infra/browser`, and both may import
 * `base`.
 */
import type { DuoCeremonyLeaseHolder } from "../domain/duo-ceremony-lease.js";
import type { BrowserSystemId, Fingerprint, IsoInstant, PositiveInt } from "../domain/ids.js";

declare const DUO_CEREMONY_LEASE_TOKEN_BRAND: unique symbol;

/** Proof that the holder owns the credential's ceremony lease at `generation`. */
export interface DuoCeremonyLeaseToken {
  readonly [DUO_CEREMONY_LEASE_TOKEN_BRAND]: "DuoCeremonyLeaseToken";
  readonly credentialKey: Fingerprint;
  readonly generation: PositiveInt;
  readonly holder: DuoCeremonyLeaseHolder;
  readonly expiresAt: IsoInstant;
}

const MINTED_DUO_CEREMONY_LEASE_TOKENS = new WeakSet<object>();
const RETIRED_DUO_CEREMONY_LEASE_TOKENS = new WeakSet<object>();

interface MintedTokenShape {
  readonly credentialKey: Fingerprint;
  readonly generation: PositiveInt;
  readonly holder: DuoCeremonyLeaseHolder;
  readonly expiresAt: IsoInstant;
}

/** DO NOT CALL. The lease store in `src/infra/sqlite/authority-database.ts` is the only permitted caller. */
export function mintDuoCeremonyLeaseToken(input: MintedTokenShape): DuoCeremonyLeaseToken {
  const value: MintedTokenShape = Object.freeze({
    credentialKey: input.credentialKey,
    generation: input.generation,
    holder: Object.freeze({ workerId: input.holder.workerId, system: input.holder.system }),
    expiresAt: input.expiresAt,
  });
  const token = value as DuoCeremonyLeaseToken;
  MINTED_DUO_CEREMONY_LEASE_TOKENS.add(token);
  return token;
}

/**
 * DO NOT CALL. The lease store retires a token when its lease is released (or
 * found superseded), so a helper presented with it AFTER the release refuses.
 */
export function retireDuoCeremonyLeaseToken(token: DuoCeremonyLeaseToken): void {
  if (!MINTED_DUO_CEREMONY_LEASE_TOKENS.has(token)) {
    throw new Error("Duo ceremony lease token was not minted by the Duo ceremony lease store; refusing to retire it");
  }
  if (RETIRED_DUO_CEREMONY_LEASE_TOKENS.has(token)) {
    throw new Error("Duo ceremony lease token was already retired; a lease is released exactly once");
  }
  RETIRED_DUO_CEREMONY_LEASE_TOKENS.add(token);
}

export function isDuoCeremonyLeaseToken(token: unknown): token is DuoCeremonyLeaseToken {
  return token !== null && typeof token === "object" && MINTED_DUO_CEREMONY_LEASE_TOKENS.has(token);
}

/**
 * The SSO-helper verification seam: every helper that navigates to the SSO
 * form or drives the Duo assertion calls this BEFORE touching the page. A
 * token nobody minted, one already retired, or one minted for a different
 * system throws — the ceremony would otherwise run outside the lease.
 */
export function assertDuoCeremonyLeaseToken(
  token: unknown,
  expected?: Readonly<{ system: BrowserSystemId }>,
): asserts token is DuoCeremonyLeaseToken {
  if (!isDuoCeremonyLeaseToken(token)) {
    throw new Error("Duo ceremony lease token was not minted by the Duo ceremony lease store; refusing to reach the SSO form");
  }
  if (RETIRED_DUO_CEREMONY_LEASE_TOKENS.has(token)) {
    throw new Error("Duo ceremony lease token is retired (its lease was released or superseded); refusing to reach the SSO form");
  }
  if (expected !== undefined && token.holder.system !== expected.system) {
    throw new Error(
      `Duo ceremony lease token was minted for ${token.holder.system}, not ${expected.system}; refusing to reach the SSO form`,
    );
  }
}

/**
 * The per-acquisition gate a login recipe is handed. `defineVerifiedLoginRecipe`
 * is its ONE caller (ref execution-and-sessions §10.6): it runs the ceremony
 * half of a recipe under the credential's lease, minting nothing itself.
 */
export interface DuoCeremonyGate {
  withCeremony<Result>(run: (token: DuoCeremonyLeaseToken) => Promise<Result>): Promise<Result>;
}
