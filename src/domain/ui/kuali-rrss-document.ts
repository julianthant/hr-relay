/**
 * Kuali Build — the RRSS Separation Request Form document surface.
 *
 * This is the semantic vocabulary Phase 2's transaction proof writes against:
 * one screen (an Action-List document opened by its deep link), the three
 * elements the write touches, the two page states the kernel binds, and the two
 * authoritative observations — the displayed EID (the SUBJECT of the write) and
 * the displayed timekeeper name (the COMPLETION read-back).
 *
 * Two facts shape every recipe below and are not negotiable (doc 07 §3.8 /
 * doc 09 §13 OQ1, the operator-authorized 2026-07-23 live probe, D78):
 *
 *  - **A Kuali save is UI-silent.** No toast, no banner, no URL change. A
 *    reload read-back is therefore the ONLY landing proof; "clicked without an
 *    error" may never count. This independently re-confirms the legacy
 *    2026-04-10 lesson that deleted Kuali error detection as
 *    false-positive-prone (`kuali/LESSONS.md:17-23`).
 *  - **DOM refs change on every reload**, so every recipe anchors on role +
 *    the EXACT accessible name — including the literal `*` the form labels
 *    carry — and never on a captured ref.
 *
 * The `Save` button sits in one action group with `Send Back` and
 * `Mark Complete`, which ADVANCE the workflow. A fallback that widened onto
 * either of those would file a real separation step. That is why
 * `KUALI_RRSS_SAVE_BUTTON` is an exact-name recipe with no `.or()` chain and
 * why the driver refuses on a match count other than one — verified live
 * 2026-08-04 (exactly one `button "Save"`, one `Send Back`, one
 * `Mark Complete` on doc 4490).
 */
import { z } from "zod";
import {
  EidSchema,
  ElementIdSchema,
  IsoInstantSchema,
  ObservationIdSchema,
  PageStateIdSchema,
  ScreenIdSchema,
} from "../ids.js";
import type { ElementId, ObservationId } from "../ids.js";
import type { MutationCapability, UiActionProof } from "./driver.js";

export const KUALI_RRSS_DOCUMENT_SCREEN = ScreenIdSchema.parse("kuali.rrss-document");

export const KUALI_RRSS_EID_FIELD = ElementIdSchema.parse("kuali.rrss-document.eid-field");
export const KUALI_RRSS_TIMEKEEPER_FIELD = ElementIdSchema.parse(
  "kuali.rrss-document.timekeeper-field",
);
export const KUALI_RRSS_SAVE_BUTTON = ElementIdSchema.parse("kuali.rrss-document.save-button");

export const KUALI_RRSS_DOCUMENT_READY = PageStateIdSchema.parse("kuali.rrss-document.ready");
export const KUALI_RRSS_TIMEKEEPER_STAGED = PageStateIdSchema.parse(
  "kuali.rrss-document.timekeeper-staged",
);

export const KUALI_RRSS_DISPLAYED_EID = ObservationIdSchema.parse(
  "kuali.rrss-document.displayed-eid",
);
export const KUALI_RRSS_DISPLAYED_TIMEKEEPER = ObservationIdSchema.parse(
  "kuali.rrss-document.displayed-timekeeper",
);

/**
 * The opaque 24-hex Action-List action id in the document deep link
 * `…/build/space/<space>/actions/<actionId>` (it redirects to `…/view`).
 *
 * It is NOT the document number, there is no query-param form, and it is NOT
 * stable across workflow steps: doc 4453's 2026-07-23 action id
 * (`6a613869d3863ae06c634407`) no longer resolved to a form on 2026-08-04 — it
 * redirected to the Action List. A run therefore carries BOTH the action id and
 * the document number, and the driver refuses when the opened document's
 * displayed number is not the expected one.
 */
export const KualiActionIdSchema = z.string().regex(/^[0-9a-f]{24}$/, "Kuali action id must be 24 hex characters");
export const KualiDocumentNumberSchema = z.string().regex(/^\d{3,8}$/, "Kuali document number must be 3-8 digits");

/**
 * A Kuali timekeeper value the automation may write.
 *
 * Deliberately narrow: printable ASCII, no leading/trailing whitespace, no
 * control characters, bounded length. Kuali inputs return whitespace-padded
 * values (legacy `kuali/LESSONS.md:49-54`, doc #4241), so every read trims and
 * every comparison is against the trimmed form.
 */
export const KualiTimekeeperNameSchema = z.string()
  .min(1)
  .max(64)
  .regex(/^[\x20-\x7E]+$/, "timekeeper name must be printable ASCII")
  .refine((value) => value === value.trim(), "timekeeper name may not be whitespace-padded");

/**
 * The typed saved-state proof for doc 09's `save-verify` completion arm.
 *
 * It names the exact document identity, the exact persisted value, and the
 * subject the page displayed. It carries NO "clicked ok" flag by design — the
 * only thing that promotes a claim to proof is a reload read-back that returns
 * this shape with `source:"reload-read-back"`.
 */
export const KualiSavedTimekeeperProofSchema = z.strictObject({
  kind: z.literal("kuali-saved-timekeeper"),
  actionId: KualiActionIdSchema,
  documentNumber: KualiDocumentNumberSchema,
  timekeeperName: KualiTimekeeperNameSchema,
  observedEid: EidSchema,
  source: z.literal("reload-read-back"),
});
export type KualiSavedTimekeeperProof = z.infer<typeof KualiSavedTimekeeperProofSchema>;

/** What `openDocument` proves before anything else is allowed to touch the page. */
export const KualiDocumentViewSchema = z.strictObject({
  pageStateId: z.literal(KUALI_RRSS_DOCUMENT_READY),
  actionId: KualiActionIdSchema,
  documentNumber: KualiDocumentNumberSchema,
  observedEid: EidSchema,
  /** The timekeeper value the document currently displays; "" when the field is empty. */
  currentTimekeeperName: z.string(),
  observedAt: IsoInstantSchema,
});
export type KualiDocumentView = z.infer<typeof KualiDocumentViewSchema>;

/**
 * What `stageTimekeeperName` proves. The staged value is read BACK out of the
 * live input before the driver returns — the legacy `fillWithVerify` discipline
 * (`kuali/navigate.ts:16-39`), which exists because Kuali inputs silently
 * ignore `fill()` on some controls. A staged value that does not read back is a
 * throw, never a "probably fine".
 */
export const KualiTimekeeperStagingSchema = z.strictObject({
  pageStateId: z.literal(KUALI_RRSS_TIMEKEEPER_STAGED),
  actionId: KualiActionIdSchema,
  documentNumber: KualiDocumentNumberSchema,
  observedEid: EidSchema,
  previousTimekeeperName: z.string(),
  stagedTimekeeperName: KualiTimekeeperNameSchema,
  observedAt: IsoInstantSchema,
});
export type KualiTimekeeperStaging = z.infer<typeof KualiTimekeeperStagingSchema>;

/**
 * The reload read-back. `state:"absent"` means the reloaded document
 * deterministically displays a DIFFERENT value — a real, evidenced negative.
 * `unknown` covers every "the check itself failed" case; there is no boolean.
 */
export const KualiTimekeeperReadBackSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("present"),
    proof: KualiSavedTimekeeperProofSchema,
    observedAt: IsoInstantSchema,
  }),
  z.strictObject({
    state: z.literal("absent"),
    actionId: KualiActionIdSchema,
    documentNumber: KualiDocumentNumberSchema,
    observedEid: EidSchema,
    observedTimekeeperName: z.string(),
    observedAt: IsoInstantSchema,
  }),
  z.strictObject({
    state: z.literal("unknown"),
    reason: z.string().min(1),
    observedAt: IsoInstantSchema,
  }),
]);
export type KualiTimekeeperReadBack = z.infer<typeof KualiTimekeeperReadBackSchema>;

const OpenDocumentOperationSchema = z.custom<(
  input: Readonly<{ actionId: string; documentNumber: string }>,
) => Promise<KualiDocumentView>>((value) => typeof value === "function");

const StageTimekeeperOperationSchema = z.custom<(
  input: Readonly<{ actionId: string; documentNumber: string; timekeeperName: string }>,
) => Promise<KualiTimekeeperStaging>>((value) => typeof value === "function");

const ReadSavedTimekeeperOperationSchema = z.custom<(
  input: Readonly<{ actionId: string; documentNumber: string; timekeeperName: string }>,
) => Promise<KualiTimekeeperReadBack>>((value) => typeof value === "function");

const ReadObservationOperationSchema = z.custom<(
  id: ObservationId,
) => Promise<string>>((value) => typeof value === "function");

const CommitOperationSchema = z.custom<(
  id: ElementId,
  capability: MutationCapability,
) => Promise<UiActionProof>>((value) => typeof value === "function");

/**
 * Kuali's task-facing semantic surface.
 *
 * `read` is not a task convenience — it is the seam the KERNEL calls at doc 09
 * beat ③ to observe the subject on the exact staged page. `commit` is the only
 * method that can click Save, and it requires the unforgeable
 * `MutationCapability` the fenced write sequencer alone mints.
 */
export const KualiRrssDocumentDriverSchema = z.strictObject({
  system: z.literal("kuali"),
  read: ReadObservationOperationSchema,
  openDocument: OpenDocumentOperationSchema,
  stageTimekeeperName: StageTimekeeperOperationSchema,
  readSavedTimekeeper: ReadSavedTimekeeperOperationSchema,
  commit: CommitOperationSchema,
});
export type KualiRrssDocumentDriver = z.infer<typeof KualiRrssDocumentDriverSchema>;
