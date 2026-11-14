import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { admitProtectedInput } from "../../../../src/backend/runs/start/protected-input.js";
import { readProfileIdentity } from "../../../../src/models/config/secrets.js";
import { valueFreeProtectedData, valueFreeProtectedInput } from "../../../../src/models/write-safety/protected-input.js";
import { separationsDescriptor } from "../../../support/helpers/registered-workflows.js";
import { protectedSecretSource } from "../../../support/helpers/protected-secret-source.js";

describe("admitted profile timekeeper input", () => {
  it("binds the full profile name without a stored timekeeper credential and keeps it out of public projections", () => {
    const source = protectedSecretSource({ profileName: "Synthetic Middle Operator" });
    const identity = readProfileIdentity(source);
    const admitted = admitProtectedInput(separationsDescriptor, [{ documentNumber: "4444" }], source)[0];
    assert.ok(admitted);
    assert.deepEqual(admitted.admitted, { documentNumber: "4444", timekeeperName: "Synthetic Middle Operator", timekeeperInitials: "SMO" });
    assert.deepEqual(admitted.bindings, [{ kind: "profile", inputPath: "timekeeperName", name: "timekeeperName", profileId: identity.profileId, sessionEpoch: identity.sessionEpoch }]);
    assert.equal(identity.initials, "SMO");
    for (const projection of [valueFreeProtectedInput(admitted.admitted, admitted.bindings), valueFreeProtectedData(admitted.admitted, admitted.bindings)]) {
      assert.equal(JSON.stringify(projection).includes(identity.displayName), false);
      assert.match(JSON.stringify(projection), /"kind":"profile"/u);
    }
  });

  it("refuses caller overrides before reading profile or private credentials", () => {
    let reads = 0;
    const source = { read: () => { reads++; throw new Error("private fixture detail"); } };
    assert.throws(() => admitProtectedInput(separationsDescriptor, [{ documentNumber: "4444", timekeeperName: "Caller override" }], source), /caller-supplied protected input timekeeperName is refused/u);
    assert.equal(reads, 0);
    assert.throws(() => admitProtectedInput(separationsDescriptor, [{ documentNumber: "4444" }], source), /^SecretSourceError: admitted profile identity is unreadable$/u);
    assert.equal(reads, 1);
  });

  it("refuses missing profile identity instead of inventing a signer", () => {
    assert.throws(() => admitProtectedInput(separationsDescriptor, [{ documentNumber: "4444" }], protectedSecretSource()), /admitted profile identity is unavailable/u);
    assert.throws(() => admitProtectedInput(separationsDescriptor, [{ documentNumber: "4444" }]), /profile is unavailable/u);
  });

  it("admits the stored initials beside the name from one profile read, under the one name binding", () => {
    const source = protectedSecretSource({ profileName: "Lex Rivers", profileInitials: "QZ" });
    const admitted = admitProtectedInput(separationsDescriptor, [{ documentNumber: "4444" }], source)[0];
    assert.ok(admitted);
    assert.deepEqual(admitted.admitted, { documentNumber: "4444", timekeeperName: "Lex Rivers", timekeeperInitials: "QZ" });
    assert.equal(admitted.bindings.length, 1);
    assert.equal(admitted.bindings[0]?.inputPath, "timekeeperName");
    assert.equal(admitted.bindings[0]?.kind, "profile");
  });

  it("refuses caller-supplied initials", () => {
    const source = protectedSecretSource({ profileName: "Lex Rivers", profileInitials: "QZ" });
    assert.throws(() => admitProtectedInput(separationsDescriptor, [{ documentNumber: "4444", timekeeperInitials: "AB" }], source),
      /caller-supplied protected input timekeeperInitials is refused/u);
  });

  it("refuses a start whose stored initials are missing or not 1-8 letters A-Z, with a stated reason", () => {
    const source = (initials: string) => protectedSecretSource({ profileName: "Lex Rivers", profileInitials: initials });
    assert.throws(() => admitProtectedInput(separationsDescriptor, [{ documentNumber: "4444" }], source("")), /admitted profile identity is unreadable/u);
    for (const initials of ["q1", "ABCDEFGHI"]) {
      assert.throws(() => admitProtectedInput(separationsDescriptor, [{ documentNumber: "4444" }], source(initials)),
        /protected input timekeeperInitials is refused: the profile's stored Timekeeper initials are not 1-8 letters A-Z/u, initials);
    }
  });
});
