import { z } from "zod";
import { ErrorCodeSchema } from "../../rules/identity/ids.js";
import { BoundarySourceSchema } from "./boundary-failure.js";

const EmptyParametersSchema = z.strictObject({});

function catalogEntry<const Parameters extends z.ZodTypeAny>(text: string, parameters: Parameters) {
  return Object.freeze({ text, parameters });
}

export const ERROR_CATALOG = Object.freeze({
  ERROR_CATALOG_CODE_UNREGISTERED: catalogEntry(
    "This failure code is not in the current catalog. Review the recorded local evidence.",
    EmptyParametersSchema,
  ),
  BOUNDARY_VALIDATION_FAILED: catalogEntry(
    "The supplied data does not match the expected contract.",
    z.strictObject({ source: BoundarySourceSchema }),
  ),
  TASK_UNHANDLED_FAILURE: catalogEntry(
    "The task stopped with an unclassified failure. Review local diagnostic evidence.",
    EmptyParametersSchema,
  ),
  ERROR_CATALOG_FORMAT_FAILED: catalogEntry(
    "The failure could not be formatted safely. Review local diagnostic evidence.",
    EmptyParametersSchema,
  ),
  DASHBOARD_DAY_INVALID: catalogEntry(
    "The selected work date is invalid. Choose a valid date.",
    EmptyParametersSchema,
  ),
  DASHBOARD_DAY_FUTURE: catalogEntry(
    "A future work date cannot be selected.",
    EmptyParametersSchema,
  ),
  DASHBOARD_WORKFLOW_UNAVAILABLE: catalogEntry(
    "This workflow is not available for selection in the current catalog.",
    EmptyParametersSchema,
  ),
  COMMAND_OUTCOME_UNCERTAIN: catalogEntry(
    "The command outcome is uncertain. Check its result before taking further action.",
    EmptyParametersSchema,
  ),
  STORAGE_RELOCATION_OUTCOME_UNCERTAIN: catalogEntry(
    "The plan write could not be confirmed. It may already be recorded. Retry the exact attempt; your draft is retained.",
    EmptyParametersSchema,
  ),
  COMMAND_RESULT_IDENTITY_MISMATCH: catalogEntry(
    "The command response did not match the requested command. Review local diagnostic evidence.",
    EmptyParametersSchema,
  ),
  COMMAND_READBACK_MISMATCH: catalogEntry(
    "The command result could not be confirmed by the current state. Review local diagnostic evidence.",
    EmptyParametersSchema,
  ),
  DASHBOARD_AUTHORITY_REPLACED: catalogEntry(
    "The dashboard context changed before the command result could be confirmed.",
    EmptyParametersSchema,
  ),
  COMMAND_REFUSED: catalogEntry(
    "The command was refused. Review the current state before continuing.",
    EmptyParametersSchema,
  ),
  COMMAND_CONFLICT: catalogEntry(
    "The command conflicted with a newer state. Refresh and review the current result.",
    EmptyParametersSchema,
  ),
  COMMAND_CONFIRMATION_REQUIRED: catalogEntry(
    "The command requires confirmation before it can proceed.",
    EmptyParametersSchema,
  ),
  COMMAND_DISPATCH_FAILED: catalogEntry(
    "The command could not be dispatched. Review local diagnostic evidence.",
    EmptyParametersSchema,
  ),  CHATGPT_AUTH_BUSY: catalogEntry(
    "A ChatGPT sign-in is already in progress.",
    EmptyParametersSchema,
  ),
  CHATGPT_AUTH_CANCELLED: catalogEntry(
    "ChatGPT sign-in was cancelled.",
    EmptyParametersSchema,
  ),
  CHATGPT_AUTH_EXPIRED: catalogEntry(
    "ChatGPT sign-in expired. Start a new sign-in.",
    EmptyParametersSchema,
  ),
  CHATGPT_AUTH_INVALID: catalogEntry(
    "The ChatGPT sign-in response could not be verified.",
    EmptyParametersSchema,
  ),
  CHATGPT_AUTH_UNAVAILABLE: catalogEntry(
    "ChatGPT sign-in is unavailable. Try again later.",
    EmptyParametersSchema,
  ),
  CHATGPT_ACCOUNT_EXPIRED: catalogEntry(
    "The ChatGPT session expired. Sign in again.",
    EmptyParametersSchema,
  ),
  CHATGPT_PLAN_DISABLED: catalogEntry(
    "ChatGPT plan use is not enabled for this connection.",
    EmptyParametersSchema,
  ),
  CHATGPT_USAGE_LIMIT: catalogEntry(
    "The ChatGPT plan usage limit has been reached.",
    EmptyParametersSchema,
  ),
  CHATGPT_USAGE_UNAVAILABLE: catalogEntry(
    "ChatGPT plan usage is unavailable.",
    EmptyParametersSchema,
  ),
  CHATGPT_OCR_INVALID: catalogEntry(
    "The OCR request is invalid.",
    EmptyParametersSchema,
  ),
  CHATGPT_OCR_FAILED: catalogEntry(
    "ChatGPT could not complete the OCR request.",
    EmptyParametersSchema,
  ),
  CHATGPT_OCR_INCOMPLETE: catalogEntry(
    "ChatGPT returned an incomplete OCR response.",
    EmptyParametersSchema,
  ),
  CHATGPT_OCR_CANCELLED: catalogEntry(
    "The OCR request was cancelled.",
    EmptyParametersSchema,
  ),
  CHATGPT_SERVICE_CLOSED: catalogEntry(
    "The ChatGPT account service is closed.",
    EmptyParametersSchema,
  ),
  CHATGPT_CREDENTIAL_UNAVAILABLE: catalogEntry(
    "ChatGPT credentials could not be read or saved safely.",
    EmptyParametersSchema,
  ),
  CHATGPT_CREDENTIAL_BUSY: catalogEntry(
    "ChatGPT credentials are in use by another operation.",
    EmptyParametersSchema,
  ),
  CHATGPT_CREDENTIAL_CONFLICT: catalogEntry(
    "The ChatGPT account changed. Read its current state before trying again.",
    EmptyParametersSchema,
  ),
  CHATGPT_CREDENTIAL_UNCERTAIN: catalogEntry(
    "The ChatGPT credential change could not be confirmed. Read its current state before trying again.",
    EmptyParametersSchema,
  ),
  WORKBOOK_INVALID: catalogEntry(
    "The workbook is malformed and cannot be saved.",
    EmptyParametersSchema,
  ),
  WORKBOOK_NOT_FOUND: catalogEntry(
    "The saved workbook was not found.",
    EmptyParametersSchema,
  ),
  WORKBOOK_VERSION_CONFLICT: catalogEntry(
    "The saved workbook changed. Read its current version before saving.",
    EmptyParametersSchema,
  ),
  WORKBOOK_STORAGE_CORRUPT: catalogEntry(
    "The saved workbook or its history is corrupt.",
    EmptyParametersSchema,
  ),
  WORKBOOK_STORAGE_FAILED: catalogEntry(
    "The workbook library storage operation failed.",
    EmptyParametersSchema,
  ),
  ACTIVITY_POPULATION_RANGE_INVALID: catalogEntry(
    "The Analytics date range is invalid.",
    EmptyParametersSchema,
  ),
  ACTIVITY_POPULATION_BROWSE_INVALID: catalogEntry(
    "The Analytics browse selection is invalid.",
    EmptyParametersSchema,
  ),
  ACTIVITY_POPULATION_WORKFLOW_UNAVAILABLE: catalogEntry(
    "This workflow has no runs in the selected Analytics period.",
    EmptyParametersSchema,
  ),
  ACTIVITY_POPULATION_PAGE_UNAVAILABLE: catalogEntry(
    "This Analytics page is unavailable.",
    EmptyParametersSchema,
  ),
  ACTIVITY_POPULATION_RUN_UNAVAILABLE: catalogEntry(
    "This run is not part of the selected Analytics result.",
    EmptyParametersSchema,
  ),
  ACTIVITY_POPULATION_CONTENT_MISMATCH: catalogEntry(
    "The selected Analytics population has changed. Select the period again.",
    EmptyParametersSchema,
  ),
  ACTIVITY_POPULATION_SOURCE_MISMATCH: catalogEntry(
    "The Analytics report and run population disagree.",
    EmptyParametersSchema,
  ),
  ACTIVITY_SNAPSHOT_INVALID_OR_EXPIRED: catalogEntry(
    "The Analytics selection has expired. Select the period again.",
    EmptyParametersSchema,
  ),
  ACTIVITY_SNAPSHOT_STALE_OR_SELECTION_MISMATCH: catalogEntry(
    "The Analytics selection no longer matches the current data. Select the period again.",
    EmptyParametersSchema,
  ),
  ACTIVITY_SNAPSHOT_CONTENT_MISMATCH: catalogEntry(
    "The selected Analytics report has changed. Select the period again.",
    EmptyParametersSchema,
  ),
});

export type ErrorCatalogCode = keyof typeof ERROR_CATALOG;

export const ErrorCatalogCodeSchema = z.enum(
  Object.keys(ERROR_CATALOG) as [ErrorCatalogCode, ...ErrorCatalogCode[]],
);

export type ErrorCatalogParameters<Code extends ErrorCatalogCode> = z.infer<
  (typeof ERROR_CATALOG)[Code]["parameters"]
>;

export type ErrorCatalogFailure<Code extends ErrorCatalogCode = ErrorCatalogCode> = {
  [RegisteredCode in Code]: Readonly<{
    code: RegisteredCode;
    parameters: ErrorCatalogParameters<RegisteredCode>;
  }>;
}[Code];

export type ErrorCatalogMessage = ErrorCatalogFailure & Readonly<{ text: string }>;

export type ErrorCatalogFormattingFault = Readonly<{
  code: "ERROR_CATALOG_FORMAT_FAILED";
  text: (typeof ERROR_CATALOG)["ERROR_CATALOG_FORMAT_FAILED"]["text"];
  cause: unknown;
}>;

export type ErrorCatalogResolution<Failure> =
  | (ErrorCatalogMessage & Readonly<{ state: "resolved"; originalFailure: Failure }>)
  | Readonly<{
    state: "format-failed";
    originalFailure: Failure;
    catalogFault: ErrorCatalogFormattingFault;
  }>;

export function createErrorCatalogFailure<Code extends ErrorCatalogCode>(
  code: Code,
  parameters: ErrorCatalogParameters<Code>,
): ErrorCatalogFailure<Code> {
  const entry = ERROR_CATALOG[code];
  return Object.freeze({ code, parameters: entry.parameters.parse(parameters) }) as ErrorCatalogFailure<Code>;
}

export function formatErrorCatalogFailure(failure: ErrorCatalogFailure): ErrorCatalogMessage {
  const code = ErrorCatalogCodeSchema.parse(failure.code);
  const parameters = ERROR_CATALOG[code].parameters.parse(failure.parameters);
  return Object.freeze({ code, text: ERROR_CATALOG[code].text, parameters }) as ErrorCatalogMessage;
}

function resolveAs<Failure>(
  originalFailure: Failure,
  code: ErrorCatalogCode,
  parameters: unknown,
): ErrorCatalogResolution<Failure> {
  const message = formatErrorCatalogFailure({ code, parameters } as ErrorCatalogFailure);
  return Object.freeze({ ...message, state: "resolved", originalFailure });
}

export function resolveErrorCatalogFailure<Failure>(
  originalFailure: Failure,
  boundarySource: z.infer<typeof BoundarySourceSchema>,
): ErrorCatalogResolution<Failure> {
  try {
    const parsedSource = BoundarySourceSchema.safeParse(boundarySource);
    if (!parsedSource.success) {
      return resolveAs(originalFailure, "TASK_UNHANDLED_FAILURE", {});
    }

    if (typeof originalFailure !== "object" || originalFailure === null || !("code" in originalFailure)) {
      return resolveAs(originalFailure, "TASK_UNHANDLED_FAILURE", {});
    }

    const parsedCode = ErrorCodeSchema.safeParse(originalFailure.code);
    if (!parsedCode.success) {
      return resolveAs(originalFailure, "TASK_UNHANDLED_FAILURE", {});
    }

    const registeredCode = ErrorCatalogCodeSchema.safeParse(parsedCode.data);
    if (!registeredCode.success) {
      return resolveAs(originalFailure, "ERROR_CATALOG_CODE_UNREGISTERED", {});
    }

    const entry = ERROR_CATALOG[registeredCode.data];
    const parameters = "parameters" in originalFailure ? originalFailure.parameters : undefined;
    const parsedParameters = entry.parameters.safeParse(parameters);
    if (!parsedParameters.success) {
      return resolveAs(originalFailure, "BOUNDARY_VALIDATION_FAILED", { source: parsedSource.data });
    }

    return resolveAs(originalFailure, registeredCode.data, parsedParameters.data);
  } catch (cause) {
    const catalogFault = Object.freeze({
      code: "ERROR_CATALOG_FORMAT_FAILED" as const,
      text: ERROR_CATALOG.ERROR_CATALOG_FORMAT_FAILED.text,
      cause,
    });
    return Object.freeze({ state: "format-failed", originalFailure, catalogFault });
  }
}
