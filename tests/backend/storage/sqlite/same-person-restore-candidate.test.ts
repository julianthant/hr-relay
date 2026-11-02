import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { it, vi } from "vitest";
import { AuthoritySourceClosureUnprovedError } from "../../../../src/backend/storage/source-closure.js";
import { validateSamePersonRestoreCandidate } from "../../../../src/backend/storage/sqlite/same-person-restore-candidate.js";

const boundary = vi.hoisted((): { failure: unknown; retain: ReturnType<typeof vi.fn>; stateRoot: string } => ({ failure: undefined, retain: vi.fn(), stateRoot: "" }));
vi.mock("../../../../src/backend/storage/admission/admission-identity.js", () => ({ requireRuntimeAdmission: () => ({
  profileBinding: { installationId: "installation", profileId: "person" },
  readInstallationContext: () => ({ locator: { installationId: "installation", stateRoot: boundary.stateRoot } }),
  retainSourceClosure: boundary.retain,
}) }));
vi.mock("../../../../src/backend/storage/sqlite/profile-local-databases.js", () => ({
  assertProfileRestoreDatabaseBinding: () => { throw boundary.failure; },
}));

it.each([false, true])("preserves the binding refusal and retains only unproved source closure (uncertain: %s)", uncertain => {
  const primary = new Error("mock binding or descriptor refusal");
  const failure = uncertain ? new AuthoritySourceClosureUnprovedError([primary]) : primary;
  boundary.failure = failure; boundary.retain.mockClear(); boundary.stateRoot = join(tmpdir(), "mock-restore-candidate");
  assert.throws(() => Reflect.apply(validateSamePersonRestoreCandidate, undefined, [{
    admission: {}, activeAuthorityPath: join(boundary.stateRoot, "profiles", "person", "state.db"), verifiedBackup: undefined,
  }]), error => error === failure);
  assert.equal(boundary.retain.mock.calls.length, uncertain ? 1 : 0);
  if (uncertain) assert.equal(boundary.retain.mock.calls[0]?.[0], failure);
});
