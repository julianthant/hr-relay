import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Tooltip, useToasts } from '../../../ds/ui.js';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '../../../ds/primitives/dropdown-menu.js';
import { FIELDS, samplesOf, type Cell, type Dataset, type Field, type FieldKey } from './sheets-v2-model.js';
import { Grey, Picker, V2Button } from './sheets-v2-ui.js';

type Range = { r0: number; c0: number; r1: number; c1: number };
type Patch = Partial<Record<FieldKey, string | null>>;
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const style = (cell: Cell) => `${cell.bold ? 'font-weight:700;' : ''}${cell.fill ? `background:${cell.fill};` : ''}${cell.align ? `text-align:${cell.align};` : ''}`;
const WORKFLOWS = [...new Set(FIELDS.flatMap(field => field.usedBy))];
const tint = (percent: number) => `linear-gradient(color-mix(in srgb, var(--ui-info) ${percent}%, transparent), color-mix(in srgb, var(--ui-info) ${percent}%, transparent))`;

/** One field pill: soft when mapped, dashed and grey when not. Opens the sheet's columns with two sample values each. */
function FieldPill({ field, dataset, value, onChange, onActive }: { field: Field; dataset: Dataset; value: string | null; onChange: (header: string | null) => void; onActive: (active: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return <Tooltip content={`Used by ${field.usedBy.join(', ')}`}><span className="inline-flex" onMouseEnter={() => onActive(true)} onMouseLeave={() => !open && onActive(false)} onFocus={() => onActive(true)} onBlur={() => !open && onActive(false)}>
    <DropdownMenu open={open} onOpenChange={next => { setOpen(next); onActive(next); }}><DropdownMenuTrigger render={value
      ? <V2Button look="soft" aria-label={`${field.label} column, ${value}`}>{field.label} → {value}<ChevronDown size={14} aria-hidden className="text-ui-muted" /></V2Button>
      : <V2Button look="line" className="!border-dashed !text-[color:var(--ds-fg-muted)]" aria-label={`${field.label} column, not mapped`}>{field.label} → Choose column<ChevronDown size={14} aria-hidden /></V2Button>} />
      <DropdownMenuContent align="start" className="min-w-[400px]"><DropdownMenuGroup><DropdownMenuLabel>{field.label} column</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value ?? ''} onValueChange={next => onChange(next === '' ? null : next)}>
          {dataset.headers.map(header => <DropdownMenuRadioItem closeOnClick key={header} value={header}><span className="flex min-w-0 flex-1 items-baseline justify-between gap-4"><span className="whitespace-nowrap">{header}</span><Grey className="truncate">{samplesOf(dataset, header)}</Grey></span></DropdownMenuRadioItem>)}
          <DropdownMenuRadioItem closeOnClick value=""><span className="text-ui-muted">None</span></DropdownMenuRadioItem>
        </DropdownMenuRadioGroup></DropdownMenuGroup>
      </DropdownMenuContent></DropdownMenu>
  </span></Tooltip>;
}

export function MappingGrid({ title, dataset, mapping, onMap, maxHeight = 'max-h-[min(58vh,440px)]' }: { title: string; dataset: Dataset; mapping: Readonly<Record<FieldKey, string | null>>; onMap: (patch: Patch) => void; maxHeight?: string }) {
  const { toast } = useToasts();
  const [extra, setExtra] = useState<readonly string[]>([]);
  const [active, setActive] = useState<FieldKey | null>(null);
  const [selection, setSelection] = useState<Range>();
  const [dragging, setDragging] = useState(false);
  const mappedOrder = [...new Set(FIELDS.map(field => mapping[field.key]).filter((header): header is string => !!header && dataset.headers.includes(header)))];
  const shown = [...mappedOrder, ...dataset.headers.filter(header => extra.includes(header) && !mappedOrder.includes(header))].map(header => ({ header, index: dataset.headers.indexOf(header) }));
  const others = dataset.headers.filter(header => !mappedOrder.includes(header));
  const unseen = others.filter(header => !extra.includes(header)).length;
  const activeHeader = active ? mapping[active] : null;
  useEffect(() => { const up = () => setDragging(false); window.addEventListener('mouseup', up); return () => window.removeEventListener('mouseup', up); }, []);
  const box = selection && { r0: Math.min(selection.r0, selection.r1), r1: Math.max(selection.r0, selection.r1), c0: Math.min(selection.c0, selection.c1), c1: Math.max(selection.c0, selection.c1) };
  const inside = (row: number, column: number) => !!box && row >= box.r0 && row <= box.r1 && column >= box.c0 && column <= box.c1;
  const cellCount = box ? (box.r1 - box.r0 + 1) * (box.c1 - box.c0 + 1) : 0;
  const columnTint = (header: string) => header === activeHeader ? tint(18) : mappedOrder.includes(header) ? tint(6) : undefined;
  const copy = async () => {
    if (!box) return;
    const rows = dataset.rows.slice(box.r0, box.r1 + 1).map(row => shown.slice(box.c0, box.c1 + 1).map(({ index }) => row[index]));
    const html = `<table>${rows.map(row => `<tr>${row.map(cell => `<td style="${style(cell)}">${esc(cell.text)}</td>`).join('')}</tr>`).join('')}</table>`;
    const text = rows.map(row => row.map(cell => cell.text).join('\t')).join('\n');
    try { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]); toast({ tone: 'success', title: `Copied ${cellCount === 1 ? '1 cell' : `${cellCount} cells`}` }); }
    catch { toast({ tone: 'danger', title: "Couldn't copy the cells" }); }
  };
  return <section aria-label={title} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'c' && box) { event.preventDefault(); void copy(); } }}>
    <div className="mb-2 flex items-center justify-between gap-4"><h2 className="text-[13px] font-semibold">{title}</h2>
      <div className="flex items-center gap-2">
        {box && <><Grey>{cellCount === 1 ? '1 cell' : `${cellCount} cells`} selected · Copy keeps fills, bold and number formats</Grey><V2Button onClick={() => void copy()}>Copy</V2Button></>}
        <DropdownMenu><DropdownMenuTrigger render={<Picker aria-label="Columns">{unseen ? `Columns · ${unseen} more` : 'Columns'}</Picker>} /><DropdownMenuContent align="end" className="min-w-[240px]"><DropdownMenuGroup>
          <DropdownMenuLabel>Show other columns (view only)</DropdownMenuLabel>
          {others.map(header => <DropdownMenuCheckboxItem key={header} checked={extra.includes(header)} onCheckedChange={checked => { setSelection(undefined); setExtra(current => checked ? [...current, header] : current.filter(item => item !== header)); }} onSelect={event => event.preventDefault()}>{header}</DropdownMenuCheckboxItem>)}
        </DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
      </div></div>
    <div role="group" aria-label="Field mapping" className="flex flex-wrap items-center gap-2">
      {FIELDS.map(field => <FieldPill key={field.key} field={field} dataset={dataset} value={mapping[field.key]} onActive={on => setActive(current => on ? field.key : current === field.key ? null : current)}
        onChange={header => { setSelection(undefined); onMap({ [field.key]: header }); }} />)}
    </div>
    <div className="mb-2 mt-1.5"><Grey className="block truncate">Used by {WORKFLOWS.join(', ')}</Grey></div>
    <div className={`${maxHeight} overflow-auto rounded-md border border-ui-stroke`}>
      <table className="w-full select-none border-collapse text-[12px]">
        <thead className="sticky top-0 bg-ui-table"><tr><th className="w-9 px-2 py-1.5" />{shown.map(({ header }) => <th key={header} style={{ backgroundImage: columnTint(header), boxShadow: mappedOrder.includes(header) ? 'inset 0 2px 0 var(--ui-info)' : undefined }} className="whitespace-nowrap px-2.5 py-1.5 text-left text-[11px] font-medium text-ui-muted">{header}</th>)}</tr></thead>
        <tbody>{dataset.rows.map((row, r) => <tr key={r} className="border-t border-ui-stroke"><td className="px-2 py-1 text-right text-[11px] tabular-nums text-ui-muted">{r + 1}</td>
          {shown.map(({ header, index }, c) => { const cell = row[index], on = inside(r, c); return <td key={c} onMouseDown={event => { setDragging(true); setSelection(event.shiftKey && selection ? { ...selection, r1: r, c1: c } : { r0: r, c0: c, r1: r, c1: c }); }} onMouseEnter={() => { if (dragging) setSelection(current => current && { ...current, r1: r, c1: c }); }}
            style={on ? undefined : { background: cell.fill, backgroundImage: columnTint(header), color: cell.fill ? '#1f2937' : undefined }} className={`whitespace-nowrap px-2.5 py-1 ${cell.bold ? 'font-bold' : ''} ${cell.align === 'right' ? 'text-right tabular-nums' : ''} ${on ? 'bg-[color-mix(in_srgb,var(--ui-info)_22%,transparent)]' : ''}`}>{cell.text}</td>; })}</tr>)}</tbody>
      </table>
    </div>
  </section>;
}
