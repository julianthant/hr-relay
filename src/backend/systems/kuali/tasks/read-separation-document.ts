import { defineTask } from "../../../../workflow-kit/task.js";
import {
  KualiReadSeparationDocument,
  ReadSeparationDocumentOutputSchema,
} from "../../../../models/systems/kuali/read-separation-document.js";
import { kualiDriver } from "../driver-declaration.js";


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
