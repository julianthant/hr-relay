import type { WorkbookSyncDownload } from "../../../../src/backend/workbooks/workbook-library-service.js";

export const unexpectedWorkbookSync: WorkbookSyncDownload = Object.freeze({
  withDownload: () => Promise.reject(new Error("This fixture must not download a SharePoint workbook")),
});
