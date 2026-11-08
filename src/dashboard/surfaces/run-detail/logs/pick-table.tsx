import type { ReactNode } from "react";
import { Circle, CircleCheck, PanelsTopLeft } from "lucide-react";
import { Input } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";
import type { CandidateTableWire } from "../../../../models/dashboard/run-decision.js";
import { TYPED_ROW } from "./log-decision-model.js";

/**
 * A pick is the step's own page card in Pick mode: the icon column is the selection mark and the chosen row takes the
 * selected surface. The last row is the fill row for the operator's own value: typing selects it, and picking
 * another row clears it. The owner treats any `onText` as selecting the fill row.
 */
export function PickTable({ table, chosen, onChoose, text, onText, disabled = false }: {
  table: CandidateTableWire; chosen?: string; onChoose: (id: string) => void; text: string; onText: (value: string) => void; disabled?: boolean;
}) {
  const columns = table.columns;
  const last = columns.length - 1;
  const value = (row: CandidateTableWire["rows"][number], columnId: string) => row.cells.find(cell => cell.columnId === columnId)?.value ?? "";
  // The column with the longest values takes the leftover width and truncates; the rest never wrap.
  const widest = (index: number) => Math.max(...table.rows.map(row => value(row, columns[index].id).length));
  const flex = columns.reduce((best, _, index) => widest(index) > widest(best) ? index : best, 0);
  const row = (id: string, label: string, cells: ReactNode) => {
    const selected = chosen === id;
    const pick = () => { if (!disabled) onChoose(id); };
    return <tr key={id} onClick={pick} className={cn("border-t border-ui-stroke", !disabled && "cursor-pointer", selected ? "bg-[var(--ds-surface-selected)]" : !disabled && "hover:bg-ui-hover")}>
      <td className="w-9 py-2.5 pl-3 align-middle"><button type="button" role="radio" aria-checked={selected} aria-label={label} disabled={disabled} onClick={event => { event.stopPropagation(); pick(); }}
        className={cn("block rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ui-info", selected ? "text-ui-info" : "text-ui-muted")}>
        {selected ? <CircleCheck aria-hidden className="size-3.5" /> : <Circle aria-hidden className="size-3.5" />}</button></td>
      {cells}
    </tr>;
  };
  return <div className="overflow-hidden rounded-lg border border-ui-stroke bg-ui-table">
    <div className="flex min-h-11 items-center gap-2.5 border-b border-ui-stroke px-3 py-2.5"><PanelsTopLeft aria-hidden className="size-4 shrink-0 text-ui-muted" /><h4 className="m-0 text-control font-semibold">{table.title}</h4><span className="ml-auto text-caption text-ui-muted">Pick</span></div>
    <table aria-label={table.title} className="w-full border-collapse text-left text-body">
      <thead><tr className="text-caption text-ui-muted"><th className="w-9 pl-3"><span className="sr-only">Choose</span></th>{columns.map((column, index) => <th key={column.id} className={cn("px-3 py-2 font-normal whitespace-nowrap", index === last && "text-right")}>{column.label}</th>)}</tr></thead>
      <tbody>
        {table.rows.map(item => row(item.id, item.name, columns.map((column, index) => {
          const cell = item.cells.find(candidate => candidate.columnId === column.id);
          return <td key={column.id} title={cell?.value}
            className={cn("px-3 py-2.5 tabular-nums whitespace-nowrap", index === flex && "w-full max-w-0 truncate", index === last && "text-right", index === 0 ? "font-medium" : cell?.tone === "attention" ? "text-ui-warning" : "text-ui-secondary")}>{cell?.value}</td>;
        })))}
        {table.typed && row(TYPED_ROW, table.typed.label, <>
          <td className="px-3 py-2 font-medium whitespace-nowrap">{table.typed.label}</td>
          <td colSpan={Math.max(1, columns.length - 1)} className="px-3 py-1.5 text-right"><Input aria-label={table.typed.label} value={text} placeholder={table.typed.placeholder} disabled={disabled}
            onChange={event => onText(event.target.value)} className="ml-auto h-7 w-36 text-right font-medium text-ui-info tabular-nums" /></td>
        </>)}
      </tbody>
    </table>
  </div>;
}
