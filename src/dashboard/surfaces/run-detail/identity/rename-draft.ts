/**
 * What the operator typed into the rename dialog, checked where they typed it
 * (D233).
 *
 * The shape is `identity-ceremony.ts`'s and for the same reason: the value the
 * dialog collects is the one thing `composeCommandRequest` may not invent, so
 * the rule that decides whether it can be sent is a PURE function, testable
 * without a browser, shared by the field's own message and the composer's
 * refusal. The composer calls it as a backstop; the field calls it so a
 * refusal is never the first the operator hears of a bound.
 *
 * EVERY BOUND HERE IS `RunDisplayNameSchema`'s (`src/domain/commands.ts:90`),
 * restated in the operator's words and nothing more. The schema is the
 * authority — it runs again at the wire, and it would refuse a name this file
 * let through. What this file must never do is invent a bound the kernel does
 * not hold: a client-side maximum shorter than 120, or a character class the
 * server accepts, would be this surface refusing a legitimate name with a
 * sentence no server would ever say.
 *
 * The one place it is deliberately LOOSER than the schema is leading and
 * trailing whitespace. `RunDisplayNameSchema` demands an already-trimmed value;
 * a person typing a name will land a trailing space constantly, and refusing
 * that is refusing a name they typed correctly. So the draft is trimmed before
 * it is judged and before it is sent, and the trim is the only transformation —
 * nothing else about the text is normalised on the operator's behalf.
 */

/** `RunDisplayNameSchema`'s own bound, restated. */
const MAX_CODE_POINTS = 120;

/**
 * Why this name cannot be sent, in the words the operator has to act on — or
 * `undefined` when it can.
 *
 * Takes the RAW field text and trims it itself, so a caller cannot forget to.
 */
export function renameDraftProblem(draft: string): string | undefined {
  const name = draft.trim();
  if (name.length === 0) {
    return "Type a name for this run, or cancel to keep the one it has.";
  }
  const codePoints = [...name].length;
  if (codePoints > MAX_CODE_POINTS) {
    return `A run name is at most ${String(MAX_CODE_POINTS)} characters; this one is ${String(codePoints)}.`;
  }
  if (/\p{Cc}/u.test(name)) {
    return "A run name cannot contain control characters. This usually means the text was pasted from "
      + "somewhere that carried a line break or a tab.";
  }
  if (name.normalize("NFC") !== name) {
    // Not normalised FOR them: two names that look identical and are stored
    // differently is exactly the ambiguity the durable schema refuses, and
    // silently rewriting what somebody typed is a substitution.
    return "This name uses characters in a form the run record cannot store. Retyping the accented "
      + "characters rather than pasting them usually resolves it.";
  }
  return undefined;
}

/**
 * The name to SEND, or `undefined` when the draft is not yet sendable.
 *
 * Deliberately not a command: composing the envelope stays with
 * `composeCommandRequest`, the one place a served control becomes a command.
 * This function's whole job is to say what the human wrote.
 */
export function renameAnswer(draft: string): string | undefined {
  if (renameDraftProblem(draft) !== undefined) return undefined;
  return draft.trim();
}
