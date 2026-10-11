
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { z } from "zod";
import { PHASE1_ACTIVE_COMMAND_ARMS } from "../../../../src/backend/runs/commands/command-kernel.js";
import {
queueRowActions,
type QueueRowActionFacts,
} from "../../../../src/backend/runs/projections/queue-row-actions.js";
import { composeCommandRequest } from "../../../../src/dashboard/app/commands/command-dispatch.js";
import {
ActionCommandKeySchema,
ActionDescriptorWireSchema,
type ActionDescriptorWire,
} from "../../../../src/models/dashboard/actions.js";
import {
QueueStatusSchema
} from "../../../../src/models/dashboard/projection.js";
import {
STANDARD_WORKFLOW_ACTIONS
} from "../../../../src/models/workflow/presentation.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";

type Status = z.infer<typeof QueueStatusSchema>;
const uuid = (n: number): string => {
  const digits = String(n).padStart(12, "0");
  return `${digits.slice(0, 8)}-${digits.slice(8, 12)}-4000-8000-${digits}`;
};

function factsFor(status: Status, over: Partial<QueueRowActionFacts> = {}): QueueRowActionFacts {
  return {
    status,
    rowRevision: 7,
    dryRun: false,
    isChild: false,
    parkedWrite: false,
    memberCount: 0,
    isMember: false,
    named: false,
    workflowLabel: "Person Lookup",
    hasReviewPanel: false,
    ...over,
  };
}

describe("queue-row action descriptors — every served verb has a command behind it", () => {
  const served = QueueStatusSchema.options.flatMap((status) => [
    ...queueRowActions(STANDARD_WORKFLOW_ACTIONS, factsFor(status)),
    ...queueRowActions(STANDARD_WORKFLOW_ACTIONS, factsFor(status, { isChild: true, memberCount: 0 })),
    ...queueRowActions(STANDARD_WORKFLOW_ACTIONS, factsFor(status, { memberCount: 3 })),
  ]);


  it("composes every served descriptor into a request the kernel's own union parses", () => {
    for (const action of served) {
      if (action.kind === "navigation") {
        assert.equal(ActionDescriptorWireSchema.parse(action).kind, "navigation");
        assert.equal("command" in action, false);
        continue;
      }
      assert.ok(action.kind === "command");
      const composed = composeCommandRequest(
        action,
        { runId: uuid(1), expectedVersion: action.expectedVersion },
        {
          actorId: "local-operator",
          source: "queue",

          renameAnswer: "Friday exception pack",
        },
      );
      assert.equal(
        composed.state,
        "ready",
        `${action.key} refused composition: ${composed.state === "refused" ? composed.reason : ""}`,
      );
      const parsed = CommandRequestSchema.safeParse(composed.request);
      assert.ok(parsed.success, `${action.key} composed an envelope the kernel refuses`);
    }
  });


  it("refuses a rename with no name, and one the display-name schema would reject", () => {
    const rename = served.find((action) => action.kind === "command" && action.command === "rename");
    assert.ok(rename?.kind === "command", "the projection served no rename to test");
    const target = { runId: uuid(1), expectedVersion: rename.expectedVersion };
    const base = { actorId: "local-operator", source: "queue" } as const;

    const unanswered = composeCommandRequest(rename, target, base);
    assert.equal(unanswered.state, "refused");
    if (unanswered.state === "refused") assert.match(unanswered.reason, /no name was supplied/);

    // Blank, and blank-after-trim, are the same refusal: the field's own rule
    // is what answers, so the operator never meets a kernel error instead.
    for (const blank of ["", "   "]) {
      const composed = composeCommandRequest(rename, target, { ...base, renameAnswer: blank });
      assert.equal(composed.state, "refused", `"${blank}" composed a rename`);
    }

    // A bound the KERNEL holds, refused where it is typed rather than on the
    // wire: 121 code points against `RunDisplayNameSchema`'s 120.
    const tooLong = composeCommandRequest(rename, target, { ...base, renameAnswer: "x".repeat(121) });
    assert.equal(tooLong.state, "refused");

    // And a name that IS sendable composes an envelope the kernel parses, with
    // the operator's text trimmed and nothing else changed about it.
    const ok = composeCommandRequest(rename, target, { ...base, renameAnswer: "  Friday exception pack  " });
    assert.equal(ok.state, "ready");
    if (ok.state !== "ready") return;
    const parsed = CommandRequestSchema.safeParse(ok.request);
    assert.ok(parsed.success);
    if (!parsed.success) return;
    assert.equal(parsed.data.family, "run");
    assert.equal(parsed.data.type, "rename");
    assert.deepEqual(
      parsed.data.type === "rename" ? parsed.data.payload : undefined,
      { displayName: "Friday exception pack" },
    );
    // CAS-bound to the descriptor's own revision, like every other verb.
    assert.equal(parsed.data.target.expectedVersion, rename.expectedVersion);
  });


  it("catches a synthesized descriptor whose verb this path cannot send", () => {
    const unreachable = ["edit-checkpoint", "resolve-write-present", "resolve-write-absent"] as const;
    for (const command of unreachable) {
      assert.ok(
        !served.some((action) => action.kind === "command" && action.command === command),
        `the projection serves "${command}", which this test asserts it must not`,
      );
    }

    assert.ok(!(PHASE1_ACTIVE_COMMAND_ARMS.run as readonly string[]).includes("edit-checkpoint"));
    // (b) a verb the kernel does not implement at all must fail the vocabulary
    //     check — this is the arm that catches an invented control.
    assert.ok(!(ActionCommandKeySchema.options as readonly string[]).includes("force-done"));
    assert.ok(!(PHASE1_ACTIVE_COMMAND_ARMS.run as readonly string[]).includes("force-done"));

    const refused = composeCommandRequest(
      ActionDescriptorWireSchema.parse({
        kind: "command", command: "resolve-write-absent", key: "x", label: "x",
        intent: "neutral", placement: ["footer"], expectedVersion: 1,
        writeTarget: { writeIntentId: uuid(4), intentGeneration: 1, writeAttemptId: uuid(5),
          bindingProofDigest: "a".repeat(64), occurrenceKeyDigest: "b".repeat(64) },
      }) as Extract<ActionDescriptorWire, { kind: "command" }>,
      { runId: uuid(1), expectedVersion: 1 },
      { actorId: "local-operator", source: "queue" },
    );
    assert.equal(refused.state, "refused");
  });
});
