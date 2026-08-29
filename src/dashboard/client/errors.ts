/**
 * The client's one error vocabulary. Every failure a component can see is a
 * `DashboardClientError` with a closed kind — network reachability, an HTTP
 * status with the server's typed wire error attached, a schema parse failure
 * (the server sent something the contract does not admit), or a subscription
 * protocol violation. Nothing is swallowed into `undefined`.
 */
import { z } from "zod";

export const WIRE_ERROR_BODY = z.strictObject({
  state: z.literal("error"),
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
});

export type DashboardClientErrorKind = "network" | "http" | "schema" | "protocol";

export class DashboardClientError extends Error {
  readonly kind: DashboardClientErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly retryable: boolean;

  constructor(input: Readonly<{
    kind: DashboardClientErrorKind;
    message: string;
    status?: number;
    code?: string;
    retryable?: boolean;
    cause?: unknown;
  }>) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = "DashboardClientError";
    this.kind = input.kind;
    if (input.status !== undefined) this.status = input.status;
    if (input.code !== undefined) this.code = input.code;
    this.retryable = input.retryable ?? false;
  }
}

/** Maps a non-2xx response body to the typed error, keeping the server's words. */
export function httpError(status: number, body: unknown): DashboardClientError {
  const parsed = WIRE_ERROR_BODY.safeParse(body);
  if (parsed.success) {
    return new DashboardClientError({
      kind: "http",
      status,
      code: parsed.data.code,
      message: parsed.data.message,
      retryable: parsed.data.retryable,
    });
  }
  return new DashboardClientError({
    kind: "http",
    status,
    message: `request failed with status ${String(status)} and a body outside the wire-error contract`,
  });
}

export function schemaError(context: string, cause: unknown): DashboardClientError {
  return new DashboardClientError({
    kind: "schema",
    message: `${context}: response failed its wire schema: ${cause instanceof Error ? cause.message : String(cause)}`,
    cause,
  });
}

export function diagnosticBundleIdentityError(context: string, requestedBundleId: string): DashboardClientError {
  return new DashboardClientError({
    kind: "schema",
    code: "DIAGNOSTIC_BUNDLE_IDENTITY_MISMATCH",
    message: `${context}: DIAGNOSTIC_BUNDLE_IDENTITY_MISMATCH: response does not belong to requested diagnostic bundle ${requestedBundleId}`,
  });
}

export function runComparisonIdentityError(context: string, dimension: string): DashboardClientError {
  return new DashboardClientError({
    kind: "schema",
    code: "RUN_COMPARISON_IDENTITY_MISMATCH",
    message: `${context}: RUN_COMPARISON_IDENTITY_MISMATCH: response ${dimension} does not match the selected receipt`,
  });
}

export function networkError(context: string, cause: unknown): DashboardClientError {
  return new DashboardClientError({
    kind: "network",
    message: `${context}: ${cause instanceof Error ? cause.message : String(cause)}`,
    retryable: true,
    cause,
  });
}

export function protocolError(message: string): DashboardClientError {
  return new DashboardClientError({ kind: "protocol", message });
}
