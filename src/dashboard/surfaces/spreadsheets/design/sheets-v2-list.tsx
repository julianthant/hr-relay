import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Tooltip } from '../../../ds/ui.js';
import { type Sheet, stamp } from './sheets-v2-model.js';
import { DownloadIcon, Grey, SheetMenu, Tag, V2Button, type MenuAction } from './sheets-v2-ui.js';

export interface RowActions { open: (id: string) => void; version: (id: string) => void; menu: (id: string, action: MenuAction) => void }
const WIDE = 'grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.1fr)_56px_104px_72px]';
const NARROW = 'grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.1fr)_56px_104px_36px]';
const CELL = 'min-w-0 truncate';

/** Download folds into the ⋯ menu when the list is narrower than this. */
const NARROW_BELOW = 760;
export function useNarrow<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const element = ref.current; if (!element) return;
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < NARROW_BELOW));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  return [ref, narrow] as const;
}

function SourceCell({ sheet, sheets, onOpen }: { sheet: Sheet; sheets: readonly Sheet[]; onOpen: (id: string) => void }) {
  const parent = sheet.from && sheets.find(item => item.id === sheet.from!.id);
  if (sheet.sharePoint) return <a href={sheet.sharePoint} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 hover:underline" onClick={event => event.stopPropagation()}><span className="truncate">SharePoint</span><ExternalLink size={12} aria-hidden className="shrink-0 text-ui-muted" /></a>;
  if (sheet.from && parent) return <button type="button" className="max-w-full truncate bg-transparent p-0 text-left hover:underline" onClick={event => { event.stopPropagation(); onOpen(parent.id); }}>{parent.name} v{sheet.from.version}</button>;
  return <Grey className="text-[13px]">Imported</Grey>;
}

export function SheetRow({ sheet, sheets, narrow, actions }: { sheet: Sheet; sheets: readonly Sheet[]; narrow: boolean; actions: RowActions }) {
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  return <div role="row" tabIndex={0} aria-label={sheet.name} onClick={() => actions.open(sheet.id)} onKeyDown={event => { if (event.key === 'Enter' && event.target === event.currentTarget) actions.open(sheet.id); }}
    className={`grid ${narrow ? NARROW : WIDE} cursor-pointer items-center gap-x-4 border-t border-ui-stroke px-1 py-1.5 text-[13px] first:border-t-0 hover:bg-ui-hover`}>
    <div role="cell" className={`${CELL} font-medium`} title={sheet.name}>{sheet.name}</div>
    <div role="cell" className="flex min-w-0 gap-1 overflow-hidden">{sheet.tags.map(tag => <Tag key={tag}>{tag}</Tag>)}</div>
    <div role="cell" className={CELL}><SourceCell sheet={sheet} sheets={sheets} onOpen={actions.open} /></div>
    <div role="cell" onClick={stop}><V2Button look="plain" className="-ml-3 justify-start tabular-nums" aria-label={`Versions of ${sheet.name}, now v${sheet.versions[0].n}`} onClick={() => actions.version(sheet.id)}>v{sheet.versions[0].n}</V2Button></div>
    <div role="cell" className={`${CELL} tabular-nums text-ui-muted`}><Tooltip content={`Created ${stamp(sheet.createdAt)}`}><span>{stamp(sheet.updatedAt)}</span></Tooltip></div>
    <div role="cell" className="flex justify-end" onClick={stop}>{!narrow && <DownloadIcon name={sheet.name} />}<SheetMenu sheet={sheet} label={sheet.name} withDownload={narrow} onAction={action => actions.menu(sheet.id, action)} /></div>
  </div>;
}

export function SheetTable({ title, sheets, all, narrow, actions, limit }: { title: string; sheets: readonly Sheet[]; all: readonly Sheet[]; narrow: boolean; actions: RowActions; limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  const shown = limit && !expanded ? sheets.slice(0, limit) : sheets;
  return <section aria-label={title} className="mb-7">
    <h2 className="mb-1 text-[13px] font-semibold">{title}</h2>
    <div role="table" aria-label={title}>
      <div role="row" className={`grid ${narrow ? NARROW : WIDE} items-center gap-x-4 px-1 py-1.5 text-[11px] text-ui-muted`}>
        {['Name', 'Tags', 'Source', 'Version', 'Updated'].map(head => <div key={head} role="columnheader">{head}</div>)}<div />
      </div>
      {shown.map(sheet => <SheetRow key={sheet.id} sheet={sheet} sheets={all} narrow={narrow} actions={actions} />)}
    </div>
    {limit && sheets.length > limit && <V2Button look="plain" className="mt-1 -ml-1" onClick={() => setExpanded(current => !current)}>{expanded ? 'Show fewer' : `Show ${sheets.length - limit} more`}</V2Button>}
  </section>;
}
