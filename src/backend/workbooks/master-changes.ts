import { z } from 'zod';
import { EditableWorkbookWireSchema, WorkbookOperationReceiptSchema, WorkbookCellValueWireSchema, type EditableWorkbookWire, type WorkbookType, type WorkbookOperation, type WorkbookOperationReceipt } from '../../models/dashboard/workbooks.js';
import { canonicalJsonStringify } from '../../rules/validation/canonical-json.js';

export const WorkbookOwnershipSchema = z.record(z.string(), z.discriminatedUnion('owner', [
  z.strictObject({ owner: z.literal('relay'), value: WorkbookCellValueWireSchema }), z.strictObject({ owner: z.literal('operator') }),
]));
export type WorkbookOwnership = z.infer<typeof WorkbookOwnershipSchema>;
const same = (a: unknown, b: unknown) => canonicalJsonStringify(JSON.parse(JSON.stringify(a ?? null))) === canonicalJsonStringify(JSON.parse(JSON.stringify(b ?? null)));
const address = (sheet: string, row: string, field: string) => JSON.stringify([sheet, row, field]);
function columns(sheet: EditableWorkbookWire['sheets'][number], field: string): number[] {
  return sheet.columnBindings?.flatMap((binding, index) => binding.fieldId === field ? [index] : []) ?? [];
}
function workbookCells(workbook: EditableWorkbookWire, type: WorkbookType | undefined) {
  const cells = new Map<string, { sheetId: string; rowId: string; fieldId: string; key?: string; value: EditableWorkbookWire['sheets'][number]['rows'][number]['cells'][number]['value'] }>();
  const counts = new Map<string, number>();
  if (type?.keyFieldId) for (const sheet of workbook.sheets) {
    const keyColumns = columns(sheet, type.keyFieldId);
    for (const row of sheet.rows.slice(sheet.headerRow ?? 1)) {
      for (const key of new Set(keyColumns.map(column => row.cells[column]?.value).filter((value): value is string => typeof value === 'string')))
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  for (const sheet of workbook.sheets) {
    const keyColumn = type?.keyFieldId ? columns(sheet, type.keyFieldId)[0] : undefined;
    sheet.rows.forEach((row, rowIndex) => row.cells.forEach((cell, column) => {
    const fieldId = sheet.columnBindings?.[column]?.fieldId ?? `column:${column}`;
    const value = keyColumn === undefined ? undefined : row.cells[keyColumn]?.value;
    const key = rowIndex >= (sheet.headerRow ?? 1) && typeof value === 'string' && counts.get(value) === 1 ? value : undefined;
    const identity = key === undefined ? JSON.stringify(['row', sheet.id, row.id, fieldId]) : JSON.stringify(['key', key, fieldId]);
    cells.set(identity, { sheetId: sheet.id, rowId: row.id, fieldId, ...(key === undefined ? {} : { key }), value: cell.value });
    }));
  }
  return cells;
}
function journalChanges(before: EditableWorkbookWire, after: EditableWorkbookWire, type: WorkbookType | undefined) {
  const oldCells = workbookCells(before, type), newCells = workbookCells(after, type);
  return [...new Set([...oldCells.keys(), ...newCells.keys()])].flatMap(id => {
    const previous = oldCells.get(id), next = newCells.get(id);
    if (same(previous?.value ?? null, next?.value ?? null)) return [];
    const location = next ?? previous!;
    return [{ sheetId: location.sheetId, rowId: location.rowId, fieldId: location.fieldId,
      ...(location.key === undefined ? {} : { key: location.key }), oldValue: previous?.value ?? null, newValue: next?.value ?? null }];
  });
}
export function workbookMatches(workbook: EditableWorkbookWire, keyField: string, key: string) {
  return workbook.sheets.flatMap(sheet => {
    const indexes = columns(sheet, keyField);
    return sheet.rows.slice(sheet.headerRow ?? 1).flatMap(row => indexes.some(index => row.cells[index]?.value === key)
      ? [{ sheetId: sheet.id, rowId: row.id, sheet, row }] : []);
  });
}
export function applyMasterChange(input: Readonly<{ workbook: EditableWorkbookWire; version: number; ownership: WorkbookOwnership;
  type: WorkbookType | undefined; operation: WorkbookOperation; libraryId: string; sequence: number }>): Readonly<{
    workbook: EditableWorkbookWire; ownership: WorkbookOwnership; receipt: WorkbookOperationReceipt;
  }> {
  let workbook = structuredClone(input.workbook), ownership = structuredClone(input.ownership);
  const { operation, type } = input, change = operation.change;
  const receipt: WorkbookOperationReceipt = { operationId: operation.operationId, sequence: input.sequence, libraryId: input.libraryId,
    state: 'applied', version: input.version, ...('key' in change ? { key: change.key } : {}), candidates: [], changes: [], source: operation.source, at: operation.at };
  const refuse = (reason: NonNullable<WorkbookOperationReceipt['reason']>, resolve = false) => ({ workbook: input.workbook, ownership: input.ownership,
    receipt: WorkbookOperationReceiptSchema.parse({ ...receipt, state: resolve ? 'resolve-required' : 'refused', reason, changes: [] }) });
  if ('expectedVersion' in change && change.expectedVersion !== input.version) return refuse('version-conflict');
  if (change.kind !== 'metadata' && change.kind !== 'version' && (workbook.hasFormulas || workbook.unsupportedMetadata || ('workbook' in change && (change.workbook.hasFormulas || change.workbook.unsupportedMetadata)))) return refuse('metadata-unsupported');
  if (change.kind === 'version' || change.kind === 'metadata') return { workbook, ownership, receipt };
  if (change.kind === 'save') {
    if (change.workbook.libraryId !== input.libraryId) return refuse('invalid');
    const next = change.workbook;
    for (const sheet of workbook.sheets) for (const row of sheet.rows) row.cells.forEach((cell, col) => {
      const field = sheet.columnBindings?.[col]?.fieldId ?? `column:${col}`;
      const nextSheet = next.sheets.find(candidate => candidate.id === sheet.id);
      const nextRow = nextSheet?.rows.find(candidate => candidate.id === row.id);
      const nextCol = nextSheet?.columnBindings ? columns(nextSheet, field)[0] : col;
      const after = nextCol === undefined ? undefined : nextRow?.cells[nextCol];
      if (!same(cell, after ?? null)) {
        ownership[address(sheet.id, row.id, field)] = { owner: 'operator' };
      }
    });
    workbook = structuredClone(next);
    receipt.changes = journalChanges(input.workbook, workbook, type);
  } else {
    if (!type || type.keyFieldId === null) return refuse('invalid');
    if (change.kind === 'sync') {
      if (change.workbook.libraryId !== input.libraryId) return refuse('invalid');
      const next = structuredClone(change.workbook), nextOwnership: WorkbookOwnership = {};
      for (const incoming of next.sheets) {
        if (incoming.columnBindings) continue;
        const sources = workbook.sheets.filter(sheet => sheet.name === incoming.name);
        if (sources.length !== 1) return refuse('sync-ambiguous', true);
        const source = sources[0], keyColumns = columns(source, type.keyFieldId);
        if (!source.columnBindings || keyColumns.length !== 1) return refuse('sync-ambiguous', true);
        const keyHeader = source.columnBindings[keyColumns[0]].sourceHeader;
        const headers = incoming.rows.flatMap((row, index) => row.cells.filter(cell => cell.value === keyHeader).length === 1 ? [index] : []);
        if (headers.length !== 1) return refuse('sync-ambiguous', true);
        incoming.headerRow = headers[0] + 1;
        incoming.sourceHeaderRow = incoming.headerRow;
        const used = new Set<string>();
        incoming.columnBindings = incoming.rows[headers[0]].cells.map((cell, index) => {
          const bindings = source.columnBindings?.filter(binding => binding.sourceHeader === cell.value) ?? [];
          const binding = bindings.length === 1 ? bindings[0] : undefined;
          if (binding?.fieldId && !used.has(binding.fieldId)) {
            used.add(binding.fieldId);
            return { ...binding, sourceColumn: index };
          }
          return { id: `${incoming.id}:column:${index}`, sourceColumn: index, sourceHeader: typeof cell.value === 'string' ? cell.value : '', fieldId: null, basis: 'unmapped' as const };
        });
        if (columns(incoming, type.keyFieldId).length !== 1) return refuse('sync-ambiguous', true);
      }

      for (const sheet of workbook.sheets) for (const row of sheet.rows.slice(sheet.headerRow ?? 1)) {
        const keyCol = columns(sheet, type.keyFieldId);
        if (keyCol.length !== 1) return refuse('sync-ambiguous', true);
        const key = row.cells[keyCol[0]].value;
        for (const field of type.fields) {
          const owner = ownership[address(sheet.id, row.id, field)];
          if (!owner) continue;
          if (typeof key !== 'string' || workbookMatches(workbook, type.keyFieldId, key).length !== 1) return refuse('sync-ambiguous', true);
          const matches = workbookMatches(next, type.keyFieldId, key);
          if (matches.length !== 1) return refuse('sync-ambiguous', true);
          const target = matches[0];
          let targetColumns = columns(target.sheet, field);
          const sourceColumns = columns(sheet, field);
          if (sourceColumns.length !== 1 || targetColumns.length > 1) return refuse('sync-ambiguous', true);
          if (!targetColumns.length) {
            const sourceBinding = sheet.columnBindings?.[sourceColumns[0]];
            if (!sourceBinding || !target.sheet.columnBindings) return refuse('sync-ambiguous', true);
            const index = target.sheet.width++;
            target.sheet.columnBindings.push(structuredClone(sourceBinding));
            target.sheet.rows.forEach((item, rowIndex) => item.cells.push({ value: rowIndex === (target.sheet.headerRow ?? 1) - 1 ? sourceBinding.sourceHeader : null }));
            targetColumns = [index];
          }
          const cell = target.row.cells[targetColumns[0]], original = row.cells[sourceColumns[0]];
          {
            if (owner.owner === 'relay' && !same(original.value, owner.value)) return refuse('sync-ambiguous', true);
            Object.assign(cell, structuredClone(original));
            for (const name of ['richText', 'hyperlink', 'tooltip'] as const) if (original[name] === undefined) delete cell[name];
          }
          nextOwnership[address(target.sheetId, target.rowId, field)] = owner;
        }
      }
      workbook = next; ownership = nextOwnership;
      receipt.changes = journalChanges(input.workbook, workbook, type);
    } else {
      if (!Object.keys(change.values).length || Object.keys(change.values).some(field => !type.fields.includes(field))) return refuse('invalid');
      let matches = workbookMatches(workbook, type.keyFieldId, change.key);
      receipt.candidates = matches.map(({ sheetId, rowId }) => ({ sheetId, rowId }));
      if (change.kind === 'add') {
        if (matches.length) return refuse('duplicate-key', true);
        const sheet = workbook.sheets.find(item => item.id === change.sheetId);
        if (!sheet || sheet.rows.some(row => row.id === change.rowId) || columns(sheet, type.keyFieldId).length !== 1) return refuse('invalid');
        const row: EditableWorkbookWire['sheets'][number]['rows'][number] = { id: change.rowId, cells: Array.from({ length: sheet.width }, () => ({ value: null })) };
        row.cells[columns(sheet, type.keyFieldId)[0]].value = change.key;
        ownership[address(sheet.id, row.id, type.keyFieldId)] = { owner: 'relay', value: change.key };
        receipt.changes.push({ sheetId: sheet.id, rowId: row.id, fieldId: type.keyFieldId, key: change.key, oldValue: null, newValue: change.key });
        sheet.rows.push(row); matches = [{ sheetId: sheet.id, rowId: row.id, sheet, row }];
      } else {
        if (change.selection) {
          if (change.selection.expectedVersion !== input.version) return refuse('stale-selection', true);
          matches = matches.filter(match => match.sheetId === change.selection?.sheetId && match.rowId === change.selection.rowId);
        }
        if (!matches.length) return refuse('missing-key', true);
        if (matches.length !== 1) return refuse('duplicate-key', true);
      }
      const match = matches[0];
      for (const [field, value] of Object.entries(change.values)) {
        if (field === type.keyFieldId && value !== change.key) return refuse('invalid');
        if (change.kind === 'add' && field === type.keyFieldId) continue;
        const indexes = columns(match.sheet, field);
        if (indexes.length !== 1) return refuse('invalid');
        const cell = match.row.cells[indexes[0]], id = address(match.sheetId, match.rowId, field), owner = ownership[id];
        if (owner?.owner === 'operator' || (owner?.owner === 'relay' ? !same(cell.value, owner.value) : cell.value !== null && cell.value !== ''))
          return refuse('operator-edited', true);
        receipt.changes.push({ sheetId: match.sheetId, rowId: match.rowId, fieldId: field, oldValue: cell.value, newValue: value });
        cell.value = structuredClone(value); delete cell.richText; delete cell.hyperlink; delete cell.tooltip;
        ownership[id] = { owner: 'relay', value: structuredClone(value) };
      }
    }
  }
  const parsed = EditableWorkbookWireSchema.safeParse(workbook);
  if (!parsed.success) return refuse('invalid');
  workbook = parsed.data;
  receipt.version++;
  return { workbook, ownership, receipt: WorkbookOperationReceiptSchema.parse(receipt) };
}
