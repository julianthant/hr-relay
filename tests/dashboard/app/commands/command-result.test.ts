import assert_m0 from "node:assert/strict";
import { describe as describe_m0,it as it_m0 } from "vitest";
import { commandFailureToast as commandFailureToast_m0,settleCommandResult as settleCommandResult_m0 } from "../../../../src/dashboard/app/commands/command-result.js";
import { CommandRejectionCodeSchema as CommandRejectionCodeSchema_m0,CommandResultSchema as CommandResultSchema_m0 } from "../../../../src/rules/commands/commands.js";
// @vitest-environment jsdom
import assert_m1 from "node:assert/strict";
import { describe as describe_m1,it as it_m1 } from "vitest";
import { commandFailureToast as commandFailureToast_m1 } from "../../../../src/dashboard/app/commands/command-result.js";

import assert_m2 from "node:assert/strict";
import { describe as describe_m2,it as it_m2 } from "vitest";
import { CommandExecutor as CommandExecutor_m2, type CommandExecutionOptions as CommandExecutionOptions_m2, type CommandOutcome as CommandOutcome_m2 } from "../../../../src/dashboard/app/commands/command-executor.js";
import { commandFailureToast as commandFailureToast_m2,settleCommandResult as settleCommandResult_m2 } from "../../../../src/dashboard/app/commands/command-result.js";
import { createSharedCommands as createSharedCommands_m2 } from "../../../../src/dashboard/client/commands/shared-commands.js";
import { createDashboardTransport as createDashboardTransport_m2 } from "../../../../src/dashboard/client/transport.js";
import { toastAppliedCommandResult as toastAppliedCommandResult_m2 } from "../../../../src/dashboard/surfaces/shared/actions/actions-model.js";
import { CommandRequestSchema as CommandRequestSchema_m2,CommandResultSchema as CommandResultSchema_m2 } from "../../../../src/rules/commands/commands.js";

import assert_m3 from "node:assert/strict";
import { describe as describe_m3,it as it_m3 } from "vitest";
import { settleCommandResult as settleCommandResult_m3 } from "../../../../src/dashboard/app/commands/command-result.js";
import { commandResultFeedEntry as commandResultFeedEntry_m3,toastAppliedCommandResult as toastAppliedCommandResult_m3 } from "../../../../src/dashboard/surfaces/shared/actions/actions-model.js";
import { CommandResultSchema as CommandResultSchema_m3 } from "../../../../src/rules/commands/commands.js";


{


const COMMAND_ID = "0f3b6d5a-2e5a-4b8f-9a4e-1c2d3e4f5a6b";
const RUN_ID = "8a1c9d2e-3f4b-4c5d-8e9f-0a1b2c3d4e5f";

const settle = (raw: unknown) => settleCommandResult_m0(CommandResultSchema_m0.parse(raw));

const CONFLICT_MESSAGE = "the run moved while this was open.";
const REJECTED_MESSAGE = "run is terminal; corrections apply only to a resumable run";

const conflictOf = (currentVersion: number, message = CONFLICT_MESSAGE) =>
  settle({ state: "conflict", commandId: COMMAND_ID, currentVersion, message });

const rejectedOf = (code: string, message = REJECTED_MESSAGE) =>
  settle({ state: "rejected", commandId: COMMAND_ID, code, message });

describe_m0("settleCommandResult", () => {
  it_m0("settles both landing arms as applied, and says which was a replay", () => {
    const targets = [{ family: "run", runId: RUN_ID }];
    assert_m0.deepEqual(
      settle({ state: "applied", commandId: COMMAND_ID, affectedTargets: targets }),
      { kind: "applied", replayed: false },
    );
    assert_m0.deepEqual(
      settle({ state: "already-applied", commandId: COMMAND_ID, affectedTargets: targets }),
      { kind: "applied", replayed: true },
    );
  });

  it_m0("settles a CAS conflict as a REFUSAL carrying the server's own version", () => {
    const settlement = conflictOf(7);
    assert_m0.equal(settlement.kind, "refused");
    if (settlement.kind !== "refused") return;
    assert_m0.equal(settlement.reason, "conflict");
    // The server's sentence survives, and the number that resolves it is added.
    assert_m0.match(settlement.problem, /the run moved while this was open\./u);
    assert_m0.match(settlement.problem, /version 7/u);
    // Never "try again": a re-send carries the same stale expectedVersion.
    assert_m0.doesNotMatch(settlement.problem, /try again/iu);
  });

  it_m0("carries a conflict's `currentVersion` as a NUMBER, for a surface that lays it out itself", () => {
    const settlement = conflictOf(41);
    assert_m0.equal(settlement.kind === "refused" && settlement.reason === "conflict"
      ? settlement.currentVersion
      : undefined, 41);
  });

  it_m0("keeps a conflict's `message` UNCOMPOSED — it is the wire's sentence, not the fold's", () => {
    // Keep the visible refusal string exact; it is part of the frozen accessibility corpus.
    const settlement = conflictOf(2);
    if (settlement.kind !== "refused" || settlement.reason !== "conflict") {
      assert_m0.fail("a conflict must settle as a conflict refusal");
      return;
    }
    assert_m0.equal(settlement.message, CONFLICT_MESSAGE);
    // And the composed sentence is genuinely a DIFFERENT string, so a caller
    // that wants the version gets it by asking for `problem`, never by accident.
    assert_m0.notEqual(settlement.problem, settlement.message);
  });

  it_m0("passes a kernel rejection's own sentence through UNCHANGED", () => {
    assert_m0.deepEqual(rejectedOf("invalid-state"), {
      kind: "refused",
      reason: "rejected",
      problem: REJECTED_MESSAGE,

      message: REJECTED_MESSAGE,
      code: "invalid-state",
    });
  });

  it_m0("carries EVERY rejection code the kernel can send, verbatim", () => {

    for (const code of CommandRejectionCodeSchema_m0.options) {
      const settlement = rejectedOf(code);
      assert_m0.equal(
        settlement.kind === "refused" && settlement.reason === "rejected" ? settlement.code : undefined,
        code,
        `the fold must carry the ${code} rejection code`,
      );
    }
  });

  it_m0("keeps the two refusals distinguishable — they are different operator acts", () => {
    const conflict = conflictOf(2, "moved.");
    const rejected = rejectedOf("policy-refused", "moved.");
    assert_m0.notDeepEqual(conflict, rejected);
    // Even on the SAME server sentence, the two are told apart by `reason`
    // alone — a surface never has to compare strings to know which it holds.
    assert_m0.equal(conflict.kind === "refused" ? conflict.reason : undefined, "conflict");
    assert_m0.equal(rejected.kind === "refused" ? rejected.reason : undefined, "rejected");
  });

  it_m0("answers `refused` for BOTH refusal arms and `applied` for neither", () => {

    assert_m0.deepEqual(
      [
        settle({ state: "applied", commandId: COMMAND_ID, affectedTargets: [{ family: "run", runId: RUN_ID }] }).kind,
        settle({
          state: "already-applied",
          commandId: COMMAND_ID,
          affectedTargets: [{ family: "run", runId: RUN_ID }],
        }).kind,
        conflictOf(3).kind,
        rejectedOf("target-not-found").kind,
      ],
      ["applied", "applied", "refused", "refused"],
    );
  });
});

// Before dispatch the client can prove nothing was sent; after dispatch it must preserve uncertainty.
describe_m0("commandFailureToast — where the command died decides what may be claimed", () => {
  it_m0("says nothing was SENT before dispatch, carrying the client's own reason verbatim", () => {
    const toast = commandFailureToast_m0({ stage: "before-dispatch", reason: "a rename needs a name." });
    assert_m0.equal(toast.tone, "danger");
    assert_m0.equal(toast.title, "Nothing was sent");
    assert_m0.equal(toast.description, "a rename needs a name.");
  });

  it_m0("refuses to claim anything about the server after dispatch, and says what to do instead", () => {
    const toast = commandFailureToast_m0({ stage: "after-dispatch", caught: new Error("network error") });
    assert_m0.equal(toast.tone, "danger");
    assert_m0.equal(toast.title, "Result unknown — check the run");
    assert_m0.ok(
      !/nothing was (recorded|sent)/iu.test(`${toast.title} ${toast.description}`),
      `a throw after dispatch cannot know either negative: ${toast.title} — ${toast.description}`,
    );
    assert_m0.ok(toast.description.includes("network error"), "the throw's own sentence survives");
    assert_m0.ok(
      toast.description.includes("open the run"),
      "an unknown result is only actionable if the toast names the one thing that resolves it",
    );
    assert_m0.ok(toast.description.includes("check its logs"), "unknown results point to the current inspection surface");
    assert_m0.ok(!toast.description.includes("receipt"), "the retired tab cannot be a recovery destination");
  });

  it_m0("keeps the two stages DISTINGUISHABLE, which is the whole finding", () => {
    const before = commandFailureToast_m0({ stage: "before-dispatch", reason: "a rename needs a name." });
    const after = commandFailureToast_m0({ stage: "after-dispatch", caught: new Error("network error") });
    assert_m0.notEqual(before.title, after.title);
  });

  it_m0("survives a throw that is not an Error, rather than printing `[object Object]` at the operator", () => {
    const toast = commandFailureToast_m0({ stage: "after-dispatch", caught: "socket hang up" });
    assert_m0.ok(toast.description.startsWith("socket hang up "), toast.description);
  });
});
}

{


describe_m1("dispatchBulk's rejection arm (the selection band's bulk post)", () => {

  it_m1("post-dispatch throw is Result unknown", () => {
    const recorded: { tone: string; title: string; description: string }[] = [];
    const toast = (input: { tone: string; title: string; description: string }): string => {
      recorded.push(input);
      return "toast-id";
    };
    const onRejected = (caught: unknown): void => {
      toast(commandFailureToast_m1({ stage: "after-dispatch", caught }));
    };
    return Promise.reject(new Error("the bulk POST never reached the BFF"))
      .then(undefined, onRejected)
      .then(() => {
        assert_m1.equal(recorded.length, 1);
        const [only] = recorded;
        assert_m1.equal(only?.title, "Result unknown — check the run");
        assert_m1.notEqual(only?.title, "Nothing was recorded");
        assert_m1.ok(only?.description.includes("the bulk POST never reached the BFF"));
      });
  });
});
}

{


const COMMAND_ID = "1a000000-0000-4000-8000-000000000001";
const RUN_ID = "1a000000-0000-4000-8000-000000000002";

function command_m2(n: number, runId = RUN_ID, expectedVersion = 7) {
  return CommandRequestSchema_m2.parse({
    commandId: `1a000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    requestedAt: "2026-08-03T12:00:00.000Z",
    requestedBy: "local-operator",
    source: "dashboard",
    family: "run",
    type: "cancel",
    target: { runId, expectedVersion },
  });
}

function executionHarness_m2() {
  const sent: string[] = [];
  const persisted = new Map<string, { runId: string; version: number; cancelled: boolean }>();
  const client = createSharedCommands_m2(createDashboardTransport_m2({
    baseUrl: "http://fixture.test",
    fetchImpl: async (_url, init) => {
      if (typeof init?.body !== "string") assert_m2.fail("JSON command body missing");
      const body = init.body;
      sent.push(body);
      const request = CommandRequestSchema_m2.parse(JSON.parse(body));
      if (request.family !== "run") assert_m2.fail("expected a run command");
      persisted.set(request.target.runId, {
        runId: request.target.runId,
        version: request.target.expectedVersion + 1,
        cancelled: true,
      });
      return Response.json({
        state: "applied",
        commandId: request.commandId,
        affectedTargets: [{ family: "run", runId: request.target.runId }],
      });
    },
  }));
  const scope = { actorId: "local-operator", client, authority: {}, dayRequest: {} };
  const executor = new CommandExecutor_m2(() => scope);
  const options = (): CommandExecutionOptions_m2 => ({
    scope,
    readback: async (request) => {
      if (request.family !== "run") return { state: "mismatch", evidence: undefined };
      const observed = persisted.get(request.target.runId);
      return observed?.runId === request.target.runId
        && observed.version === request.target.expectedVersion + 1
        && observed.cancelled
        ? { state: "matched", evidence: observed }
        : { state: "mismatch", evidence: observed };
    },
  });
  return { executor, options, persisted, sent };
}

describe_m2("CommandExecutor settlement and publication guards", () => {
  it_m2("keeps an applied command uncertain and locked when authoritative readback throws", async () => {
    const h = executionHarness_m2();
    const request = command_m2(1);
    const cause = new Error("the authoritative readback failed");
    const published: CommandOutcome_m2[] = [];
    const defaults = h.options();
    const outcome = await h.executor.execute(request, {
      ...defaults,
      publish: result => published.push(result),
      readback: async command => {
        if (command.family !== "run") assert_m2.fail("expected a run command");
        const observed = h.persisted.get(command.target.runId);
        assert_m2.equal(observed?.runId, command.target.runId);
        assert_m2.equal(observed?.version, command.target.expectedVersion + 1);
        assert_m2.equal(observed?.cancelled, true);
        throw cause;
      },
    });

    if (outcome.kind !== "uncertain") assert_m2.fail("expected an uncertain outcome");
    assert_m2.equal(outcome.cause, cause);
    assert_m2.equal(outcome.feedback.text, "The command outcome is uncertain. Check its result before taking further action.");
    const [retained] = h.executor.retainedAttempts();
    assert_m2.ok(retained);
    assert_m2.deepEqual(retained.request, request);
    assert_m2.equal(retained.state, "settled");
    assert_m2.equal(retained.outcome, outcome);
    assert_m2.equal(published.length, 1);
    const blocked = await h.executor.execute(command_m2(2, RUN_ID, 8), h.options());
    assert_m2.deepEqual({ kind: blocked.kind, reason: blocked.kind === "refused" ? blocked.reason : undefined }, { kind: "refused", reason: "locked" });
    assert_m2.equal(h.sent.length, 1, "the uncertain target cannot dispatch a fresh command");
  });

  it_m2("resolves a matched applied result with the applied-toast guard's publication error attached", async () => {
    const h = executionHarness_m2();
    const request = command_m2(3);
    const published: CommandOutcome_m2[] = [];
    let guardCause: unknown;
    const outcome = await h.executor.execute(request, {
      ...h.options(),
      publish: result => {
        published.push(result);
        try {
          toastAppliedCommandResult_m2(() => "toast-id", {
            settlement: settleCommandResult_m2(CommandResultSchema_m2.parse({
              state: "rejected",
              commandId: request.commandId,
              code: "policy-refused",
              message: "policy blocks this retry",
            })),
            actionLabel: "Retry",
            subject: "Jordan Reyes",
            clock: "3:07 PM",
            actorId: "local-operator",
          });
        } catch (caught) {
          guardCause = caught;
          throw caught;
        }
      },
    });

    if (outcome.kind !== "confirmed") assert_m2.fail("expected the authoritative readback to confirm the command");
    if (request.family !== "run") assert_m2.fail("expected a run command");
    assert_m2.equal(h.persisted.get(RUN_ID)?.version, request.target.expectedVersion + 1);
    assert_m2.equal(h.persisted.get(RUN_ID)?.cancelled, true);
    assert_m2.equal(published.length, 1);
    assert_m2.equal(published[0]?.kind, "confirmed");
    assert_m2.equal(outcome.cause, guardCause);
    assert_m2.ok(outcome.cause instanceof Error);
    assert_m2.equal(outcome.cause.message, "an applied-command toast was composed for a refused settlement of Retry on Jordan Reyes");
    const [retained] = h.executor.retainedAttempts();
    assert_m2.ok(retained);
    assert_m2.equal(retained.request.commandId, request.commandId);
    assert_m2.equal(retained.state, "settled");
    assert_m2.equal(retained.outcome, outcome);
    assert_m2.equal(h.sent.length, 1);
  });
});

interface Toasted {
  readonly tone: "success" | "danger";
  readonly title: string;
  readonly description: string;
}


function makeArms(recorded: Toasted[]): {
  onFulfilled: () => void;
  onRejected: (caught: unknown) => void;
} {
  const toast = (input: Toasted): string => {
    recorded.push(input);
    return "toast-id";
  };
  return {
    onFulfilled: (): void => {
      toastAppliedCommandResult_m2(toast, {
        settlement: settleCommandResult_m2(CommandResultSchema_m2.parse({
          state: "rejected",
          commandId: COMMAND_ID,
          code: "policy-refused",
          message: "policy blocks this retry",
        })),
        actionLabel: "Retry",
        subject: "Jordan Reyes",
        clock: "3:07 PM",
        actorId: "local-operator",
      });
    },
    onRejected: (caught: unknown): void => {
      toast(commandFailureToast_m2({ stage: "after-dispatch", caught }));
    },
  };
}

describe_m2("the two promise shapes, driven with the real guard and the real handler", () => {
  it_m2("the two-arm `.then(a, b)` this replaced loses the guard entirely", async () => {
    const recorded: Toasted[] = [];
    const arms = makeArms(recorded);

    await Promise.resolve()
      .then(arms.onFulfilled, arms.onRejected)
      .catch(() => undefined);
    assert_m2.deepEqual(
      recorded,
      [],
      "no toast, no feed entry, no console the operator reads — the guard fired into nothing",
    );
  });

  it_m2("the chained `.then(a).catch(b)` reports the guard's own sentence through the danger toast", async () => {
    const recorded: Toasted[] = [];
    const arms = makeArms(recorded);
    await Promise.resolve().then(arms.onFulfilled).catch(arms.onRejected);
    assert_m2.equal(recorded.length, 1);
    const [only] = recorded;
    assert_m2.equal(only?.tone, "danger");
    assert_m2.equal(only?.title, "Result unknown — check the run");
    assert_m2.match(
      only?.description ?? "",
      /an applied-command toast was composed for a refused settlement of Retry on Jordan Reyes/,
      "the guard names the action and the subject, and the operator must be able to read both",
    );
  });

  it_m2("still routes a transport rejection to the same handler, which the chained form must not lose", async () => {
    const recorded: Toasted[] = [];
    const arms = makeArms(recorded);
    await Promise.reject(new Error("the BFF is not reachable"))
      .then(arms.onFulfilled)
      .catch(arms.onRejected);
    assert_m2.deepEqual(recorded, [commandFailureToast_m2({
      stage: "after-dispatch",
      caught: new Error("the BFF is not reachable"),
    })]);
  });
});
}

{


const COMMAND_ID = "1a000000-0000-4000-8000-000000000001";
const RUN_ID = "1a000000-0000-4000-8000-000000000002";

const context = {
  targetRunId: RUN_ID,
  expectedVersion: 3,
  commandId: COMMAND_ID,
  subject: "Jordan Reyes",
  workflowLabel: "Person lookup",
  actionLabel: "Retry",
  clock: "3:07 PM",
  actorId: "local-operator",
} as const;

describe_m3("command result feed settlement", () => {
  it_m3("refuses to create persistent failure context for an applied command", () => {
    const settlement = settleCommandResult_m3(CommandResultSchema_m3.parse({
      state: "applied",
      commandId: COMMAND_ID,
      affectedTargets: [{ family: "run", runId: RUN_ID }],
    }));
    assert_m3.equal(commandResultFeedEntry_m3({ settlement, ...context }), undefined);
  });

  it_m3("preserves both refusal arms and their distinct server facts", () => {
    const conflict = commandResultFeedEntry_m3({
      settlement: settleCommandResult_m3(CommandResultSchema_m3.parse({
        state: "conflict", commandId: COMMAND_ID, currentVersion: 4, message: "the row moved",
      })),
      ...context,
    });
    const rejected = commandResultFeedEntry_m3({
      settlement: settleCommandResult_m3(CommandResultSchema_m3.parse({
        state: "rejected", commandId: COMMAND_ID, code: "policy-refused", message: "policy blocks this retry",
      })),
      ...context,
    });

    assert_m3.equal(conflict?.settlement.kind, "refused");
    assert_m3.equal(conflict?.settlement.reason, "conflict");
    assert_m3.equal(rejected?.settlement.reason, "rejected");
    assert_m3.equal(rejected?.settlement.message, "policy blocks this retry");
  });
});


describe_m3("the applied-command toast", () => {
  // Create a recorder per test so an applied toast cannot leak into a later refusal case.
  const recorder = (): {
    toasted: { title: string; description: string }[];
    toast: (input: { tone: "success"; title: string; description: string }) => string;
  } => {
    const toasted: { title: string; description: string }[] = [];
    return {
      toasted,
      toast: (input): string => {
        toasted.push({ title: input.title, description: input.description });
        return "toast-id";
      },
    };
  };

  it_m3("draws the applied receipt from the settlement and the surface's own context", () => {
    const { toasted, toast } = recorder();
    toastAppliedCommandResult_m3(toast, {
      settlement: settleCommandResult_m3(CommandResultSchema_m3.parse({
        state: "applied",
        commandId: COMMAND_ID,
        affectedTargets: [{ family: "run", runId: RUN_ID }],
      })),
      actionLabel: "Retry",
      subject: "Jordan Reyes",
      clock: "3:07 PM",
      actorId: "local-operator",
    });
    assert_m3.deepEqual(toasted, [{ title: "Retry", description: "Jordan Reyes · 3:07 PM" }]);
  });

  it_m3("throws rather than falling silent when handed a refusal", () => {
    const { toasted, toast } = recorder();
    assert_m3.throws(
      () => {
        toastAppliedCommandResult_m3(toast, {
          settlement: settleCommandResult_m3(CommandResultSchema_m3.parse({
            state: "rejected", commandId: COMMAND_ID, code: "policy-refused", message: "policy blocks this retry",
          })),
          actionLabel: "Retry",
          subject: "Jordan Reyes",
          clock: "3:07 PM",
          actorId: "local-operator",
        });
      },
      /refused settlement of Retry on Jordan Reyes/u,
      "a quiet return would leave the operator with no toast at all and no reason for its absence",
    );
    assert_m3.deepEqual(toasted, [], "and it must not have emitted a success toast on the way out");
  });
});
}
