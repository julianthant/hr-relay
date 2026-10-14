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
