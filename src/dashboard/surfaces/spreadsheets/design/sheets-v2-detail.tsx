import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { PageBreadcrumbs } from '../../../ds/ui.js';
import type { EditableWorkbook } from '../../../../rules/spreadsheets/workbook-io.js';
import { MappingGrid } from './sheets-v2-grid.js';
import { datasetOf, mappingOf, missingFields, notMatchedNote, stamp, type Field, type Mapping, type Sheet } from './sheets-v2-model.js';
import { DownloadIcon, SheetChips, SheetMenu, V2Button, type MenuAction } from './sheets-v2-ui.js';

export function SheetDetail({ sheet, document, fields, onBack, onMap, onVersion, onMenu }: { sheet: Sheet; document: EditableWorkbook; fields: readonly Field[]; onBack: () => void; onMap: (worksheet: string, patch: Mapping) => void; onVersion: () => void; onMenu: (action: MenuAction) => void }) {
  const [tab, setTab] = useState(document.sheets[0].id);
  const worksheet = document.sheets.find(item => item.id === tab) ?? document.sheets[0];
  return <div className="min-w-0">
    <PageBreadcrumbs items={[{ label: 'Spreadsheets', onClick: onBack }, { label: sheet.name }]} />
    <div className="mb-6 mt-2 flex items-center justify-between gap-4">
      <div className="min-w-0"><h1 className="sv2-title truncate">{sheet.name}</h1>
        <div className="sv2-desc flex min-w-0 items-center gap-1.5 whitespace-nowrap">
          {(sheet.workflow || sheet.tags.length > 0) && <><SheetChips sheet={sheet} /><span aria-hidden>·</span></>}
          {sheet.sharePoint ? <a href={sheet.sharePoint} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">SharePoint<ExternalLink size={12} aria-hidden /></a> : <span>{sheet.run ? 'Run output' : 'Imported'}</span>}
          <span aria-hidden>·</span><span className="truncate">Updated {stamp(sheet.updatedAt)}</span></div></div>
      <div className="flex shrink-0 items-center gap-1"><V2Button look="plain" className="tabular-nums" aria-label={`Versions, now v${sheet.version}`} onClick={onVersion}>v{sheet.version}</V2Button><DownloadIcon name={sheet.name} onClick={() => onMenu('download')} /><SheetMenu sheet={sheet} label={sheet.name} withDownload={false} onAction={onMenu} /></div>
    </div>
    <MappingGrid key={worksheet.id} fields={fields} dataset={datasetOf(worksheet)} mapping={mappingOf(worksheet, fields)} onMap={patch => onMap(worksheet.id, patch)}
      worksheets={{ names: document.sheets.map(item => item.name), current: worksheet.name, onSelect: name => setTab(document.sheets.find(item => item.name === name)!.id), notMatched: name => notMatchedNote(missingFields(fields, mappingOf(document.sheets.find(item => item.name === name)!, fields))) }} />
  </div>;
}
