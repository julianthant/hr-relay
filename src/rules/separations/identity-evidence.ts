import { ProtectedInputBindingsSchema, type ProtectedInputBinding } from "../../models/write-safety/protected-input.js";
/** The identity-approval **decision packet** — everything needed to decide without leaving the dashboard, as a pure fold over facts the run already read. */
import { z } from "zod";
import { canonicalJsonStringify } from "../validation/canonical-json.js";
import { FingerprintSchema, EidSchema, IsoInstantSchema } from "../identity/ids.js";
import { directIdentifierDisplay } from "../redaction/redaction.js";
import type { Fingerprint } from "../identity/ids.js";
import {
  NameSimilarityTierSchema,
  classifyNameSimilarity,
} from "../matching/name-match.js";
import { sha256Hex } from "../validation/sha256.js";
import type { UcpathCandidate, UcpathPersonSelection } from "../../models/systems/ucpath/search-person-org.js";
import type { UcpathJobSummary } from "../../models/ui/ucpath-job-summary.js";
import {
  JobSummaryClassificationSchema,
  classifyJobSummary,
} from "./job-summary-classification.js";
import { SeparationWritePlanSchema } from "./write-plan.js";
import type { SeparationWritePlan } from "./write-plan.js";

/** Retain the source of the EID being checked. */
export const IdentityEidSourceSchema = z.enum(["document-eid", "canonical-eid", "name-resolved"]);
export type IdentityEidSource = z.infer<typeof IdentityEidSourceSchema>;

export const IdentityCandidateSchema = z.strictObject({
  eid: EidSchema,
  name: z.string().min(1),
  department: z.string().min(1),
  jobTitle: z.string().min(1),
  employeeStatus: z.enum(["active", "inactive", "terminated", "unknown"]),
});
export type IdentityCandidate = z.infer<typeof IdentityCandidateSchema>;

export const IdentityComparisonFieldSchema = z.enum([
  "name",
  "eid",
  "employment",
  "name-search",
]);

export const IdentityFieldComparisonSchema = z.strictObject({
  field: IdentityComparisonFieldSchema,
  /** What the separation document (or the run's own claim) says. */
  documentValue: z.string().min(1),
  /** What UCPath showed. */
  ucpathValue: z.string().min(1),
  agrees: z.boolean(),
  /** Why this comparison matters, in the words an operator needs. */
  note: z.string().min(1),
});
export type IdentityFieldComparison = z.infer<typeof IdentityFieldComparisonSchema>;

/** What a search on the DOCUMENT'S NAME resolves, run on every identity check, so the two-candidate presentation exists on every run rather than only on the runs a threshold selects. */
export const IdentityNameSearchSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("resolved"),
    candidate: IdentityCandidateSchema,
    candidateEids: z.array(EidSchema).min(1),
  }),
  z.strictObject({
    status: z.literal("ambiguous"),
    candidateEids: z.array(EidSchema).min(2),
  }),
  z.strictObject({
    status: z.literal("not-found"),
    candidateEids: z.array(EidSchema).max(0),
  }),
]);

export const IdentityApprovalShapeSchema = z.enum([
  "one-click",
  "choose-a-candidate",
]);
export type IdentityApprovalShape = z.infer<typeof IdentityApprovalShapeSchema>;

export const IdentityEvidencePacketSchema = z.strictObject({
  protectedBindings: ProtectedInputBindingsSchema.optional(),
  documentNumber: z.string().min(1),
  /** The EID this run checked, and where it came from. */
  emplId: EidSchema,
  emplIdSource: IdentityEidSourceSchema,
  /** The document's own EID field as text — the value, or why it had none. */
  documentEidText: z.string().min(1),
  /** The name the separation document carries, verbatim. */
  documentName: z.string().min(1),
  /** The name the UCPath Person Org detail page displays, verbatim. */
  ucpathName: z.string().min(1),
  nameTier: NameSimilarityTierSchema,
  /** Disagreements first, then agreements. Order is part of the contract. */
  comparisons: z.array(IdentityFieldComparisonSchema).min(1),
  nameSearch: IdentityNameSearchSchema,
  jobs: JobSummaryClassificationSchema,
    /* What the writes will consume, or a stated reason this graph composes none; it rides INSIDE the packet so the digest binds the approval to the values themselves. */
  plan: SeparationWritePlanSchema,
  /** Every EID a human may legitimately approve on this packet. */
  approvableEids: z.array(EidSchema).min(1),
  approvalShape: IdentityApprovalShapeSchema,
  /** The instant the job-summary read observed the page. */
  observedAt: IsoInstantSchema,
});
export type IdentityEvidencePacket = z.infer<typeof IdentityEvidencePacketSchema>;

/** The digest an approval binds to: it hashes the PARSED packet, so an approval granted on one packet cannot be replayed against a different one. */
export function deriveIdentityEvidenceDigest(packet: IdentityEvidencePacket): Fingerprint {
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:identity-evidence:v1\u0000${canonicalJsonStringify(IdentityEvidencePacketSchema.parse(packet))}`,
  ));
}

function candidateFrom(candidate: UcpathCandidate): IdentityCandidate {
  return IdentityCandidateSchema.parse({
    eid: candidate.emplId,
    name: candidate.name,
    department: candidate.department,
    jobTitle: candidate.jobTitle,
    employeeStatus: candidate.employeeStatus,
  });
}

function nameSearchFrom(selection: UcpathPersonSelection): z.infer<typeof IdentityNameSearchSchema> {
  if (selection.status === "resolved") {
    return IdentityNameSearchSchema.parse({
      status: "resolved",
      candidate: candidateFrom(selection.selected),
      candidateEids: selection.candidateEids,
    });
  }
  return IdentityNameSearchSchema.parse(
    selection.status === "ambiguous"
      ? { status: "ambiguous", candidateEids: selection.candidateEids }
      : { status: "not-found", candidateEids: [] },
  );
}


/** Deliberately NOT exported and deliberately NOT schema-backed: it is a function's argument list, not a boundary, and the packet it builds is parsed through its schema before it is returned. */
interface IdentityEvidenceInput {
  readonly protectedBindings?: readonly ProtectedInputBinding[];
  readonly documentNumber: string;
  readonly documentName: string;
  readonly documentEidText: string;
  readonly emplIdSource: IdentityEidSource;
  readonly documentEidConflicts: boolean;
  readonly jobSummary: UcpathJobSummary;
  readonly nameSelection: UcpathPersonSelection;
  readonly plan: SeparationWritePlan;
}

export function buildIdentityEvidencePacket(
  input: IdentityEvidenceInput,
): IdentityEvidencePacket {
  const jobs = classifyJobSummary(input.jobSummary.jobRows);
  const nameSearch = nameSearchFrom(input.nameSelection);
  const nameTier = classifyNameSimilarity(input.documentName, input.jobSummary.displayedName);
  const nameSearchEid = nameSearch.status === "resolved" ? nameSearch.candidate.eid : undefined;
  const nameSearchAgrees = nameSearchEid === input.jobSummary.emplId;

  const nameSearchValue = nameSearch.status === "resolved"
    ? `${nameSearch.candidate.name} (${directIdentifierDisplay(nameSearch.candidate.eid)}, ${nameSearch.candidate.jobTitle})`
    : nameSearch.status === "ambiguous"
      ? `${String(nameSearch.candidateEids.length)} candidates: ${nameSearch.candidateEids.map(directIdentifierDisplay).join(", ")}`
      : "no UCPath person matched this name";

  const comparisons: IdentityFieldComparison[] = [
    {
      field: "name",
      documentValue: input.documentName,
      ucpathValue: input.jobSummary.displayedName,
      agrees: nameTier === "same",
      note: nameTier === "same"
        ? "the two spellings agree token for token"
        : nameTier === "similar"
          ? "the spellings differ within two edits per token — close enough to be a typo AND close "
            + "enough to be two different people (S15); supplied EID read-back decides whether approval is required"
          : "the names do not match; a common-name re-search resolving a different career employee is "
            + "exactly how T002173685 terminated the wrong person (S17)",
    },
    {
      field: "eid",
      documentValue: input.documentEidText,
      ucpathValue: input.jobSummary.emplId,
      agrees: !input.documentEidConflicts && input.emplIdSource === "document-eid",
      note: input.emplIdSource === "document-eid"
        ? "the checked EID is the one the separation document carries"
        : input.emplIdSource === "canonical-eid"
          ? "the harness supplied the checked EID independently; UCPath's actual detail read-back must match it"
          : "the separation document did not supply this EID; it was resolved by name (S18), so the "
            + "document itself confirms nothing about who this is",
    },
    {
      field: "employment",
      documentValue: "a separation is being prepared for this person",
      ucpathValue: `${jobs.disposition} — ${String(jobs.activeRowCount)} active of `
        + `${String(jobs.rowCount)} employment rows`,
      agrees: jobs.disposition === "single-active-job",
      note: jobs.disposition === "single-active-job"
        ? "exactly one active employment, which is the ordinary separation shape"
        : jobs.disposition === "no-active-job"
          ? "UCPath shows no active employment — this person may already be fully separated (S21/S22)"
          : jobs.disposition === "concurrent-active-jobs"
            ? "more than one active employment; which job is being separated is not derivable (S23)"
            : "at least one employment row carries an HR status this system does not recognize",
    },
    {
      field: "name-search",
      documentValue: `a UCPath search on "${input.documentName}"`,
      ucpathValue: nameSearchValue,
      agrees: nameSearchAgrees,
      note: nameSearchAgrees
        ? "searching the document's name resolves the same person the document's EID does"
        : "searching the document's name does NOT resolve the person being checked; both candidates "
          + "remain visible; an exact supplied EID read-back takes precedence, while name-only identity requires approval",
    },
  ];
  comparisons.sort((left, right) => Number(left.agrees) - Number(right.agrees));

  const approvableEids = [...new Set([
    input.jobSummary.emplId,
    ...nameSearch.candidateEids,
  ])];

  return protectIdentityEvidencePacket(IdentityEvidencePacketSchema.parse({
    documentNumber: input.documentNumber,
    emplId: input.jobSummary.emplId,
    emplIdSource: input.emplIdSource,
    documentEidText: input.documentEidText,
    documentName: input.documentName,
    ucpathName: input.jobSummary.displayedName,
    nameTier,
    comparisons,
    nameSearch,
    jobs,
    plan: SeparationWritePlanSchema.parse(input.plan),
    approvableEids,
    approvalShape: approvableEids.length > 1 ? "choose-a-candidate" : "one-click",
    observedAt: input.jobSummary.observedAt,
  }), input.protectedBindings);
}

/** The displayed approval binds retained identity; execution still uses the private canonical input. */
export function protectIdentityEvidencePacket(packet: IdentityEvidencePacket, bindings?: readonly ProtectedInputBinding[]): IdentityEvidencePacket {
  if (bindings === undefined || !bindings.some(({ inputPath }) => inputPath === "documentNumber")) return packet;
  return IdentityEvidencePacketSchema.parse({ ...packet, protectedBindings: bindings,
    documentNumber: "protected document", plan: packet.plan.state === "planned"
      ? { ...packet.plan, document: { ...packet.plan.document, documentNumber: "protected document" } } : packet.plan });
}
