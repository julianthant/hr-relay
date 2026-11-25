import type { ReactNode } from "react";
import { Circle, CircleCheck } from "lucide-react";
import { Input, Table, TBody, TD, TH, THead, TR } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";
import { PageCard } from "./page-card.js";

export type PickColumn = Readonly<{ id: string; label: string }>;
export type PickCell = Readonly<{ value: string; attention?: boolean }>;
export type PickRow = Readonly<{ id: string; label: string; cells: readonly PickCell[] }>;
export type PickTyped = Readonly<{ id: string; label: string; placeholder?: string; value: string }>;

/**
 * A pick is the step's own page card in Pick mode: the icon column is the selection mark and the chosen row takes the
 * selected surface. `typed` is the fill row for the operator's own value. A cell with `attention` takes the warning colour.
 */
export function PickTableView({ title, columns, rows, typed, chosen, onChoose, onText, disabled = false }: {
  title: string; columns: readonly PickColumn[]; rows: readonly PickRow[]; typed?: PickTyped;
  chosen?: string; onChoose: (id: string) => void; onText: (value: string) => void; disabled?: boolean;
}) {
  const last = columns.length - 1;
  // The column with the longest values takes the leftover width and truncates; the rest never wrap.
  const widest = (index: number) => Math.max(...rows.map(row => row.cells[index]?.value.length ?? 0));
  const flex = columns.reduce((best, _, index) => widest(index) > widest(best) ? index : best, 0);
  const row = (id: string, label: string, cells: ReactNode) => {
    const selected = chosen === id;
    const pick = () => { if (!disabled) onChoose(id); };
    return <TR key={id} selected={selected} interactive={!disabled && !selected} onClick={pick}>
      <TD className="w-9 pl-3"><button type="button" role="radio" aria-checked={selected} aria-label={label} disabled={disabled} onClick={event => { event.stopPropagation(); pick(); }}
        className={cn("block rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ui-info", selected ? "text-ui-info" : "text-ui-muted")}>
        {selected ? <CircleCheck aria-hidden className="size-3.5" /> : <Circle aria-hidden className="size-3.5" />}</button></TD>
      {cells}
    </TR>;
  };
  return <PageCard title={title} mode="Pick">
    <Table label={title}>
      <THead><TR><TH className="w-9 pl-3"><span className="sr-only">Choose</span></TH>{columns.map((column, index) => <TH key={column.id} align={index === last ? "right" : "left"} title={column.label} className={cn("text-caption font-normal normal-case whitespace-nowrap", index === flex && "w-full max-w-0 truncate")}>{column.label}</TH>)}</TR></THead>
      <TBody>
        {rows.map(item => row(item.id, item.label, columns.map((column, index) => {
          const cell = item.cells[index];
          return <TD key={column.id} align={index === last ? "right" : "left"} title={cell?.value}
            className={cn("tabular-nums whitespace-nowrap", index === flex && "w-full max-w-0 truncate", index === 0 ? "font-medium text-ui-primary" : cell?.attention ? "text-ui-warning" : "text-ui-secondary")}>{cell?.value}</TD>;
        })))}
        {typed && row(typed.id, typed.label, <>
          <TD className="font-medium whitespace-nowrap text-ui-primary">{typed.label}</TD>
          <TD align="right" colSpan={Math.max(1, columns.length - 1)}><Input aria-label={typed.label} value={typed.value} placeholder={typed.placeholder} disabled={disabled}
            onChange={event => onText(event.target.value)} className="ml-auto h-7 w-36 text-right font-medium text-ui-info tabular-nums" /></TD>
        </>)}
      </TBody>
    </Table>
  </PageCard>;
}
