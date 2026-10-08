/**
 * THE TWO SIBLING ARMS 8154e1a4 LEFT BEHIND.
 *
 * `commandFailureToast` (`app/command-result.ts`) exists because a throw AFTER
 * dispatch cannot claim "Nothing was recorded" — that is a claim about the
 * SERVER, and the envelope is already on the wire by the time a `.catch` can
 * fire. `dispatchCommand`'s single-command route was fixed in 8154e1a4. Its
 * two sibling routes — the bulk dispatch behind the selection band, and the
 * Session Panel's `stopWorker` (D249) — post through the same one command
 * route and were left with the pre-fix hardcoded title.
 *
 * The rejection arms live inside closures in `dashboard-app.tsx` and are not
 * exported, so — following `command-guard-surfacing.test.ts`'s own pattern —
 * this file (1) slices the arm's own source between fixed landmarks, so a
 * reversion to the inline literal is caught even though nothing calls the
 * closure directly, and (2) drives a REPLICA of the arm, byte-identical to
 * production once fixed, through an actually-rejected promise to prove the
 * toast an operator would see.
 *
 * Note what stays untouched: `response.state === "refused"` and
 * `settlement.kind === "refused"` are the server ITSELF answering with a
 * refusal — a real "nothing was recorded" the client is entitled to state —
 * and are not part of either arm asserted here.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import { commandFailureToast } from "../../../../../src/dashboard/app/commands/command-result.js";

const DASHBOARD_APP = new URL("../../../../../src/dashboard/app/dashboard-app.tsx", import.meta.url);

function sliceBetween(source: string, openMarker: string, closeMarker: string, label: string): string {
  const opens = source.indexOf(openMarker);
  if (opens === -1) {
    throw new Error(`${label}: dashboard-app.tsx no longer contains the opening landmark ${JSON.stringify(openMarker)}`);
  }
  const closes = source.indexOf(closeMarker, opens);
  if (closes === -1) {
    throw new Error(`${label}: dashboard-app.tsx no longer contains the closing landmark ${JSON.stringify(closeMarker)}`);
  }
  return source.slice(opens, closes);
}

function bulkDispatchRejectionArm(): string {
  const source = readFileSync(DASHBOARD_APP, "utf8");
  return sliceBetween(
    source,
    "client.executeBulkCommand(composed.request).then(",
    "\n\n  /**\n   * The Session Panel's `Stop`",
    "dispatchBulk",
  );
}

function stopWorkerRejectionArm(): string {
  const source = readFileSync(DASHBOARD_APP, "utf8");
  return sliceBetween(
    source,
    "client.executeCommand(composeStopWorkerCommand(",
    "\n\n  /**\n   * Ported from legacy",
    "stopWorker",
  );
}

describe("dispatchBulk's rejection arm (the selection band's bulk post)", () => {
  it("no longer claims Nothing was recorded from a post-dispatch throw", () => {
    const arm = bulkDispatchRejectionArm();
    assert.doesNotMatch(
      arm,
      /\(caught: unknown\) => \{\s*toast\(\{\s*tone: "danger",\s*title: "Nothing was recorded"/u,
      "the rejection handler still hardcodes the negative this client is not entitled to make",
    );
    assert.match(
      arm,
      /\(caught: unknown\) => \{[^}]*commandFailureToast\(\{\s*stage: "after-dispatch",\s*caught\s*\}\)/u,
      "the rejection handler must settle through the same honest fold dispatchCommand uses",
    );
  });

  it("— driven, the honest fold titles it Result unknown, never Nothing was recorded", () => {
    const recorded: { tone: string; title: string; description: string }[] = [];
    const toast = (input: { tone: string; title: string; description: string }): string => {
      recorded.push(input);
      return "toast-id";
    };
    const onRejected = (caught: unknown): void => {
      toast(commandFailureToast({ stage: "after-dispatch", caught }));
    };
    return Promise.reject(new Error("the bulk POST never reached the BFF"))
      .then(undefined, onRejected)
      .then(() => {
        assert.equal(recorded.length, 1);
        const [only] = recorded;
        assert.equal(only?.title, "Result unknown — check the run");
        assert.notEqual(only?.title, "Nothing was recorded");
        assert.ok(only?.description.includes("the bulk POST never reached the BFF"));
      });
  });
});

describe("stopWorker's rejection arm (the Session Panel's Stop, D249)", () => {
  it("no longer claims Nothing was recorded from a post-dispatch throw", () => {
    const arm = stopWorkerRejectionArm();
    assert.doesNotMatch(
      arm,
      /\(caught: unknown\) => \{\s*toast\(\{\s*tone: "danger",\s*title: "Nothing was recorded"/u,
      "the rejection handler still hardcodes the negative this client is not entitled to make",
    );
    assert.match(
      arm,
      /\(caught: unknown\) => \{[^}]*commandFailureToast\(\{\s*stage: "after-dispatch",\s*caught\s*\}\)/u,
      "the rejection handler must settle through the same honest fold dispatchCommand uses",
    );
  });

  it("— driven, the honest fold titles it Result unknown, never Nothing was recorded", () => {
    const recorded: { tone: string; title: string; description: string }[] = [];
    const toast = (input: { tone: string; title: string; description: string }): string => {
      recorded.push(input);
      return "toast-id";
    };
    const onRejected = (caught: unknown): void => {
      toast(commandFailureToast({ stage: "after-dispatch", caught }));
    };
    return Promise.reject(new Error("the stop POST never reached the BFF"))
      .then(undefined, onRejected)
      .then(() => {
        assert.equal(recorded.length, 1);
        const [only] = recorded;
        assert.equal(only?.title, "Result unknown — check the run");
        assert.notEqual(only?.title, "Nothing was recorded");
        assert.ok(only?.description.includes("the stop POST never reached the BFF"));
      });
  });
});
