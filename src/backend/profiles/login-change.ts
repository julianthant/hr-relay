import { createHash, randomUUID } from "node:crypto";
import type { CredentialStore } from "../../models/config/credential-store.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsApplyInputSchema } from "../../models/config/protected-settings.js";
import type { ErrorCatalogCode } from "../../models/failures/error-catalog.js";
import { isRelayUsername } from "../../models/profiles/public-profile.js";
import { CredentialStoreCommitUncertainError } from "../storage/configuration/credential-store.js";
import { isPlainEmail } from "../storage/configuration/synthetic-verifier.js";
import { hasUnprovedSourceClosure } from "../storage/source-closure.js";
import type { createProfileVerifiers } from "../storage/configuration/verifier-store.js";
import { ProfileSessionRefusedError } from "./profile-errors.js";

/**
 * The Relay login is the work email and password saved as the profile's UCPath sign-in, proved against the machine verifier row.
 * A change saves both UCPath entries in one marked write, then swaps the verifier row as its commit point. A change that stops
 * between the two leaves entries that no longer prove the verifier; the old login writes itself back, on the same session's next
 * change or at the next sign-in. The store's own history decides that: only when a marked login write was the last to set both
 * entries is a restore allowed, so a later Settings set, clear or erase of either entry is never overwritten.
 */
const PURPOSES = { change: createHash("sha256").update("relay-login-change").digest("hex"), restore: createHash("sha256").update("relay-login-change-restore").digest("hex") };
type Purpose = keyof typeof PURPOSES;
const LOGIN_WRITES = new Set(Object.values(PURPOSES));

/** True when a marked login change or restore was the last write to set both UCPath entries. */
function loginWritten(store: CredentialStore): boolean {
  const writers = store.lastEntryWriters();
  return (["ucpathUserId", "ucpathPassword"] as const).every(name => writers[name]?.operation === "set" && LOGIN_WRITES.has(writers[name].commandFingerprint));
}

export type RelayLogin = { readonly email: string; readonly password: string };
export type RelayLoginChange = { readonly kind: "password"; readonly password: string } | { readonly kind: "username"; readonly email: string };
type Verifiers = ReturnType<typeof createProfileVerifiers>;

/** The change wrote the saved entries but neither committed the verifier nor put the entries back; the old login settles it. */
export class RelayLoginUnsettledError extends Error {
  constructor(options: ErrorOptions) { super("profile-login-change-unsettled", options); this.name = "RelayLoginUnsettledError"; }
}

/** The verifier could not be read back after a failed swap, so whether the change landed is unknown; nothing is undone. */
export class RelayLoginOutcomeUnknownError extends Error {
  constructor(options: ErrorOptions) { super("profile-login-change-outcome-unknown", options); this.name = "RelayLoginOutcomeUnknownError"; }
}

export type RelayLoginOutcome = { readonly kind: "changed" } | { readonly kind: "unconfirmed"; readonly failure: unknown } | { readonly kind: "refused"; readonly code: ErrorCatalogCode };

type SaveOutcome = { readonly kind: "applied" } | { readonly kind: "refused" } | { readonly kind: "uncertain"; readonly failure: unknown };

/**
 * Save both UCPath entries as `login` in one marked write. "uncertain" means the write may have landed but is not proved
 * durable: the store owns it, or its ownership could not be read back. A write whose descriptors could not be proved
 * closed throws for its owner to retain.
 */
function saveLogin(store: CredentialStore, login: RelayLogin, purpose: Purpose, at: string): SaveOutcome {
  const saved = store.read(), commandId = randomUUID();
  const entries = { ucpathUserId: { set: login.email }, ucpathPassword: { set: login.password } };
  try {
    return { kind: store.apply(ProtectedSettingsApplyInputSchema.parse({ commandId, commandFingerprint: PURPOSES[purpose], expectedRevision: saved.revision,
      protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(), updatedAt: at, entries })).state === "applied" ? "applied" : "refused" };
  } catch (error) {
    if (!(error instanceof CredentialStoreCommitUncertainError) || hasUnprovedSourceClosure(error)) throw error;
    try { return store.ownsCommandId(commandId) ? { kind: "uncertain", failure: error } : { kind: "refused" }; }
    catch (readback) { return { kind: "uncertain", failure: new AggregateError([error, readback], "profile login write ownership unreadable") }; }
  }
}

/** A login restore wrote the old login back but could not prove it durable; nothing is reported as settled. */
export class RelayLoginRestoreUncertainError extends Error {
  constructor(options: ErrorOptions) { super("profile-login-restore-uncertain", options); this.name = "RelayLoginRestoreUncertainError"; }
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
    // A new username must be one the sign-in form accepts and must change the verifier key, or a stopped change could not be told apart from a finished one.
    if (!isRelayUsername(next.email) || !isPlainEmail(next.email) || verifiers.emailKeyFor(next.email) === verifiers.emailKeyFor(email)) return refused("PROFILE_USERNAME_REFUSED");
    if (verifiers.identify(next.email) !== "unknown") return refused("PROFILE_USERNAME_TAKEN");
  }
  const verifier = verifiers.prepareLoginChange(profileId, next.email, next.password);
  const written = saveLogin(store, next, "change", fields.at);
  if (written.kind === "refused") return refused("PROFILE_LOGIN_CHANGE_BUSY");
  // The verifier is committed only over durable entries; unproved entries stay marked for the old login to settle.
  if (written.kind === "uncertain") throw new RelayLoginUnsettledError({ cause: written.failure });
  try { verifier.swap(); }
  catch (error) {
    let landed: boolean;
    // An unreadable verifier leaves the swap unknown: nothing is undone, and the old login settles it if the swap did not land.
    try { landed = verifier.landed(); }
    catch (readback) { throw new RelayLoginOutcomeUnknownError({ cause: new AggregateError([error, readback], "profile login change verifier outcome unknown") }); }
    // A swap that landed holds the new login on both sides; its failure is reported to the caller, never undone.
    if (landed) return { kind: "unconfirmed", failure: error };
    let restored: ReturnType<typeof saveLogin>;
    try { restored = saveLogin(store, prior, "restore", fields.at); }
    catch (cleanup) { throw new RelayLoginUnsettledError({ cause: new AggregateError([error, cleanup], "profile login change and its restore failed") }); }
    if (restored.kind === "refused") throw new RelayLoginUnsettledError({ cause: error });
    if (restored.kind === "uncertain") throw new RelayLoginUnsettledError({ cause: new AggregateError([error, restored.failure], "profile login change failed and its restore is unproved") });
    throw error;
  }
  return { kind: "changed" };
}

/**
 * After `proved` passed the verifier: if a login change stopped before its verifier swap, write the proved login back.
 * A saved email that still keys this profile is kept as saved; otherwise the proved email is written as sign-up would save it.
 */
export function restoreInterruptedLogin(verifiers: Verifiers, store: CredentialStore, profileId: string, proved: RelayLogin, at: string): void {
  const entries = store.read().entries, email = entries.ucpathUserId?.value, password = entries.ucpathPassword?.value;
  if (email === proved.email && password === proved.password || !loginWritten(store) || proves(verifiers, profileId, { email, password })) return;
  const owner = email === undefined ? "unknown" : verifiers.identify(email);
  const restored = email !== undefined && owner !== "unknown" && owner.profileId === profileId ? email : proved.email;
  const outcome = saveLogin(store, { email: restored, password: proved.password }, "restore", at);
  if (outcome.kind === "refused") throw new ProfileSessionRefusedError("PROFILE_LOGIN_CHANGE_BUSY");
  if (outcome.kind === "uncertain") throw new RelayLoginRestoreUncertainError({ cause: outcome.failure });
}
