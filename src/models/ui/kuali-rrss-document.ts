/**
 * Kuali Build — the RRSS Separation Request Form document surface.
 *
 * This is the semantic vocabulary the separation read and finalization write
 * use: one document screen, its shared controls, and authoritative observations
 * including the displayed EID that binds every write to its subject.
 *
 * Two facts shape every recipe below and are not negotiable (doc 03c §Live probe status /
 * ref write-safety §13 OQ1, the operator-authorized 2026-07-23 live probe, D78):
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
  ElementIdSchema,
  ObservationIdSchema,
  PageStateIdSchema,
  ScreenIdSchema,
} from "../../rules/identity/ids.js";
import type { ElementId, ObservationId } from "../../rules/identity/ids.js";
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

export const KUALI_RRSS_DISPLAYED_EID = ObservationIdSchema.parse(
  "kuali.rrss-document.displayed-eid",
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
 * because the staged-variables model is an order of magnitude wider than this
 * shared document vocabulary — not because it is a separate driver.
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
 * `read` is the seam the kernel calls at ref write-safety beat ③ to observe the
 * subject on the exact staged page. `commit` is the only method that can click
 * Save, and it requires the unforgeable
 * `MutationCapability` the fenced write sequencer alone mints.
 */
export const KualiRrssDocumentDriverSchema = z.strictObject({
  system: z.literal("kuali"),
  read: ReadObservationOperationSchema,
  readActionListForDocument: ReadActionListForDocumentOperation,
  readSeparationDocument: ReadSeparationDocumentOperation,
  stageSeparationFinalization: StageSeparationFinalizationOperation,
  readSavedSeparationFinalization: ReadSavedSeparationFinalizationOperation,
  commit: CommitOperationSchema,
});
export type KualiRrssDocumentDriver = z.infer<typeof KualiRrssDocumentDriverSchema>;
