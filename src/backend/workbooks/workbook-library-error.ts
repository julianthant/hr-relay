import { ERROR_CATALOG, type ErrorCatalogCode } from "../../models/failures/error-catalog.js";

export class WorkbookLibraryError extends Error {
  constructor(readonly code: Extract<ErrorCatalogCode, `WORKBOOK_${string}`>, options?: ErrorOptions) {
    super(ERROR_CATALOG[code].text, options);
    this.name = "WorkbookLibraryError";
  }
}
