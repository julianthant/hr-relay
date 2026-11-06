import { useState, type RefObject } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Badge, Banner, Button, Checkbox, Dialog, DialogBody, DialogContent, DialogFooter, Drawer, DrawerContent, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Field, IconButton, Input, Select } from '../../ds/ui.js';
import { formatInstantDate } from '../../lib/date-format.js';
import type { WorkbookLibraryAction, WorkbookLibraryEntry, WorkbookLibraryVersion } from '../../../models/dashboard/workbook-library.js';
import type { LibraryChangeResult } from '../../state/spreadsheet-wiring-adapter.js';

export function SpreadsheetVersions({ entry, onClose, onDownload, onChange, onCheck, pending, returnFocus }: {
  entry: WorkbookLibraryEntry | null; onClose: () => void; returnFocus?: RefObject<HTMLElement | null>;
  onDownload: (entry: WorkbookLibraryEntry, version: WorkbookLibraryVersion) => Promise<void>;
  onChange: (entry: WorkbookLibraryEntry, change: WorkbookLibraryAction['change']) => Promise<LibraryChangeResult>;
  onCheck: (entry: WorkbookLibraryEntry) => Promise<LibraryChangeResult>; pending: boolean;
}) {
  const [renameId, setRenameId] = useState<string>(), [name, setName] = useState('');
  const [dialog, setDialog] = useState<{ kind: 'use' | 'delete'; version: WorkbookLibraryVersion } | { kind: 'new'; from: string } | { kind: 'unlink' }>();
  const [from, setFrom] = useState(''), [useNow, setUseNow] = useState(true), [working, setWorking] = useState(false), [error, setError] = useState('');
  const perform = async (work: () => Promise<LibraryChangeResult | void>): Promise<LibraryChangeResult> => {
    setWorking(true); setError('');
    try { const result = await work(); if (result && result.state !== 'confirmed') setError(result.message); return result ?? { state: 'confirmed' }; }
    catch (error) { const message = error instanceof Error ? error.message : String(error); setError(message); return { state: 'uncertain', message }; }
    finally { setWorking(false); }
  };
  const newVersion = (source: string) => { setName(''); setFrom(source); setUseNow(true); setError(''); setDialog({ kind: 'new', from: source }); };
  const close = () => { onClose(); window.requestAnimationFrame(() => { if (returnFocus?.current?.isConnected) returnFocus.current.focus(); }); };
  const confirm = async () => {
    if (!entry || !dialog) return;
    const change: WorkbookLibraryAction['change'] = dialog.kind === 'new' ? { kind: 'create-version', name: name.trim(), from: from === 'sharepoint' ? { kind: 'sharepoint' } : { kind: 'version', versionId: from.slice(8) }, useNow } : dialog.kind === 'unlink' ? { kind: 'unlink' } : { kind: dialog.kind === 'use' ? 'use-version' : 'delete-version', versionId: dialog.version.id };
    if ((await perform(() => onChange(entry, change))).state === 'confirmed') setDialog(undefined);
  };
  const lastSync = entry?.state.versions.findLast(version => version.source === 'sharepoint');
  return <><Drawer open={entry !== null} onOpenChange={open => { if (!open && !working) close(); }}><DrawerContent title="Versions" description={entry?.name} size="480px" className="hub-sheets-versions">
    {entry && <div className="hub-sheets-versions-body">
      <section className="hub-sheets-section"><h3>Source</h3><div className="hub-sheets-version-row"><div>{entry.metadata.sharePoint ? <><a href={entry.metadata.sharePoint.url} target="_blank" rel="noreferrer">SharePoint</a><p className="hub-sheets-caption">{lastSync ? `Last sync ${formatInstantDate(lastSync.savedAt)}` : 'No sync saved yet'}</p></> : <><p>This Mac</p><p className="hub-sheets-caption">Versions are saved in your local library.</p></>}</div>{entry.metadata.sharePoint && <Button disabled={working || pending} onClick={() => void perform(() => onChange(entry, { kind: 'sync' }))}>Sync now</Button>}</div></section>
      {pending && <Banner tone="warning" title="Change not yet confirmed">Check the result before changing this spreadsheet again.<Button disabled={working} onClick={() => void perform(() => onCheck(entry))}>Check result</Button></Banner>}
      {error && !dialog && <Banner tone="danger" title="Version action unavailable">{error}</Banner>}
      <section className="hub-sheets-section"><div className="hub-sheets-toolbar"><h3>Saved versions</h3><Button disabled={working || pending} onClick={() => newVersion(entry.metadata.sharePoint ? 'sharepoint' : `version:${entry.state.selectedVersionId}`)}>New version</Button></div>
        <div className="hub-sheets-version-list">{entry.state.versions.toReversed().map(version => <div className="hub-sheets-version-row" key={version.id}>
          <div className="min-w-0">{renameId === version.id ? <Field label="Version name"><Input value={name} disabled={working || pending} onChange={event => setName(event.target.value)} /></Field> : <><strong>{version.name}</strong><div className="hub-sheets-actions">{version.id === entry.state.selectedVersionId && <Badge>In use</Badge>}{version.source === 'sharepoint' && <Badge>Automatic</Badge>}</div><p className="hub-sheets-caption">{formatInstantDate(version.savedAt)} · {version.source === 'sharepoint' ? 'Synced from SharePoint' : version.source === 'workflow' ? 'Workflow' : 'Saved locally'}</p></>}</div>
          <div className="hub-sheets-actions">{renameId === version.id ? <><Button disabled={working || pending || !name.trim()} onClick={() => void perform(() => onChange(entry, { kind: 'rename-version', versionId: version.id, name: name.trim() })).then(result => { if (result.state === 'confirmed') setRenameId(undefined); })}>Save</Button><Button disabled={working} onClick={() => setRenameId(undefined)}>Cancel</Button></> : <>{version.id !== entry.state.selectedVersionId && <Button disabled={working || pending} onClick={() => { setError(''); setDialog({ kind: 'use', version }); }}>Use</Button>}<Button disabled={working} aria-label={`Download ${version.name}`} onClick={() => void perform(() => onDownload(entry, version))}>Download</Button><DropdownMenu><DropdownMenuTrigger render={<IconButton label={`Actions for ${version.name}`} disabled={working || pending} icon={<MoreHorizontal size={16} />} />} /><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => { setRenameId(version.id); setName(version.name); }}>Rename</DropdownMenuItem><DropdownMenuItem onSelect={() => newVersion(`version:${version.id}`)}>New version from this</DropdownMenuItem><DropdownMenuItem onSelect={() => void perform(() => onDownload(entry, version))}>Download</DropdownMenuItem><DropdownMenuItem variant="destructive" disabled={version.id === entry.state.selectedVersionId} onSelect={() => { setError(''); setDialog({ kind: 'delete', version }); }}>Delete version</DropdownMenuItem></DropdownMenuContent></DropdownMenu></>}</div>
        </div>)}</div>
      </section>
      {entry.metadata.sharePoint && <Button disabled={working || pending} onClick={() => { setError(''); setDialog({ kind: 'unlink' }); }}>Unlink from SharePoint</Button>}
    </div>}
  </DrawerContent></Drawer>
  <Dialog open={!!dialog} onOpenChange={open => { if (!open && !working) setDialog(undefined); }}><DialogContent title={dialog?.kind === 'new' ? 'New version' : dialog?.kind === 'use' ? 'Use this version?' : dialog?.kind === 'delete' ? 'Delete this version?' : 'Unlink from SharePoint?'}><DialogBody>
    {dialog?.kind === 'new' ? <div className="grid gap-4"><Field label="Start from"><Select disabled={working || pending} value={from} onChange={event => setFrom(event.target.value)}>{entry?.metadata.sharePoint && <option value="sharepoint">Latest SharePoint file</option>}{entry?.state.versions.toReversed().map(version => <option key={version.id} value={`version:${version.id}`}>{version.name}</option>)}</Select></Field><Field label="Version name"><Input value={name} disabled={working || pending} onChange={event => setName(event.target.value)} /></Field><Checkbox label="Use this version now" disabled={working || pending} checked={useNow} onCheckedChange={checked => setUseNow(checked === true)} /></div> : dialog?.kind === 'use' ? <p>New lookups will use <strong>{dialog.version.name}</strong>. Runs already started keep their captured reference data.</p> : dialog?.kind === 'delete' ? <p>Delete <strong>{dialog.version.name}</strong> from the library? Runs that used it keep their results. A version still used by an active run cannot be deleted.</p> : <p>Saved versions stay in this library. Sync will be unavailable until you link a SharePoint file again.</p>}
    {error && <Banner tone="danger" title="Version action unavailable">{error}</Banner>}
  </DialogBody><DialogFooter><Button disabled={working} onClick={() => setDialog(undefined)}>Cancel</Button><Button disabled={working || pending || dialog?.kind === 'new' && (!name.trim() || !from)} onClick={() => void confirm()}>{working ? 'Working…' : dialog?.kind === 'new' ? 'Create version' : dialog?.kind === 'use' ? 'Use version' : dialog?.kind === 'delete' ? 'Delete version' : 'Unlink'}</Button></DialogFooter></DialogContent></Dialog></>;
}
