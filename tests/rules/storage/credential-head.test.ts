import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_HEAD_EVENTS,
  CREDENTIAL_HEAD_STATES,
  CREDENTIAL_HEAD_TRANSITIONS,
  credentialHeadStateOf,
  credentialHeadTransition,
  type CredentialHeadEvent,
  type CredentialHeadFile,
  type CredentialHeadState,
  type CredentialOperationFile,
} from "../../../src/rules/storage/credential-head.js";

/** Written by hand from the canonical credential store's write and read sites; it is the specification the table must reproduce. */
const BUSY = { refused: "CREDENTIAL_BUSY" } as const;
const CONVERSION = { refused: "CREDENTIAL_CONVERSION_REQUIRED" } as const;
const UNAVAILABLE = { refused: "CREDENTIAL_UNAVAILABLE" } as const;
const HELD = { refused: "CREDENTIAL_ABANDONED_SIGNUP_HELD" } as const;
const expected: Record<CredentialHeadState, Record<CredentialHeadEvent, unknown>> = {
  absent: {
    "begin-create": { state: "creating" }, "publish-create": CONVERSION, "advance-revision": CONVERSION, "write-record": CONVERSION,
    convert: CONVERSION, "begin-erase": CONVERSION, "finish-erase": CONVERSION, "remove-tombstone": HELD, read: CONVERSION,
  },
  creating: {
    "begin-create": BUSY, "publish-create": { state: "active" }, "advance-revision": BUSY, "write-record": BUSY,
    convert: BUSY, "begin-erase": BUSY, "finish-erase": BUSY, "remove-tombstone": HELD, read: BUSY,
  },
  active: {
    "begin-create": CONVERSION, "publish-create": UNAVAILABLE, "advance-revision": { state: "active" }, "write-record": { state: "active" },
    convert: { state: "active" }, "begin-erase": { state: "erasing" }, "finish-erase": UNAVAILABLE, "remove-tombstone": HELD, read: { state: "active" },
  },
  erasing: {
    "begin-create": BUSY, "publish-create": BUSY, "advance-revision": BUSY, "write-record": BUSY,
    convert: BUSY, "begin-erase": BUSY, "finish-erase": { state: "erased" }, "remove-tombstone": HELD, read: BUSY,
  },
  erased: {
    "begin-create": CONVERSION, "publish-create": UNAVAILABLE, "advance-revision": UNAVAILABLE, "write-record": UNAVAILABLE,
    convert: UNAVAILABLE, "begin-erase": UNAVAILABLE, "finish-erase": UNAVAILABLE, "remove-tombstone": { state: "absent" }, read: UNAVAILABLE,
  },
};

describe("canonical credential head transition table", () => {
  it("declares exactly the five head states and nine events", () => {
    expect([...CREDENTIAL_HEAD_STATES]).toEqual(["absent", "creating", "active", "erasing", "erased"]);
    expect([...CREDENTIAL_HEAD_EVENTS]).toEqual(["begin-create", "publish-create", "advance-revision", "write-record", "convert",
      "begin-erase", "finish-erase", "remove-tombstone", "read"]);
    expect(Object.keys(CREDENTIAL_HEAD_TRANSITIONS).sort()).toEqual([...CREDENTIAL_HEAD_STATES].sort());
    expect(Object.isFrozen(CREDENTIAL_HEAD_TRANSITIONS.active)).toBe(true);
  });

  for (const state of CREDENTIAL_HEAD_STATES) {
    for (const event of CREDENTIAL_HEAD_EVENTS) {
      it(`${state} on ${event}`, () => {
        expect(credentialHeadTransition(state, event)).toEqual(expected[state][event]);
      });
    }
  }
});

const active = { state: "active" } as const, erased = { state: "erased" } as const;
const create = { kind: "create" } as const, erase = { kind: "erase" } as const;
const heads: Record<string, CredentialHeadFile> = { absent: "absent", active, erased, unparseable: "unparseable" };
const operations: Record<string, CredentialOperationFile> = { absent: "absent", create, erase, unread: "unread" };
const derived: Record<string, Record<string, unknown>> = {
  absent: { absent: "absent", create: "creating", erase: { inconsistent: "absent-with-erase" }, unread: "absent" },
  active: { absent: "active", create: "creating", erase: "erasing", unread: "active" },
  erased: { absent: "erased", create: { inconsistent: "erased-with-create" }, erase: "erasing", unread: "erased" },
  unparseable: { absent: { inconsistent: "unparseable-head" }, create: { inconsistent: "unparseable-head" },
    erase: { inconsistent: "unparseable-head" }, unread: { inconsistent: "unparseable-head" } },
};

describe("canonical credential head state derivation", () => {
  for (const [headName, head] of Object.entries(heads)) {
    for (const [operationName, operation] of Object.entries(operations)) {
      it(`a ${headName} head beside a ${operationName} operation file`, () => {
        expect(credentialHeadStateOf(head, operation)).toEqual(derived[headName]?.[operationName]);
      });
    }
  }
});
