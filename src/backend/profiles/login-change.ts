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

// These fingerprints identify the last writers of both entries in a pre-upgrade interrupted change.
const PURPOSES = { change: createHash("sha256").update("relay-login-change").digest("hex"), restore: createHash("sha256").update("relay-login-change-restore").digest("hex") };
const LOGIN_WRITES = new Set(Object.values(PURPOSES));

/** True when a marked login change or restore was the last write to set both UCPath entries. */
function loginWritten(store: CredentialStore): boolean {
  const writers = store.lastEntryWriters();
  return (["ucpathUserId", "ucpathPassword"] as const).every(name => writers[name]?.operation === "set" && LOGIN_WRITES.has(writers[name].commandFingerprint));
}

export type RelayLogin = { readonly email: string; readonly password: string };
export type RelayLoginChange = { readonly kind: "password"; readonly password: string } | { readonly kind: "username"; readonly email: string };
type Verifiers = ReturnType<typeof createProfileVerifiers>;

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
function saveLogin(store: CredentialStore, login: RelayLogin, at: string): SaveOutcome {
  const saved = store.read(), commandId = randomUUID();
  const entries = { ucpathUserId: { set: login.email }, ucpathPassword: { set: login.password } };
  try {
    return { kind: store.apply(ProtectedSettingsApplyInputSchema.parse({ commandId, commandFingerprint: PURPOSES.restore, expectedRevision: saved.revision,
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
export function changeRelayLogin(verifiers: Verifiers, profileId: string, relayEmail: string,
  fields: { readonly currentPassword: string; readonly change: RelayLoginChange; readonly at: string }): RelayLoginOutcome {
  const nowMs = Date.parse(fields.at);
  const refused = (code: ErrorCatalogCode) => ({ kind: "refused" as const, code });
  if (verifiers.locked(profileId, nowMs)) return refused("PROFILE_CURRENT_PASSWORD_REFUSED");
  if (!verifiers.passwordMatches(profileId, fields.currentPassword)) {
    verifiers.recordFailure(profileId, nowMs);
    return refused("PROFILE_CURRENT_PASSWORD_REFUSED");
  }
  const change = fields.change;
  if (change.kind === "username") {
    if (!isRelayUsername(change.email) || !isPlainEmail(change.email)) return refused("PROFILE_USERNAME_REFUSED");
    const owner = verifiers.identify(change.email);
    if (owner !== "unknown") return refused(owner.profileId === profileId ? "PROFILE_USERNAME_REFUSED" : "PROFILE_USERNAME_TAKEN");
  }
  const verifier = change.kind === "username"
    ? verifiers.prepareLoginChange(profileId, change.email, fields.currentPassword, "username")
    : verifiers.prepareLoginChange(profileId, relayEmail, change.password, "password");
  try { verifier.swap(); }
  catch (error) {
    let landed: boolean;
    try { landed = verifier.landed(); }
    catch (readback) { throw new RelayLoginOutcomeUnknownError({ cause: new AggregateError([error, readback], "profile login change verifier outcome unknown") }); }
    if (landed) return { kind: "unconfirmed", failure: error };
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
  const outcome = saveLogin(store, { email: restored, password: proved.password }, at);
  if (outcome.kind === "refused") throw new ProfileSessionRefusedError("PROFILE_LOGIN_CHANGE_BUSY");
  if (outcome.kind === "uncertain") throw new RelayLoginRestoreUncertainError({ cause: outcome.failure });
}
