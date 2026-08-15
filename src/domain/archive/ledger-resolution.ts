/**
 * Resolving an archived run's ledger POINTERS against the live ledger.
 *
 * D179's rule stands and this is what makes it liveable: the ledger is never
 * archived, so an archived record names `(system, date, sequence)` and copies
 * nothing. The Write-ledger card then has ids and no content — it cannot say
 * what was filed or what came back, which is exactly what a relaunch's "this
 * run already filed X" needs. The answer is a READ-THROUGH: the pointer keeps
 * naming the line, and the surface resolves it when it renders.
 *
 * The resolution is a closed union with one settled arm and one refusal,
 * because the ways a pointer can fail to name a line are not the same fact as
 * the line's contents, and a card that dropped the failures would silently
 * shrink the list of what a run filed — the one list an operator must not see
 * short.
 *
 * ## Why `action` and `confirmation` are unions too
 *
 * A ledger entry (`src/domain/ledger.ts`) declares no action label and no
 * confirmation number. It carries the system, the instance, the permanent
 * idempotency key, the completion KIND, the proof source and the instants —
 * and its `proof` is a `SchemaBoundCanonicalValue` whose shape belongs to
 * whichever commit contract wrote it. Sniffing a field name out of that value
 * is the mistake D204 names by hand: a closed presentation fed from an
 * author-controlled payload needs a DECLARED mapping. So the two columns are
 * served as reasoned absences until a commit contract declares how to read
 * them, and `LEDGER_PRESENTATION_DECLARATIONS` is where that declaration goes.
 * An invented label on the one record that says what we did to a real person's
 * employment is worse than a blank.
 */
import { z } from "zod";
import { ArchivedEvidencePointersSchema } from "./model.js";
import { LedgerCompletionKindSchema, LedgerProofSourceSchema } from "../ledger-primitives.js";

/**
 * The pointer an archived record holds — never the line itself, and taken
 * from the archived record's OWN schema so the two cannot drift.
 *
 * The enums come from `ledger-primitives.js` rather than `ledger.js` because
 * this module lands on a wire the dashboard bundle reaches, and `ledger.js`
 * imports `write-safety.js`, which imports `node:crypto` (doc 13 §8.13 — a
 * browser-reachable Node built-in is a blank page in dev and a silent time
 * bomb in prod).
 */
export const LedgerLinePointerSchema = ArchivedEvidencePointersSchema.shape.ledgerPartitions.element;
export type LedgerLinePointer = z.infer<typeof LedgerLinePointerSchema>;

/**
 * How a presentation column reads: a value, or the reason there is none.
 * Absence is never an empty string — a blank cell and "nothing declares this"
 * are different facts and only one of them is actionable.
 */
const LedgerColumnSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), value: z.string().min(1) }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);
export type LedgerColumn = z.infer<typeof LedgerColumnSchema>;

/**
 * Every way a pointer can fail to resolve. Each is a genuinely different
 * operator situation: a partition file that is gone is a retention or a
 * deployment question, a sequence past the end is an archive that names a line
 * the projector never appended, and a malformed line is ledger corruption —
 * the one thing doc 09 §6 forbids projecting past.
 */
export const LedgerResolutionFailureSchema = z.enum([
  "partition-missing",
  "sequence-missing",
  "line-malformed",
  "sequence-mismatch",
]);
export type LedgerResolutionFailure = z.infer<typeof LedgerResolutionFailureSchema>;

export const ResolvedLedgerLineWireSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("resolved"),
    pointer: LedgerLinePointerSchema,
    /** The system the write was filed against, from the LINE, not the pointer. */
    system: z.string().min(1),
    instance: z.enum(["prod", "test"]),
    /** The permanent natural key naming exactly what was filed. */
    idempotencyKey: z.string().min(1),
    completionKind: LedgerCompletionKindSchema,
    proofSource: LedgerProofSourceSchema,
    confirmedAt: z.iso.datetime({ offset: true }),
    /** The HR action filed, when a commit contract declares how to read it. */
    action: LedgerColumnSchema,
    /** The confirmation the external system returned, on the same terms. */
    confirmation: LedgerColumnSchema,
  }),
  z.strictObject({
    state: z.literal("unresolved"),
    pointer: LedgerLinePointerSchema,
    failure: LedgerResolutionFailureSchema,
    reason: z.string().min(1),
  }),
]);
export type ResolvedLedgerLineWire = z.infer<typeof ResolvedLedgerLineWireSchema>;

/**
 * How to read an `action` and a `confirmation` out of ONE commit contract's
 * ledger entry, declared per `(system, completionKind)`.
 *
 * It is EMPTY, and that is a statement rather than an oversight: no commit
 * contract in this tree writes an action label or a confirmation number into
 * its ledger entry, so there is nothing truthful to read. A row added here
 * declares the leaf by name and the entry's own schema hash bounds it — which
 * is the difference between a mapping and a guess.
 */
export const LEDGER_PRESENTATION_DECLARATIONS: readonly Readonly<{
  system: string;
  completionKind: z.infer<typeof LedgerCompletionKindSchema>;
  /** Reads the HR action out of this contract's own proof value. */
  action(proof: unknown): LedgerColumn;
  /** Reads the confirmation the external system returned, on the same terms. */
  confirmation(proof: unknown): LedgerColumn;
}>[] = Object.freeze([]);

/** One entry's declared reading of a column, or the reason there is none. */
function readDeclaredColumn(
  entry: LedgerEntryFacts,
  column: "action" | "confirmation",
): LedgerColumn {
  const declaration = LEDGER_PRESENTATION_DECLARATIONS.find(
    (candidate) => candidate.system === entry.system && candidate.completionKind === entry.completionKind,
  );
  if (declaration === undefined) {
    return {
      state: "absent",
      reason: `no commit contract declares how to read a ${column} out of a ${entry.system} `
        + `${entry.completionKind} ledger entry; the entry's proof is schema-bound to the contract that `
        + "wrote it and sniffing a field name out of it would be a guess on an HR record",
    };
  }
  return column === "action" ? declaration.action(entry.proof.value) : declaration.confirmation(entry.proof.value);
}

/**
 * Exactly the entry fields this presentation reads. Naming them keeps the
 * module off `src/domain/ledger.ts` (and therefore off `node:crypto`) while
 * still being structurally satisfied by a real `LedgerEntryPayload`.
 */
/*
 * NOT exported: it is one function's argument shape, structurally satisfied by
 * a real `LedgerEntryPayload`, and exporting it would claim a boundary
 * contract nothing crosses.
 */
interface LedgerEntryFacts {
  readonly system: string;
  readonly instance: "prod" | "test";
  readonly idempotencyKey: string;
  readonly completionKind: z.infer<typeof LedgerCompletionKindSchema>;
  readonly proofSource: z.infer<typeof LedgerProofSourceSchema>;
  readonly confirmedAt: string;
  readonly proof: Readonly<{ value: unknown }>;
}

/**
 * Turn ONE found ledger entry into the row the Write-ledger card renders.
 *
 * The pointer is echoed back beside the line so a reader can see which
 * `(system, date, sequence)` produced this row — and so a `sequence-mismatch`
 * refusal below has something to be a mismatch AGAINST.
 */
export function resolveLedgerLine(
  pointer: LedgerLinePointer,
  entry: LedgerEntryFacts,
): ResolvedLedgerLineWire {
  return ResolvedLedgerLineWireSchema.parse({
    state: "resolved",
    pointer,
    system: entry.system,
    instance: entry.instance,
    idempotencyKey: entry.idempotencyKey,
    completionKind: entry.completionKind,
    proofSource: entry.proofSource,
    confirmedAt: entry.confirmedAt,
    action: readDeclaredColumn(entry, "action"),
    confirmation: readDeclaredColumn(entry, "confirmation"),
  });
}

/** A pointer that named no line, with the situation it actually is. */
export function unresolvedLedgerLine(
  pointer: LedgerLinePointer,
  failure: LedgerResolutionFailure,
  reason: string,
): ResolvedLedgerLineWire {
  return ResolvedLedgerLineWireSchema.parse({ state: "unresolved", pointer, failure, reason });
}
