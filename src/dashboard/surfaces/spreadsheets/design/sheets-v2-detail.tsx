import { useEffect, useState, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { PageBreadcrumbs, PageHeading, Skeleton, dsIcon, dsRadius, useToasts } from '../../../ds/ui.js';
import { LoadingRegion, SkeletonText } from '../../shared/loading/loading.js';
import type { EditableWorkbook } from '../../../../rules/spreadsheets/workbook-io.js';
import { MappingGrid } from './sheets-v2-grid.js';
import { sameHeaderWorksheets } from '../../../../rules/spreadsheets/column-mapping.js';
import { datasetOf, mappingOf, matchedCount, stamp, syncFailureWhy, type Field, type Mapping, type Sheet } from './sheets-v2-model.js';
import { PinButton, SheetChips, SheetMenu, V2Button, type MenuAction } from './sheets-v2-ui.js';

/** The opened sheet's page. Its breadcrumbs, name, source line and actions come from the library row, so they show at once
 * and stay mounted while the content below goes from the opening frame to the grid or to the read failure. */
export function SheetDetail({ sheet, onBack, onVersion, onMenu, children }: { sheet: Sheet; onBack: () => void; onVersion: () => void; onMenu: (action: MenuAction) => void; children: ReactNode }) {
  return <div className="min-w-0">
    <PageBreadcrumbs items={[{ label: 'Spreadsheets', onClick: onBack }, { label: sheet.name }]} />
    <PageHeading className="mb-[var(--ds-space-page-heading-content)]" title={sheet.name} description={<span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
      {(sheet.workflow || sheet.tags.length > 0) && <><SheetChips sheet={sheet} /><span aria-hidden>·</span></>}
      {sheet.sharePoint ? <a href={sheet.sharePoint} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">SharePoint<ExternalLink aria-hidden className={dsIcon.sm} /></a> : <span>{sheet.run ? 'Run output' : 'Imported'}</span>}
      <span aria-hidden>·</span><span className="truncate">Updated {stamp(sheet.updatedAt)}</span></span>}
      actions={<><V2Button look="plain" className="max-w-48 tabular-nums" aria-label={`Versions, now ${sheet.versionName}`} onClick={onVersion}><span className="min-w-0 truncate">{sheet.versionName}</span></V2Button><PinButton sheet={sheet} onClick={() => onMenu('pin')} /><SheetMenu sheet={sheet} label={sheet.name} onAction={onMenu} /></>} />
    {children}
  </div>;
}

/** A workbook's worksheets, each read through its own mapping, with the Columns panel beside them. */
export function WorkbookGrid({ document, fields, onMap, onCopy, copying = false }: { document: EditableWorkbook; fields: readonly Field[]; onMap: (worksheet: string, patch: Mapping) => void; onCopy: (worksheet: string) => void; copying?: boolean }) {
  const [tab, setTab] = useState(document.sheets[0].id);
  const worksheet = document.sheets.find(item => item.id === tab) ?? document.sheets[0];
  return <MappingGrid key={worksheet.id} fields={fields} dataset={datasetOf(worksheet)} mapping={mappingOf(worksheet, fields)} onMap={patch => onMap(worksheet.id, patch)}
    copy={{ count: sameHeaderWorksheets(document, worksheet.id).length, busy: copying, onCopy: () => onCopy(worksheet.id) }}
    worksheets={{ items: document.sheets.map(item => ({ name: item.name, matched: matchedCount(fields, mappingOf(item, fields)) })), current: worksheet.name,
      onSelect: name => setTab(document.sheets.find(item => item.name === name)!.id) }} />;
}

/** The opened sheet's grid; a failed last sync shows once as a toast. */
export function SheetDetailGrid({ sheet, ...grid }: { sheet: Sheet } & Parameters<typeof WorkbookGrid>[0]) {
  const { toast } = useToasts();
  const why = syncFailureWhy(sheet), failedAt = sheet.sync?.lastFinishedAt;
  useEffect(() => { if (why) toast({ tone: 'danger', key: `sheets-sync-${sheet.id}`, title: 'Sync failed', description: why }); }, [why, failedAt, sheet.id, toast]);
  return <WorkbookGrid {...grid} />;
}

/** The grid of a sheet that is still opening: its search, grid and Columns panel at a large sheet's settled size. */
export function SheetDetailGridSkeleton({ name }: { name: string }) {
  return <LoadingRegion label={`Opening ${name}`}><div aria-hidden>
    <div className="ds-toolbar-row mb-2 flex items-center gap-2"><Skeleton className="h-8 min-w-0 flex-1 rounded-full" /></div>
    <div className="grid grid-cols-[minmax(0,1fr)_304px] items-start gap-3">
      <div className="h-[min(70vh,640px)] overflow-hidden sv2-card border border-ui-stroke">
        <div className="bg-ui-table px-2.5 py-1.5 ds-text-meta"><SkeletonText className="w-2/5" /></div>
        {Array.from({ length: 16 }, (_, row) => <div key={row} className="border-t border-ui-stroke px-2.5 py-1 ds-text-body"><SkeletonText className={row % 2 ? "w-3/5" : "w-4/5"} /></div>)}
      </div>
      <div className="grid gap-2 sv2-card border border-ui-stroke p-2"><Skeleton className={`h-[var(--ds-row-control-h)] w-full ${dsRadius.lg}`} />
        {Array.from({ length: 8 }, (_, row) => <div key={row} className="flex min-h-6 items-center justify-between px-2 ds-text-ui"><SkeletonText className="w-24" /><SkeletonText className="w-16" /></div>)}</div>
    </div>
  </div></LoadingRegion>;
}
