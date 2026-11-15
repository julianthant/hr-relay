import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  ASSISTANT_COMMAND_INVENTORY,
  AssistantActionManifestSchema,
  AssistantModelProposalSchema,
  readAssistantAuthority,
} from "../../../src/models/profiles/assistant-permissions.js";
import { CommandActionSchema } from "../../../src/rules/commands/commands.js";

const PROFILE = "11111111-1111-4111-8111-111111111111";
const AUTHORITY = {
  profileId: PROFILE,
  accountSessionEpoch: 1,
  manifest: {
    revision: 1,
    entries: [{ family: "intake", action: "validate-intake", classification: "read", subject: "none" }],
  },
};

describe("assistant permission authority", () => {
  it("reads the signed-in person and manifest, and refuses anything else", () => {
    const accepted = readAssistantAuthority(AUTHORITY);
    assert.equal(accepted.ok, true);
    for (const invalid of [{ ...AUTHORITY, extra: true }, { ...AUTHORITY, accountSessionEpoch: 0 },
      { ...AUTHORITY, policy: { revision: 1, mode: "every-action" } }, { mode: "every-action" }]) {
      assert.deepEqual(readAssistantAuthority(invalid), { ok: false, code: "ASSISTANT_AUTHORITY_INVALID" });
    }
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
    assert.equal(AssistantModelProposalSchema.safeParse({ ...proposal, grant: { grantId: PROFILE } }).success, false);
    assert.equal(AssistantModelProposalSchema.safeParse({ ...proposal, skipExistingGates: true }).success, false);
  });
});
