// Only lease-store tokens authorize a Duo ceremony; caller claims cannot.
import type { DuoCeremonyLeaseHolder } from "../rules/sessions/duo-ceremony-lease.js";
import type { BrowserSystemId, Fingerprint, IsoInstant, PositiveInt } from "../rules/identity/ids.js";

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

/** DO NOT CALL. The lease store in `src/backend/storage/sqlite/authority-database.ts` is the only permitted caller. */
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

/** DO NOT CALL. The lease store retires a token when its lease is released or superseded. */
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

/** SSO-helper verification seam: call BEFORE touching the page; an unminted, retired, or wrong-system token throws. */
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

/** The per-acquisition gate a login recipe is handed; its one caller runs the ceremony half under the credential's lease, minting nothing itself. */
export interface DuoCeremonyGate {
  withCeremony<Result>(run: (token: DuoCeremonyLeaseToken) => Promise<Result>): Promise<Result>;
}
