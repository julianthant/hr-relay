/**
 * The identity-approval **decision packet** — ref write-safety §14.4's "everything needed
 * to decide without leaving the dashboard", as a pure fold over facts the run
 * already read.
 *
 * ## Nothing here is minted; everything is derived
 *
 * The packet is a function of the run's own stored node outputs (the job-summary
 * read, the name search, the run input). That is the D82 shape, and for the same
 * reason: an approval must bind to evidence that can be RE-DERIVED and compared,
 * so `deriveIdentityEvidenceDigest` over the same stored outputs yields the same
 * bytes, and ref write-safety §14.5's "an approval never survives the disappearance of
 * what it approved" becomes a byte comparison instead of a judgement call.
 *
 * ## Disconfirming evidence FIRST (ref write-safety §14.6 risk 1)
 *
 * `comparisons` is ordered disagreements-first, always. ALWAYS-GATE's dominant
 * failure mode is rubber-stamping: a control that fires on every run and is
 * almost always obviously right trains the operator to approve without reading.
 * Putting the fields that DISAGREE at the top of the packet is the cheap half of
 * the answer; `approvalShape` is the expensive half.
 *
 * ## `approvalShape` is a policy, and it is computed here on purpose
 *
 * §14.6 requires the *shape of the control to change with the risk*: a single
 * unambiguous candidate is a one-click approve, and ANY ambiguity — 2+
 * candidates, a `different` tier, an EID conflict, a manual EID — requires a
 * distinct explicit action. That is a server decision, not a rendering
 * preference: a frontend free to choose the control could quietly turn every
 * gate into one click, which is the exact rot §14.6 predicts. The wire serves
 * the shape; the UI obeys it.
 *
 * ## What deliberately does NOT port (S15)
 *
 * Legacy's `similar` tier trusts the Kuali EID, proceeds silently, AND rewrites
 * the employee's name into the live Kuali document
 * (`legacy:src/workflows/separations/workflow.ts:629-649`, commit `1bffbd65`).
 * `Chan`/`Chen`, `Marc`/`Mark` and `Nguyen`/`Nguyan` are all inside its 2-edit
 * threshold, so the arm that is supposed to fix a typo also SUPPRESSES the
 * wrong-person control on exactly the near-miss cases it should raise it for.
 * Here `similar` is never silent — it is a `choose-a-candidate` gate with both
 * spellings shown — and no name is ever written anywhere by this workflow.
 */
import { z } from "zod";
import { canonicalJsonStringify } from "../canonical-json.js";
import { FingerprintSchema, EidSchema, IsoInstantSchema } from "../ids.js";
import type { Fingerprint } from "../ids.js";
import {
  NameSimilarityTierSchema,
  classifyNameSimilarity,
} from "../matching/name-match.js";
import { sha256Hex } from "../sha256.js";
import type { UcpathCandidate, UcpathPersonSelection } from "../contracts/ucpath/search-person-org.js";
import type { UcpathJobSummary } from "../ui/ucpath-job-summary.js";
import {
  JobSummaryClassificationSchema,
  classifyJobSummary,
} from "./job-summary-classification.js";
import type { JobSummaryClassification } from "./job-summary-classification.js";
import { SeparationWritePlanSchema } from "./write-plan.js";
import type { SeparationWritePlan } from "./write-plan.js";

/** Where the EID this run is checking came from — S18/S19's fork, stated. */
export const IdentityEidSourceSchema = z.enum(["document-eid", "name-resolved"]);
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

/**
 * What a search on the DOCUMENT'S NAME resolves, run on every gate.
 *
 * Legacy only ever performs this search when the name tier came back
 * `different` — which is why the `T002173685` incident's alternative candidate
 * was invisible until the tier fired. Running it unconditionally is what makes
 * ref write-safety §14.2's two-candidate side-by-side presentation exist on every run
 * rather than only on the runs a threshold happened to select.
 */
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
  "type-the-eid",
]);
export type IdentityApprovalShape = z.infer<typeof IdentityApprovalShapeSchema>;

export const IdentityEvidencePacketSchema = z.strictObject({
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
  /**
   * **What the writes will consume**, or a stated reason this graph composes
   * none (`write-plan.ts`). It rides INSIDE the packet so §14.5's digest binds
   * the approval to the values themselves: a reconciled date that moves after
   * approval re-derives a different digest and re-opens the gate. An approval of
   * a person is not an approval of a date.
   */
  plan: SeparationWritePlanSchema,
  /** Every EID a human may legitimately approve on this packet. */
  approvableEids: z.array(EidSchema).min(1),
  approvalShape: IdentityApprovalShapeSchema,
  /** The instant the job-summary read observed the page. */
  observedAt: IsoInstantSchema,
});
export type IdentityEvidencePacket = z.infer<typeof IdentityEvidencePacketSchema>;

/**
 * The digest ref write-safety §14.5 binds an approval to.
 *
 * It hashes the PARSED packet through canonical JSON, so an approval granted on
 * one packet cannot be replayed against a different one: re-derive the packet
 * from the run's stored outputs and the digest either matches (proceed) or does
 * not (re-open the gate). `sha256Hex` is this tree's pure implementation — this
 * module is reachable from the dashboard bundle through the run-detail wire, and
 * a static `node:crypto` import there is the defect D120 recorded.
 */
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

/**
 * The control's shape, decided by the RISK and nothing else (§14.6 risk 1).
 *
 * The order of the tests is the policy: anything that could mean "this is not
 * the person" demands a typed EID; anything ambiguous demands an explicit
 * choice; only a single unambiguous, same-named, single-active-job candidate
 * whose EID came off the document itself is a one-click approve.
 */
export function deriveApprovalShape(input: Readonly<{
  nameTier: z.infer<typeof NameSimilarityTierSchema>;
  emplIdSource: IdentityEidSource;
  documentEidConflicts: boolean;
  nameSearchStatus: "resolved" | "ambiguous" | "not-found";
  nameSearchAgrees: boolean;
  disposition: JobSummaryClassification["disposition"];
}>): IdentityApprovalShape {
  if (
    input.nameTier === "different"
    || input.documentEidConflicts
    || input.emplIdSource === "name-resolved"
    || input.disposition === "indeterminate-status"
  ) {
    return "type-the-eid";
  }
  if (
    input.nameTier === "similar"
    || input.nameSearchStatus === "ambiguous"
    || !input.nameSearchAgrees
    || input.disposition !== "single-active-job"
  ) {
    return "choose-a-candidate";
  }
  return "one-click";
}

/**
 * Deliberately NOT exported and deliberately NOT schema-backed: this is a
 * function's argument list, not a boundary. Every value it carries is already
 * schema-bound by the node that produced it (the job-summary read's output, the
 * search's selection, the run's own canonical input), and the packet it builds
 * is parsed through `IdentityEvidencePacketSchema` before it is returned — so a
 * second schema here would restate three contracts and add a fourth place for
 * them to drift.
 */
interface IdentityEvidenceInput {
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
    ? `${nameSearch.candidate.name} (${nameSearch.candidate.eid}, ${nameSearch.candidate.jobTitle})`
    : nameSearch.status === "ambiguous"
      ? `${String(nameSearch.candidateEids.length)} candidates: ${nameSearch.candidateEids.join(", ")}`
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
            + "enough to be two different people (S15); this never proceeds without a human"
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
          + "are shown because only a human can say which one the document means",
    },
  ];
  comparisons.sort((left, right) => Number(left.agrees) - Number(right.agrees));

  const approvableEids = [...new Set([
    input.jobSummary.emplId,
    ...nameSearch.candidateEids,
  ])];

  return IdentityEvidencePacketSchema.parse({
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
    approvalShape: deriveApprovalShape({
      nameTier,
      emplIdSource: input.emplIdSource,
      documentEidConflicts: input.documentEidConflicts,
      nameSearchStatus: nameSearch.status,
      nameSearchAgrees,
      disposition: jobs.disposition,
    }),
    observedAt: input.jobSummary.observedAt,
  });
}
