import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { BodySection } from '../../../ds/ui.js';
import { type Sheet, stamp } from './sheets-v2-model.js';
import { DownloadIcon, SheetMenu, TagsFit, V2Button, type MenuAction } from './sheets-v2-ui.js';

export interface RowActions { open: (id: string) => void; version: (id: string) => void; menu: (id: string, action: MenuAction) => void; logs: (sheet: Sheet) => void }

const cols = (narrow: boolean) => `grid items-center gap-x-4 ${narrow ? 'grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_150px_56px_28px]' : 'grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_150px_56px_64px]'}`;
const LINK = 'inline-flex max-w-full items-center gap-1 hover:text-ui-primary hover:underline';
function SourceCell({ sheet }: { sheet: Sheet }) {
  if (sheet.sharePoint) return <a href={sheet.sharePoint} target="_blank" rel="noreferrer" className={LINK} onClick={event => event.stopPropagation()}><span className="truncate">SharePoint</span><ExternalLink size={12} aria-hidden className="shrink-0" /></a>;
  return <span>{sheet.run ? 'Run output' : 'Imported'}</span>;
}

export function SheetRow({ sheet, narrow, actions }: { sheet: Sheet; narrow: boolean; actions: RowActions }) {
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  return <li tabIndex={0} aria-label={sheet.name} onClick={() => actions.open(sheet.id)} onKeyDown={event => { if (event.key === 'Enter' && event.target === event.currentTarget) actions.open(sheet.id); }}
    className={`${cols(narrow)} sv2-row cursor-pointer border-t border-ui-stroke text-[13px] hover:bg-ui-hover`}>
    <div className="min-w-0">
      <div className="sv2-row-title truncate" title={sheet.name}>{sheet.run
        ? <button type="button" className="max-w-full truncate bg-transparent p-0 text-left hover:underline" aria-label={`${sheet.name}, open run logs`} onClick={event => { stop(event); actions.logs(sheet); }}>{sheet.name}</button> : sheet.name}</div>
      <div className="sv2-row-desc truncate tabular-nums text-ui-muted"><span>Updated {stamp(sheet.updatedAt)}</span></div>
    </div>
    <TagsFit sheet={sheet} />
    <div className="truncate text-ui-muted"><SourceCell sheet={sheet} /></div>
    <div onClick={stop}><V2Button look="plain" className="-ml-3 tabular-nums" aria-label={`Versions of ${sheet.name}, now v${sheet.version}`} onClick={() => actions.version(sheet.id)}>v{sheet.version}</V2Button></div>
    <div className="flex justify-end" onClick={stop}>{!narrow && <DownloadIcon name={sheet.name} onClick={() => actions.menu(sheet.id, 'download')} />}<SheetMenu sheet={sheet} label={sheet.name} withDownload={narrow} onAction={action => actions.menu(sheet.id, action)} /></div>
  </li>;
}

export function SheetTable({ title, sheets, narrow, actions, limit }: { title: string; sheets: readonly Sheet[]; narrow: boolean; actions: RowActions; limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  const shown = limit && !expanded ? sheets.slice(0, limit) : sheets;
  return <BodySection title={title}>
    <div className="overflow-hidden sv2-card border border-ui-stroke bg-[var(--ds-card-bg)]">
      <div className={`${cols(narrow)} sv2-head bg-ui-table text-ui-muted`}>{['Spreadsheet', 'Tags', 'Source', 'Version'].map(head => <div key={head}>{head}</div>)}<div /></div>
      <ul aria-label={title}>{shown.map(sheet => <SheetRow key={sheet.id} sheet={sheet} narrow={narrow} actions={actions} />)}</ul>
    </div>
    {limit && sheets.length > limit && <V2Button look="plain" className="mt-1" onClick={() => setExpanded(current => !current)}>{expanded ? 'Show fewer' : `Show ${sheets.length - limit} more`}</V2Button>}
  </BodySection>;
}
