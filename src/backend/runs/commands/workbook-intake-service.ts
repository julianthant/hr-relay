import JSZip from "jszip";
import { WorkbookIntakeSourceSchema } from "../../../models/intake/session.js";
import Excel from "exceljs";
import { WorkbookIntakeRequestSchema } from "../../../models/dashboard/workbooks.js";
import type { IntakeService } from "./intake-service.js";
import { WorkbookLibraryError, type WorkbookLibraryService } from "../../workbooks/workbook-library-service.js";

export function createWorkbookIntakeBridge(library: WorkbookLibraryService, intake: IntakeService) {
  return async (libraryId: string, input: unknown) => {
    const request = WorkbookIntakeRequestSchema.parse(input);
    const saved = library.read(libraryId);
    if (saved.version !== request.expectedVersion) throw new WorkbookLibraryError("WORKBOOK_VERSION_CONFLICT");
    const workbook = new Excel.Workbook();
    for (const sheet of saved.workbook.sheets) {
      const target = workbook.addWorksheet(sheet.name);
      sheet.rows.forEach((row, rowIndex) => row.cells.forEach((cell, columnIndex) => {
        const next = target.getCell(rowIndex + 1, columnIndex + 1);
        next.value = cell.richText ? { richText: structuredClone(cell.richText) } : cell.hyperlink !== undefined ? { text: String(cell.value), hyperlink: cell.hyperlink, ...(cell.tooltip === undefined ? {} : { tooltip: cell.tooltip }) } : cell.value;
        if (cell.numFmt !== undefined) next.numFmt = cell.numFmt;
        if (cell.fill !== undefined) next.fill = structuredClone(cell.fill);
      }));
      for (const column of sheet.hidden) target.getColumn(column + 1).hidden = true;
    }
    workbook.created = new Date(saved.createdAt);
    workbook.modified = new Date(saved.savedAt);
    const model = workbook.model;
    Reflect.set(model, "themes", saved.workbook.themes);
    workbook.model = model;
    const archive = await JSZip.loadAsync(await workbook.xlsx.writeBuffer());
    for (const entry of Object.values(archive.files)) entry.date = new Date(saved.savedAt);
    const bytes = await archive.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    return intake.upload({ workflow: request.workflowId, fileName: saved.workbook.name,
      mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes,
      workbookSource: WorkbookIntakeSourceSchema.parse({ libraryId: saved.libraryId, version: saved.version }) });
  };
}
