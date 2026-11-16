import { writeWorkbookXlsx } from "../../../rules/spreadsheets/workbook-io.js";
import { WorkbookIntakeSourceSchema } from "../../../models/intake/session.js";
import { WorkbookIntakeRequestSchema } from "../../../models/dashboard/workbooks.js";
import type { IntakeService } from "./intake-service.js";
import { WorkbookLibraryError } from "../../workbooks/workbook-library-error.js";
import { type WorkbookLibraryService } from "../../workbooks/workbook-library-service.js";

export function createWorkbookIntakeBridge(library: WorkbookLibraryService, intake: IntakeService) {
  return async (libraryId: string, input: unknown) => {
    const request = WorkbookIntakeRequestSchema.parse(input);
    const saved = library.read(libraryId);
    if (saved.version !== request.expectedVersion) throw new WorkbookLibraryError("WORKBOOK_VERSION_CONFLICT");
    const bytes = new Uint8Array(await writeWorkbookXlsx(saved.workbook, { columns: 'all', createdAt: saved.createdAt, modifiedAt: saved.savedAt }));
    return intake.upload({ workflow: request.workflowId, fileName: saved.workbook.name,
      mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes,
      workbookSource: WorkbookIntakeSourceSchema.parse({ libraryId: saved.libraryId, version: saved.version }) });
  };
}
