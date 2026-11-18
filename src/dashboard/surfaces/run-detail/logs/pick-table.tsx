import type { CandidateTableWire } from "../../../../models/dashboard/run-decision.js";
import { PickTableView } from "../../shared/steps/pick-table-view.js";
import { TYPED_ROW } from "./log-decision-model.js";

/**
 * The last row is the fill row for the operator's own value: typing selects it, and picking
 * another row clears it. The owner treats any `onText` as selecting the fill row.
 */
export function PickTable({ table, chosen, onChoose, text, onText, disabled = false }: {
  table: CandidateTableWire; chosen?: string; onChoose: (id: string) => void; text: string; onText: (value: string) => void; disabled?: boolean;
}) {
  return <PickTableView title={table.title} columns={table.columns} chosen={chosen} onChoose={onChoose} onText={onText} disabled={disabled}
    rows={table.rows.map(item => ({ id: item.id, label: item.name, cells: table.columns.map(column => {
      const cell = item.cells.find(candidate => candidate.columnId === column.id);
      return { value: cell?.value ?? "", attention: cell?.tone === "attention" };
    }) }))}
    typed={table.typed && { id: TYPED_ROW, label: table.typed.label, placeholder: table.typed.placeholder, value: text }} />;
}
