import { publicTransactionKeyDigest, PublicTransactionKeyDigestSchema } from "../write-safety/protected-input.js";
/** Resolve live ledger pointers by proof schema hash; system/completion kind may name two contracts. */
import { z } from "zod";

import { KualiSaveSeparationFinalization } from "../systems/kuali/save-separation-finalization.js";
import { UcpathPendingSweepProofSchema } from "../ui/ucpath-smart-hr-termination.js";
import { UcpathCreateTermination } from "../systems/ucpath/create-termination.js";
import { UcpathDeletePendingTerminations } from "../systems/ucpath/delete-pending-terminations.js";
import { FingerprintSchema, NonNegativeIntSchema } from "../../rules/identity/ids.js";
import { directIdentifierDisplay } from "../../rules/redaction/redaction.js";
import { LedgerCompletionKindSchema, LedgerProofSourceSchema } from "../../rules/runs/ledger-primitives.js";
import { deriveSchemaHash } from "../validation/schema-bound-value.js";

/** The pointer an archived record holds, from its OWN schema so the two cannot drift; the ledger enums come from `ledger-primitives.js` because this module lands on the dashboard bundle. */
export const LedgerLinePointerSchema = z.strictObject({ system: z.string().min(1), date: z.iso.date(), sequence: NonNegativeIntSchema });
export type LedgerLinePointer = z.infer<typeof LedgerLinePointerSchema>;

/** How a presentation column reads: a value, or the reason there is none — never an empty string. */
const LedgerColumnSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), value: z.string().min(1) }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);
export type LedgerColumn = z.infer<typeof LedgerColumnSchema>;

/** Every way a pointer can fail to resolve; each names a genuinely different operator situation. */
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
    /** The permanent key digest; the authority-only natural key never crosses this wire. */
    idempotencyKeyDigest: PublicTransactionKeyDigestSchema,
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

/** How to read an `action` and `confirmation` out of one commit contract's proof, keyed by its schema hash: leaves are read only out of a value that schema accepted. */
/* Not exported: this table carries a zod schema and two functions, so exporting it would claim a wire contract nothing crosses. */
interface LedgerPresentationDeclaration {
  /** The commit contract this declaration speaks for, for the refusal text. */
  readonly taskId: string;
  /** The contract's own proof schema — the value's shape AND its identity. */
  readonly proofSchema: z.ZodTypeAny;
  /** Frozen schemas this same task used before a contract evolution. */
  readonly historicalProofSchemas?: readonly z.ZodTypeAny[];
  /** Reads the HR action out of this contract's own parsed proof. */
  action(proof: unknown): LedgerColumn;
  /** Reads the confirmation the external system returned, on the same terms. */
  confirmation(proof: unknown): LedgerColumn;
}

function pendingSweepAction(proof: unknown): LedgerColumn {
  const value = UcpathPendingSweepProofView.parse(proof);
  return {
    state: "present",
    value: `Cleared pending terminations for ${directIdentifierDisplay(value.emplId)} (grid scanned ${String(value.scannedRowCount)} rows)`,
  };
}

function pendingSweepConfirmation(): LedgerColumn {
  return noSuchColumn(
    "UCPath issues no confirmation number for an in-progress-grid delete; the current proof's selected "
    + "transaction ids identify the authorized set and are not a confirmation emitted by UCPath",
  );
}

/** A declared column this contract's write genuinely has no value for, rather than the undeclared fallback that says nobody looked. */
function noSuchColumn(reason: string): LedgerColumn {
  return { state: "absent", reason };
}

export const LEDGER_PRESENTATION_DECLARATIONS: readonly LedgerPresentationDeclaration[] = Object.freeze([
    /* Separations' three commit contracts, in the order the composed graph files them; every label is composed from leaves the proof schema declares. */
  {
    taskId: UcpathDeletePendingTerminations.id,
    proofSchema: UcpathDeletePendingTerminations.writeSafety.completion.proofSchema,
    historicalProofSchemas: [UcpathPendingSweepProofSchema],
    action: pendingSweepAction,
        /* No confirmation is a property of the write, not a gap: after Delete the rows are gone and an authorized selected ID must not be served as one. */
    confirmation: pendingSweepConfirmation,
  },
  {
    taskId: UcpathCreateTermination.id,
    proofSchema: UcpathCreateTermination.writeSafety.completion.proofSchema,
    action: (proof) => {
      const value = UcpathTerminationProofView.parse(proof);
      return {
        state: "present",
        value: `Termination for ${directIdentifierDisplay(value.emplId)} effective ${value.effectiveDate} (${value.approvalStatus})`,
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
        value: `Separation finalization saved on Kuali document ${value.documentNumber} for ${directIdentifierDisplay(value.observedEid)}`,
      };
    },
        /* Kuali's save is UI-silent; its proof is a reload read-back, which is evidence the document holds the values, not a receipt. */
    confirmation: () => noSuchColumn(
      "Kuali's save returns no confirmation number; this contract proves completion by reloading the "
      + "document and reading the saved fields back, which is evidence rather than a receipt",
    ),
  },
]);

/** The leaves each declaration reads, as the narrowest schema that satisfies the read; loose on purpose, because the contract's own `proofSchema` validates the value. */
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

/** A declaration bound to the proof schema its hash was derived from; the hash is derived once at module load, as the write sequencer stamps a line. */
interface BoundLedgerPresentationDeclaration {
  readonly declaration: LedgerPresentationDeclaration;
  readonly proofSchema: z.ZodTypeAny;
}

const DECLARATIONS_BY_PROOF_HASH: ReadonlyMap<string, BoundLedgerPresentationDeclaration> = (() => {
  const byHash = new Map<string, BoundLedgerPresentationDeclaration>();
  for (const declaration of LEDGER_PRESENTATION_DECLARATIONS) {
    for (const proofSchema of [
      declaration.proofSchema,
      ...(declaration.historicalProofSchemas ?? []),
    ]) {
      const hash = FingerprintSchema.parse(deriveSchemaHash(proofSchema, "output"));
      const existing = byHash.get(hash);
      if (existing !== undefined) {
        throw new Error(
          `${declaration.taskId} and ${existing.declaration.taskId} declare proof schemas with the same hash ${hash}; a `
          + "ledger line could not say which contract wrote it",
        );
      }
      byHash.set(hash, { declaration, proofSchema });
    }
  }
  return byHash;
})();

/** One entry's declared reading of a column, or the reason there is none. */
function readDeclaredColumn(
  entry: LedgerEntryFacts,
  column: "action" | "confirmation",
): LedgerColumn {
  const bound = DECLARATIONS_BY_PROOF_HASH.get(entry.proof.schemaHash);
  if (bound === undefined) {
    return {
      state: "absent",
      reason: `no commit contract declares how to read a ${column} out of a proof bound to schema `
        + `${entry.proof.schemaHash}; the entry's proof is schema-bound to the contract that wrote it and `
        + "sniffing a field name out of it would be a guess on an HR record",
    };
  }
  const parsed = bound.proofSchema.safeParse(entry.proof.value);
  if (!parsed.success) {
          /* The hash named this contract and its own schema refuses the value: that is a disagreement about a real HR record, reported by name. */
    return {
      state: "absent",
      reason: `this line's proof names ${bound.declaration.taskId}'s schema and does not satisfy it, so its `
        + `${column} cannot be read: ${parsed.error.message}`,
    };
  }
  return column === "action"
    ? bound.declaration.action(parsed.data)
    : bound.declaration.confirmation(parsed.data);
}

/** Exactly the entry fields this presentation reads, named to keep the module off `src/domain/ledger.ts` and `node:crypto`. */
/* Not exported: it is one function's argument shape, and exporting it would claim a boundary contract nothing crosses. */
interface LedgerEntryFacts {
  readonly system: string;
  readonly instance: "prod" | "test";
  readonly idempotencyKeyDigest: string;
  readonly completionKind: z.infer<typeof LedgerCompletionKindSchema>;
  readonly proofSource: z.infer<typeof LedgerProofSourceSchema>;
  readonly confirmedAt: string;
  readonly proof: Readonly<{ schemaHash: string; value: unknown }>;
}

/** Turn one found ledger entry into the row the Write-ledger card renders; the pointer is echoed back so a `sequence-mismatch` refusal has something to mismatch against. */
export function resolveLedgerLine(
  pointer: LedgerLinePointer,
  entry: LedgerEntryFacts,
  protectedTransaction = false,
): ResolvedLedgerLineWire {
  return ResolvedLedgerLineWireSchema.parse({
    state: "resolved",
    pointer,
    system: entry.system,
    instance: entry.instance,
    idempotencyKeyDigest: publicTransactionKeyDigest(entry.idempotencyKeyDigest, protectedTransaction),
    completionKind: entry.completionKind,
    proofSource: entry.proofSource,
    confirmedAt: entry.confirmedAt,
    action: protectedTransaction ? { state: "absent", reason: "protected transaction details withheld" } : readDeclaredColumn(entry, "action"),
    confirmation: protectedTransaction ? { state: "absent", reason: "protected transaction details withheld" } : readDeclaredColumn(entry, "confirmation"),
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
