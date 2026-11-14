import { useViewState } from "../../../app/navigation/view-route-model.js";
import '../reference-settings.css';
import { Fragment, useState } from 'react';
import { Pencil, Trash2, Undo2 } from 'lucide-react';
import { Banner, Button, Dialog, DialogBody, DialogContent, DialogFooter, IconButton, Input, PageHeading, SearchInput, Select } from '../../../ds/ui.js';
import { usePersonPreferences } from "../../../lib/person-preferences.js";
import { isMacPlatform, sendShortcutLabel } from "../../../state/person-preferences-model.js";
import type { SettingsSaveListener } from "../editor/settings-attempt-model.js";
import { DEFAULT_SHORTCUT_PREFERENCES, SHORTCUT_ACTIONS, useSaveShortcutPreferences, shortcutChord, shortcutLabel, useShortcutPreferences, type ShortcutAction } from './keyboard-preferences-model.js';

export function KeyboardSection({ onSaved }: { onSaved?: SettingsSaveListener }) {
  const preferences = useShortcutPreferences();
  const saveShortcutPreferences = useSaveShortcutPreferences();
  const [query, setQuery] = useViewState('keyboardQuery', '', 'replace');
  const [editing, setEditing] = useState<{ id: ShortcutAction; index: number } | null>(null);
  const [captured, setCaptured] = useState('');
  const [error, setError] = useState('');
  const person = usePersonPreferences();
  const sendShown = 'send shortcut choose which keys send a message in the assistant'.includes(query.toLowerCase());
  const actions = SHORTCUT_ACTIONS.filter(action => `${action.title} ${action.description} ${preferences.bindings[action.id].join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const edit = (id: ShortcutAction, index: number) => { setEditing({ id, index }); setCaptured(preferences.bindings[id][index] ?? ''); setError(''); };
  const save = async () => {
    if (!editing || !captured) return;
    const next = [...preferences.bindings[editing.id]];
    next[editing.index] = captured;
    try { if (!await saveShortcutPreferences({ ...preferences, bindings: { ...preferences.bindings, [editing.id]: next } })) return; setEditing(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); return; }
    onSaved?.({ title: `Saved ${SHORTCUT_ACTIONS.find(action => action.id === editing.id)!.title} shortcut` });
  };
  return <section className="settings-reference-page settings-shortcuts">
    <PageHeading title="Keyboard shortcuts" actions={<Button variant="muted" onClick={() => saveShortcutPreferences(DEFAULT_SHORTCUT_PREFERENCES)}>Reset all to defaults</Button>} />
    <SearchInput aria-label="Search shortcuts" placeholder="Search shortcuts" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} />
    <div className="shortcut-reference-card" aria-label="Keyboard bindings">
      {actions.map(action => {
        const chords = preferences.bindings[action.id];
        const defaults: readonly string[] = SHORTCUT_ACTIONS.find(item => item.id === action.id)!.defaults;
        const changed = chords.length !== defaults.length || chords.some((chord, position) => chord !== defaults[position]);
        const lines = Math.max(chords.length, 1);
        const save = (next: readonly string[]) => saveShortcutPreferences({ ...preferences, bindings: { ...preferences.bindings, [action.id]: [...next] } });
        const reset = changed ? <IconButton label={`Reset ${action.title} shortcut`} icon={<Undo2 className="size-3.5" />} onClick={() => save(defaults)} /> : null;
        return <div className="shortcut-reference-row" key={action.id}><div className="shortcut-reference-copy" style={{ gridRow: `1 / span ${lines}` }}><p>{action.title}</p><span>{action.description}</span></div>
          {chords.length === 0 ? <>
            <div className="shortcut-reference-binding" style={{ gridColumn: 2, gridRow: 1 }}><span className="shortcut-reference-unassigned">Unassigned</span><IconButton label={`Edit ${action.title} shortcut 1`} icon={<Pencil className="size-3.5" />} onClick={() => edit(action.id, 0)} /></div>
            <div className="shortcut-reference-actions" style={{ gridColumn: 3, gridRow: 1 }}>{reset}</div>
          </> : chords.map((chord, index) => <Fragment key={index}>
            <div className="shortcut-reference-binding" style={{ gridColumn: 2, gridRow: index + 1 }}><kbd>{shortcutLabel(chord)}</kbd><IconButton label={`Edit ${action.title} shortcut ${index + 1}`} icon={<Pencil className="size-3.5" />} onClick={() => edit(action.id, index)} /></div>
            <div className="shortcut-reference-actions" style={{ gridColumn: 3, gridRow: index + 1 }}>{index === 0 && reset}<IconButton label={`Remove ${action.title} shortcut ${index + 1}`} icon={<Trash2 className="size-3.5" />} onClick={() => save(chords.filter((_, position) => index !== position))} /></div>
          </Fragment>)}
        </div>;
      })}
      {sendShown && <div className="shortcut-reference-row"><div className="shortcut-reference-copy"><p>Send shortcut</p><span>Choose which keys send a message in the assistant.</span></div>
        <div className="shortcut-reference-binding" style={{ gridColumn: 2 }}><Select aria-label="Send shortcut" className="w-[150px]" value={person.value.sendShortcut} disabled={person.change === undefined || person.state === 'saving'} onChange={event => { void person.change?.({ 'preferences.sendShortcut': { set: event.target.value } }).then(saved => { if (saved) onSaved?.({ title: 'Saved Send shortcut' }); }); }}>{(['enter', 'mod-enter'] as const).map(option => <option key={option} value={option}>{sendShortcutLabel(option, isMacPlatform())}</option>)}</Select></div></div>}
      {actions.length === 0 && !sendShown && <p role="status" className="p-5 text-ui-muted">No shortcuts match your search.</p>}
    </div>
    <p className="m-0 text-caption text-ui-muted">Shortcuts pause in text fields and dialogs. Changes are saved in this browser.</p>
    <Dialog open={editing !== null} onOpenChange={open => { if (!open) setEditing(null); }}><DialogContent title="Edit shortcut" description="Press a key or key combination, then save." size="sm"><DialogBody>{error && <Banner className="mb-[var(--ds-space-heading-content)]" tone="danger" title="Shortcut unavailable">{error}</Banner>}<Input name="shortcutKeys" autoComplete="off" autoFocus readOnly aria-label="Shortcut keys" value={captured ? shortcutLabel(captured) : ''} placeholder="Press shortcut…" onKeyDown={event => { if (event.key === 'Escape' || event.key === 'Tab') return; event.preventDefault(); const chord = shortcutChord(event.nativeEvent); if (chord) { setCaptured(chord); setError(''); } }} /></DialogBody><DialogFooter><Button variant="muted" onClick={() => setEditing(null)}>Cancel</Button><Button disabled={!captured} onClick={save}>Save shortcut</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
