// Match RunDisplayNameSchema’s bounds; trim drafts only, never silently normalize authored names.

/** `RunDisplayNameSchema`'s own bound, restated. */
const MAX_CODE_POINTS = 120;

/** Why this name cannot be sent, in the words the operator has to act on — or
 * `undefined` when it can. */
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
    return "A name cannot contain line breaks or tabs.";
  }
  if (name.normalize("NFC") !== name) {
    // Validate typed names without rewriting them; normalization would silently substitute another stored answer.
    return "Retype the accented characters instead of pasting them.";
  }
  return undefined;
}

/** Return the typed name only; envelope composition belongs to the shared composer. */
export function renameAnswer(draft: string): string | undefined {
  if (renameDraftProblem(draft) !== undefined) return undefined;
  return draft.trim();
}
