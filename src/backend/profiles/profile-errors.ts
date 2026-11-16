import { operatorFailureSentence, type ErrorCatalogCode } from "../../models/failures/error-catalog.js";

export class ProfileRuntimeStartFailedError extends Error {
  readonly code = "PROFILE_RUNTIME_START_FAILED";
  constructor(options: ErrorOptions) { super(operatorFailureSentence("PROFILE_RUNTIME_START_FAILED"), options); this.name = "ProfileRuntimeStartFailedError"; }
}

export class ProfileSessionRefusedError extends Error {
  constructor(readonly code: ErrorCatalogCode, options?: ErrorOptions) { super(operatorFailureSentence(code), options); this.name = "ProfileSessionRefusedError"; }
}
