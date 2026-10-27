import { operatorFailureSentence, type ErrorCatalogCode } from "../../models/failures/error-catalog.js";

export class ProfileSessionRefusedError extends Error {
  constructor(readonly code: ErrorCatalogCode) { super(operatorFailureSentence(code)); this.name = "ProfileSessionRefusedError"; }
}
