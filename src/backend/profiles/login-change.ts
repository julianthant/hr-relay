import { createHash, randomUUID } from "node:crypto";
import type { CredentialStore } from "../../models/config/credential-store.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsApplyInputSchema } from "../../models/config/protected-settings.js";
import type { ErrorCatalogCode } from "../../models/failures/error-catalog.js";
import { CredentialStoreCommitUncertainError } from "../storage/configuration/credential-store.js";
import { isPlainEmail } from "../storage/configuration/synthetic-verifier.js";
import { hasUnprovedSourceClosure } from "../storage/source-closure.js";
import type { createProfileVerifiers } from "../storage/configuration/verifier-store.js";
import { ProfileSessionRefusedError } from "./profile-errors.js";

/**
 * The Relay login is the work email and password saved as the profile's UCPath sign-in, proved against the machine verifier row.
 * A change saves the entries under CHANGE, then swaps the verifier row as its commit point. A change that stops between the two
 * leaves the marked entries no longer proving the verifier; the old login writes itself back, on the same session's next change
 * or at the next sign-in.
 */
const CHANGE = createHash("sha256").update("relay-login-change").digest("hex");
const RESTORE = createHash("sha256").update("relay-login-change-restore").digest("hex");

export type RelayLogin = { readonly email: string; readonly password: string };
export type RelayLoginChange = { readonly kind: "password"; readonly password: string } | { readonly kind: "username"; readonly email: string };
type Verifiers = ReturnType<typeof createProfileVerifiers>;

/** The change wrote the saved entries but neither committed the verifier nor put the entries back; the old login settles it. */
export class RelayLoginUnsettledError extends Error {
  constructor(options: ErrorOptions) { super("profile-login-change-unsettled", options); this.name = "RelayLoginUnsettledError"; }
}

export type RelayLoginOutcome = { readonly kind: "changed" } | { readonly kind: "unconfirmed"; readonly failure: unknown } | { readonly kind: "refused"; readonly code: ErrorCatalogCode };

/**
 * Save the entries that differ from `login`. "uncertain" means the store owns the write but could not prove it durable;
 * a write whose descriptors could not be proved closed throws for its owner to retain.
 */
function saveLogin(store: CredentialStore, login: RelayLogin, fingerprint: string, at: string): "applied" | "uncertain" | "refused" {
  const saved = store.read();
  const entries = {
    ...(saved.entries.ucpathUserId?.value === login.email ? {} : { ucpathUserId: { set: login.email } }),
    ...(saved.entries.ucpathPassword?.value === login.password ? {} : { ucpathPassword: { set: login.password } }),
  };
  if (Object.keys(entries).length === 0) return "applied";
  const commandId = randomUUID();
  try {
    return store.apply(ProtectedSettingsApplyInputSchema.parse({ commandId, commandFingerprint: fingerprint, expectedRevision: saved.revision,
      protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(), updatedAt: at, entries })).state === "applied" ? "applied" : "refused";
  } catch (error) {
    if (!(error instanceof CredentialStoreCommitUncertainError) || hasUnprovedSourceClosure(error)) throw error;
    return store.ownsCommandId(commandId) ? "uncertain" : "refused";
  }
}

function proves(verifiers: Verifiers, profileId: string, login: Partial<RelayLogin>): boolean {
  const owner = login.email === undefined ? "unknown" : verifiers.identify(login.email);
  return owner !== "unknown" && owner.profileId === profileId && login.password !== undefined && verifiers.passwordMatches(profileId, login.password);
}

/** Change one profile's login. The caller holds the profile lock and a live session, and retains any unproved closure it receives. */
export function changeRelayLogin(verifiers: Verifiers, store: CredentialStore, profileId: string,
  fields: { readonly currentPassword: string; readonly change: RelayLoginChange; readonly at: string }): RelayLoginOutcome {
  const nowMs = Date.parse(fields.at);
  const refused = (code: ErrorCatalogCode) => ({ kind: "refused" as const, code });
  if (verifiers.locked(profileId, nowMs)) return refused("PROFILE_CURRENT_PASSWORD_REFUSED");
  if (!verifiers.passwordMatches(profileId, fields.currentPassword)) {
    verifiers.recordFailure(profileId, nowMs);
    return refused("PROFILE_CURRENT_PASSWORD_REFUSED");
  }
  const saved = store.read().entries, email = saved.ucpathUserId?.value;
  if (email === undefined || saved.ucpathPassword?.value !== fields.currentPassword || !proves(verifiers, profileId, { email, password: fields.currentPassword })) return refused("PROFILE_AUTHORITY_UNAVAILABLE");
  const prior = { email, password: fields.currentPassword };
  const next = fields.change.kind === "password" ? { email, password: fields.change.password } : { email: fields.change.email, password: fields.currentPassword };
  if (fields.change.kind === "username") {
    // A new username must change the verifier key, or a stopped change could not be told apart from a finished one.
    if (next.email !== next.email.trim() || !isPlainEmail(next.email) || verifiers.emailKeyFor(next.email) === verifiers.emailKeyFor(email)) return refused("PROFILE_USERNAME_REFUSED");
    if (verifiers.identify(next.email) !== "unknown") return refused("PROFILE_USERNAME_TAKEN");
  }
  const verifier = verifiers.prepareLoginChange(profileId, next.email, next.password);
  const written = saveLogin(store, next, CHANGE, fields.at);
  if (written === "refused") return refused("PROFILE_LOGIN_CHANGE_BUSY");
  // The verifier is committed only over durable entries; unproved entries stay marked for the old login to settle.
  if (written === "uncertain") throw new RelayLoginUnsettledError({ cause: new Error("profile-login-change-entries-unproved") });
  try { verifier.commit(); }
  catch (error) {
    // A swap that landed holds the new login on both sides; its failure is reported to the caller, never undone.
    if (verifier.landed()) return { kind: "unconfirmed", failure: error };
    let restored: ReturnType<typeof saveLogin>;
    try { restored = saveLogin(store, prior, RESTORE, fields.at); }
    catch (cleanup) { throw new RelayLoginUnsettledError({ cause: new AggregateError([error, cleanup], "profile login change and its restore failed") }); }
    if (restored === "refused") throw new RelayLoginUnsettledError({ cause: error });
    throw error;
  }
  return { kind: "changed" };
}

/**
 * After `proved` passed the verifier: if a login change stopped before its verifier swap, write the proved login back.
 * A saved email that still keys this profile is kept as saved; otherwise the proved email is written as sign-up would save it.
 */
export function restoreInterruptedLogin(verifiers: Verifiers, store: CredentialStore, profileId: string, proved: RelayLogin, at: string): void {
  const record = store.read(), fingerprint = record.lastApplied?.commandFingerprint;
  if (fingerprint !== CHANGE && fingerprint !== RESTORE) return;
  const email = record.entries.ucpathUserId?.value, password = record.entries.ucpathPassword?.value;
  if (email === proved.email && password === proved.password || proves(verifiers, profileId, { email, password })) return;
  const owner = email === undefined ? "unknown" : verifiers.identify(email);
  const restored = email !== undefined && owner !== "unknown" && owner.profileId === profileId ? email : proved.email;
  if (saveLogin(store, { email: restored, password: proved.password }, RESTORE, at) === "refused") throw new ProfileSessionRefusedError("PROFILE_LOGIN_CHANGE_BUSY");
}
