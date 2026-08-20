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
 *
 * ## The declaration is keyed by the PROOF SCHEMA HASH, not by the system
 *
 * `(system, completionKind)` looks like the natural key and cannot work:
 * separations files two different UCPath writes — the pending-transaction
 * sweep and the termination itself — and both are `save-verify` on `ucpath`,
 * so one key would name two contracts. What DOES identify the contract is
 * already on the line: `proof.schemaHash` is
 * `deriveSchemaHash(commitContract.writeSafety.completion.proofSchema)`, the
 * exact value the write sequencer stamped when it filed. So a declaration
 * carries the contract's own proof schema, derives that same hash from it, and
 * PARSES the stored proof through it before reading a leaf — a line whose
 * proof does not satisfy the schema its hash names is reported, never read
 * past.
 *
 * Importing the commit contracts here is safe and is checked two ways: their
 * closure reaches no Node built-in (ref frontend-backend-integration §8.13 — this module lands on the
 * dashboard bundle) and no descriptor module (`archive-invariants` — an
 * archived run must render with its originating descriptor absent). A task
 * CONTRACT is neither: it is the schema of one write, and interpreting a
 * ledger line with current code is exactly right, because the ledger is never
 * archived and stays an audit record in its own lifecycle.
 */
import { z } from "zod";
import { ArchivedEvidencePointersSchema } from "./model.js";
import { KualiSaveSeparationFinalization } from "../contracts/kuali/save-separation-finalization.js";
import { UcpathCreateTermination } from "../contracts/ucpath/create-termination.js";
import { UcpathDeletePendingTerminations } from "../contracts/ucpath/delete-pending-terminations.js";
import { FingerprintSchema } from "../ids.js";
import { LedgerCompletionKindSchema, LedgerProofSourceSchema } from "../ledger-primitives.js";
import { deriveSchemaHash } from "../schema-bound-value.js";

/**
 * The pointer an archived record holds — never the line itself, and taken
 * from the archived record's OWN schema so the two cannot drift.
 *
 * The enums come from `ledger-primitives.js` rather than `ledger.js` because
 * this module lands on a wire the dashboard bundle reaches, and `ledger.js`
 * imports `write-safety.js`, which imports `node:crypto` (ref frontend-backend-integration §8.13 — a
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
 * the one thing ref write-safety §6 forbids projecting past.
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
 * ledger entry, declared per PROOF SCHEMA — see the module header for why the
 * hash and not `(system, completionKind)` is the key.
 *
 * Each entry names the contract it speaks for, carries that contract's own
 * `proofSchema`, and reads leaves only out of a value that schema accepted. A
 * column a contract genuinely has no value for is an `absent` with the reason
 * — which is a DIFFERENT and stronger statement than "nothing declares this":
 * it says a human looked at this write and found the external system returns
 * no such thing.
 */
/*
 * NOT exported, for the same reason `LedgerEntryFacts` is not: it is this
 * module's own table shape, and it carries a zod SCHEMA and two functions —
 * values no boundary schema can describe. Exporting it would claim a wire
 * contract that nothing crosses. Callers read the frozen list itself.
 */
interface LedgerPresentationDeclaration {
  /** The commit contract this declaration speaks for, for the refusal text. */
  readonly taskId: string;
  /** The contract's own proof schema — the value's shape AND its identity. */
  readonly proofSchema: z.ZodTypeAny;
  /** Reads the HR action out of this contract's own parsed proof. */
  action(proof: unknown): LedgerColumn;
  /** Reads the confirmation the external system returned, on the same terms. */
  confirmation(proof: unknown): LedgerColumn;
}

/**
 * A declared column that this contract's write genuinely has no value for.
 *
 * It exists so a declaration can say "UCPath's in-progress-grid delete returns
 * no confirmation number" rather than leaving the column to the undeclared
 * fallback, which would say the opposite thing — that nobody has looked.
 */
function noSuchColumn(reason: string): LedgerColumn {
  return { state: "absent", reason };
}

export const LEDGER_PRESENTATION_DECLARATIONS: readonly LedgerPresentationDeclaration[] = Object.freeze([
  /*
   * Separations' three commit contracts, in the order the composed graph files
   * them. Every label below is composed from leaves the proof SCHEMA declares,
   * so a contract that changes its proof changes its hash and this declaration
   * stops matching — loudly, as an undeclared line — rather than reading a leaf
   * that has moved.
   */
  {
    taskId: UcpathDeletePendingTerminations.id,
    proofSchema: UcpathDeletePendingTerminations.writeSafety.completion.proofSchema,
    action: (proof) => {
      const value = UcpathPendingSweepProofView.parse(proof);
      return {
        state: "present",
        value: `Cleared pending terminations for ${value.emplId} (grid scanned ${String(value.scannedRowCount)} rows)`,
      };
    },
    /*
     * There is no confirmation and that is a property of the write, not a gap
     * in this table. The proof deliberately does NOT list what was deleted —
     * after the Delete click those rows are gone, so a post-click read cannot
     * name them — and UCPath issues no receipt for a grid delete. Reporting the
     * transaction id the sweep removed would be quoting an intention back as a
     * confirmation.
     */
    confirmation: () => noSuchColumn(
      "UCPath issues no confirmation number for an in-progress-grid delete, and this contract's proof "
      + "deliberately records only what a post-delete scan could see",
    ),
  },
  {
    taskId: UcpathCreateTermination.id,
    proofSchema: UcpathCreateTermination.writeSafety.completion.proofSchema,
    action: (proof) => {
      const value = UcpathTerminationProofView.parse(proof);
      return {
        state: "present",
        value: `Termination for ${value.emplId} effective ${value.effectiveDate} (${value.approvalStatus})`,
      };
    },
    /** UCPath's own transaction id, read back off the Smart HR detail page. */
    confirmation: (proof) => ({ state: "present", value: UcpathTerminationProofView.parse(proof).transactionId }),
  },
  {
    taskId: KualiSaveSeparationFinalization.id,
    proofSchema: KualiSaveSeparationFinalization.writeSafety.completion.proofSchema,
    action: (proof) => {
      const value = KualiSavedFinalizationProofView.parse(proof);
      return {
        state: "present",
        value: `Separation finalization saved on Kuali document ${value.documentNumber} for ${value.observedEid}`,
      };
    },
    /*
     * Kuali's save is UI-silent (D128): it returns HTTP 200 and a rendered
     * "Form saved" and issues no number. The proof is a RELOAD READ-BACK, which
     * is evidence that the document holds the values — stronger than a receipt,
     * and not a receipt. The document number is the target, not a confirmation,
     * and serving it here would let a reader take it for one.
     */
    confirmation: () => noSuchColumn(
      "Kuali's save returns no confirmation number; this contract proves completion by reloading the "
      + "document and reading the saved fields back, which is evidence rather than a receipt",
    ),
  },
]);

/**
 * The leaves each declaration reads, re-stated as the narrowest schema that
 * satisfies the read.
 *
 * They are `looseObject`s on purpose: the contract's own `proofSchema` is what
 * VALIDATES the value (`readDeclaredColumn` parses through it first), and this
 * second parse exists only to give the label composition typed access to the
 * leaves it names. A strict restatement here would be a second authority over
 * the proof's shape, which is exactly the fork D215 caught one directory over.
 */
const UcpathPendingSweepProofView = z.looseObject({
  emplId: z.string().min(1),
  scannedRowCount: z.number().int().nonnegative(),
});
const UcpathTerminationProofView = z.looseObject({
  emplId: z.string().min(1),
  effectiveDate: z.string().min(1),
  approvalStatus: z.string().min(1),
  transactionId: z.string().min(1),
});
const KualiSavedFinalizationProofView = z.looseObject({
  documentNumber: z.string().min(1),
  observedEid: z.string().min(1),
});

/**
 * Every declaration's proof-schema hash, derived ONCE at module load from the
 * contract's own schema — the same derivation the write sequencer performs
 * when it stamps the line. Two declarations that hashed alike would mean two
 * contracts with byte-identical proofs, which is a real ambiguity and is
 * refused here rather than resolved by list order.
 */
const DECLARATIONS_BY_PROOF_HASH: ReadonlyMap<string, LedgerPresentationDeclaration> = (() => {
  const byHash = new Map<string, LedgerPresentationDeclaration>();
  for (const declaration of LEDGER_PRESENTATION_DECLARATIONS) {
    const hash = FingerprintSchema.parse(deriveSchemaHash(declaration.proofSchema, "output"));
    const existing = byHash.get(hash);
    if (existing !== undefined) {
      throw new Error(
        `${declaration.taskId} and ${existing.taskId} declare proof schemas with the same hash ${hash}; a `
        + "ledger line could not say which contract wrote it",
      );
    }
    byHash.set(hash, declaration);
  }
  return byHash;
})();

/** One entry's declared reading of a column, or the reason there is none. */
function readDeclaredColumn(
  entry: LedgerEntryFacts,
  column: "action" | "confirmation",
): LedgerColumn {
  const declaration = DECLARATIONS_BY_PROOF_HASH.get(entry.proof.schemaHash);
  if (declaration === undefined) {
    return {
      state: "absent",
      reason: `no commit contract declares how to read a ${column} out of a proof bound to schema `
        + `${entry.proof.schemaHash}; the entry's proof is schema-bound to the contract that wrote it and `
        + "sniffing a field name out of it would be a guess on an HR record",
    };
  }
  const parsed = declaration.proofSchema.safeParse(entry.proof.value);
  if (!parsed.success) {
    /*
     * The hash said this contract wrote the line and the contract's own schema
     * refuses the value. That is a disagreement about a real HR record, so it
     * is reported by name — reading the leaves anyway would present a value
     * nothing validated.
     */
    return {
      state: "absent",
      reason: `this line's proof names ${declaration.taskId}'s schema and does not satisfy it, so its `
        + `${column} cannot be read: ${parsed.error.message}`,
    };
  }
  return column === "action" ? declaration.action(parsed.data) : declaration.confirmation(parsed.data);
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
  readonly proof: Readonly<{ schemaHash: string; value: unknown }>;
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
