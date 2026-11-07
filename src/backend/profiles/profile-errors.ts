import { operatorFailureSentence, type ErrorCatalogCode } from "../../models/failures/error-catalog.js";

export class ProfileSessionRefusedError extends Error {
  constructor(readonly code: ErrorCatalogCode, options?: ErrorOptions) { super(operatorFailureSentence(code), options); this.name = "ProfileSessionRefusedError"; }
}
