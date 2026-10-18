import { useViewState } from "../../../app/navigation/view-route-model.js";
import '../reference-settings.css';
import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Banner, Button, Dialog, DialogBody, DialogContent, DialogFooter, IconButton, Input, PageHeading, SearchInput } from '../../../ds/ui.js';
import type { SettingsSaveListener } from "../editor/settings-attempt-model.js";
import { DEFAULT_SHORTCUT_PREFERENCES, SHORTCUT_ACTIONS, saveShortcutPreferences, shortcutChord, shortcutLabel, useShortcutPreferences, type ShortcutAction } from './keyboard-preferences-model.js';

export function KeyboardSection({ onSaved }: { onSaved?: SettingsSaveListener }) {
  const preferences = useShortcutPreferences();
  const [query, setQuery] = useViewState('keyboardQuery', '', 'replace');
  const [editing, setEditing] = useState<{ id: ShortcutAction; index: number } | null>(null);
  const [captured, setCaptured] = useState('');
  const [error, setError] = useState('');
  const actions = SHORTCUT_ACTIONS.filter(action => `${action.title} ${action.description} ${preferences.bindings[action.id].join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const edit = (id: ShortcutAction, index: number) => { setEditing({ id, index }); setCaptured(preferences.bindings[id][index] ?? ''); setError(''); };
  const save = () => {
    if (!editing || !captured) return;
    const next = [...preferences.bindings[editing.id]];
    next[editing.index] = captured;
    try { saveShortcutPreferences({ ...preferences, bindings: { ...preferences.bindings, [editing.id]: next } }); setEditing(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); return; }
    onSaved?.({ title: `Saved ${SHORTCUT_ACTIONS.find(action => action.id === editing.id)!.title} shortcut` });
  };
  return <section className="settings-reference-page settings-shortcuts">
    <PageHeading title="Keyboard shortcuts" />
    <SearchInput aria-label="Search shortcuts" placeholder="Search shortcuts" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} />
    <div className="shortcut-reference-card" aria-label="Keyboard bindings">
      {actions.map(action => <div className="shortcut-reference-row" key={action.id}><div className="shortcut-reference-copy"><p>{action.title}</p><span>{action.description}</span></div>
        <div className="shortcut-reference-bindings">{preferences.bindings[action.id].map((chord, index) => <div className="shortcut-reference-binding" key={index}><kbd>{shortcutLabel(chord)}</kbd><IconButton label={`Edit ${action.title} shortcut ${index + 1}`} icon={<Pencil className="size-3.5" />} onClick={() => edit(action.id, index)} /><IconButton label={`Remove ${action.title} shortcut ${index + 1}`} icon={<Trash2 className="size-3.5" />} onClick={() => saveShortcutPreferences({ ...preferences, bindings: { ...preferences.bindings, [action.id]: preferences.bindings[action.id].filter((_, position) => index !== position) } })} /></div>)}
          {preferences.bindings[action.id].length === 0 && <div className="shortcut-reference-binding"><span className="text-caption text-ui-muted">Not assigned</span><IconButton label={`Edit ${action.title} shortcut 1`} icon={<Pencil className="size-3.5" />} onClick={() => edit(action.id, 0)} /></div>}
        </div>
      </div>)}
      {actions.length === 0 && <p role="status" className="p-5 text-ui-muted">No shortcuts match your search.</p>}
    </div>
    <div className="flex items-start justify-between gap-4"><p className="m-0 text-caption text-ui-muted">Shortcuts pause in text fields and dialogs. Changes are saved in this browser.</p><Button size="sm" variant="ghost" onClick={() => saveShortcutPreferences(DEFAULT_SHORTCUT_PREFERENCES)}>Reset defaults</Button></div>
    <Dialog open={editing !== null} onOpenChange={open => { if (!open) setEditing(null); }}><DialogContent title="Edit shortcut" description="Press a key or key combination, then save." size="sm"><DialogBody>{error && <Banner className="mb-[var(--ds-space-heading-content)]" tone="danger" title="Shortcut unavailable">{error}</Banner>}<Input name="shortcutKeys" autoComplete="off" autoFocus readOnly aria-label="Shortcut keys" value={captured ? shortcutLabel(captured) : ''} placeholder="Press shortcut…" onKeyDown={event => { if (event.key === 'Escape' || event.key === 'Tab') return; event.preventDefault(); const chord = shortcutChord(event.nativeEvent); if (chord) { setCaptured(chord); setError(''); } }} /></DialogBody><DialogFooter><Button variant="muted" onClick={() => setEditing(null)}>Cancel</Button><Button disabled={!captured} onClick={save}>Save shortcut</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
