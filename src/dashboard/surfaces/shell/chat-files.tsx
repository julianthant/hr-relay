import { useId, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { ArrowDown, Folder } from 'lucide-react';
import { Banner, Button, Dialog, DialogBody, DialogContent, DialogFooter, IconButton } from '../../ds/ui.js';
import { cellText } from '../spreadsheets/spreadsheet-editor-model.js';
import type { SpreadsheetFileReference } from '../spreadsheets/spreadsheet-chat-registration-model.js';
import { saveSpreadsheetDownload } from '../spreadsheets/spreadsheet-chat-registration-model.js';
import { useChatFileObjectUrl, useChatFilePreview, type ChatFile, type ChatFilesPort } from './chat-files-model.js';
import './chat-files.css';

export function ChatFiles({ port, onBackToChat, onOpenWorkbook, onAttachFile, mode = 'browse', initialFile }: { initialFile?: ChatFile; port: ChatFilesPort; onBackToChat: () => void; onOpenWorkbook?: (file: SpreadsheetFileReference) => void; onAttachFile?: (file: ChatFile) => void; mode?: 'browse' | 'attach' }) {
  const files = useSyncExternalStore(port.subscribe, port.snapshot, port.snapshot);
  const title = useId();
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const [selected, setSelection] = useState<{ port: ChatFilesPort; file: ChatFile } | null>(() => initialFile ? { port, file: initialFile } : null);
  const selection = selected?.port === port ? selected : null;
  const [downloadState, setDownloadState] = useState<{ port: ChatFilesPort; pending: boolean; error: string }>();
  const downloading = downloadState?.port === port && downloadState.pending;
  const error = downloadState?.port === port ? downloadState.error : '';
  const download = async (file: ChatFile) => {
    const request = { port, pending: true, error: '' }; setDownloadState(request);
    try { saveSpreadsheetDownload(await port.download(file)); setDownloadState(held => held === request ? { ...request, pending: false } : held); }
    catch (error) { setDownloadState(held => held === request ? { ...request, pending: false, error: error instanceof Error ? error.message : String(error) } : held); }
  };
  return <section className="hub-chat-files" aria-labelledby={title} data-mode={mode}>
    <header><h3 id={title}>Chat files</h3><p>Files shared in this conversation</p></header>
    {error && <Banner tone="danger" title="File unavailable">{error}</Banner>}
    {files.length ? <>{files.map(file => <div className="hub-chat-file" data-kind={file.kind} key={file.id}>
      <Button className="hub-chat-file-open" aria-label={`${mode === 'attach' ? 'Attach' : 'Preview'} ${file.name}`} onClick={event => { returnFocus.current = event.currentTarget; if (mode === 'attach' && onAttachFile) onAttachFile(file); else setSelection({ port, file }); }}><Folder aria-hidden /><span>{file.name}{file.kind === 'workbook' && <small>{file.reference.status} spreadsheet</small>}</span></Button>
      <IconButton className="hub-chat-file-download" label={`Download ${file.name}`} disabled={downloading} icon={<ArrowDown aria-hidden />} onClick={() => { void download(file); }} />
    </div>)}<Button className="hub-chat-files-button" onClick={onBackToChat}>Back to chat</Button></> : <div className="hub-chat-files-empty"><span className="hub-chat-files-symbol" aria-hidden><Folder /></span><h4>No files yet</h4><p>Attach a file with the + button in chat.<br />You'll find it here after you send it.</p><Button className="hub-chat-files-button hub-chat-files-primary" onClick={onBackToChat}>Back to chat</Button></div>}
    <ChatFilePreviewDialog returnFocus={returnFocus} port={port} selection={selection} onClose={() => setSelection(null)} onOpenWorkbook={onOpenWorkbook} onAttachFile={onAttachFile} onDownload={download} downloading={downloading} error={error} />
  </section>;
}

function ChatFilePreviewDialog({ returnFocus, port, selection, onClose, onOpenWorkbook, onAttachFile, onDownload, downloading, error }: { port: ChatFilesPort; selection: { file: ChatFile } | null; onClose: () => void; onOpenWorkbook?: (file: SpreadsheetFileReference) => void; onAttachFile?: (file: ChatFile) => void; onDownload: (file: ChatFile) => Promise<void>; downloading: boolean; error: string; returnFocus: RefObject<HTMLButtonElement | null> }) {
  const result = useChatFilePreview(port, selection);
  const blob = result?.state === 'loaded' && result.preview.kind === 'mock' ? result.preview.blob : undefined;
  const url = useChatFileObjectUrl(blob);
  const file = selection?.file;
  return <Dialog open={!!selection} onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="hub-chat-files-dialog" title={file?.name ?? 'File preview'} size="lg" onCloseAutoFocus={event => { if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus(); } }}><DialogBody>
    {error && <Banner tone="danger" title="Download unavailable">{error}</Banner>}
    {result?.state === 'loading' ? <p role="status">Loading preview…</p> : result?.state === 'failed' ? <Banner tone="danger" title="Preview unavailable">{result.message} Close this preview and open the file again to retry.</Banner> : result?.state === 'loaded' && result.preview.kind === 'workbook' ? <div className="hub-chat-file-preview">{result.preview.document.sheets.map(sheet => <section key={sheet.id}><h3>{sheet.name}</h3><table aria-label={`${sheet.name} preview`}><thead><tr>{sheet.rows[(sheet.headerRow ?? 1) - 1].cells.slice(0, 20).map((cell, column) => <th key={column} scope="col">{cellText(cell)}</th>)}</tr></thead><tbody>{sheet.rows.slice(sheet.headerRow ?? 1, (sheet.headerRow ?? 1) + 50).map(row => <tr key={row.id}>{row.cells.slice(0, 20).map((cell, column) => <td key={column}>{cellText(cell)}</td>)}</tr>)}</tbody></table>{(sheet.width > 20 || sheet.rows.length - (sheet.headerRow ?? 1) > 50) && <p>Preview shows the first 50 rows and 20 columns. Open the spreadsheet to see all cells.</p>}</section>)}</div> : blob?.type.startsWith('image/') && url ? <img loading="eager" className="hub-chat-file-image" src={url} alt={file?.name} width={640} height={480} /> : <p>Download this file to open it.</p>}
  </DialogBody><DialogFooter><Button onClick={onClose}>Close</Button>{file && <Button disabled={downloading} onClick={() => { void onDownload(file); }}>Download</Button>}{file && onAttachFile && <Button onClick={() => { onAttachFile(file); onClose(); }}>Attach to chat</Button>}{file?.kind === 'workbook' && onOpenWorkbook && <Button disabled={result?.state !== 'loaded'} onClick={() => { onOpenWorkbook(file.reference); onClose(); }}>Open spreadsheet</Button>}</DialogFooter></DialogContent></Dialog>;
}
