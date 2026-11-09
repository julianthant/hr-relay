import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { dsFocus, useToasts } from '../../../ds/ui.js';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '../../../ds/primitives/dropdown-menu.js';
import { FIELDS, type Cell, type Dataset, type FieldKey } from './sheets-v2-model.js';
import { Grey, Picker, V2Button } from './sheets-v2-ui.js';

type Range = { r0: number; c0: number; r1: number; c1: number };
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const style = (cell: Cell) => `${cell.bold ? 'font-weight:700;' : ''}${cell.fill ? `background:${cell.fill};` : ''}${cell.align ? `text-align:${cell.align};` : ''}`;

const FIELD_TAG = 'inline-flex h-4 shrink-0 items-center rounded-[4px] bg-[color-mix(in_srgb,var(--ui-info)_16%,transparent)] px-1 text-[11px] font-normal text-ui-info';
type Patch = Partial<Record<FieldKey, string | null>>;

export function MappingGrid({ title, dataset, mapping, onMap, maxHeight = 'max-h-[min(58vh,440px)]' }: { title: string; dataset: Dataset; mapping: Readonly<Record<FieldKey, string | null>>; onMap: (patch: Patch) => void; maxHeight?: string }) {
  const { toast } = useToasts();
  const data = dataset;
  const [extra, setExtra] = useState<readonly string[]>([]);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [pending, setPending] = useState<FieldKey | null>(null);
  const [selection, setSelection] = useState<Range>();
  const [dragging, setDragging] = useState(false);
  const mappedOrder = [...new Set(FIELDS.map(field => mapping[field.key]).filter((header): header is string => !!header && data.headers.includes(header)))];
  const shown = [...mappedOrder, ...data.headers.filter(header => extra.includes(header) && !mappedOrder.includes(header))].map(header => ({ header, index: data.headers.indexOf(header) }));
  const others = data.headers.filter(header => !mappedOrder.includes(header));
  const unseen = others.filter(header => !extra.includes(header)).length;
  const unmapped = FIELDS.filter(field => !mapping[field.key]);
  const fieldOf = (header: string) => FIELDS.find(field => mapping[field.key] === header);
  useEffect(() => { const up = () => setDragging(false); window.addEventListener('mouseup', up); return () => window.removeEventListener('mouseup', up); }, []);
  const box = selection && { r0: Math.min(selection.r0, selection.r1), r1: Math.max(selection.r0, selection.r1), c0: Math.min(selection.c0, selection.c1), c1: Math.max(selection.c0, selection.c1) };
  const inside = (row: number, column: number) => !!box && row >= box.r0 && row <= box.r1 && column >= box.c0 && column <= box.c1;
  const cellCount = box ? (box.r1 - box.r0 + 1) * (box.c1 - box.c0 + 1) : 0;
  const assignTo = (header: string, value: string) => {
    const patch: Patch = {}; const current = fieldOf(header);
    if (current) patch[current.key] = null;
    if (value !== 'none') patch[value as FieldKey] = header;
    setSelection(undefined); onMap(patch);
  };
  const copy = async () => {
    if (!box) return;
    const rows = data.rows.slice(box.r0, box.r1 + 1).map(row => shown.slice(box.c0, box.c1 + 1).map(({ index }) => row[index]));
    const html = `<table>${rows.map(row => `<tr>${row.map(cell => `<td style="${style(cell)}">${esc(cell.text)}</td>`).join('')}</tr>`).join('')}</table>`;
    const text = rows.map(row => row.map(cell => cell.text).join('\t')).join('\n');
    try { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]); toast({ tone: 'success', title: `Copied ${cellCount === 1 ? '1 cell' : `${cellCount} cells`}` }); }
    catch { toast({ tone: 'danger', title: "Couldn't copy the cells" }); }
  };
  return <section aria-label={title} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'c' && box) { event.preventDefault(); void copy(); } }}>
    <div className="mb-2 flex items-center justify-between gap-4"><h2 className="text-[13px] font-semibold">{title}</h2>
      <div className="flex items-center gap-2">
        {box && <><Grey>{cellCount === 1 ? '1 cell' : `${cellCount} cells`} selected · Copy keeps fills, bold and number formats</Grey><V2Button onClick={() => void copy()}>Copy</V2Button></>}
        <DropdownMenu open={columnsOpen} onOpenChange={open => { setColumnsOpen(open); if (!open) setPending(null); }}><DropdownMenuTrigger render={<Picker aria-label="Columns">{unseen ? `Columns · ${unseen} more` : 'Columns'}</Picker>} /><DropdownMenuContent align="end" className="min-w-[240px]">
          <DropdownMenuGroup><DropdownMenuLabel>{pending ? `Choose the ${FIELDS.find(field => field.key === pending)!.label} column` : 'Show other columns (view only)'}</DropdownMenuLabel>
          {pending ? others.map(header => <DropdownMenuItem key={header} onSelect={() => { onMap({ [pending]: header }); setPending(null); }}>{header}</DropdownMenuItem>)
            : others.map(header => <DropdownMenuCheckboxItem key={header} checked={extra.includes(header)} onCheckedChange={checked => { setSelection(undefined); setExtra(current => checked ? [...current, header] : current.filter(item => item !== header)); }} onSelect={event => event.preventDefault()}>{header}</DropdownMenuCheckboxItem>)}
        </DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
      </div></div>
    {unmapped.length > 0 && <button type="button" className={`mb-2 block max-w-full truncate bg-transparent p-0 text-left text-[12px] text-ui-muted hover:text-ui-primary hover:underline ${dsFocus}`} onClick={() => { setPending(unmapped[0].key); setColumnsOpen(true); }}>
      {unmapped.length === 1 ? `${unmapped[0].label} isn't mapped (used by ${unmapped[0].usedBy.join(', ')})` : `${unmapped.map(field => field.label).join(' and ')} aren't mapped`}</button>}
    <div className={`${maxHeight} overflow-auto rounded-md border border-ui-stroke`}>
      <table className="w-full select-none border-collapse text-[12px]">
        <thead className="sticky top-0 bg-ui-table"><tr><th className="w-9 px-2 py-1.5" />{shown.map(({ header }) => { const field = fieldOf(header); return <th key={header} className="whitespace-nowrap px-1 py-0.5 text-left text-[11px] font-medium text-ui-muted">
          <DropdownMenu><DropdownMenuTrigger render={<button type="button" aria-label={`Column ${header}`} className={`flex h-6 items-center gap-1.5 rounded-md px-1.5 hover:bg-ui-hover ${dsFocus}`}><span>{header}</span>{field && <span className={FIELD_TAG}>{field.label}</span>}<ChevronDown size={11} aria-hidden /></button>} /><DropdownMenuContent align="start" className="min-w-[200px]">
            <DropdownMenuGroup><DropdownMenuLabel>Use as</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={field?.key ?? 'none'} onValueChange={value => assignTo(header, value)}>
              {FIELDS.map(item => <DropdownMenuRadioItem closeOnClick key={item.key} value={item.key}>{item.label}</DropdownMenuRadioItem>)}<DropdownMenuRadioItem closeOnClick value="none">None</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup></DropdownMenuGroup>
          </DropdownMenuContent></DropdownMenu></th>; })}</tr></thead>
        <tbody>{data.rows.map((row, r) => <tr key={r} className="border-t border-ui-stroke"><td className="px-2 py-1 text-right text-[11px] tabular-nums text-ui-muted">{r + 1}</td>
          {shown.map(({ index }, c) => { const cell = row[index], on = inside(r, c); return <td key={c} onMouseDown={event => { setDragging(true); setSelection(event.shiftKey && selection ? { ...selection, r1: r, c1: c } : { r0: r, c0: c, r1: r, c1: c }); }} onMouseEnter={() => { if (dragging) setSelection(current => current && { ...current, r1: r, c1: c }); }}
            style={on ? undefined : { background: cell.fill, color: cell.fill ? '#1f2937' : undefined }} className={`whitespace-nowrap px-2.5 py-1 ${cell.bold ? 'font-bold' : ''} ${cell.align === 'right' ? 'text-right tabular-nums' : ''} ${on ? 'bg-[color-mix(in_srgb,var(--ui-info)_22%,transparent)]' : ''}`}>{cell.text}</td>; })}</tr>)}</tbody>
      </table>
    </div>
  </section>;
}
