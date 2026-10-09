/** Kuali Build — the RRSS Separation Request Form document surface: the semantic vocabulary the separation read and finalization write share. */
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

/** The document identifiers, re-exported so every existing importer keeps its one import site; they are DEFINED in the identity module. */
export {
  KUALI_RRSS_TIMEKEEPER_FORM_KEY,
  KualiActionIdSchema,
  KualiDocumentNumberSchema,
  KualiTimekeeperNameSchema,
} from "./kuali-document-identity.js";

const ReadObservationOperationSchema = z.custom<(
  id: ObservationId,
) => Promise<string>>((value) => typeof value === "function");

/** The Action-List read, declared HERE because a second driver declaration for one store is what the task/driver boundary forbids; a sibling family extends this surface. */
const ReadActionListForDocumentOperation = ReadActionListForDocumentOperationSchema;

/** The separation-document read, declared here on the one driver declaration the whole store binds, because a second declaration for the same store is what the boundary forbids. */
const ReadSeparationDocumentOperation = ReadSeparationDocumentOperationSchema;

/** The finalization write, declared here for the same reason: a sibling family extends this surface rather than minting a second declaration. */
const StageSeparationFinalizationOperation = StageSeparationFinalizationOperationSchema;
const ReadSavedSeparationFinalizationOperation = ReadSavedSeparationFinalizationOperationSchema;

const CommitOperationSchema = z.custom<(
  id: ElementId,
  capability: MutationCapability,
) => Promise<UiActionProof>>((value) => typeof value === "function");

/** Kuali's task-facing semantic surface; `read` is the seam the kernel calls to observe the page before anything is staged. */
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
