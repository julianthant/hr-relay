import { ExternalLink } from 'lucide-react';
import { PageBreadcrumbs } from '../../../ds/ui.js';
import { MappingGrid } from './sheets-v2-grid.js';
import { DATASETS, type FieldKey, type Sheet, stamp } from './sheets-v2-model.js';
import { DownloadIcon, SheetChips, SheetMenu, V2Button, type MenuAction } from './sheets-v2-ui.js';

export function SheetDetail({ sheet, sheets, onBack, onOpen, onMap, onVersion, onMenu }: { sheet: Sheet; sheets: readonly Sheet[]; onBack: () => void; onOpen: (id: string) => void; onMap: (patch: Partial<Record<FieldKey, string | null>>) => void; onVersion: () => void; onMenu: (action: MenuAction) => void }) {
  const parent = sheet.from && sheets.find(item => item.id === sheet.from!.id);
  return <div className="min-w-0">
    <PageBreadcrumbs items={[{ label: 'Spreadsheets', onClick: onBack }, { label: sheet.name }]} />
    <div className="mb-6 mt-2 flex items-center justify-between gap-4">
      <div className="min-w-0"><h1 className="truncate !text-[22px] !leading-7">{sheet.name}</h1>
        <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[12px] text-ui-muted">
          <SheetChips sheet={sheet} />{(sheet.workflow || sheet.tags.length > 0) && <span aria-hidden>·</span>}
          {sheet.sharePoint ? <a href={sheet.sharePoint} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">SharePoint<ExternalLink size={12} aria-hidden /></a>
            : parent && sheet.from ? <button type="button" className="bg-transparent p-0 hover:underline" onClick={() => onOpen(parent.id)}>{parent.name} v{sheet.from.version}</button> : <span>Imported</span>}
          <span aria-hidden>·</span><span className="truncate">Updated {stamp(sheet.updatedAt)}</span></div></div>
      <div className="flex shrink-0 items-center gap-1"><V2Button look="plain" className="tabular-nums" aria-label={`Versions, now v${sheet.versions[0].n}`} onClick={onVersion}>v{sheet.versions[0].n}</V2Button><DownloadIcon name={sheet.name} /><SheetMenu sheet={sheet} label={sheet.name} withDownload={false} onAction={onMenu} /></div>
    </div>
    <MappingGrid title="Preview" dataset={DATASETS[sheet.dataset]} mapping={sheet.mapping} onMap={onMap} />
  </div>;
}
