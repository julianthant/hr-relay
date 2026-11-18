import { addSpreadsheetColumn, editSpreadsheetCell } from "../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js";
import type { EditableWorkbook } from "../../../src/rules/spreadsheets/workbook-io.js";
import { assistantWorkflowOption, type AssistantWorkflowRequest, type AssistantWorkflowResult } from "../../../src/dashboard/surfaces/shell/assistant-panel-model.js";
import type { WorkflowComposition } from "../../../src/dashboard/app/workflow-sources.js";
import { initialMockDraft, mockRunsForDraft, type MockRun } from "./workflow-mock-model.js";

export function prepareHubWorkflow(request: AssistantWorkflowRequest, composition: WorkflowComposition, sequence: number): { runs: readonly MockRun[]; result: AssistantWorkflowResult } {
  const option = assistantWorkflowOption(request.workflowId);
  if (request.source !== 'mock' || request.dryRun !== true || !option || composition.assistant !== 'mock') throw new Error('This assistant supports sample dry runs only.');
  const workbook = request.file.workbook;
  if (!workbook || !request.rows.length || request.rows.some(row => row.issue !== null)) throw new Error('Review the spreadsheet rows before starting.');
  const id = option.id;
  const runs = request.rows.flatMap((row, index) => {
    const field = Object.entries(row.values).filter(([key]) => option.identifier.test(key));
    if (field.length !== 1 || !field[0][1].trim()) throw new Error(`${row.person}: provide one ${option.identifierLabel} column before starting.`);
    const created = mockRunsForDraft(id, { ...initialMockDraft(id), method: 'typed', text: field[0][1].trim(), dryRun: true }, sequence + index);
    if (created.length !== 1) throw new Error(`${row.person}: provide one ${option.identifierLabel} per row before starting.`);
    return created.map(run => ({ ...run, title: row.person }));
  });
  const status = 'Sample dry run complete';
  const updated: EditableWorkbook = { ...workbook, sheets: workbook.sheets.map(sheet => {
    const rows = request.rows.filter(row => row.sheet === sheet.name);
    if (!rows.length) return sheet;
    let next = addSpreadsheetColumn(sheet, 'Relay result');
    for (const row of rows) {
      const target = sheet.rows[row.row - 1];
      if (!target) throw new Error('The reviewed spreadsheet row is unavailable.');
      next = editSpreadsheetCell(next, target.id, sheet.width, status);
    }
    return next;
  }) };
  const generated: EditableWorkbook = { name: 'Results.csv', themes: {}, hasFormulas: false, sheets: [{ id: 'results', name: 'Results', width: 4, hidden: [], rows: [
    { id: 'header', cells: ['Name', 'Source sheet', 'Source row', 'Result'].map(value => ({ value })) },
    ...request.rows.map((row, index) => ({ id: `result-${index}`, cells: [row.person, row.sheet, row.row, status].map(value => ({ value })) })),
  ] }] };
  return { runs, result: { state: 'complete', source: 'mock', files: [
    { id: `${request.file.id}:updated`, name: workbook.name, status: 'Updated', workbook: updated },
    { id: `${request.file.id}:results`, name: generated.name, status: 'Generated', workbook: generated },
  ] } };
}
