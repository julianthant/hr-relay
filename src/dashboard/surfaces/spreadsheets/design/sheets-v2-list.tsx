import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Tooltip } from '../../../ds/ui.js';
import { type Sheet, stamp } from './sheets-v2-model.js';
import { DownloadIcon, SheetMenu, TagsFit, V2Button, type MenuAction } from './sheets-v2-ui.js';

export interface RowActions { open: (id: string) => void; version: (id: string) => void; menu: (id: string, action: MenuAction) => void }

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

const LINK = 'inline-flex max-w-full items-center gap-1 hover:text-ui-primary hover:underline';
function SourceCell({ sheet, sheets, onOpen }: { sheet: Sheet; sheets: readonly Sheet[]; onOpen: (id: string) => void }) {
  const parent = sheet.from && sheets.find(item => item.id === sheet.from!.id);
  if (sheet.sharePoint) return <a href={sheet.sharePoint} target="_blank" rel="noreferrer" className={LINK} onClick={event => event.stopPropagation()}><span className="truncate">SharePoint</span><ExternalLink size={12} aria-hidden className="shrink-0" /></a>;
  if (sheet.from && parent) return <button type="button" className={`${LINK} bg-transparent p-0 text-left`} onClick={event => { event.stopPropagation(); onOpen(parent.id); }}><span className="truncate">{parent.name} v{sheet.from.version}</span></button>;
  return <span>Imported</span>;
}

export function SheetRow({ sheet, sheets, narrow, actions }: { sheet: Sheet; sheets: readonly Sheet[]; narrow: boolean; actions: RowActions }) {
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  return <li tabIndex={0} aria-label={sheet.name} onClick={() => actions.open(sheet.id)} onKeyDown={event => { if (event.key === 'Enter' && event.target === event.currentTarget) actions.open(sheet.id); }}
    className="flex cursor-pointer items-center gap-3 border-t border-ui-stroke px-3 py-1.5 text-[13px] first:border-t-0 hover:bg-ui-hover">
    <span className="w-[200px] shrink-0 truncate font-medium" title={sheet.name}>{sheet.name}</span>
    <TagsFit tags={sheet.tags} />
    <div className="flex shrink-0 items-center gap-3">
      <div className="w-[150px] truncate text-ui-muted"><SourceCell sheet={sheet} sheets={sheets} onOpen={actions.open} /></div>
      <div className="w-12" onClick={stop}><V2Button look="plain" className="w-full tabular-nums" aria-label={`Versions of ${sheet.name}, now v${sheet.versions[0].n}`} onClick={() => actions.version(sheet.id)}>v{sheet.versions[0].n}</V2Button></div>
      <div className="w-[104px] truncate tabular-nums text-ui-muted"><Tooltip content={`Created ${stamp(sheet.createdAt)}`}><span>{stamp(sheet.updatedAt)}</span></Tooltip></div>
      <div className={`flex justify-end ${narrow ? 'w-7' : 'w-14'}`} onClick={stop}>{!narrow && <DownloadIcon name={sheet.name} />}<SheetMenu sheet={sheet} label={sheet.name} withDownload={narrow} onAction={action => actions.menu(sheet.id, action)} /></div>
    </div>
  </li>;
}

export function SheetTable({ title, sheets, all, narrow, actions, limit }: { title: string; sheets: readonly Sheet[]; all: readonly Sheet[]; narrow: boolean; actions: RowActions; limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  const shown = limit && !expanded ? sheets.slice(0, limit) : sheets;
  return <section aria-label={title} className="mb-6">
    <h2 className="mb-1.5 text-[13px] font-semibold">{title}</h2>
    <ul aria-label={title} className="overflow-hidden rounded-[10px] border border-ui-stroke">
      {shown.map(sheet => <SheetRow key={sheet.id} sheet={sheet} sheets={all} narrow={narrow} actions={actions} />)}
    </ul>
    {limit && sheets.length > limit && <V2Button look="plain" className="mt-1" onClick={() => setExpanded(current => !current)}>{expanded ? 'Show fewer' : `Show ${sheets.length - limit} more`}</V2Button>}
  </section>;
}
