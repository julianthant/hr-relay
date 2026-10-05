/**
 * The copy ONE refusal notice needs to be truthful in two different ceremonies
 * (D273 item 10).
 *
 * `park-resolve.tsx` and `identity-approve.tsx` each carried their own
 * `RefusedNotice`. The two were near-identical — same two arms, same split on
 * whether the server named a code, same enter transition — and near-identical
 * is the shape that drifts: the park copy's uncoded arm had already drifted to
 * "Nothing was recorded and your answer below is untouched", which repeats the
 * banner's own TITLE and drops the one fact the operator came for, while the
 * gate copy said the thing that was actually still true of it.
 *
 * What genuinely differs between the two is ONE clause: what is STILL TRUE
 * after the refusal. A parked write is still parked; an open gate is still
 * open. Everything else — the title, the untouched-answer promise, the
 * no-code-to-quote sentence — is the same sentence about the same event.
 *
 * So the clause is the parameter, and it is stated TWICE per ceremony rather
 * than case-folded from one form: the coded arm reads it mid-`MetaLine` in
 * lower case and the uncoded arm opens a sentence with it. A fold that
 * lower-cased the first character would work today and quietly mangle the first
 * ceremony whose standing fact begins with a proper noun, and this file exists
 * because "works today" is how the drift got here.
 *
 * It lives beside `refused-notice.tsx` rather than inside it because a module
 * that exports a component may export nothing else if React Fast Refresh is to
 * treat it as a refresh boundary (`dashboard-refresh-boundary`, ref
 * frontend-backend-integration §8.14).
 */

/**
 * A refusal as a ceremony dialog holds it: the server's sentence, and its code
 * when the server sent one. `conflict` never carries a code and `rejected`
 * always does (`CommandResultSchema`), so the optional field is the wire's own
 * shape, not a guess — and the notice's two arms split on exactly that.
 */
export interface Refused {
  readonly message: string;
  readonly code?: string;
}

/** Which ceremony is being refused. Both are real dialogs; there is no default. */
export type RefusedCeremony = "parked-write" | "identity-gate";

/**
 * What is STILL TRUE of the ceremony after the server said no, in the two
 * grammatical positions the notice reads it in.
 */
interface StandingFact {
  /** opens a sentence — "The write is still parked and your answer …" */
  readonly sentence: string;
  /** a `MetaLine` segment — "… · the write is still parked · your answer …" */
  readonly clause: string;
}

const STANDING: Readonly<Record<RefusedCeremony, StandingFact>> = Object.freeze({
  "parked-write": Object.freeze({
    sentence: "The write is still parked",
    clause: "the write is still parked",
  }),
  "identity-gate": Object.freeze({
    sentence: "The gate is still open",
    clause: "the gate is still open",
  }),
});

/**
 * The banner title, both arms, both ceremonies. It is the answer to the only
 * question the operator has at this moment — they pressed a verb that settles a
 * real HR write, and this says it did not settle anything.
 */
export const REFUSED_NOTICE_TITLE = "Nothing was recorded";

/** The composed copy one arm of the notice draws. */
export interface RefusedNoticeCopy {
  /**
   * the coded arm's `MetaLine` segments — the standing fact, then what was not
   * done. Two segments, not one `·`-joined string: `MetaLine`'s separators are
   * `aria-hidden`, while a literal middle dot inside one segment is read aloud.
   * The VISIBLE line is unchanged — the joined form remains the ratified copy.
   */
  readonly segments: readonly [standing: string, outcome: string];
  /** the joined coded line, byte-identical to the ratified pre-merge strings */
  readonly outcome: string;
  /** the uncoded arm's sentence, printed AFTER the server's own message */
  readonly uncoded: string;
}

/**
 * The two ceremonies' copy, composed from the one clause that differs.
 *
 * Neither string interpolates the server's message: the message is the server's
 * own sentence and it is rendered as its own node, so a refusal whose text
 * happens to contain a brace or a percent cannot be re-read as a template.
 */
export function refusedNoticeCopy(ceremony: RefusedCeremony): RefusedNoticeCopy {
  const standing = STANDING[ceremony];
  const untouched = "your answer below is untouched";
  return {
    segments: [standing.clause, untouched],
    outcome: `${standing.clause} · ${untouched}`,
    uncoded:
      `${standing.sentence} and your answer below is untouched — but the server sent no `
      + "refusal code, so there is nothing here to quote in a bug report.",
  };
}
