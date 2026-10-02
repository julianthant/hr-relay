/**
 * A FAIL-LOUD GUARD THAT NOBODY CATCHES IS SILENCE WITH EXTRA STEPS.
 *
 * `dispatchCommand` in `app/dashboard-app.tsx` carries two throws inside the
 * arm that runs when the BFF answers: `toastAppliedCommandResult` refuses to
 * compose a success receipt for a refused settlement, and the refused branch
 * refuses to continue when the feed fold produced no entry. Both exist so that
 * "nothing was recorded" can never look like "it worked" (D253).
 *
 * They were installed on a promise chain of the form `.then(onFulfilled,
 * onRejected)`, and that form registers `onRejected` on the ORIGINAL promise —
 * so it can never see a throw raised by `onFulfilled`. The guard fired into a
 * floating unhandled rejection: no toast, no feed row, an operator staring at a
 * screen that reported nothing at all. This file pins both halves of the fix.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import { toastAppliedCommandResult } from "../../../../src/dashboard/surfaces/actions-model.js";
import { commandFailureToast, settleCommandResult } from "../../../../src/dashboard/app/command-result.js";
import { CommandResultSchema } from "../../../../src/domain/commands.js";

const COMMAND_ID = "1a000000-0000-4000-8000-000000000001";

const DASHBOARD_APP = new URL("../../../../src/dashboard/app/dashboard-app.tsx", import.meta.url);

/**
 * The call site itself, sliced out by its two fixed landmarks: the one
 * `executeCommand` post `dispatchCommand` makes, and the dependency array that
 * closes the `useCallback` holding it.
 */
function dispatchCommandChain(): string {
  const source = readFileSync(DASHBOARD_APP, "utf8");
  const opens = source.indexOf("client.executeCommand(requestToExecute)");
  const closes = source.indexOf("[boot.actor.id, client, sections, toast, dayWire", opens);
  if (opens === -1 || closes === -1) {
    throw new Error(
      "dashboard-app.tsx no longer contains dispatchCommand's executeCommand chain between its "
      + "known landmarks — re-point this guard rather than deleting it",
    );
  }
  return source.slice(opens, closes);
}

describe("dispatchCommand's settlement handler surfaces its own guards", () => {
  it("still has guards worth catching", () => {
    const chain = dispatchCommandChain();
    assert.match(
      chain,
      /toastAppliedCommandResult\(toast, \{/u,
      "the applied-toast fold throws on a refused settlement; if it left this chain, so did the hazard",
    );
    assert.match(
      chain,
      /throw new Error\("refused command settlement produced no feed entry"\)/u,
      "the second guard in the same arm, and it floats or lands by the same chain shape",
    );
  });

  it("terminates the chain in a `.catch`, which is the only handler a throw from the fulfilment arm can reach", () => {
    const chain = dispatchCommandChain();
    assert.match(
      chain,
      /\)\.catch\(\(caught: unknown\) => \{/u,
      "without a trailing .catch a guard that fires produces no toast and no feed entry",
    );
    assert.doesNotMatch(
      chain,
      /\}\s*,\s*\(caught: unknown\)/u,
      "a second `.then` argument is the shape that swallowed the guards: it is installed on the "
      + "promise BEFORE the fulfilment arm and never sees what that arm throws",
    );
  });
});

interface Toasted {
  readonly tone: "success" | "danger";
  readonly title: string;
  readonly description: string;
}

/**
 * The production arms, verbatim in behaviour: the fulfilment arm settles a
 * REFUSED result through the real D253 fold and hands it to the real applied
 * toast (which is exactly how the guard fires), and the rejection arm is the
 * danger toast `dashboard-app.tsx` composes from a caught value.
 */
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
      toastAppliedCommandResult(toast, {
        settlement: settleCommandResult(CommandResultSchema.parse({
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
      toast(commandFailureToast({ stage: "after-dispatch", caught }));
    },
  };
}

describe("the two promise shapes, driven with the real guard and the real handler", () => {
  it("the two-arm `.then(a, b)` this replaced loses the guard entirely", async () => {
    const recorded: Toasted[] = [];
    const arms = makeArms(recorded);
    // The `.catch` here is the very handler production was missing; it is
    // attached ONLY so the guard's throw does not take the test process down
    // as an unhandled rejection. The claim is what `recorded` holds.
    await Promise.resolve()
      .then(arms.onFulfilled, arms.onRejected)
      .catch(() => undefined);
    assert.deepEqual(
      recorded,
      [],
      "no toast, no feed entry, no console the operator reads — the guard fired into nothing",
    );
  });

  it("the chained `.then(a).catch(b)` reports the guard's own sentence through the danger toast", async () => {
    const recorded: Toasted[] = [];
    const arms = makeArms(recorded);
    await Promise.resolve().then(arms.onFulfilled).catch(arms.onRejected);
    assert.equal(recorded.length, 1);
    const [only] = recorded;
    assert.equal(only?.tone, "danger");
    assert.equal(only?.title, "Result unknown — check the run");
    assert.match(
      only?.description ?? "",
      /an applied-command toast was composed for a refused settlement of Retry on Jordan Reyes/,
      "the guard names the action and the subject, and the operator must be able to read both",
    );
  });

  it("still routes a transport rejection to the same handler, which the chained form must not lose", async () => {
    const recorded: Toasted[] = [];
    const arms = makeArms(recorded);
    await Promise.reject(new Error("the BFF is not reachable"))
      .then(arms.onFulfilled)
      .catch(arms.onRejected);
    assert.deepEqual(recorded, [commandFailureToast({
      stage: "after-dispatch",
      caught: new Error("the BFF is not reachable"),
    })]);
  });
});
