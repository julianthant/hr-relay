import { z } from 'zod';
import { EditableWorkbookWireSchema, WorkbookOperationReceiptSchema, type EditableWorkbookWire, type WorkbookType, type WorkbookOperation, type WorkbookOperationReceipt } from '../../models/dashboard/workbooks.js';
import { canonicalJsonStringify } from '../../rules/validation/canonical-json.js';

export const WorkbookOwnershipSchema = z.record(z.string(), z.discriminatedUnion('owner', [
  z.strictObject({ owner: z.literal('relay'), value: WorkbookOperationReceiptSchema.shape.changes.element.shape.newValue }), z.strictObject({ owner: z.literal('operator') }),
]));
export type WorkbookOwnership = z.infer<typeof WorkbookOwnershipSchema>;
export type WorkbookRowKeyWitness = Readonly<{ sheetId: string; rowId: string; keyFieldId: string; key: string }>;
export type WorkbookReplayContext = { witnesses: WorkbookRowKeyWitness[]; captured: boolean };
const same = (a: unknown, b: unknown) => canonicalJsonStringify(JSON.parse(JSON.stringify(a ?? null))) === canonicalJsonStringify(JSON.parse(JSON.stringify(b ?? null)));
const address = (sheet: string, row: string, field: string) => JSON.stringify([sheet, row, field]);
function columns(sheet: EditableWorkbookWire['sheets'][number], field: string): number[] {
  return sheet.columnBindings?.flatMap((binding, index) => binding.fieldId === field ? [index] : []) ?? [];
}
export function workbookKey(value: unknown): string | undefined {
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
function syncByCapturedKeys(workbook: EditableWorkbookWire, incoming: EditableWorkbookWire,
  ownership: WorkbookOwnership, witnesses: readonly WorkbookRowKeyWitness[]) {
  const next = structuredClone(incoming), relocated: WorkbookOwnership = {}, movedWitnesses: WorkbookRowKeyWitness[] = [];
  const sheets = new Map<string, { old: EditableWorkbookWire['sheets'][number]; current: EditableWorkbookWire['sheets'][number] }>();
  const addressSchema = z.tuple([z.string(), z.string(), z.string()]);
  let invalidAddress = false;
  const indexes = new Map<string, Map<string, number>>();
  for (const sheet of workbook.sheets) indexes.set(sheet.id, new Map<string, number>(sheet.rows.map((row, index) => [row.id, index])));
  const owners = Object.entries(ownership).flatMap(([id, owner]) => {
    let decoded: unknown;
    try { decoded = JSON.parse(id); } catch { invalidAddress = true; return []; }
    const parsed = addressSchema.safeParse(decoded);
    if (!parsed.success) { invalidAddress = true; return []; }
    const [sheetId, rowId, fieldId] = parsed.data;
    const sheet = workbook.sheets.find(sheet => sheet.id === sheetId);
    const rowIndex = indexes.get(sheetId)?.get(rowId) ?? -1;
    return sheet !== undefined && rowIndex >= (sheet.headerRow ?? 1) ? [{ sheetId, rowId, fieldId, owner }] : [];
  });
  if (invalidAddress) return undefined;
  for (const current of next.sheets) {
    const sources = workbook.sheets.filter(sheet => sheet.name === current.name);
    if (sources.length === 0) {
      if (current.columnBindings !== undefined) return undefined;
      continue;
    }
    if (sources.length !== 1 || current.columnBindings !== undefined) return undefined;
    const old = sources[0];
    if (sheets.has(old.id)) return undefined;
    const mapped = old.columnBindings?.filter(binding => binding.fieldId !== null) ?? [];
    if (!old.columnBindings || mapped.length === 0) {
      if (owners.some(owner => owner.sheetId === old.id) || witnesses.some(witness => witness.sheetId === old.id)) return undefined;
      continue;
    }
    const ownedFields = new Set(owners.filter(owner => owner.sheetId === old.id).map(owner => owner.fieldId));
    const keyFields = new Set(witnesses.filter(witness => witness.sheetId === old.id).map(witness => witness.keyFieldId));
    const anchors = mapped.filter(binding => binding.fieldId !== null && (!ownedFields.has(binding.fieldId) || keyFields.has(binding.fieldId)));
    if (anchors.length === 0 || new Set(mapped.map(binding => binding.sourceHeader)).size !== mapped.length) return undefined;
    const headers = current.rows.flatMap((row, index) => anchors.every(binding => row.cells.filter(cell => cell.value === binding.sourceHeader).length === 1) ? [index] : []);
    if (headers.length !== 1) return undefined;
    current.headerRow = headers[0] + 1;
    current.sourceHeaderRow = current.headerRow;
    const header = current.rows[headers[0]];
    current.columnBindings = header.cells.map((cell, index) => {
      const matches = old.columnBindings?.filter(binding => binding.sourceHeader === cell.value) ?? [];
      const binding = matches.length === 1 ? matches[0] : undefined;
      return binding === undefined ? { id: `${current.id}:column:${index}`, sourceColumn: index,
        sourceHeader: typeof cell.value === 'string' ? cell.value : '', fieldId: null, basis: 'unmapped' as const }
        : { ...binding, sourceColumn: index };
    });
    sheets.set(old.id, { old, current });
  }
  const targets = new Map<string, { sheet: EditableWorkbookWire['sheets'][number]; row: EditableWorkbookWire['sheets'][number]['rows'][number] }>();
  const reverseTargets = new Map<string, string>();
  const witnessesByRow = new Map<string, WorkbookRowKeyWitness[]>();
  for (const witness of witnesses) {
    const id = JSON.stringify([witness.sheetId, witness.rowId]);
    const group = witnessesByRow.get(id) ?? [];
    group.push(witness); witnessesByRow.set(id, group);
  }
  type Sheet = EditableWorkbookWire['sheets'][number];
  type Row = Sheet['rows'][number];
  const rowsById = new WeakMap<Sheet, Map<string, Row>>();
  const columnsBySheet = new WeakMap<Sheet, Map<string, number[]>>();
  const indexedColumns = (sheet: Sheet, field: string) => {
    let fields = columnsBySheet.get(sheet);
    if (fields === undefined) { fields = new Map(); columnsBySheet.set(sheet, fields); }
    let indexes = fields.get(field);
    if (indexes === undefined) { indexes = columns(sheet, field); fields.set(field, indexes); }
    return indexes;
  };
  const rowFor = (sheet: Sheet, id: string) => {
    let rows = rowsById.get(sheet);
    if (rows === undefined) { rows = new Map<string, Row>(sheet.rows.map(row => [row.id, row])); rowsById.set(sheet, rows); }
    return rows.get(id);
  };
  const keysBySheet = new WeakMap<Sheet, Map<string, Map<string, Row[]>>>();
  const keyedRows = (sheet: Sheet, field: string, key: string) => {
    let fields = keysBySheet.get(sheet);
    if (fields === undefined) { fields = new Map(); keysBySheet.set(sheet, fields); }
    let keys = fields.get(field);
    if (keys === undefined) {
      const indexes = indexedColumns(sheet, field);
      if (indexes.length !== 1) return undefined;
      keys = new Map();
      for (const row of sheet.rows.slice(sheet.headerRow ?? 1)) {
        const value = workbookKey(row.cells[indexes[0]]?.value);
        if (value === undefined) continue;
        const group = keys.get(value) ?? [];
        group.push(row); keys.set(value, group);
      }
      fields.set(field, keys);
    }
    return keys.get(key) ?? [];
  };
  const locate = (sheetId: string, rowId: string) => {
    const identity = JSON.stringify([sheetId, rowId]);
    if (targets.has(identity)) return targets.get(identity);
    const mapped = sheets.get(sheetId), oldRow = mapped && rowFor(mapped.old, rowId);
    if (!mapped || !oldRow || (indexes.get(sheetId)?.get(rowId) ?? -1) < (mapped.old.headerRow ?? 1)) return undefined;
    const proofs = witnessesByRow.get(identity) ?? [];
    if (!proofs.length) return undefined;
    let target: { sheet: typeof mapped.current; row: typeof mapped.current.rows[number] } | undefined;
    for (const witness of proofs) {
      const oldMatches = keyedRows(mapped.old, witness.keyFieldId, witness.key);
      const matches = keyedRows(mapped.current, witness.keyFieldId, witness.key);
      if (oldMatches?.length !== 1 || oldMatches[0] !== oldRow || matches === undefined) return undefined;
      if (matches.length !== 1 || target && target.row !== matches[0]) return undefined;
      target = { sheet: mapped.current, row: matches[0] };
    }
    if (target) {
      const destination = JSON.stringify([target.sheet.id, target.row.id]);
      const previous = reverseTargets.get(destination);
      if (previous !== undefined && previous !== identity) return undefined;
      reverseTargets.set(destination, identity);
      targets.set(identity, target);
    }
    return target;
  };
  for (const owner of owners) {
    const target = locate(owner.sheetId, owner.rowId), source = sheets.get(owner.sheetId);
    const oldRow = source && rowFor(source.old, owner.rowId);
    if (!target || !source || !oldRow) return undefined;
    const sourceColumns = indexedColumns(source.old, owner.fieldId);
    let targetColumns = indexedColumns(target.sheet, owner.fieldId);
    if (sourceColumns.length !== 1 || targetColumns.length > 1) return undefined;
    const oldCell = oldRow.cells[sourceColumns[0]];
    if (!oldCell || owner.owner.owner === 'relay' && !same(oldCell.value, owner.owner.value)) return undefined;
    if (!targetColumns.length) {
      const binding = source.old.columnBindings?.[sourceColumns[0]];
      if (!binding || !target.sheet.columnBindings || target.sheet.rows.some(row => row.cells.length !== target.sheet.width)) return undefined;
      const index = target.sheet.width++;
      target.sheet.columnBindings.push({ ...structuredClone(binding), sourceColumn: index });
      target.sheet.rows.forEach((row, rowIndex) => row.cells.push({ value: rowIndex === (target.sheet.headerRow ?? 1) - 1 ? binding.sourceHeader : null }));
      targetColumns = [index];
      columnsBySheet.get(target.sheet)?.set(owner.fieldId, targetColumns);
    }
    const cell = target.row.cells[targetColumns[0]];
    Object.assign(cell, structuredClone(oldCell));
    for (const name of ['richText', 'hyperlink', 'tooltip'] as const) if (oldCell[name] === undefined) delete cell[name];
    const id = address(target.sheet.id, target.row.id, owner.fieldId);
    if (relocated[id] !== undefined) return undefined;
    relocated[id] = owner.owner;
  }
  for (const witness of witnesses) {
    const target = locate(witness.sheetId, witness.rowId);
    if (target === undefined) return undefined;
    movedWitnesses.push({ ...witness, sheetId: target.sheet.id, rowId: target.row.id });
  }
  return { workbook: next, ownership: relocated, witnesses: movedWitnesses };
}
export function applyMasterChange(input: Readonly<{ workbook: EditableWorkbookWire; version: number; ownership: WorkbookOwnership;
  type: Pick<WorkbookType, 'keyFieldId' | 'fields'> | undefined; operation: WorkbookOperation; libraryId: string; sequence: number;
  context?: WorkbookReplayContext }>): Readonly<{
    workbook: EditableWorkbookWire; ownership: WorkbookOwnership; receipt: WorkbookOperationReceipt;
  }> {
  let workbook = structuredClone(input.workbook), ownership = structuredClone(input.ownership);
  let nextWitnesses = input.context?.witnesses ?? [];
  let nextCaptured = input.context?.captured ?? false;
  let appliedWitness: WorkbookRowKeyWitness | undefined;
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
    nextWitnesses = nextWitnesses.filter(witness => {
      const sheet = workbook.sheets.find(sheet => sheet.id === witness.sheetId);
      const row = sheet?.rows.find(row => row.id === witness.rowId);
      const keyColumns = sheet === undefined ? [] : columns(sheet, witness.keyFieldId);
      return row !== undefined && keyColumns.length === 1 && workbookKey(row.cells[keyColumns[0]]?.value) === witness.key;
    });
    receipt.changes = journalChanges(input.workbook, workbook, type);
  } else {
    if (change.kind !== 'sync' && (!type || type.keyFieldId === null)) return refuse('invalid');
    if (change.kind === 'sync') {
      if (change.workbook.libraryId !== input.libraryId) return refuse('invalid');
      if (nextCaptured || type?.keyFieldId === null) {
        const mapped = syncByCapturedKeys(workbook, change.workbook, ownership, nextWitnesses);
        if (mapped === undefined) return refuse('sync-ambiguous', true);
        workbook = mapped.workbook;
        ownership = mapped.ownership;
        nextWitnesses = mapped.witnesses;
        receipt.changes = journalChanges(input.workbook, workbook, type);
      } else {
      if (!type || type.keyFieldId === null) return refuse('invalid');
      const next = structuredClone(change.workbook), nextOwnership: WorkbookOwnership = {};
      const legacyTargets = new Map<string, { sheetId: string; rowId: string; sheet: EditableWorkbookWire['sheets'][number]; row: EditableWorkbookWire['sheets'][number]['rows'][number] }>();
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
          legacyTargets.set(JSON.stringify([sheet.id, row.id]), target);
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
      nextWitnesses = nextWitnesses.flatMap(witness => {
        const target = legacyTargets.get(JSON.stringify([witness.sheetId, witness.rowId]));
        if (target === undefined) return [];
        const keyColumns = columns(target.sheet, witness.keyFieldId);
        return keyColumns.length === 1 && workbookKey(target.row.cells[keyColumns[0]]?.value) === witness.key
          ? [{ ...witness, sheetId: target.sheetId, rowId: target.rowId }] : [];
      });
      workbook = next; ownership = nextOwnership;
      receipt.changes = journalChanges(input.workbook, workbook, type);
      }
    } else {
      if (!type || type.keyFieldId === null) return refuse('invalid');
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
      if (change.kind === 'patch' || change.kind === 'add') appliedWitness = { sheetId: match.sheetId, rowId: match.rowId,
        keyFieldId: type.keyFieldId, key: change.key };
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
  if (appliedWitness !== undefined) {
    if (!nextWitnesses.some(witness => same(witness, appliedWitness))) nextWitnesses = [...nextWitnesses, appliedWitness];
    if (operation.source.kind === 'run-reference') nextCaptured = true;
  }
  if (input.context) { input.context.witnesses = nextWitnesses; input.context.captured = nextCaptured; }
  receipt.version++;
  return { workbook, ownership, receipt: WorkbookOperationReceiptSchema.parse(receipt) };
}
