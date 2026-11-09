import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { PageBreadcrumbs } from '../../../ds/ui.js';
import { MappingGrid } from './sheets-v2-grid.js';
import { DATASETS, mappingOf, mergeOriginal, missingRequired, notMatchedNote, type Mapping, type Sheet, stamp } from './sheets-v2-model.js';
import { DownloadIcon, SheetChips, SheetMenu, V2Button, type MenuAction } from './sheets-v2-ui.js';

export function SheetDetail({ sheet, sheets, onBack, onOpen, onMap, onVersion, onMenu }: { sheet: Sheet; sheets: readonly Sheet[]; onBack: () => void; onOpen: (id: string) => void; onMap: (worksheet: string, patch: Partial<Mapping>) => void; onVersion: () => void; onMenu: (action: MenuAction) => void }) {
  const [tab, setTab] = useState(sheet.worksheets[0].name);
  const worksheet = sheet.worksheets.find(item => item.name === tab) ?? sheet.worksheets[0];
  const parent = sheet.from && sheets.find(item => item.id === sheet.from!.id);
  return <div className="min-w-0">
    <PageBreadcrumbs items={[{ label: 'Spreadsheets', onClick: onBack }, { label: sheet.name }]} />
    <div className="mb-6 mt-2 flex items-center justify-between gap-4">
      <div className="min-w-0"><h1 className="sv2-title truncate">{sheet.name}</h1>
        <div className="sv2-desc flex min-w-0 items-center gap-1.5 whitespace-nowrap">
          <SheetChips sheet={sheet} />{(sheet.workflow || sheet.tags.length > 0) && <span aria-hidden>·</span>}
          {sheet.sharePoint ? <a href={sheet.sharePoint} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">SharePoint<ExternalLink size={12} aria-hidden /></a>
            : parent && sheet.from ? <button type="button" className="bg-transparent p-0 hover:underline" onClick={() => onOpen(parent.id)}>{parent.name} v{sheet.from.version}</button> : <span>Imported</span>}
          <span aria-hidden>·</span><span className="truncate">Updated {stamp(sheet.updatedAt)}</span></div></div>
      <div className="flex shrink-0 items-center gap-1"><V2Button look="plain" className="tabular-nums" aria-label={`Versions, now v${sheet.versions[0].n}`} onClick={onVersion}>v{sheet.versions[0].n}</V2Button><DownloadIcon name={sheet.name} /><SheetMenu sheet={sheet} original={mergeOriginal(sheet, sheets)} label={sheet.name} withDownload={false} onAction={onMenu} /></div>
    </div>
    <MappingGrid key={worksheet.name} dataset={DATASETS[worksheet.data]} mapping={mappingOf(sheet, worksheet)} onMap={patch => onMap(worksheet.name, patch)}
      worksheets={{ names: sheet.worksheets.map(item => item.name), current: worksheet.name, onSelect: setTab, notMatched: name => notMatchedNote(missingRequired(sheet, sheet.worksheets.find(item => item.name === name)!)) }} />
  </div>;
}
