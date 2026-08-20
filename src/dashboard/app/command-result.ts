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
 */
import type { CommandResult } from "../../domain/commands.js";

export type CommandSettlement =
  /** The command landed — `already-applied` is a replay of the same landing. */
  | { readonly kind: "applied"; readonly replayed: boolean }
  /** The command did NOT land. `problem` is what the operator reads. */
  | { readonly kind: "refused"; readonly reason: "conflict" | "rejected"; readonly problem: string };

export function settleCommandResult(result: CommandResult): CommandSettlement {
  switch (result.state) {
    case "applied":
      return { kind: "applied", replayed: false };
    case "already-applied":
      return { kind: "applied", replayed: true };
    case "conflict":
      return {
        kind: "refused",
        reason: "conflict",
        // The server's own sentence first, then the number that resolves it.
        // Never "try again": a re-send of the same envelope would carry the
        // same stale `expectedVersion` and be refused identically.
        problem: `${result.message} The server is now at version ${String(result.currentVersion)} — `
          + "reopen the run to see what changed before re-applying.",
      };
    case "rejected":
      return { kind: "refused", reason: "rejected", problem: result.message };
  }
}
