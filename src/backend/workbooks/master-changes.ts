import { z } from 'zod';
import { EditableWorkbookWireSchema, WorkbookOperationReceiptSchema, type EditableWorkbookWire, type WorkbookType, type WorkbookOperation, type WorkbookOperationReceipt } from '../../models/dashboard/workbooks.js';
import { canonicalJsonStringify } from '../../rules/validation/canonical-json.js';

export const WorkbookOwnershipSchema = z.record(z.string(), z.discriminatedUnion('owner', [
  z.strictObject({ owner: z.literal('relay'), value: WorkbookOperationReceiptSchema.shape.changes.element.shape.newValue }), z.strictObject({ owner: z.literal('operator') }),
]));
export type WorkbookOwnership = z.infer<typeof WorkbookOwnershipSchema>;
const same = (a: unknown, b: unknown) => canonicalJsonStringify(JSON.parse(JSON.stringify(a ?? null))) === canonicalJsonStringify(JSON.parse(JSON.stringify(b ?? null)));
const address = (sheet: string, row: string, field: string) => JSON.stringify([sheet, row, field]);
function columns(sheet: EditableWorkbookWire['sheets'][number], field: string): number[] {
  return sheet.columnBindings?.flatMap((binding, index) => binding.fieldId === field ? [index] : []) ?? [];
}
function workbookKey(value: unknown): string | undefined {
  if (typeof value === 'string') return value.length ? value : undefined;
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
}
function workbookCells(workbook: EditableWorkbookWire, type: Pick<WorkbookType, 'keyFieldId' | 'fields'> | undefined) {
  const cells = new Map<string, { sheetId: string; rowId: string; fieldId: string; key?: string; value: EditableWorkbookWire['sheets'][number]['rows'][number]['cells'][number]['value'] }>();
  const counts = new Map<string, number>();
  if (type?.keyFieldId) for (const sheet of workbook.sheets) {
    const keyColumns = columns(sheet, type.keyFieldId);
    for (const row of sheet.rows.slice(sheet.headerRow ?? 1)) {
      for (const key of new Set(keyColumns.map(column => workbookKey(row.cells[column]?.value)).filter((value): value is string => value !== undefined)))
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  for (const sheet of workbook.sheets) {
    const keyColumn = type?.keyFieldId ? columns(sheet, type.keyFieldId)[0] : undefined;
    sheet.rows.forEach((row, rowIndex) => row.cells.forEach((cell, column) => {
    const fieldId = sheet.columnBindings?.[column]?.fieldId ?? `column:${column}`;
    const value = keyColumn === undefined ? undefined : workbookKey(row.cells[keyColumn]?.value);
    const key = rowIndex >= (sheet.headerRow ?? 1) && value !== undefined && counts.get(value) === 1 ? value : undefined;
    const identity = key === undefined ? JSON.stringify(['row', sheet.id, row.id, fieldId]) : JSON.stringify(['key', key, fieldId]);
    cells.set(identity, { sheetId: sheet.id, rowId: row.id, fieldId, ...(key === undefined ? {} : { key }), value: cell.value });
    }));
  }
  return cells;
}
function journalChanges(before: EditableWorkbookWire, after: EditableWorkbookWire, type: Pick<WorkbookType, 'keyFieldId' | 'fields'> | undefined) {
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
    return sheet.rows.slice(sheet.headerRow ?? 1).flatMap(row => indexes.some(index => workbookKey(row.cells[index]?.value) === key)
      ? [{ sheetId: sheet.id, rowId: row.id, sheet, row }] : []);
  });
}
export function applyMasterChange(input: Readonly<{ workbook: EditableWorkbookWire; version: number; ownership: WorkbookOwnership;
  type: Pick<WorkbookType, 'keyFieldId' | 'fields'> | undefined; operation: WorkbookOperation; libraryId: string; sequence: number }>): Readonly<{
    workbook: EditableWorkbookWire; ownership: WorkbookOwnership; receipt: WorkbookOperationReceipt;
  }> {
  let workbook = structuredClone(input.workbook), ownership = structuredClone(input.ownership);
  const { operation } = input, change = operation.change;
  const type = operation.source.kind === 'run-reference'
    ? { keyFieldId: operation.source.authority.keyFieldId, fields: operation.source.authority.writableFields } : input.type;
  const receipt: WorkbookOperationReceipt = { operationId: operation.operationId, sequence: input.sequence, libraryId: input.libraryId,
    state: 'applied', version: input.version, ...('key' in change ? { key: change.key } : {}), candidates: [], changes: [], source: operation.source, at: operation.at };
  const refuse = (reason: NonNullable<WorkbookOperationReceipt['reason']>, resolve = false) => ({ workbook: input.workbook, ownership: input.ownership,
    receipt: WorkbookOperationReceiptSchema.parse({ ...receipt, state: resolve ? 'resolve-required' : 'refused', reason, changes: [] }) });
  if (operation.source.kind === 'run-reference' && change.kind !== 'patch') return refuse('invalid');
  if ('expectedVersion' in change && change.expectedVersion !== undefined && change.expectedVersion !== input.version) return refuse('version-conflict', change.kind === 'patch');
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
        const key = workbookKey(row.cells[keyCol[0]].value);
        for (const field of type.fields) {
          const owner = ownership[address(sheet.id, row.id, field)];
          if (!owner) continue;
          if (key === undefined || workbookMatches(workbook, type.keyFieldId, key).length !== 1) return refuse('sync-ambiguous', true);
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
        const keyValue = type.keyFieldId in change.values ? change.values[type.keyFieldId] : change.key;
        if (workbookKey(keyValue) !== change.key) return refuse('invalid');
        const row: EditableWorkbookWire['sheets'][number]['rows'][number] = { id: change.rowId, cells: Array.from({ length: sheet.width }, () => ({ value: null })) };
        row.cells[columns(sheet, type.keyFieldId)[0]].value = keyValue;
        ownership[address(sheet.id, row.id, type.keyFieldId)] = { owner: 'relay', value: keyValue };
        receipt.changes.push({ sheetId: sheet.id, rowId: row.id, fieldId: type.keyFieldId, key: change.key, oldValue: null, newValue: keyValue });
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
        if (field === type.keyFieldId && workbookKey(value) !== change.key) return refuse('invalid');
        if (change.kind === 'add' && field === type.keyFieldId) continue;
        const indexes = columns(match.sheet, field);
        if (indexes.length !== 1) return refuse('invalid');
        const cell = match.row.cells[indexes[0]], id = address(match.sheetId, match.rowId, field), owner = ownership[id];
        if (owner?.owner === 'operator' || (owner?.owner === 'relay' ? !same(cell.value, owner.value) : cell.value !== null && cell.value !== ''))
          return refuse('operator-edited', true);
        receipt.changes.push({ sheetId: match.sheetId, rowId: match.rowId, fieldId: field, key: change.key, oldValue: cell.value, newValue: value });
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

export function mergeMasterWorkbooks(sources: readonly Readonly<{ libraryId: string; savedAt: string; workbook: EditableWorkbookWire }>[], type: WorkbookType,
  name: string, duplicates: 'keep-newer' | 'keep-both'): EditableWorkbookWire | undefined {
  const first = sources[0];
  if (!first || sources.length < 2 || duplicates === 'keep-newer' && type.keyFieldId === null
    || sources.some(source => source.workbook.hasFormulas || source.workbook.unsupportedMetadata || !same(source.workbook.themes, first.workbook.themes))) return undefined;
  const winners = new Map<string, { source: typeof first; rowId: string; sheetId: string }>();
  if (duplicates === 'keep-newer') for (const source of sources) for (const sheet of source.workbook.sheets) {
    const indexes = columns(sheet, type.keyFieldId!);
    if (indexes.length !== 1) return undefined;
    for (const row of sheet.rows.slice(sheet.headerRow ?? 1)) {
      const key = workbookKey(row.cells[indexes[0]]?.value);
      if (key === undefined) continue;
      const previous = winners.get(key);
      if (previous?.source.savedAt === source.savedAt) return undefined;
      if (previous === undefined || previous.source.savedAt < source.savedAt) winners.set(key, { source, rowId: row.id, sheetId: sheet.id });
    }
  }
  const sheets = new Map<string, EditableWorkbookWire['sheets'][number]>();
  const layout = (sheet: EditableWorkbookWire['sheets'][number]) => ({ width: sheet.width, hidden: sheet.hidden, headerRow: sheet.headerRow ?? 1,
    columnBindings: sheet.columnBindings?.map(binding => ({ sourceColumn: binding.sourceColumn, sourceHeader: binding.sourceHeader, fieldId: binding.fieldId })),
    heading: sheet.rows.slice(0, sheet.headerRow ?? 1).map(row => row.cells) });
  for (const source of sources) for (const sheet of source.workbook.sheets) {
    let target = sheets.get(sheet.name);
    if (target !== undefined && !same(layout(target), layout(sheet))) return undefined;
    if (target === undefined) {
      target = { ...structuredClone(sheet), id: JSON.stringify([source.libraryId, sheet.id]), rows: structuredClone(sheet.rows.slice(0, sheet.headerRow ?? 1)) };
      sheets.set(sheet.name, target);
    }
    const keyColumn = type.keyFieldId === null ? undefined : columns(sheet, type.keyFieldId)[0];
    for (const row of sheet.rows.slice(sheet.headerRow ?? 1)) {
      const key = keyColumn === undefined ? undefined : workbookKey(row.cells[keyColumn]?.value);
      const winner = key === undefined ? undefined : winners.get(key);
      if (duplicates === 'keep-newer' && winner && (winner.source !== source || winner.sheetId !== sheet.id || winner.rowId !== row.id)) continue;
      target.rows.push({ ...structuredClone(row), id: JSON.stringify([source.libraryId, sheet.id, row.id]) });
    }
  }
  return EditableWorkbookWireSchema.parse({ ...first.workbook, name, sheets: [...sheets.values()] });
}
