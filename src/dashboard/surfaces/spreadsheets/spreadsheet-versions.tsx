import { useState, type RefObject } from 'react';
import { Banner, Button, Dialog, DialogBody, DialogContent, DialogFooter } from '../../ds/ui.js';
import { formatInstantDate } from '../../lib/date-format.js';
import type { SavedWorkbook } from '../../../models/dashboard/workbooks.js';
import { useSpreadsheetVersions } from './spreadsheet-versions-model.js';

export function SpreadsheetVersions({ libraryId, read, onClose, onDownload, returnFocus }: { returnFocus?: RefObject<HTMLElement | null>; libraryId: string | null; read: (id: string) => Promise<readonly SavedWorkbook[]>; onClose: () => void; onDownload: (record: SavedWorkbook) => Promise<void> }) {
  const history = useSpreadsheetVersions(libraryId, read);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <Dialog open={libraryId !== null} onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="hub-sheets-dialog" title="Spreadsheet versions" onCloseAutoFocus={event => { if (returnFocus?.current?.isConnected) { event.preventDefault(); returnFocus.current.focus(); } }} description="Download an exact saved version. Your current draft stays open."><DialogBody>
    {history.state === 'loading' ? <p role="status">Loading versions…</p> : history.state === 'failed' ? <Banner tone="danger" title="Versions unavailable">{history.message}</Banner> : <div className="hub-sheets-table"><table aria-label="Saved spreadsheet versions"><thead><tr><th scope="col">Version</th><th scope="col">Saved</th><th scope="col">File</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>{history.records.toReversed().map(record => <tr key={record.version}><td>{record.version}</td><td>{formatInstantDate(record.savedAt)}</td><td>{record.workbook.name}</td><td><Button disabled={busy} aria-label={`Download version ${record.version}`} onClick={() => { setBusy(true); setError(''); void onDownload(record).catch(error => setError(error instanceof Error ? error.message : String(error))).finally(() => setBusy(false)); }}>Download</Button></td></tr>)}</tbody></table></div>}
    {error && <Banner tone="danger" title="Download unavailable">{error}</Banner>}
  </DialogBody><DialogFooter><Button onClick={onClose}>Close</Button></DialogFooter></DialogContent></Dialog>;
}
