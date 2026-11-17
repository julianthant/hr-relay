import { deepFreeze } from "../validation/immutability.js";

/**
 * A person's canonical credential head, derived from the head file (`machine/credential-keys/<profileId>.json`) and the
 * credential operation file (`machine/credential-operations/<profileId>.json`). Nothing stores this state: an operation
 * file beside a head is the normal prefix of a create or an erase, and an `erased` head with no operation is the tombstone.
 */
export const CREDENTIAL_HEAD_STATES = deepFreeze(["absent", "creating", "active", "erasing", "erased"] as const);
export type CredentialHeadState = (typeof CREDENTIAL_HEAD_STATES)[number];

export const CREDENTIAL_HEAD_EVENTS = deepFreeze([
  "begin-create", "publish-create", "advance-revision", "write-record", "convert",
  "begin-erase", "finish-erase", "remove-tombstone", "read",
] as const);
export type CredentialHeadEvent = (typeof CREDENTIAL_HEAD_EVENTS)[number];

/** Each refusal is the error-catalog code the store raises today for that attempt. */
export type CredentialHeadRefusal = "CREDENTIAL_BUSY" | "CREDENTIAL_CONVERSION_REQUIRED" | "CREDENTIAL_UNAVAILABLE" | "CREDENTIAL_ABANDONED_SIGNUP_HELD";
export type CredentialHeadTransition = { readonly state: CredentialHeadState } | { readonly refused: CredentialHeadRefusal };
export type CredentialHeadInconsistency = Readonly<{ inconsistent: "unparseable-head" | "erased-with-create" | "absent-with-erase" }>;

/** The parsed head file, or why there is none. */
export type CredentialHeadFile = Readonly<{ state: "active" | "erased" }> | "absent" | "unparseable";
/** The parsed operation file; `unread` is a reader that consults only the head, which therefore sees no pending operation. */
export type CredentialOperationFile = Readonly<{ kind: "create" | "erase" }> | "absent" | "unread";

const UNPARSEABLE_HEAD = deepFreeze({ inconsistent: "unparseable-head" } as const);
const ERASED_WITH_CREATE = deepFreeze({ inconsistent: "erased-with-create" } as const);
const ABSENT_WITH_ERASE = deepFreeze({ inconsistent: "absent-with-erase" } as const);

export function credentialHeadStateOf(head: CredentialHeadFile, operation: CredentialOperationFile): CredentialHeadState | CredentialHeadInconsistency {
  if (head === "unparseable") return UNPARSEABLE_HEAD;
  const pending = operation === "absent" || operation === "unread" ? undefined : operation.kind;
  if (head === "absent") return pending === undefined ? "absent" : pending === "create" ? "creating" : ABSENT_WITH_ERASE;
  if (pending === "create") return head.state === "active" ? "creating" : ERASED_WITH_CREATE;
  if (pending === "erase") return "erasing";
  return head.state;
}

const BUSY = { refused: "CREDENTIAL_BUSY" } as const;
const CONVERSION = { refused: "CREDENTIAL_CONVERSION_REQUIRED" } as const;
const UNAVAILABLE = { refused: "CREDENTIAL_UNAVAILABLE" } as const;
const HELD = { refused: "CREDENTIAL_ABANDONED_SIGNUP_HELD" } as const;
const ACTIVE = { state: "active" } as const;

/**
 * Only an absent head may begin a create and only the tombstone may be removed. A pending create or erase refuses everything
 * but its own completion as busy; a person with no head needs conversion; an erased head serves no credential.
 */
export const CREDENTIAL_HEAD_TRANSITIONS = deepFreeze({
  absent: {
    "begin-create": { state: "creating" }, "publish-create": CONVERSION, "advance-revision": CONVERSION, "write-record": CONVERSION,
    convert: CONVERSION, "begin-erase": CONVERSION, "finish-erase": CONVERSION, "remove-tombstone": HELD, read: CONVERSION,
  },
  creating: {
    "begin-create": BUSY, "publish-create": ACTIVE, "advance-revision": BUSY, "write-record": BUSY,
    convert: BUSY, "begin-erase": BUSY, "finish-erase": BUSY, "remove-tombstone": HELD, read: BUSY,
  },
  active: {
    "begin-create": CONVERSION, "publish-create": UNAVAILABLE, "advance-revision": ACTIVE, "write-record": ACTIVE,
    convert: ACTIVE, "begin-erase": { state: "erasing" }, "finish-erase": UNAVAILABLE, "remove-tombstone": HELD, read: ACTIVE,
  },
  erasing: {
    "begin-create": BUSY, "publish-create": BUSY, "advance-revision": BUSY, "write-record": BUSY,
    convert: BUSY, "begin-erase": BUSY, "finish-erase": { state: "erased" }, "remove-tombstone": HELD, read: BUSY,
  },
  erased: {
    "begin-create": CONVERSION, "publish-create": UNAVAILABLE, "advance-revision": UNAVAILABLE, "write-record": UNAVAILABLE,
    convert: UNAVAILABLE, "begin-erase": UNAVAILABLE, "finish-erase": UNAVAILABLE, "remove-tombstone": { state: "absent" }, read: UNAVAILABLE,
  },
} as const satisfies Record<CredentialHeadState, Record<CredentialHeadEvent, CredentialHeadTransition>>);

export function credentialHeadTransition(state: CredentialHeadState, event: CredentialHeadEvent): CredentialHeadTransition {
  return CREDENTIAL_HEAD_TRANSITIONS[state][event];
}
