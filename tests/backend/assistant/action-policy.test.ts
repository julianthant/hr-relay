import { deriveRawSettingsPatchFingerprint } from "../../../src/models/config/settings.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { checkAssistantAction } from "../../../src/backend/assistant/action-policy.js";
import type { AssistantApprovalBinding, AssistantDecision } from "../../../src/models/profiles/assistant-permissions.js";

const PROFILE = "11111111-1111-4111-8111-111111111111";
const OTHER_PROFILE = "99999999-9999-4999-8999-999999999999";
const GRANT = "22222222-2222-4222-8222-222222222222";
const COMMAND = "33333333-3333-4333-8333-333333333333";
const INTAKE = "44444444-4444-4444-8444-444444444444";
const RUN = "55555555-5555-4555-8555-555555555555";
const NOTIFICATION = "66666666-6666-4666-8666-666666666666";
const PLAN = "77777777-7777-4777-8777-777777777777";
const INSTALL = "88888888-8888-4888-8888-888888888888";
const WRITE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = "2026-10-18T17:00:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const ENTRIES = [
  { family: "intake", action: "validate-intake", classification: "local-write", subject: "none" },
  { family: "notification", action: "notification-read", classification: "local-write", subject: "none" },
  { family: "settings", action: "apply-settings", classification: "local-write", subject: "none" },
  { family: "settings", action: "apply-protected-settings", classification: "destructive", subject: "none" },
  { family: "run", action: "delete", classification: "destructive", subject: "none" },
  { family: "storage-relocation", action: "plan-storage-relocation", classification: "local-write", subject: "none" },
  { family: "intake", action: "correct-intake-row", classification: "local-write", subject: "none" },
  { family: "intake", action: "inspect-intake", classification: "local-write", subject: "classified" },
  { family: "worker-browser", action: "spawn-worker", classification: "external-submit", subject: "none" },
  { family: "failure-resolution", action: "annotate-failure", classification: "local-write", subject: "none" },
  { family: "gate", action: "resolve-gate", classification: "external-submit", subject: "none" },
] as const;

function authority(mode = "before-submits", revision = 1, epoch = 1) {
  return {
    profileId: PROFILE,
    accountSessionEpoch: epoch,
    policy: {
      revision,
      mode,
      grant: { grantId: GRANT, profileId: PROFILE, policyRevision: revision, mode, grantedAt: NOW },
    },
    manifest: { revision: 1, entries: ENTRIES },
  };
}

const envelope = {
  commandId: COMMAND,
  requestedAt: NOW,
  requestedBy: "local-operator",
  source: "dashboard",
};

function commands() {
  return {
    read: {
      ...envelope, family: "intake", type: "validate-intake",
      target: { intakeSessionId: INTAKE, expectedVersion: 1 },
    },
    local: {
      ...envelope, family: "notification", type: "notification-read",
      target: { notificationId: NOTIFICATION, actorId: "local-operator", expectedVersion: 1 },
    },
    write: {
      ...envelope, family: "settings", type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: { settingsSchemaHash: HASH_A, patchFingerprint: HASH_B, patch: { "browser.headless": { set: false } } },
    },
    destructive: { ...envelope, family: "run", type: "delete", target: { runId: RUN, expectedVersion: 1 } },
    start: {
      ...envelope, family: "start", type: "start-run",
      target: { workflowId: "person-lookup", startPlanId: PLAN, expectedVersion: 1 },
      payload: {
        descriptorFingerprint: HASH_A, configFingerprint: HASH_B, ingressSchemaHash: HASH_A,
        canonicalInputSchemaHash: HASH_B, inputFingerprint: HASH_A,
      },
    },
    unbound: {
      ...envelope, family: "intake", type: "correct-intake-row",
      target: { intakeSessionId: INTAKE, expectedVersion: 1 },
      payload: { sourceRow: 1, field: "rowNote", correctedValue: "synthetic-text" },
    },
    storage: {
      ...envelope, family: "storage-relocation", type: "plan-storage-relocation",
      target: {
        installationId: INSTALL, sourceGeneration: 1, expectedRevision: 0,
        sourcePair: { stateRoot: "/source/state", artifactRoot: "/source/artifacts" },
      },
      payload: {
        writeId: WRITE,
        desiredPair: { stateRoot: "/target/state", artifactRoot: "/target/artifacts" },
        desiredDigest: HASH_A,
        requestFingerprint: HASH_B,
      },
    },
    secret: {
      ...envelope, family: "settings", type: "apply-protected-settings",
      target: { expectedRevision: 1 },
      payload: {
        protectedSchemaHash: HASH_A,
        writeId: WRITE,
        entries: { ucpathPassword: { set: "synthetic-password-value" } },
      },
    },
    spawn: {
      ...envelope, family: "worker-browser", type: "spawn-worker",
      target: { workflowId: "person-lookup", expectedVersion: 1 },
      payload: { workerId: "worker-1" },
    },
    reopen: {
      ...envelope, family: "failure-resolution", type: "annotate-failure",
      target: { runId: RUN, failureId: PLAN, expectedVersion: 1 },
      payload: { action: "reopen" },
    },
    sheet: {
      ...envelope, family: "intake", type: "inspect-intake",
      target: { intakeSessionId: INTAKE, expectedVersion: 1 },
      payload: { sheet: "Roster" },
    },
    gate: {
      ...envelope, family: "gate", type: "resolve-gate",
      target: { runId: RUN, gateId: "queue-gate", expectedVersion: 1 },
      payload: {
        result: {
          schemaHash: HASH_A,
          value: { timekeeperName: "alex", keyHex: HASH_B, keyGeneration: "activity-person-1", emplId: 42 },
        },
      },
    },
    classifiedRead: {
      ...envelope, family: "intake", type: "inspect-intake",
      target: { intakeSessionId: INTAKE, expectedVersion: 1 },
      payload: { headerRowIndex: 1 },
    },
  };
}

function proposalOf(command: { commandId: string; family: string; type: string; target: unknown }) {
  return { commandId: command.commandId, family: command.family, action: command.type, target: command.target };
}

function resolved(command: unknown, patch: Record<string, unknown> = {}) {
  return {
    profileId: PROFILE,
    accountSessionEpoch: 1,
    command,
    subject: { kind: "none" },
    cancelled: false,
    checkOutcome: { state: "none" },
    ...patch,
  };
}

function decide(command: { commandId: string; family: string; type: string; target: unknown }, overrides: Record<string, unknown> = {}) {
  return checkAssistantAction({
    phase: "prepare",
    authority: authority(),
    proposal: proposalOf(command),
    resolved: resolved(command),
    ...overrides,
  });
}

function bindingOf(decision: AssistantDecision): AssistantApprovalBinding {
  assert.notEqual(decision.state, "refused");
  if (decision.state === "refused") throw new Error("refused");
  return decision.binding;
}

describe("assistant action policy", () => {
  it("requires approval for every action, only submits and destructive actions, or no assistant prompt", () => {
    const sample = commands();
    const table = [
      ["every-action", sample.read, "approval-required"],
      ["every-action", sample.local, "approval-required"],
      ["every-action", sample.write, "approval-required"],
      ["every-action", sample.destructive, "approval-required"],
      ["before-submits", sample.read, "assistant-clear"],
      ["before-submits", sample.local, "assistant-clear"],
      ["before-submits", sample.write, "assistant-clear"],
      ["before-submits", sample.destructive, "approval-required"],
      ["without-asking", sample.read, "assistant-clear"],
      ["without-asking", sample.local, "assistant-clear"],
      ["without-asking", sample.write, "assistant-clear"],
      ["without-asking", sample.destructive, "assistant-clear"],
    ] as const;
    for (const [mode, command, expected] of table) {
      const decision = decide(command, { authority: authority(mode) });
      assert.equal(decision.state, expected, `${mode} ${command.type}`);
      assert.equal(decision.existingAppGates, "unchanged");
      assert.equal("allow" in decision, false);
    }
  });

  it("honors a stronger trusted manifest label before submits", () => {
    const command = commands().write;
    const entries = ENTRIES.map((entry) => entry.action === "apply-settings"
      ? { ...entry, classification: "external-submit" as const }
      : entry);
    const decision = decide(command, {
      authority: { ...authority(), manifest: { revision: 1, entries } },
    });
    assert.equal(decision.state, "approval-required");
    assert.equal(decision.existingAppGates, "unchanged");
  });

  it("does not treat a missing authority or an unclassified action as a read", () => {
    const sample = commands();
    const missing = checkAssistantAction({
      phase: "prepare",
      proposal: proposalOf(sample.read),
      resolved: resolved(sample.read),
    });
    assert.equal(missing.state, "refused");
    if (missing.state === "refused") assert.equal(missing.code, "ASSISTANT_AUTHORITY_INVALID");
    const bare = decide(sample.read, { authority: { mode: "before-submits" } });
    assert.equal(bare.state, "refused");
    if (bare.state === "refused") assert.notEqual(bare.code, undefined);
    for (const mode of ["every-action", "before-submits", "without-asking"]) {
      const decision = decide(sample.start, { authority: authority(mode) });
      assert.equal(decision.state, "refused");
      if (decision.state === "refused") assert.equal(decision.code, "ASSISTANT_UNCLASSIFIED");
    }
  });

  it("refuses unbound freeform options and does not copy a protected value into the binding", () => {
    const sample = commands();
    const unbound = decide(sample.unbound);
    assert.equal(unbound.state, "refused");
    if (unbound.state === "refused") assert.equal(unbound.code, "ASSISTANT_OPTIONS_UNBOUND");
    assert.equal(JSON.stringify(unbound).includes("synthetic-text"), false);
    const secret = decide(sample.secret);
    assert.equal(secret.state, "refused");
    if (secret.state === "refused") assert.equal(secret.code, "ASSISTANT_OPTIONS_UNBOUND");
    assert.equal(JSON.stringify(secret).includes("synthetic-password-value"), false);
    const swapped = {
      ...sample.secret,
      payload: { ...sample.secret.payload, entries: { ucpathPassword: { set: "synthetic-password-other" } } },
    };
    const swappedDecision = decide(swapped, { approval: { kind: "existing-fingerprint", fingerprint: HASH_B } });
    assert.equal(swappedDecision.state, "refused");
    if (swappedDecision.state === "refused") assert.equal(swappedDecision.code, "ASSISTANT_OPTIONS_UNBOUND");
    const spawn = decide(sample.spawn);
    assert.equal(spawn.state, "approval-required");
    const reopen = decide(sample.reopen);
    assert.equal(reopen.state, "assistant-clear");
    const sheet = decide(sample.sheet, {
      resolved: resolved(sample.sheet, {
        subject: { kind: "catalog", catalogKey: "queue-row", bindingDigest: HASH_A },
      }),
    });
    assert.equal(sheet.state, "assistant-clear");
    const gate = decide(sample.gate);
    assert.equal(gate.state, "refused");
    if (gate.state === "refused") assert.equal(gate.code, "ASSISTANT_OPTIONS_UNBOUND");
    const gateText = JSON.stringify(gate);
    assert.equal(gateText.includes("alex"), false);
    assert.equal(gateText.includes("activity-person-1"), false);
    assert.equal(gateText.includes(HASH_B), false);
    const storage = decide(sample.storage);
    assert.equal(storage.state, "assistant-clear");
    if (storage.state === "assistant-clear") assert.equal(storage.binding.options.kind, "existing-fingerprint");
  });

  it("matches an exact approval and rejects a caller or model override", () => {
    const sample = commands();
    const required = decide(sample.write);
    const binding = bindingOf(required);
    const allowed = decide(sample.write, { approval: binding });
    assert.equal(allowed.state, "assistant-clear");
    assert.equal(allowed.existingAppGates, "unchanged");
    const escalated = decide(sample.write, {
      proposal: { ...proposalOf(sample.write), skipExistingGates: true, mode: "without-asking" },
    });
    assert.equal(escalated.state, "refused");
    if (escalated.state === "refused") assert.equal(escalated.code, "ASSISTANT_MODEL_PROPOSAL_REFUSED");
    const forced = decide(sample.read, { resolved: { ...resolved(sample.read), overrideExistingGates: true } });
    assert.equal(forced.state, "refused");
    if (forced.state === "refused") assert.equal(forced.code, "ASSISTANT_AUTHORITY_INVALID");
  });

  it("rechecks the resolved action before preparation and dispatch", () => {
    const sample = commands();
    const prepared = checkAssistantAction({
      phase: "prepare",
      authority: authority("every-action"),
      proposal: { ...proposalOf(sample.read), commandId: RUN },
      resolved: resolved(sample.read),
    });
    assert.equal(prepared.state, "refused");
    if (prepared.state === "refused") {
      assert.equal(prepared.code, "ASSISTANT_PROPOSAL_MISMATCH");
      assert.equal(prepared.phase, "prepare");
    }
    const binding = bindingOf(decide(sample.read, { authority: authority("every-action") }));
    const dispatched = checkAssistantAction({
      phase: "dispatch",
      authority: authority("every-action", 1, 2),
      proposal: proposalOf(sample.read),
      resolved: resolved(sample.read, { accountSessionEpoch: 2 }),
      approval: binding,
    });
    assert.equal(dispatched.state, "refused");
    if (dispatched.state === "refused") {
      assert.equal(dispatched.field, "epoch");
      assert.equal(dispatched.phase, "dispatch");
    }
  });

  it("stales an approval when profile, policy, manifest, target, subject, options, or config changes", () => {
    const sample = commands();
    const readBinding = bindingOf(decide(sample.read, { authority: authority("every-action") }));
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ approval: { ...readBinding, profileId: OTHER_PROFILE } }, "profile"],
      [{ approval: { ...readBinding, accountSessionEpoch: 2 } }, "epoch"],
      [{ authority: authority("every-action", 2), approval: readBinding }, "policy"],
      [{ approval: { ...readBinding, grantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } }, "grant"],
      [{ approval: { ...readBinding, manifestRevision: 2 } }, "manifest"],
      [{ approval: { ...readBinding, classification: "destructive" } }, "manifest"],
      [{ approval: { ...readBinding, commandId: RUN } }, "command"],
      [{ approval: { ...readBinding, target: { ...sample.read.target, expectedVersion: 2 } } }, "target"],
      [{ approval: { ...readBinding, options: { kind: "existing-fingerprint", fingerprint: HASH_B } } }, "options"],
      [{ approval: { ...readBinding, configDescriptor: { kind: "present", descriptorFingerprint: HASH_B } } }, "configDescriptor"],
    ];
    for (const [overrides, field] of cases) {
      const decision = decide(sample.read, { authority: authority("every-action"), ...overrides });
      assert.equal(decision.state, "refused", field);
      if (decision.state === "refused") assert.equal(decision.field, field, field);
    }
    const subject = {
      kind: "catalog" as const,
      catalogKey: "queue-row",
      bindingDigest: HASH_A,
    };
    const missingSubject = decide(sample.classifiedRead);
    assert.equal(missingSubject.state, "refused");
    if (missingSubject.state === "refused") assert.equal(missingSubject.code, "ASSISTANT_SUBJECT_MISMATCH");
    const classified = decide(sample.classifiedRead, {
      authority: authority("every-action"),
      resolved: resolved(sample.classifiedRead, { subject }),
    });
    const classifiedBinding = bindingOf(classified);
    const staleSubject = decide(sample.classifiedRead, {
      authority: authority("every-action"),
      resolved: resolved(sample.classifiedRead, { subject }),
      approval: { ...classifiedBinding, subject: { kind: "none" } },
    });
    assert.equal(staleSubject.state, "refused");
    if (staleSubject.state === "refused") assert.equal(staleSubject.field, "subject");
    const moved = {
      ...sample.storage,
      payload: {
        ...sample.storage.payload,
        desiredPair: { stateRoot: "/target/other", artifactRoot: "/target/artifacts" },
      },
    };
    const stored = bindingOf(decide(sample.storage, { authority: authority("every-action") }));
    const staleOptions = decide(moved, { authority: authority("every-action"), approval: stored });
    assert.equal(staleOptions.state, "refused");
    if (staleOptions.state === "refused") assert.equal(staleOptions.field, "options");
  });

  it("invalidates a pending approval when the profile or the action is cancelled", () => {
    const sample = commands();
    const binding = bindingOf(decide(sample.destructive, { authority: authority("before-submits") }));
    const otherProfile = decide(sample.destructive, {
      resolved: resolved(sample.destructive, { profileId: OTHER_PROFILE }),
      approval: binding,
    });
    assert.equal(otherProfile.state, "refused");
    if (otherProfile.state === "refused") assert.equal(otherProfile.field, "profile");
    const cancelled = decide(sample.read, {
      authority: authority("without-asking"),
      resolved: resolved(sample.read, { cancelled: true }),
    });
    assert.equal(cancelled.state, "refused");
    if (cancelled.state === "refused") assert.equal(cancelled.field, "cancelled");
  });

  it("asks before a live submit and lets a dry enqueue stay a local write", () => {
    const sample = commands();
    const start = { family: "start", action: "start-run", classification: "external-submit", subject: "none" };
    const enqueue = { family: "intake", action: "enqueue-intake-manifest", classification: "external-submit", subject: "none" };
    const manifest = (mode: string, extra: readonly object[]) => ({
      ...authority(mode),
      manifest: { revision: 1, entries: [...ENTRIES, ...extra] },
    });
    const live = {
      ...envelope, family: "intake", type: "enqueue-intake-manifest",
      target: { intakeSessionId: INTAKE, expectedVersion: 1 }, payload: { dryRun: false },
    };
    const dry = { ...live, payload: { dryRun: true } };
    assert.equal(decide(sample.start, { authority: manifest("before-submits", [start]) }).state, "approval-required");
    assert.equal(decide(sample.start, { authority: manifest("every-action", [start]) }).state, "approval-required");
    assert.equal(decide(sample.start, { authority: manifest("without-asking", [start]) }).state, "assistant-clear");
    assert.equal(decide(live, { authority: manifest("before-submits", [enqueue]) }).state, "approval-required");
    assert.equal(decide(dry, { authority: manifest("before-submits", [enqueue]) }).state, "approval-required");
    const dryAuthority = manifest("before-submits", [{ ...enqueue, classification: "local-write" }]);
    const dryClearance = decide(dry, { authority: dryAuthority });
    assert.equal(dryClearance.state, "assistant-clear");
    const liveReplay = decide(live, {
      authority: manifest("before-submits", [enqueue]),
      resolved: resolved(live, { checkOutcome: { state: "retained", outcome: "assistant-clear", binding: bindingOf(dryClearance) } }),
    });
    assert.equal(liveReplay.state, "approval-required");
    const labelledLocal = decide(live, {
      authority: manifest("without-asking", [{ ...enqueue, classification: "local-write" }]),
    });
    assert.equal(labelledLocal.state, "refused");
    if (labelledLocal.state === "refused") assert.equal(labelledLocal.code, "ASSISTANT_EFFECT_UNDERSTATED");
    const labelledDestructive = decide(sample.start, {
      authority: manifest("before-submits", [{ ...start, classification: "destructive" }]),
    });
    assert.equal(labelledDestructive.state, "approval-required");
    if (labelledDestructive.state === "approval-required") assert.equal(labelledDestructive.existingAppGates, "unchanged");
  });

  it("requires submit classification for workers that can claim live runs", () => {
    const spawn = commands().spawn;
    const controls = ["resume-worker", "retry-worker"].map((type) => ({
      ...envelope, family: "worker-browser", type,
      target: type === "retry-worker"
        ? { workflowId: "person-lookup", workerId: "worker-1", membershipRevision: 1,
          expectedVersion: 1, controlBasis: { leaseGeneration: 1, controlRevision: 1 } }
        : { workerId: "worker-1", expectedVersion: 1 },
    }));
    for (const command of [spawn, ...controls]) {
      for (const [mode, expected] of [
        ["every-action", "approval-required"],
        ["before-submits", "approval-required"],
        ["without-asking", "assistant-clear"],
      ] as const) {
        for (const classification of ["external-submit", "destructive", "local-write", "read"]) {
          const entries = [
            ...ENTRIES.filter((entry) => entry.action !== command.type),
            { family: command.family, action: command.type, classification, subject: "none" },
          ];
          const decision = decide(command, { authority: { ...authority(mode), manifest: { revision: 1, entries } } });
          const understated = classification === "local-write" || classification === "read";
          assert.equal(decision.state, understated ? "refused" : expected, `${command.type} ${mode} ${classification}`);
          if (decision.state === "refused") assert.equal(decision.code, "ASSISTANT_EFFECT_UNDERSTATED");
          else assert.equal(decision.existingAppGates, "unchanged");
        }
      }
    }
  });

  it("refuses a destructive command when the trusted manifest labels it read", () => {
    const sample = commands();
    const entries = ENTRIES.map((entry) => entry.action === "delete"
      ? { ...entry, classification: "read" as const }
      : entry);
    for (const mode of ["every-action", "before-submits", "without-asking"] as const) {
      const decision = decide(sample.destructive, {
        authority: { ...authority(mode), manifest: { revision: 1, entries } },
      });
      assert.equal(decision.state, "refused", mode);
      if (decision.state === "refused") {
        assert.equal(decision.code, "ASSISTANT_EFFECT_UNDERSTATED");
        assert.equal(decision.field, undefined);
      }
      assert.equal(JSON.stringify(decision).includes(sample.destructive.target.runId), false);
    }
  });

  it("replays a retained check and refuses to replay UNKNOWN as clearance", () => {
    const sample = commands();
    const fresh = decide(sample.read);
    assert.equal(fresh.state, "assistant-clear");
    assert.equal(fresh.replay, "fresh");
    const binding = fresh.binding;
    const retained = {
      state: "retained",
      outcome: "refused",
      code: "ASSISTANT_UNCLASSIFIED",
      binding,
    };
    const replayed = decide(sample.read, { resolved: resolved(sample.read, { checkOutcome: retained }) });
    const repeated = decide(sample.read, { resolved: resolved(sample.read, { checkOutcome: retained }) });
    assert.equal(replayed.state, "refused");
    if (replayed.state === "refused") assert.equal(replayed.code, "ASSISTANT_UNCLASSIFIED");
    assert.deepEqual(replayed, repeated);
    const blocked = decide(sample.read, {
      resolved: resolved(sample.read, {
        checkOutcome: { state: "unknown", reason: "settlement did not finish", observedAt: NOW, binding },
      }),
    });
    assert.equal(blocked.state, "refused");
    if (blocked.state === "refused") assert.equal(blocked.code, "ASSISTANT_UNKNOWN_NOT_REPLAYABLE");
    const drifted = { ...binding, manifestRevision: 4 };
    const stillBlocked = decide(sample.read, {
      resolved: resolved(sample.read, {
        checkOutcome: { state: "unknown", reason: "settlement did not finish", observedAt: NOW, binding: drifted },
      }),
    });
    assert.equal(stillBlocked.state, "refused");
    if (stillBlocked.state === "refused") assert.equal(stillBlocked.code, "ASSISTANT_UNKNOWN_NOT_REPLAYABLE");
    const otherCommand = decide(sample.read, {
      resolved: resolved(sample.read, {
        checkOutcome: {
          state: "unknown",
          reason: "settlement did not finish",
          observedAt: NOW,
          binding: { ...binding, commandId: RUN },
        },
      }),
    });
    assert.equal(otherCommand.state, "refused");
    if (otherCommand.state === "refused") assert.equal(otherCommand.code, "ASSISTANT_UNKNOWN_NOT_REPLAYABLE");
  });
});

it("refuses assistant consent envelopes independently of stored command admission", () => {
  const command = commands().write;
  assert.equal(command.type, "apply-settings");
  const permission = { ...command, payload: { ...command.payload, patch: {}, patchFingerprint: deriveRawSettingsPatchFingerprint({}),
    assistantPermission: { expectedPolicyRevision: 0, mode: "without-asking" } } };
  const decision = decide(permission, { authority: authority("without-asking") });
  assert.equal(decision.state, "refused");
  assert.equal(decision.code, "ASSISTANT_OPTIONS_UNBOUND");
});
