import { ErrorCatalogCodeSchema, type ErrorCatalogCode } from "./error-catalog.js";

type OriginCode = ErrorCatalogCode | "INTERNAL_FAILURE" | "SCHEMA_INVALID";
type OriginRow = Readonly<{ name: string; code: OriginCode | "parsed"; reason: string }>;

/** The closed cause vocabulary. A row is selected only by a bound constructor, never by runtime text. */
const ORIGINS = {
  "profile-newer": { name: "AuthoritySchemaVersionError", code: "STORAGE_PROFILE_NEWER_VERSION", reason: "format-newer" },
  "profile-format-unsupported": { name: "AuthorityFormatUnsupportedError", code: "STORAGE_PROFILE_FORMAT_UNSUPPORTED", reason: "format-unsupported" },
  "runtime-custody-uncertain": { name: "RuntimeCustodyUncertainError", code: "RUNTIME_CUSTODY_UNCERTAIN", reason: "custody-unproved" },
  "preflight-observation-changed": { name: "PreflightObservationChangedError", code: "PREFLIGHT_OBSERVATION_CHANGED", reason: "observation-changed" },
  "storage-doctor-observation-changed": { name: "StorageDoctorObservationChangedError", code: "STORAGE_DOCTOR_OBSERVATION_CHANGED", reason: "observation-changed" },
  "dashboard-read-failed": { name: "DashboardReadFailedError", code: "DASHBOARD_READ_FAILED", reason: "read-failed" },
  "request-disconnected": { name: "DashboardClientDisconnectedError", code: "INTERNAL_FAILURE", reason: "request-disconnected" },
  "client-http": { name: "DashboardClientError", code: "parsed", reason: "read-failed" },
  "client-schema": { name: "DashboardClientError", code: "SCHEMA_INVALID", reason: "schema-invalid" },
  "client-network": { name: "DashboardClientError", code: "DASHBOARD_READ_FAILED", reason: "network-failed" },
  aggregate: { name: "AggregateError", code: "INTERNAL_FAILURE", reason: "aggregate-cause" },
  "unknown-error": { name: "UnknownError", code: "INTERNAL_FAILURE", reason: "cause-unavailable" },
  "unknown-cause": { name: "UnknownCause", code: "INTERNAL_FAILURE", reason: "cause-unavailable" },
  truncated: { name: "UnknownCause", code: "INTERNAL_FAILURE", reason: "cause-chain-truncated" },
} as const satisfies Record<string, OriginRow>;
export type ErrorOriginKey = keyof typeof ORIGINS;
export type ErrorOriginSelection = ErrorOriginKey | Readonly<{ key: "client-http"; code: string | undefined }>;

export type ErrorCause = Readonly<{ name: string; code: string; reason: string; stack: string }>;

const TRANSPORT_CODES = new Set<string>(["INTERNAL_FAILURE", "SCHEMA_INVALID"]);
const CONSTRUCTOR_NAME = /^[A-Za-z][A-Za-z0-9]{0,79}$/u;
/** An HTTP row never claims SCHEMA_INVALID; that code belongs to the client-schema row. */
const httpCode = (code: string | undefined): OriginCode =>
  code !== undefined && code !== "SCHEMA_INVALID" && (ErrorCatalogCodeSchema.safeParse(code).success || TRANSPORT_CODES.has(code)) ? code as OriginCode : "INTERNAL_FAILURE";
const MAX_CAUSES = 16;
const MAX_FRAMES = 40;
const FRAME = /(?:^|[/(\s])((?:src|scripts|node_modules|assets)\/[A-Za-z0-9_./-]+\.(?:[cm]?[jt]sx?):\d+:\d+)\)?$/u;

type ErrorConstructor = abstract new (...args: never[]) => Error;
const bindings = new Map<ErrorConstructor, (error: Error) => ErrorOriginSelection>();

/** Binds one exact constructor (not its subclasses) to its closed origin row. */
export function bindErrorOrigin<E extends Error>(constructor: abstract new (...args: never[]) => E,
  origin: ErrorOriginKey | ((error: E) => ErrorOriginSelection)): void {
  if (bindings.has(constructor)) throw new Error("error-origin-already-bound");
  bindings.set(constructor, typeof origin === "string" ? () => origin : origin as (error: Error) => ErrorOriginSelection);
}

function row(selection: ErrorOriginSelection): Omit<ErrorCause, "stack"> {
  if (typeof selection === "string") {
    const origin: OriginRow = ORIGINS[selection];
    return { name: origin.name, code: origin.code === "parsed" ? "INTERNAL_FAILURE" : origin.code, reason: origin.reason };
  }
  return { name: ORIGINS["client-http"].name, code: httpCode(selection.code), reason: ORIGINS["client-http"].reason };
}

function frames(error: Error): readonly string[] {
  return (error.stack ?? "").split("\n").slice(1).flatMap(line => {
    if (!/^\s+at /u.test(line)) return [];
    const frame = FRAME.exec(line)?.[1];
    return frame === undefined || frame.includes("..") ? [] : [`    at ${frame}`];
  }).slice(0, MAX_FRAMES);
}

function originOf(error: Error): ErrorOriginSelection {
  const prototype: unknown = Object.getPrototypeOf(error);
  const constructor: unknown = typeof prototype === "object" && prototype !== null ? Reflect.get(prototype, "constructor") : undefined;
  const bound = typeof constructor === "function" ? bindings.get(constructor as ErrorConstructor) : undefined;
  if (bound !== undefined) return bound(error);
  return constructor === AggregateError ? "aggregate" : "unknown-error";
}

function ownCode(error: Error): string {
  const code: unknown = "code" in error ? error.code : undefined;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,127}$/u.test(code) ? code : "INTERNAL_FAILURE";
}

function constructorName(error: Error): string {
  const prototype: unknown = Object.getPrototypeOf(error);
  const constructor: unknown = typeof prototype === "object" && prototype !== null ? Reflect.get(prototype, "constructor") : undefined;
  const name = typeof constructor === "function" ? constructor.name : "";
  return CONSTRUCTOR_NAME.test(name) ? name : "Error";
}

/** Serializes a cause chain to closed name/code/reason rows and build-relative frames; no message text passes. */
export function serializeErrorCauses(error: unknown): readonly ErrorCause[] {
  if (error === undefined || error === null) return [{ ...row("unknown-cause"), stack: ORIGINS["unknown-cause"].name }];
  const pending: unknown[] = [error], seen = new Set<unknown>(), causes: ErrorCause[] = [];
  while (pending.length > 0) {
    const cause = pending.shift();
    if (cause === undefined || cause === null || seen.has(cause)) continue;
    if (causes.length === MAX_CAUSES - 1) { causes.push({ ...row("truncated"), stack: ORIGINS.truncated.name }); break; }
    seen.add(cause);
    if (!(cause instanceof Error)) { causes.push({ ...row("unknown-cause"), stack: ORIGINS["unknown-cause"].name }); continue; }
    const selection = originOf(cause);
    // An unbound error keeps its constructor name and a well-formed code; its message never passes.
    const origin = selection === "unknown-error" ? { ...row(selection), name: constructorName(cause), code: ownCode(cause) } : row(selection);
    causes.push({ ...origin, stack: [origin.name, ...frames(cause)].join("\n") });
    pending.push(cause.cause);
    if (cause instanceof AggregateError) pending.push(...(cause.errors as readonly unknown[]));
  }
  return causes;
}

/** Revalidates a client-claimed cause row: closed browser names, matching reason/code and normalized frames only. */
export function clientCauseRowAccepted(input: Readonly<{ message: string; code: string; reason?: string; stack?: string }>): boolean {
  const candidates = (["client-http", "client-schema", "client-network", "aggregate", "unknown-error", "unknown-cause", "truncated"] as const)
    .map(key => ORIGINS[key]).filter(origin => origin.name === input.message && origin.reason === input.reason
      && (origin.code === "parsed" ? httpCode(input.code) === input.code : origin.code === input.code));
  if (candidates.length === 0) return false;
  const [name, ...rest] = (input.stack ?? input.message).split("\n");
  return name === input.message && rest.length <= MAX_FRAMES && rest.every(line => {
    const frame = /^ {4}at (.+)$/u.exec(line)?.[1];
    return frame !== undefined && FRAME.exec(` ${frame}`)?.[1] === frame && !frame.includes("..");
  });
}
