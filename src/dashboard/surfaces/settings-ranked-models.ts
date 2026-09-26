export interface ProviderModelRow {
  readonly id: string;
  readonly value: string;
}

export function modelRows(raw: string, previous: readonly ProviderModelRow[], newId: () => string): ProviderModelRow[] {
  if (raw === "") return [];
  return raw.split("\n").map((value, index) => ({ id: previous[index]?.id ?? newId(), value }));
}

export function modelRaw(rows: readonly ProviderModelRow[]): string {
  return rows.map(row => row.value).join("\n");
}

export function updateModelRow(rows: readonly ProviderModelRow[], id: string, value: string): ProviderModelRow[] {
  if (!rows.some(row => row.id === id)) throw new Error("settings-model-row-missing");
  return rows.map(row => row.id === id ? { ...row, value } : row);
}

export function removeModelRow(rows: readonly ProviderModelRow[], id: string): ProviderModelRow[] {
  if (!rows.some(row => row.id === id)) throw new Error("settings-model-row-missing");
  return rows.filter(row => row.id !== id);
}

export function reorderModelRows(rows: readonly ProviderModelRow[], ids: readonly string[]): ProviderModelRow[] {
  if (ids.length !== rows.length || new Set(ids).size !== rows.length) throw new Error("settings-model-order-invalid");
  const byId = new Map(rows.map(row => [row.id, row]));
  return ids.map(id => {
    const row = byId.get(id);
    if (row === undefined) throw new Error("settings-model-order-invalid");
    return row;
  });
}
