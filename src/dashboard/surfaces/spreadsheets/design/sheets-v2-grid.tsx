import { useEffect, useState } from 'react';
import { Checkbox, dsLayer, SearchInput, Popover, PopoverContent, PopoverTrigger, Tooltip, useToasts } from '../../../ds/ui.js';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '../../../ds/primitives/dropdown-menu.js';
import { FIELDS, samplesOf, type Cell, type Dataset, type Field, type FieldKey } from './sheets-v2-model.js';
import { CONTROL, Grey, MENU, Picker, ROW, RunsTag, V2Button } from './sheets-v2-ui.js';

type Range = { r0: number; c0: number; r1: number; c1: number };
type Patch = Partial<Record<FieldKey, string | null>>;
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const style = (cell: Cell) => `${cell.bold ? 'font-weight:700;' : ''}${cell.fill ? `background:${cell.fill};` : ''}${cell.align ? `text-align:${cell.align};` : ''}`;
const tint = (percent: number) => `linear-gradient(color-mix(in srgb, var(--ui-info) ${percent}%, transparent), color-mix(in srgb, var(--ui-info) ${percent}%, transparent))`;

/** One field row in the Columns popover: field name left, a column picker right. Unmapped reads "Choose column" in grey with a dashed border. */
function FieldRow({ field, dataset, value, onChange, onActive }: { field: Field; dataset: Dataset; value: string | null; onChange: (header: string | null) => void; onActive: (active: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const unmapped = 'dashed';
  return <div className="flex items-center justify-between gap-4 px-2 py-1" onMouseEnter={() => onActive(true)} onMouseLeave={() => !open && onActive(false)} onFocus={() => onActive(true)} onBlur={() => !open && onActive(false)}>
    <span className="min-w-0 truncate text-[13px]">{field.label}</span>
    <DropdownMenu open={open} onOpenChange={next => { setOpen(next); onActive(next); }}><DropdownMenuTrigger render={value
      ? <Picker aria-label={`${field.label} column, ${value}`} className="w-[170px]">{value}</Picker>
      : <Picker aria-label={`${field.label} column, not mapped`} data-unmapped={unmapped} className="w-[170px] !border-dashed !border-[color:var(--ui-stroke-control)] !text-[color:var(--ds-fg-muted)] hover:!border-[color:var(--ui-muted)] focus-visible:!border-[color:var(--ui-muted)] data-[popup-open]:!border-[color:var(--ui-muted)]">Choose column</Picker>} />
      <DropdownMenuContent align="end" className={`min-w-[360px] ${MENU}`}><DropdownMenuGroup><DropdownMenuLabel>{field.label} column</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value ?? ''} onValueChange={next => onChange(next === '' ? null : next)}>
          {dataset.headers.map(header => <DropdownMenuRadioItem closeOnClick className={ROW} key={header} value={header}><span className="flex min-w-0 flex-1 items-baseline justify-between gap-4"><span className="whitespace-nowrap">{header}</span><Grey className="truncate">{samplesOf(dataset, header)}</Grey></span></DropdownMenuRadioItem>)}
          <DropdownMenuRadioItem closeOnClick className={ROW} value=""><span className="text-ui-muted">None</span></DropdownMenuRadioItem>
        </DropdownMenuRadioGroup></DropdownMenuGroup>
      </DropdownMenuContent></DropdownMenu>
  </div>;
}

export interface WorksheetControl { names: readonly string[]; current: string; runs: string; onSelect: (name: string) => void; onUseForRuns?: (name: string) => void }
/** The worksheet dropdown: every sheet; the one runs read carries a Runs tag, the others a Use for runs action. */
function WorksheetPicker({ control }: { control: WorksheetControl }) {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Picker aria-label="Worksheet" className={CONTROL}>{control.current}</Picker></PopoverTrigger>
    <PopoverContent title="Worksheet" hideTitle hideClose align="end" className={`!w-[280px] !p-1 ${dsLayer.modal}`}>
      <ul aria-label="Worksheets" className={MENU}>{control.names.map(name => <li key={name} className="flex h-7 items-center gap-1 rounded-md pl-2 pr-1 hover:bg-ui-hover">
        <button type="button" aria-current={name === control.current} className={`flex h-full min-w-0 flex-1 items-center gap-2 bg-transparent text-left text-[13px] ${name === control.current ? 'font-medium' : ''}`} onClick={() => { control.onSelect(name); setOpen(false); }}>
          <span className="truncate">{name}</span>{name === control.runs && <RunsTag />}</button>
        {name !== control.runs && control.onUseForRuns && <V2Button look="plain" size="sm" onClick={() => control.onUseForRuns!(name)}>Use for runs</V2Button>}
      </li>)}</ul>
    </PopoverContent>
  </Popover>;
}

const NO_MAPPING: Readonly<Record<FieldKey, string | null>> = { eid: null, name: null, email: null };
const Highlight = ({ text, query }: { text: string; query: string }) => {
  const at = query ? text.toLowerCase().indexOf(query) : -1;
  return at < 0 ? <>{text}</> : <>{text.slice(0, at)}<mark className="rounded-sm bg-[color-mix(in_srgb,var(--warning)_45%,transparent)] text-inherit">{text.slice(at, at + query.length)}</mark>{text.slice(at + query.length)}</>;
};

/** `viewOnly` (a note) shows the sheet without the mapping strip; `tabs` render under the grid. */
export function MappingGrid({ dataset, mapping: given, onMap, worksheets, columnsOpen = false, maxHeight = 'max-h-[min(58vh,440px)]' }: { dataset: Dataset; mapping: Readonly<Record<FieldKey, string | null>>; onMap: (patch: Patch) => void; worksheets?: WorksheetControl; columnsOpen?: boolean; maxHeight?: string }) {
  const viewOnly = worksheets && worksheets.current !== worksheets.runs ? `View only. Runs read ${worksheets.runs}.` : undefined;
  const mapping = viewOnly ? NO_MAPPING : given;
  const unmapped = viewOnly ? [] : FIELDS.filter(field => !mapping[field.key]);
  const [columns, setColumns] = useState(columnsOpen && unmapped.length > 0);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const view = dataset.rows.map((row, i) => ({ row, i })).filter(({ row }) => !q || row.some(cell => cell.text.toLowerCase().includes(q)));
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
    const rows = view.slice(box.r0, box.r1 + 1).map(({ row }) => row).map(row => shown.slice(box.c0, box.c1 + 1).map(({ index }) => row[index]));
    const html = `<table>${rows.map(row => `<tr>${row.map(cell => `<td style="${style(cell)}">${esc(cell.text)}</td>`).join('')}</tr>`).join('')}</table>`;
    const text = rows.map(row => row.map(cell => cell.text).join('\t')).join('\n');
    try { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]); toast({ tone: 'success', title: `Copied ${cellCount === 1 ? '1 cell' : `${cellCount} cells`}` }); }
    catch { toast({ tone: 'danger', title: "Couldn't copy the cells" }); }
  };
  return <section aria-label="Preview" onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'c' && box) { event.preventDefault(); void copy(); } }}>
    <div className="mb-2 flex items-center gap-2">
      <SearchInput aria-label="Search this sheet" placeholder="Search this sheet" value={query} onChange={event => { setSelection(undefined); setQuery(event.target.value); }} onClear={() => setQuery('')} className="min-w-0 flex-1" />
      {box && <V2Button className={CONTROL} onClick={() => void copy()}>Copy</V2Button>}
      {worksheets && worksheets.names.length > 1 && <WorksheetPicker control={worksheets} />}
      <Popover open={columns} onOpenChange={setColumns}>
        <Tooltip open={columns || !unmapped.length ? false : undefined} content={`${unmapped.map(field => field.label).join(' and ')} ${unmapped.length > 1 ? "aren't" : "isn't"} mapped`}>
          <PopoverTrigger asChild><Picker aria-label="Columns" className={CONTROL}>{unmapped.length > 0 && <span aria-hidden className="mr-1.5 inline-block size-1.5 rounded-full align-middle bg-[var(--warning)]" />}Columns{unseen ? ` · ${unseen} more` : ''}</Picker></PopoverTrigger>
        </Tooltip>
        <PopoverContent title="Columns" hideTitle hideClose align="end" width="md" className={`!w-[360px] !p-1 ${dsLayer.modal}`}>
          {!viewOnly && <section aria-label="Fields" className="pb-1">
            <h3 className="px-2 py-1 text-[11px] font-normal text-ui-muted">Fields</h3>
            {FIELDS.map(field => <FieldRow key={field.key} field={field} dataset={dataset} value={mapping[field.key]} onActive={on => setActive(current => on ? field.key : current === field.key ? null : current)}
              onChange={header => { setSelection(undefined); onMap({ [field.key]: header }); }} />)}
          </section>}
          <section aria-label="Show columns" className={viewOnly ? '' : 'border-t border-ui-stroke pt-1'}>
            <h3 className="px-2 py-1 text-[11px] font-normal text-ui-muted">Show columns (view only)</h3>
            <div className={MENU}>{others.map(header => <div key={header} className="flex h-7 items-center px-2"><Checkbox label={header} checked={extra.includes(header)} onCheckedChange={checked => { setSelection(undefined); setExtra(current => checked === true ? [...current, header] : current.filter(item => item !== header)); }} /></div>)}</div>
          </section>
        </PopoverContent>
      </Popover>
    </div>
    <div className={`${maxHeight} overflow-auto sv2-card border border-ui-stroke`}>
      <table className="w-full select-none border-collapse text-[12px]">
        <thead className="sticky top-0 bg-ui-table"><tr><th className="w-9 px-2 py-1.5" />{shown.map(({ header }) => <th key={header} style={{ backgroundImage: columnTint(header), boxShadow: mappedOrder.includes(header) ? 'inset 0 2px 0 var(--ui-info)' : undefined }} className="whitespace-nowrap px-2.5 py-1.5 text-left text-[11px] font-medium text-ui-muted">{header}</th>)}</tr></thead>
        <tbody>{view.length === 0 && <tr><td /><td colSpan={Math.max(shown.length, 1)} className="px-2.5 py-2 text-ui-muted">No rows match.</td></tr>}{view.map(({ row, i }, r) => <tr key={i} className="border-t border-ui-stroke"><td className="px-2 py-1 text-right text-[11px] tabular-nums text-ui-muted">{i + 1}</td>
          {shown.map(({ header, index }, c) => { const cell = row[index], on = inside(r, c); return <td key={c} onMouseDown={event => { setDragging(true); setSelection(event.shiftKey && selection ? { ...selection, r1: r, c1: c } : { r0: r, c0: c, r1: r, c1: c }); }} onMouseEnter={() => { if (dragging) setSelection(current => current && { ...current, r1: r, c1: c }); }}
            style={on ? undefined : { background: cell.fill, backgroundImage: columnTint(header), color: cell.fill ? '#1f2937' : undefined }} className={`whitespace-nowrap px-2.5 py-1 ${cell.bold ? 'font-bold' : ''} ${cell.align === 'right' ? 'text-right tabular-nums' : ''} ${on ? 'bg-[color-mix(in_srgb,var(--ui-info)_22%,transparent)]' : ''}`}><Highlight text={cell.text} query={q} /></td>; })}</tr>)}</tbody>
      </table>
    </div>
    {viewOnly && <Grey className="mt-2 block">{viewOnly}</Grey>}
  </section>;
}
