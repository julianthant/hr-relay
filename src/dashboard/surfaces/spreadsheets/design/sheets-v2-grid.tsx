import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { SearchInput, dsFocus, dsIcon, dsLayer, useToasts } from '../../../ds/ui.js';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '../../../ds/primitives/dropdown-menu.js';
import { matchedCount, samplesOf, type Cell, type Dataset, type Field, type Mapping } from './sheets-v2-model.js';
import { Grey, Picker, V2Button } from './sheets-v2-ui.js';
import { MENU } from './sheets-v2-menu.js';

type Range = { r0: number; c0: number; r1: number; c1: number };
type Patch = Record<string, string | null>;
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const style = (cell: Cell) => `${cell.fill ? `background:${cell.fill};` : ''}${cell.align ? `text-align:${cell.align};` : ''}`;

/** One field in the Columns panel: its name left, its column (or "Choose") right; opening it marks the field and its column. */
function FieldRow({ field, dataset, value, used, on, onOpen, onChange }: { field: Field; dataset: Dataset; value: string | null; used: ReadonlySet<string>; on: boolean; onOpen: () => void; onChange: (header: string | null) => void }) {
  return <DropdownMenu onOpenChange={open => { if (open) onOpen(); }}><DropdownMenuTrigger render={<button type="button" aria-label={`${field.label} column, ${value ?? 'not mapped'}`} data-on={on || undefined}
    className={`flex min-h-8 w-full items-center justify-between gap-2 rounded-md pl-2 pr-1 text-left ds-text-ui ${on ? 'bg-[var(--ds-accent-quiet)]' : 'hover:bg-ui-hover'} ${dsFocus}`}>
    <span className="min-w-0 truncate">{field.label}</span>
    <span className={`inline-flex min-w-0 items-center gap-1 ds-text-body ${value ? 'text-[color:var(--ds-fg-secondary)]' : 'text-ui-muted'}`}><span className="truncate">{value ?? 'Choose'}</span><ChevronDown aria-hidden className={`${dsIcon.sm} shrink-0`} /></span>
  </button>} />
    <DropdownMenuContent align="end" className={`min-w-[340px] ${MENU}`}><DropdownMenuGroup><DropdownMenuLabel>{field.label} column</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={value ?? ''} onValueChange={next => onChange(next === '' ? null : next)}>
        {dataset.headers.filter(header => header === value || !used.has(header)).map(header => <DropdownMenuRadioItem closeOnClick key={header} value={header}><span className="flex min-w-0 flex-1 items-baseline justify-between gap-4"><span className="whitespace-nowrap">{header}</span><Grey className="truncate">{samplesOf(dataset, header)}</Grey></span></DropdownMenuRadioItem>)}
        <DropdownMenuRadioItem closeOnClick value="">None</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup></DropdownMenuGroup>
    </DropdownMenuContent></DropdownMenu>;
}

/** Each worksheet with how many of the fields it has a column for. */
export interface WorksheetControl { items: readonly { name: string; matched: number }[]; current: string; onSelect: (name: string) => void }
/** "Use for all N worksheets": N counts the worksheets with this one's headers, this one included. */
export interface CopyControl { count: number; busy: boolean; onCopy: () => void }

/** Beside the grid: the worksheet control at the top, then every field with its column, then Use for all. The worksheet control
 * swaps the fields for the worksheet list until one is picked. */
function ColumnsPanel({ fields, dataset, mapping, onMap, field, onField, worksheets, copy }: { fields: readonly Field[]; dataset: Dataset; mapping: Mapping; onMap: (patch: Patch) => void;
  field?: string; onField: (key: string) => void; worksheets?: WorksheetControl; copy?: CopyControl }) {
  const [listing, setListing] = useState(false);
  const [query, setQuery] = useState('');
  const matched = matchedCount(fields, mapping), partial = (count: number) => count < fields.length;
  const current = worksheets?.items.find(item => item.name === worksheets.current);
  const close = () => { setListing(false); setQuery(''); };
  const used = new Set(Object.values(mapping).filter((header): header is string => !!header));
  return <aside aria-label="Columns" className="sv2-card border border-ui-stroke p-2" onKeyDown={event => { if (event.key === 'Escape' && listing) { event.stopPropagation(); close(); } }}>
    {worksheets && worksheets.items.length > 1 && <div className="pb-2"><Picker aria-label="Worksheet" aria-expanded={listing} className="w-full" onClick={() => listing ? close() : setListing(true)}>
      {current && partial(current.matched) && <span aria-hidden className="mr-1.5 inline-block size-1.5 rounded-full align-middle bg-[var(--warning)]" />}{worksheets.current}</Picker></div>}
    {listing && worksheets ? <>
      <SearchInput variant="menu" aria-label="Find a worksheet" placeholder="Find a worksheet" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} />
      <ul aria-label="Worksheets" className="mt-1">{worksheets.items.filter(item => item.name.toLowerCase().includes(query.trim().toLowerCase())).map(item => <li key={item.name}>
        <button type="button" aria-current={item.name === worksheets.current || undefined} onClick={() => { worksheets.onSelect(item.name); close(); }}
          className={`flex min-h-8 w-full items-center justify-between gap-3 rounded-md pl-2 pr-1 text-left ds-text-ui hover:bg-ui-hover ${item.name === worksheets.current ? 'bg-ui-hover' : ''} ${dsFocus}`}>
          <span className="min-w-0 truncate">{item.name}</span>
          <span className="inline-flex shrink-0 items-center gap-2"><Grey className={`tabular-nums ${partial(item.matched) ? 'text-[color:var(--warning)]' : ''}`}>{item.matched} of {fields.length}</Grey>
            <span className={`${dsIcon.md} inline-flex`}>{item.name === worksheets.current && <Check aria-hidden className={dsIcon.md} />}</span></span>
        </button></li>)}</ul>
    </> : <>
      <div className="flex items-baseline justify-between px-1.5 pb-2 pt-1"><h3 className="m-0 ds-text-ui font-medium">Columns</h3><Grey className="tabular-nums">{matched} of {fields.length}</Grey></div>
      {fields.map(item => <FieldRow key={item.key} field={item} dataset={dataset} value={mapping[item.key]} used={used} on={field === item.key} onOpen={() => onField(item.key)}
        onChange={header => onMap({ [item.key]: header })} />)}
      {copy && copy.count > 1 && <div className="mt-2 flex border-t border-ui-stroke pt-2"><V2Button look="plain" disabled={copy.busy} onClick={copy.onCopy}>Use for all {copy.count} worksheets</V2Button></div>}
    </>}
  </aside>;
}

const Highlight = ({ text, query }: { text: string; query: string }) => {
  const at = query ? text.toLowerCase().indexOf(query) : -1;
  return at < 0 ? <>{text}</> : <>{text.slice(0, at)}<mark className="rounded-sm bg-[color-mix(in_srgb,var(--ds-fg)_22%,transparent)] text-inherit">{text.slice(at, at + query.length)}</mark>{text.slice(at + query.length)}</>;
};

/** The sheet beside its Columns panel; picking a field marks its column and scrolls the grid to it. */
export function MappingGrid({ fields, dataset, mapping, onMap, worksheets, copy }: { fields: readonly Field[]; dataset: Dataset; mapping: Mapping; onMap: (patch: Patch) => void; worksheets?: WorksheetControl; copy?: CopyControl }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const view = dataset.rows.map((row, i) => ({ row, i })).filter(({ row }) => !q || row.some(cell => cell.text.toLowerCase().includes(q)));
  const { toast } = useToasts();
  const [selection, setSelection] = useState<Range>();
  const [dragging, setDragging] = useState(false);
  const [field, setField] = useState<string>();
  const marked = field ? dataset.headers.indexOf(mapping[field] ?? '') : -1;
  const wrap = useRef<HTMLDivElement>(null), heads = useRef<(HTMLTableCellElement | null)[]>([]);
  useEffect(() => {
    const box = wrap.current, head = heads.current[marked];
    if (box && head) box.scrollLeft = head.offsetLeft - (box.clientWidth - head.offsetWidth) / 2;
  }, [marked]);
  useEffect(() => { const up = () => setDragging(false); window.addEventListener('mouseup', up); return () => window.removeEventListener('mouseup', up); }, []);
  const box = selection && { r0: Math.min(selection.r0, selection.r1), r1: Math.max(selection.r0, selection.r1), c0: Math.min(selection.c0, selection.c1), c1: Math.max(selection.c0, selection.c1) };
  const inside = (row: number, column: number) => !!box && row >= box.r0 && row <= box.r1 && column >= box.c0 && column <= box.c1;
  const cellCount = box ? (box.r1 - box.r0 + 1) * (box.c1 - box.c0 + 1) : 0;
  // The selection is the neutral menu-hover fill with a 1px outline on the range's outer edges.
  const edge = (row: number, column: number) => !box || !inside(row, column) ? undefined : [row === box.r0 && 'inset 0 1px 0 0', row === box.r1 && 'inset 0 -1px 0 0', column === box.c0 && 'inset 1px 0 0 0', column === box.c1 && 'inset -1px 0 0 0'].filter(Boolean).map(part => `${part} var(--ui-muted)`).join(', ') || undefined;
  const copyCells = async () => {
    if (!box) return;
    const rows = view.slice(box.r0, box.r1 + 1).map(({ row }) => row.slice(box.c0, box.c1 + 1));
    const html = `<table>${rows.map(row => `<tr>${row.map(cell => `<td style="${style(cell)}">${esc(cell.text)}</td>`).join('')}</tr>`).join('')}</table>`;
    const text = rows.map(row => row.map(cell => cell.text).join('\t')).join('\n');
    try { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]); toast({ tone: 'success', title: `Copied ${cellCount === 1 ? '1 cell' : `${cellCount} cells`}` }); }
    catch { toast({ tone: 'danger', title: "Couldn't copy the cells" }); }
  };
  return <section aria-label="Preview" onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'c' && box) { event.preventDefault(); void copyCells(); } }}>
    <div className="ds-toolbar-row mb-2 flex items-center gap-2">
      <SearchInput aria-label="Search this sheet" placeholder="Search this sheet" value={query} onChange={event => { setSelection(undefined); setQuery(event.target.value); }} onClear={() => setQuery('')} className="sv2-search min-w-0 flex-1" />
      {box && <V2Button onClick={() => void copyCells()}>Copy</V2Button>}
    </div>
    <div className="grid grid-cols-[minmax(0,1fr)_304px] items-start gap-3">
      <div ref={wrap} className="max-h-[min(70vh,640px)] overflow-auto sv2-card border border-ui-stroke">
        <table className="sv2-grid w-full select-none border-collapse ds-text-body">
          <thead className={`sticky top-0 ${dsLayer.sticky} bg-ui-table`}><tr><th className="w-9 px-2 py-1.5" />{dataset.headers.map((header, c) => <th key={header} ref={element => { heads.current[c] = element; }} data-marked={c === marked || undefined}
            className="whitespace-nowrap px-2.5 py-1.5 text-left ds-text-meta font-medium text-ui-muted">{header}</th>)}</tr></thead>
          <tbody>{view.length === 0 && <tr><td /><td colSpan={Math.max(dataset.headers.length, 1)} className="px-2.5 py-2 text-ui-muted">No rows match.</td></tr>}{view.map(({ row, i }, r) => <tr key={i} className="border-t border-ui-stroke"><td className="px-2 py-1 text-right ds-text-meta tabular-nums text-ui-muted">{i + 1}</td>
            {row.map((cell, c) => { const on = inside(r, c); return <td key={c} onMouseDown={event => { setDragging(true); setSelection(event.shiftKey && selection ? { ...selection, r1: r, c1: c } : { r0: r, c0: c, r1: r, c1: c }); }} onMouseEnter={() => { if (dragging) setSelection(current => current && { ...current, r1: r, c1: c }); }}
              style={on ? { boxShadow: edge(r, c) } : cell.fill ? { '--sv2-fill': cell.fill } as CSSProperties : undefined} data-selected={on || undefined} data-marked={c === marked || undefined} data-fill={cell.fill && !on ? '' : undefined} className={`whitespace-nowrap px-2.5 py-1 ${cell.align === 'right' ? 'text-right tabular-nums' : ''}`}><Highlight text={cell.text} query={q} /></td>; })}</tr>)}</tbody>
        </table>
      </div>
      <ColumnsPanel fields={fields} dataset={dataset} mapping={mapping} onMap={patch => { setSelection(undefined); onMap(patch); }} field={field} onField={setField} worksheets={worksheets} copy={copy} />
    </div>
  </section>;
}
