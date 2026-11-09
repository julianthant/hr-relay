import { useEffect, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { PageBreadcrumbs, useToasts } from '../../../ds/ui.js';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '../../../ds/primitives/dropdown-menu.js';
import { DATASETS, type Cell, type FieldKey, type Sheet, stamp } from './sheets-v2-model.js';
import { FieldRows } from './sheets-v2-import.js';
import { DownloadIcon, Grey, Picker, SheetMenu, Tag, V2Button, type MenuAction } from './sheets-v2-ui.js';

type Range = { r0: number; c0: number; r1: number; c1: number };
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const style = (cell: Cell) => `${cell.bold ? 'font-weight:700;' : ''}${cell.fill ? `background:${cell.fill};` : ''}${cell.align ? `text-align:${cell.align};` : ''}`;

function Viewer({ sheet }: { sheet: Sheet }) {
  const { toast } = useToasts();
  const data = DATASETS[sheet.dataset];
  const [extra, setExtra] = useState<readonly string[]>([]);
  const [selection, setSelection] = useState<Range>();
  const [dragging, setDragging] = useState(false);
  const mapped = Object.values(sheet.mapping).filter((header): header is string => !!header);
  const shown = useMemo(() => data.headers.map((header, index) => ({ header, index })).filter(({ header }) => mapped.includes(header) || extra.includes(header)), [data, mapped, extra]);
  const others = data.headers.filter(header => !mapped.includes(header));
  useEffect(() => { const up = () => setDragging(false); window.addEventListener('mouseup', up); return () => window.removeEventListener('mouseup', up); }, []);
  const box = selection && { r0: Math.min(selection.r0, selection.r1), r1: Math.max(selection.r0, selection.r1), c0: Math.min(selection.c0, selection.c1), c1: Math.max(selection.c0, selection.c1) };
  const inside = (row: number, column: number) => !!box && row >= box.r0 && row <= box.r1 && column >= box.c0 && column <= box.c1;
  const copy = async () => {
    if (!box) return;
    const rows = data.rows.slice(box.r0, box.r1 + 1).map(row => shown.slice(box.c0, box.c1 + 1).map(({ index }) => row[index]));
    const html = `<table>${rows.map(row => `<tr>${row.map(cell => `<td style="${style(cell)}">${esc(cell.text)}</td>`).join('')}</tr>`).join('')}</table>`;
    const text = rows.map(row => row.map(cell => cell.text).join('\t')).join('\n');
    try { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]); toast({ tone: 'success', title: `Copied ${rows.length * rows[0].length} cells` }); }
    catch { toast({ tone: 'danger', title: "Couldn't copy the cells" }); }
  };
  return <section aria-label="Preview" onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'c' && box) { event.preventDefault(); void copy(); } }}>
    <div className="mb-2 flex items-center justify-between gap-4"><h2 className="text-[13px] font-semibold">Preview</h2>
      <div className="flex items-center gap-2">
        {box && <><Grey>{(box.r1 - box.r0 + 1) * (box.c1 - box.c0 + 1) === 1 ? '1 cell' : `${(box.r1 - box.r0 + 1) * (box.c1 - box.c0 + 1)} cells`} selected · Copy keeps fills, bold and number formats</Grey><V2Button onClick={() => void copy()}>Copy</V2Button></>}
        <DropdownMenu><DropdownMenuTrigger render={<Picker aria-label="Columns">{extra.length ? `Columns · ${extra.length} more` : 'Columns'}</Picker>} /><DropdownMenuContent align="end" className="min-w-[220px]">
          {others.map(header => <DropdownMenuCheckboxItem key={header} checked={extra.includes(header)} onCheckedChange={checked => { setSelection(undefined); setExtra(current => checked ? [...current, header] : current.filter(item => item !== header)); }} onSelect={event => event.preventDefault()}>{header}</DropdownMenuCheckboxItem>)}
        </DropdownMenuContent></DropdownMenu>
      </div></div>
    <div className="max-h-[280px] overflow-auto rounded-md border border-ui-stroke">
      <table className="w-full select-none border-collapse text-[12px]">
        <thead className="sticky top-0 bg-ui-table"><tr><th className="w-9 px-2 py-1.5 text-right text-[11px] font-normal text-ui-muted" />{shown.map(({ header }) => <th key={header} className="whitespace-nowrap px-2.5 py-1.5 text-left text-[11px] font-medium text-ui-muted">{header}</th>)}</tr></thead>
        <tbody>{data.rows.map((row, r) => <tr key={r} className="border-t border-ui-stroke"><td className="px-2 py-1 text-right text-[11px] tabular-nums text-ui-muted">{r + 1}</td>
          {shown.map(({ index }, c) => { const cell = row[index], on = inside(r, c); return <td key={c} onMouseDown={event => { setDragging(true); setSelection(event.shiftKey && selection ? { ...selection, r1: r, c1: c } : { r0: r, c0: c, r1: r, c1: c }); }} onMouseEnter={() => { if (dragging) setSelection(current => current && { ...current, r1: r, c1: c }); }}
            style={on ? undefined : { background: cell.fill, color: cell.fill ? '#1f2937' : undefined }} className={`whitespace-nowrap px-2.5 py-1 ${cell.bold ? 'font-bold' : ''} ${cell.align === 'right' ? 'text-right tabular-nums' : ''} ${on ? 'bg-[color-mix(in_srgb,var(--ui-info)_22%,transparent)]' : ''}`}>{cell.text}</td>; })}</tr>)}</tbody>
      </table>
    </div>
    <div className="mt-1.5"><Grey>Showing the columns Relay uses. Choose Columns to see others; this does not change the mapping.</Grey></div>
  </section>;
}

export function SheetDetail({ sheet, sheets, onBack, onOpen, onMap, onVersion, onMenu }: { sheet: Sheet; sheets: readonly Sheet[]; onBack: () => void; onOpen: (id: string) => void; onMap: (key: FieldKey, header: string | null) => void; onVersion: () => void; onMenu: (action: MenuAction) => void }) {
  const parent = sheet.from && sheets.find(item => item.id === sheet.from!.id);
  return <div className="min-w-0">
    <PageBreadcrumbs items={[{ label: 'Spreadsheets', onClick: onBack }, { label: sheet.name }]} />
    <div className="mb-6 mt-2 flex items-center justify-between gap-4">
      <div className="min-w-0"><h1 className="truncate !text-[22px] !leading-7">{sheet.name}</h1>
        <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[12px] text-ui-muted">
          {sheet.tags.map(tag => <Tag key={tag}>{tag}</Tag>)}{sheet.tags.length > 0 && <span aria-hidden>·</span>}
          {sheet.sharePoint ? <a href={sheet.sharePoint} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">SharePoint<ExternalLink size={12} aria-hidden /></a>
            : parent && sheet.from ? <button type="button" className="bg-transparent p-0 hover:underline" onClick={() => onOpen(parent.id)}>{parent.name} v{sheet.from.version}</button> : <span>Imported</span>}
          <span aria-hidden>·</span><span className="truncate">Updated {stamp(sheet.updatedAt)}</span></div></div>
      <div className="flex shrink-0 items-center gap-1"><V2Button look="plain" className="tabular-nums" aria-label={`Versions, now v${sheet.versions[0].n}`} onClick={onVersion}>v{sheet.versions[0].n}</V2Button><DownloadIcon name={sheet.name} /><SheetMenu sheet={sheet} label={sheet.name} withDownload={false} onAction={onMenu} /></div>
    </div>
    <section aria-label="Columns" className="mb-7"><h2 className="mb-0.5 text-[13px] font-semibold">Columns</h2><Grey>Choose which column holds each field. Changes save at once.</Grey>
      <FieldRows dataset={DATASETS[sheet.dataset]} values={sheet.mapping} onChange={onMap} /></section>
    <Viewer sheet={sheet} />
  </div>;
}
