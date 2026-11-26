import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { bindErrorOrigin } from "../../../models/failures/error-origins.js";

/** A copy's sample run: nothing runs, so every action on it, a rerun from it and its Start plan are refused. */
export class SampleRunRefusedError extends Error {
  readonly code = "SAMPLE_RUN_REFUSED";
  constructor() {
    super(ERROR_CATALOG.SAMPLE_RUN_REFUSED.text);
    this.name = "SampleRunRefusedError";
  }
}

export class LogDisplayRefusedError extends Error {
  readonly code = "RUN_LOG_DISPLAY_VALUE_UNMAPPED";
  constructor() {
    super(ERROR_CATALOG.RUN_LOG_DISPLAY_VALUE_UNMAPPED.text);
    this.name = "LogDisplayRefusedError";
  }
}


export class TargetNotFoundError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TargetNotFoundError";
  }
}

// An existing but unservable section is conflict, distinct from a missing target.
export class SectionUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SectionUnavailableError";
  }
}


export class RequestIdentityRefusedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RequestIdentityRefusedError";
  }
}

// Projection degradation is retryable after a guarded rebuild; it never permits an untrusted read.
export class ProjectionDegradedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProjectionDegradedError";
  }
}


export class DiagnosticBundleCorruptError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DiagnosticBundleCorruptError";
  }
}


export class DiagnosticBundleBytesMissingError extends DiagnosticBundleCorruptError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DiagnosticBundleBytesMissingError";
  }
}

export class LogIdentityRefusedError extends Error {
  readonly code = "LOGS_IDENTITY_REFUSED";
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LogIdentityRefusedError";
  }
}

/** A fresh stream handoff whose every snapshot read was overtaken; the client asks again after its reconnect delay. */
export class DashboardSnapshotOvertakenError extends Error {
  readonly code = "DASHBOARD_SNAPSHOT_OVERTAKEN";
  constructor() {
    super("dashboard-snapshot-overtaken");
    this.name = "DashboardSnapshotOvertakenError";
  }
}

export class DashboardReadFailedError extends Error {
  constructor(cause: unknown) {
    super("dashboard-read-failed", { cause });
    this.name = "DashboardReadFailedError";
  }
}
bindErrorOrigin(DashboardReadFailedError, "dashboard-read-failed");
