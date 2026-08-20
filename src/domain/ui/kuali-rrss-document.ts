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
 *  - **A Kuali save signal is worthless in BOTH directions.** The 2026-07-23
 *    probe recorded the save as UI-silent; the 2026-08-04 controlled attempt
 *    measured the opposite and worse — Kuali renders `Form saved` and answers
 *    `200` on its `submitDocumentV2` mutation for a save that persisted nothing
 *    of the targeted field. A reload read-back is therefore the ONLY landing
 *    proof; "clicked without an error" and "the app said saved" may never
 *    count. This independently re-confirms the legacy 2026-04-10 lesson that
 *    deleted Kuali error detection as false-positive-prone
 *    (`kuali/LESSONS.md:17-23`).
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
import {
  KualiActionIdSchema,
  KualiDocumentNumberSchema,
  KualiTimekeeperNameSchema,
} from "./kuali-document-identity.js";
import { ReadActionListForDocumentOperationSchema } from "./kuali-action-list.js";
import { ReadSeparationDocumentOperationSchema } from "./kuali-separation-document.js";
import {
  ReadSavedSeparationFinalizationOperationSchema,
  StageSeparationFinalizationOperationSchema,
} from "./kuali-separation-finalization.js";
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
 * The document identifiers, re-exported so every existing importer of this
 * module keeps its one import site. They are DEFINED in
 * `kuali-document-identity.ts` because the separation-read module needs them
 * too, and this module names that module's operation schema.
 */
export {
  KUALI_RRSS_TIMEKEEPER_FORM_KEY,
  KualiActionIdSchema,
  KualiDocumentNumberSchema,
  KualiTimekeeperNameSchema,
} from "./kuali-document-identity.js";

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

/**
 * The Action-List read (D261), declared HERE for the same reason as the two
 * families below it: a second `DriverDeclaration` for one store is exactly what
 * `task-driver-boundary` forbids, so a sibling task family extends this surface
 * rather than minting its own. Its schemas live in `kuali-action-list.ts`
 * because the Action List is a different SCREEN from the document — not because
 * it is a different driver.
 */
const ReadActionListForDocumentOperation = ReadActionListForDocumentOperationSchema;

/**
 * The separation-document read (2i chunk 2). It is declared HERE, on the one
 * driver declaration the whole store binds, because a second
 * `DriverDeclaration` for the same store is exactly what the task/driver
 * boundary forbids: `defineTask(driver, …)` binds the store's exact invariant
 * declaration, so a sibling task family extends this surface rather than
 * minting its own. The schemas it returns live in `kuali-separation-document.ts`
 * — a separate module because the read surface is an order of magnitude wider
 * than the write's three fields, not because it is a separate driver.
 */
const ReadSeparationDocumentOperation = ReadSeparationDocumentOperationSchema;

/**
 * The finalization write (chunk 5), declared here for the same reason: a second
 * `DriverDeclaration` for the same store is exactly what the task/driver
 * boundary forbids, so a sibling task family extends this surface rather than
 * minting its own. Its schemas live in `kuali-separation-finalization.ts`
 * because the staged-variables model is an order of magnitude wider than the
 * timekeeper write's one field — not because it is a separate driver.
 */
const StageSeparationFinalizationOperation = StageSeparationFinalizationOperationSchema;
const ReadSavedSeparationFinalizationOperation = ReadSavedSeparationFinalizationOperationSchema;

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
  readActionListForDocument: ReadActionListForDocumentOperation,
  openDocument: OpenDocumentOperationSchema,
  readSeparationDocument: ReadSeparationDocumentOperation,
  stageTimekeeperName: StageTimekeeperOperationSchema,
  readSavedTimekeeper: ReadSavedTimekeeperOperationSchema,
  stageSeparationFinalization: StageSeparationFinalizationOperation,
  readSavedSeparationFinalization: ReadSavedSeparationFinalizationOperation,
  commit: CommitOperationSchema,
});
export type KualiRrssDocumentDriver = z.infer<typeof KualiRrssDocumentDriverSchema>;
