// Conflicts and rejections are refusals; settle every result arm before reporting success.
import type { CommandResult } from "../../../rules/commands/commands.js";
import { DashboardClientError } from "../../client/errors.js";

export function beforeEffectRefusal(error: unknown): boolean {
  return error instanceof DashboardClientError && error.kind === "http"
    && (error.code === "OPERATOR_MUTATION_ORIGIN_REFUSED" || error.code === "OPERATOR_MUTATION_MEDIA_TYPE_REFUSED");
}

/** The kernel's own rejection vocabulary, taken from the wire union rather than restated. */
type CommandRejectionCode = Extract<CommandResult, { state: "rejected" }>["code"];

export type CommandSettlement =
  /** The command landed — `already-applied` is a replay of the same landing. */
  | { readonly kind: "applied"; readonly replayed: boolean }
  | { readonly kind: "refused"; readonly reason: "confirmation-required"; readonly problem: string; readonly message: string; readonly warningDigest: string }
  /** A CAS refusal: the target moved under the surface that was looking at it.
 * There is no code — the server sent none — and `currentVersion` is the only */
  | {
    readonly kind: "refused";
    readonly reason: "conflict";
    readonly problem: string;
    readonly message: string;
    readonly currentVersion: number;
  }
  /** A kernel refusal: its own sentence, and the code a bug report quotes. */
  | {
    readonly kind: "refused";
    readonly reason: "rejected";
    readonly problem: string;
    readonly message: string;
    readonly code: CommandRejectionCode;
  };

export function settleCommandResult(result: CommandResult): CommandSettlement {
  if (result.state === "pending") throw new Error("command-result-pending: retain the original attempt until served readback");
  switch (result.state) {
    case "applied":
      return { kind: "applied", replayed: false };
    case "already-applied":
      return { kind: "applied", replayed: true };
    case "confirmation-required":
      return { kind: "refused", reason: "confirmation-required", problem: result.message, message: result.message, warningDigest: result.warningDigest };
    case "conflict":
      return {
        kind: "refused",
        reason: "conflict",
        // The server's own sentence first, then the version number that resolves it.
        // Never "try again": a re-send of the same envelope is refused identically.
        problem: `${result.message} The server is now at version ${String(result.currentVersion)} — `
          + "reopen the run to see what changed before re-applying.",
        message: result.message,
        currentVersion: result.currentVersion,
      };
    case "rejected":
      return {
        kind: "refused",
        reason: "rejected",
        problem: result.message,
        message: result.message,
        code: result.code,
      };
  }
}

/** After dispatch, settlement failures are uncertain; never claim the server recorded nothing. */
export type CommandDispatchFailure =
  /** The client refused to compose the envelope: nothing left this tab. */
  | { readonly stage: "before-dispatch"; readonly reason: string }
  /** The promise rejected, or a guard threw while settling the answer. */
  | { readonly stage: "after-dispatch"; readonly caught: unknown; readonly command?: string };

export interface CommandFailureToast {
  readonly tone: "danger";
  readonly title: string;
  readonly description: string;
}

export function commandFailureToast(failure: CommandDispatchFailure): CommandFailureToast {
  if (failure.stage === "before-dispatch") {
    return { tone: "danger", title: "Nothing was sent", description: failure.reason };
  }
  return {
    tone: "danger",
    title: failure.command === "archive" ? "Archive result unknown" : "Result unknown — check the run",
    description: `${failure.caught instanceof Error ? failure.caught.message : String(failure.caught)} `
      + (failure.command === "archive"
        ? "Review Archive in the recovery banner to recover the original request before sending another."
        : "The command may already have been recorded: open the run and check its logs before sending it again."),
  };
}
