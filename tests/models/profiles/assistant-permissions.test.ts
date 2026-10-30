import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { ASSISTANT_COMMAND_INVENTORY, ASSISTANT_PERMISSION_INITIAL_MODE, AssistantActionManifestSchema, AssistantModelProposalSchema, readAssistantAuthority } from "../../../src/models/profiles/assistant-permissions.js";
import { CommandActionSchema } from "../../../src/rules/commands/commands.js";

const PROFILE = "11111111-1111-4111-8111-111111111111";
const GRANT = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-10-18T17:00:00.000Z";

const GRANT_RECORD = {
  grantId: GRANT,
  profileId: PROFILE,
  policyRevision: 1,
  mode: "every-action",
  grantedAt: NOW,
};

function grantedAuthority(grant: object = GRANT_RECORD) {
  return {
    profileId: PROFILE,
    accountSessionEpoch: 1,
    policy: { revision: 1, mode: "every-action", grant },
    manifest: {
      revision: 1,
      entries: [{ family: "intake", action: "validate-intake", classification: "read", subject: "none" }],
    },
  };
}

function ungrantedAuthority() {
  return {
    profileId: PROFILE,
    accountSessionEpoch: 1,
    policy: { revision: 1, mode: "every-action" },
    manifest: grantedAuthority().manifest,
  };
}

describe("assistant permission authority", () => {
  it("names every-action as the initial mode and still refuses a missing grant", () => {
    assert.equal(ASSISTANT_PERMISSION_INITIAL_MODE, "every-action");
    const missing = readAssistantAuthority(ungrantedAuthority());
    assert.deepEqual(missing, { ok: false, code: "ASSISTANT_GRANT_REQUIRED" });
    const modeOnly = readAssistantAuthority({ mode: ASSISTANT_PERMISSION_INITIAL_MODE });
    assert.deepEqual(modeOnly, { ok: false, code: "ASSISTANT_AUTHORITY_INVALID" });
  });

  it("refuses a grant that does not match the policy, profile, or shape", () => {
    const mismatched = readAssistantAuthority(grantedAuthority({
      grantId: GRANT, profileId: PROFILE, policyRevision: 2, mode: "every-action", grantedAt: NOW,
    }));
    assert.deepEqual(mismatched, { ok: false, code: "ASSISTANT_GRANT_REQUIRED" });
    const otherProfile = readAssistantAuthority(grantedAuthority({
      grantId: GRANT,
      profileId: "33333333-3333-4333-8333-333333333333",
      policyRevision: 1,
      mode: "every-action",
      grantedAt: NOW,
    }));
    assert.deepEqual(otherProfile, { ok: false, code: "ASSISTANT_GRANT_REQUIRED" });
    assert.equal(readAssistantAuthority({ ...grantedAuthority(), extra: true }).ok, false);
    const staleEpoch = readAssistantAuthority({ ...grantedAuthority(), accountSessionEpoch: 0 });
    assert.equal(staleEpoch.ok, false);
    if (staleEpoch.ok) return;
    assert.equal(staleEpoch.code, "ASSISTANT_AUTHORITY_INVALID");
  });

  it.each(["before-submits", "without-asking"])("refuses retired saved %s grants", mode => {
    const authority = grantedAuthority({ ...GRANT_RECORD, mode });
    assert.equal(readAssistantAuthority({ ...authority, policy: { ...authority.policy, mode } }).ok, false);
  });

  it("accepts an explicit every-action grant and rejects an unclassified family pair", () => {
    const accepted = readAssistantAuthority(grantedAuthority());
    assert.equal(accepted.ok, true);
    if (!accepted.ok) return;
    assert.equal(accepted.authority.policy.mode, "every-action");
    assert.equal(AssistantActionManifestSchema.safeParse({
      revision: 1,
      entries: [{ family: "gate", action: "delete", classification: "destructive", subject: "none" }],
    }).success, false);
    assert.equal(AssistantActionManifestSchema.safeParse({
      revision: 1,
      entries: [
        { family: "intake", action: "validate-intake", classification: "read", subject: "none" },
        { family: "intake", action: "validate-intake", classification: "local-write", subject: "none" },
      ],
    }).success, false);
  });

  it("keeps every canonical command unclassified until a trusted manifest says otherwise", () => {
    assert.deepEqual(
      ASSISTANT_COMMAND_INVENTORY.map((entry) => entry.action).sort(),
      [...CommandActionSchema.options].sort(),
    );
    assert.equal(new Set(ASSISTANT_COMMAND_INVENTORY.map((entry) => `${entry.family}:${entry.action}`)).size,
      ASSISTANT_COMMAND_INVENTORY.length);
    assert.equal(ASSISTANT_COMMAND_INVENTORY.every((entry) => entry.support === "unclassified"), true);
  });

  it("rejects a model proposal that carries a mode, grant, or gate override", () => {
    const proposal = {
      commandId: "33333333-3333-4333-8333-333333333333",
      family: "intake",
      action: "validate-intake",
      target: { intakeSessionId: "44444444-4444-4444-8444-444444444444", expectedVersion: 1 },
    };
    assert.equal(AssistantModelProposalSchema.safeParse(proposal).success, true);
    assert.equal(AssistantModelProposalSchema.safeParse({ ...proposal, mode: "every-action" }).success, false);
    assert.equal(AssistantModelProposalSchema.safeParse({ ...proposal, grant: { grantId: GRANT } }).success, false);
    assert.equal(AssistantModelProposalSchema.safeParse({ ...proposal, skipExistingGates: true }).success, false);
  });
});
