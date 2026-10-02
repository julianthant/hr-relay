import { defineTask } from "../../../../workflow-kit/task.js";
import {
  KualiReadSeparationDocument,
  ReadSeparationDocumentOutputSchema,
} from "../../../../models/systems/kuali/read-separation-document.js";
import { kualiDriver } from "../driver-declaration.js";

/**
 * Ported semantic operation: legacy 1bffbd65,
 * `src/systems/kuali/navigate.ts` (`extractSeparationData` :175-224) and
 * `src/workflows/separations/steps/kuali-extract.ts:36-80`.
 *
 * Three things do NOT port.
 *
 * **The entry path.** Legacy reaches a document only through the Action List's
 * own search box (`clickDocument` :114-165); this opens the deep link and
 * proves the document number from the page's level-1 heading, because an
 * `actionId` names a workflow STEP and can silently redirect to the Action List
 * (D129). The Action-List enumeration stays legacy's and is not needed here:
 * a run names its document.
 *
 * **The blind dialog handler (S62).** Legacy registers
 * `ucpathPage.on("dialog", d => d.accept().catch(() => {}))` for the duration
 * of extraction — accepting ANY dialog, sight unseen, on the system that files
 * terminations, and discarding the failure. This task registers nothing: it
 * touches one Kuali page and never reaches across to UCPath at all, so the
 * cross-system dialog it exists to clear cannot occur.
 *
 * **The swallowed Location read (S13).** Legacy wraps the location read in
 * `try { … } catch { location = "" }` and calls the field optional. The live
 * 2026-08-12 form says otherwise: the field is required (`Location*`) and
 * always populated on all three observed documents, and legacy's recipe asks
 * for the accessible name `"Location  *"` — with a space before the asterisk —
 * which matches ZERO live nodes. Legacy has therefore never once read this
 * field; it has only ever caught its own broken selector. The port fixes the
 * name, resolves exactly one node, and reports a genuinely empty control as
 * `absent` with a reason.
 *
 * The driver returns a discriminated union for every EXPECTED negative and
 * throws for mechanical failures; this task maps each arm onto its own durable
 * error code so a failed run records WHICH thing went wrong.
 */
export const readSeparationDocumentTask = defineTask(kualiDriver, KualiReadSeparationDocument, {
  sessions: [{ system: "kuali", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    const read = await ctx.driver.readSeparationDocument({
      actionId: input.actionId,
      documentNumber: input.documentNumber,
    });

    if (read.state === "document-unavailable") {
      return ctx.fail(
        "document-unavailable",
        `Kuali action ${read.actionId} did not render document ${input.documentNumber}: ${read.reason} `
        + `(observed URL ${read.observedUrl}). An action id names a workflow STEP, not a document, so a `
        + "completed or reassigned step no longer resolves to a form.",
      );
    }
    if (read.state === "document-number-mismatch") {
      return ctx.fail(
        "document-number-mismatch",
        `Kuali action ${read.actionId} opened document ${read.observedNumber}, but the run named `
        + `${read.expectedNumber}; refusing to read a different separation than the one requested.`,
      );
    }
    if (read.state === "not-a-separation-document") {
      // S2: refused BY NAME, before any field is touched.
      return ctx.fail(
        "not-a-separation-document",
        `Kuali document ${read.documentNumber} is a ${JSON.stringify(read.observedFormType)}, not an `
        + "\"RRSS Separation Request Form\". The Action List carries other document types, and reading "
        + "separation fields off one of them would produce a plausible-but-wrong separation.",
      );
    }
    if (read.state === "unparseable-date") {
      // S8: the field and the value, never a blank and never a guess.
      return ctx.fail(
        "unparseable-date",
        `Kuali document ${read.documentNumber} holds ${JSON.stringify(read.raw)} in ${read.field}, which `
        + "is not an MM/DD/YYYY calendar date. A separation's dates decide a real termination's effective "
        + "date, so an unreadable one refuses rather than being dropped.",
      );
    }
    if (read.state === "unreadable-eid") {
      return ctx.fail(
        "unreadable-eid",
        `Kuali document ${read.documentNumber} holds a value in its EID field that is not a UCPath EID; `
        + "refusing to carry an unreadable identifier into an identity check.",
      );
    }

    const { document } = read;
    if (document.documentNumber !== input.documentNumber) {
      return ctx.fail(
        "unexpected-page-state",
        `the Kuali driver returned document ${document.documentNumber} while the task ran for `
        + `${input.documentNumber}`,
      );
    }
    if (document.actionId !== input.actionId) {
      return ctx.fail(
        "unexpected-page-state",
        `the Kuali driver returned action ${document.actionId} while the task ran for ${input.actionId}`,
      );
    }

    const output = ReadSeparationDocumentOutputSchema.parse(document);
    ctx.recordData([
      { direction: "read", field: "pageStateId", value: output.pageStateId },
      { direction: "read", field: "actionId", value: output.actionId },
      { direction: "read", field: "documentNumber", value: output.documentNumber },
      { direction: "read", field: "formType", value: output.formType },
      { direction: "read", field: "employee", value: output.employee },
      { direction: "read", field: "separation", value: output.separation },
      { direction: "read", field: "timekeeper", value: output.timekeeper },
      { direction: "read", field: "finalTransactions", value: output.finalTransactions },
      { direction: "read", field: "options", value: output.options },
      { direction: "read", field: "observedAt", value: output.observedAt },
    ]);
    return output;
  },
});
