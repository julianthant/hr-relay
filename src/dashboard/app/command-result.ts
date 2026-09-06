/**
 * D253 — the ONE fold every command-issuing surface settles a result through.
 *
 * `CommandResultSchema` is a three-arm union and two of the arms are refusals.
 * A surface that branches on `rejected` alone lets `conflict` fall through to
 * whatever it does on success — which is how the Data rail came to close its
 * editor, discard the operator's drafts and report a correction saved that the
 * kernel had refused on a version check. Nothing about that is a written
 * fallback; an unhandled union arm is a fallback nobody typed, and this is the
 * exact shape the fail-loud rule exists to keep off an HR record.
 *
 * The fold is exhaustive by construction: `settleCommandResult` switches over
 * the discriminant and TypeScript refuses a new arm that nothing handles, so a
 * fourth result kind lands as a compile error rather than as another silent
 * success.
 *
 * The two refusals stay DISTINGUISHABLE in the sentence, because the operator
 * does different things about them. A `conflict` means the target moved and the
 * server says what to: its `currentVersion` is the only number that tells you to
 * refresh, so it is in the text. A `rejected` carries the kernel's own sentence,
 * which already names what it refused and why — this fold never rewrites it.
 *
 * ## What the fold decides, and what it does not (Track D row D3)
 *
 * It decides ONE thing: whether the command LANDED. That question has exactly
 * one right answer per result and so it has exactly one implementation, here.
 *
 * It does NOT decide how a refusal is drawn. Nine command surfaces draw one
 * nine ways — a `danger` toast with a single description slot, a `Refusal` with
 * its own `code` chip, a `Banner` whose meta line carries the version — and a
 * fold that flattened all of that into one string would force six of them to
 * take the union apart again to get their facts back, which is the hand
 * enumeration this decision exists to delete. So a refusal carries BOTH:
 *
 * - `problem` — the composed one-slot sentence, for a surface with one text
 *   slot to spend (`top-bar.tsx`, `context-rail.tsx`, and any new caller that
 *   has nowhere to put a code or a version).
 * - `message` / `code` / `currentVersion` — the server's own facts, verbatim
 *   and per-arm, for a surface that lays the refusal out in its own components.
 *   `message` is the server's sentence UNCOMPOSED; on a `rejected` it is
 *   identical to `problem`, because there is nothing to add to a sentence that
 *   already names what was refused and why.
 *
 * Reading a fact off the settlement is the point. Re-deriving the VERDICT from
 * `result.state` is what `command-result-exhaustive.test.ts` refuses.
 */
import type { CommandResult } from "../../domain/commands.js";

/** The kernel's own rejection vocabulary, taken from the wire union rather than restated. */
type CommandRejectionCode = Extract<CommandResult, { state: "rejected" }>["code"];

export type CommandSettlement =
  /** The command landed — `already-applied` is a replay of the same landing. */
  | { readonly kind: "applied"; readonly replayed: boolean }
  | { readonly kind: "refused"; readonly reason: "confirmation-required"; readonly problem: string; readonly message: string; readonly warningDigest: string }
  /**
   * A CAS refusal: the target moved under the surface that was looking at it.
   * There is no code — the server sent none — and `currentVersion` is the only
   * number that tells the operator what to do about it.
   */
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
        // The server's own sentence first, then the number that resolves it.
        // Never "try again": a re-send of the same envelope would carry the
        // same stale `expectedVersion` and be refused identically.
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

/**
 * WHERE A COMMAND DIED, and it decides the only honest thing the toast can say.
 *
 * `Nothing was recorded` is a claim about the SERVER, and there are exactly two
 * moments at which this client is entitled to make it: before anything was
 * sent, and after the server itself answered with a refusal. A throw from the
 * settlement handler is neither. The envelope is already on the wire — the
 * fetch may have failed after the kernel wrote the row, and the guards inside
 * the fulfilment arm throw only AFTER a result came back — so "nothing was
 * recorded" is a negative this side cannot know, and an operator who believes
 * it re-issues a command that already landed. On an HR transaction that is the
 * duplicate the fail-loud rule exists to prevent.
 *
 * So the two stages get two titles, and the after-dispatch one names the
 * uncertainty rather than resolving it in the comfortable direction.
 */
export type CommandDispatchFailure =
  /** The client refused to compose the envelope: nothing left this tab. */
  | { readonly stage: "before-dispatch"; readonly reason: string }
  /** The promise rejected, or a guard threw while settling the answer. */
  | { readonly stage: "after-dispatch"; readonly caught: unknown };

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
    title: "Result unknown — check the run",
    description: `${failure.caught instanceof Error ? failure.caught.message : String(failure.caught)} `
      + "The command may already have been recorded: open the run and read its receipt before sending it again.",
  };
}
