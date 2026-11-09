import { useState, type ReactNode } from 'react';
import { FileSpreadsheet, MoreHorizontal } from 'lucide-react';
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Field, IconButton, Input } from '../../../ds/ui.js';
import type { SheetFile } from './sheets-design-fixtures.js';
import '../../run-start/launch-presentation.css';

export type DialogKind = 'rename' | 'remove' | 'link';
export interface Actions { versions: (file: SheetFile) => void; dialog: (kind: DialogKind, files: readonly SheetFile[]) => void; open: (file: SheetFile) => void }

export function FileMenu({ file, actions, label, onReplace }: { file: SheetFile; actions: Actions; label: string; onReplace: () => void }) {
  return <DropdownMenu><DropdownMenuTrigger render={<IconButton label={`Actions for ${label}`} icon={<MoreHorizontal size={16} />} />} /><DropdownMenuContent align="end">
    <DropdownMenuItem onSelect={onReplace}>Replace</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => actions.open(file)}>Open</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => actions.versions(file)}>Versions</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => actions.dialog('rename', [file])}>Rename</DropdownMenuItem>
    {file.sharePoint ? <DropdownMenuItem onSelect={() => undefined}>Sync now</DropdownMenuItem> : <DropdownMenuItem onSelect={() => actions.dialog('link', [file])}>Link to SharePoint</DropdownMenuItem>}
    <DropdownMenuItem onSelect={() => undefined}>Download</DropdownMenuItem>
    <DropdownMenuItem variant="destructive" onSelect={() => actions.dialog('remove', [file])}>Remove</DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu>;
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="hub-sheets-section"><h2>{title}</h2>{children}</section>;
}

export function ActionDialog({ state, onClose }: { state: { kind: DialogKind; files: readonly SheetFile[] } | undefined; onClose: () => void }) {
  const [value, setValue] = useState('');
  const kind = state?.kind;
  const field = '!bg-[var(--ui-field)] !border-[color:var(--ui-stroke-control)]';
  const list = (files: readonly SheetFile[]) => <ul className="divide-y divide-ui-stroke rounded-[7px] border border-ui-stroke">{files.map(file => <li key={file.id} className="flex items-center gap-2 px-3 py-2"><FileSpreadsheet size={16} aria-hidden className="shrink-0 text-ui-muted" /><span className="min-w-0 flex-1 truncate text-body">{file.name}</span><span className="text-caption text-ui-muted">{file.rows.toLocaleString()} rows</span></li>)}</ul>;
  return <Dialog open={!!state} onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="launch-design" size="md" title={kind === 'remove' ? 'Remove spreadsheets?' : kind === 'rename' ? 'Rename spreadsheet' : 'Link to SharePoint'}><DialogBody>
    {kind === 'remove' ? <div className="grid gap-4"><p className="text-body text-ui-muted">These spreadsheets will no longer be available for lookups. Run evidence stays. SharePoint files are unchanged.</p>{list(state!.files)}</div>
      : <Field label={kind === 'rename' ? 'Name' : 'SharePoint file URL'}><Input className={field} value={value || (kind === 'rename' ? state!.files[0].name : '')} onChange={event => setValue(event.target.value)} /></Field>}
  </DialogBody><DialogFooter><Button variant="muted" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={onClose}>{kind === 'remove' ? 'Remove' : 'Save'}</Button></DialogFooter></DialogContent></Dialog>;
}
