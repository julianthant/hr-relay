import "./reference-settings.css";
import { useState } from "react";
import { BodySection, FormGroup, PageHeading, SearchInput, dsText } from "../ds/ui.js";
import { shortcutsByScope } from "./shortcuts-model.js";
import { ShortcutKeys } from "./shortcuts.js";

export function KeyboardSection() {
  const [query, setQuery] = useState("");
  const groups = shortcutsByScope().map(group => ({ ...group, shortcuts: group.shortcuts.filter(shortcut => `${shortcut.what} ${shortcut.keys.join(" ")} ${group.scope}`.toLowerCase().includes(query.trim().toLowerCase())) })).filter(group => group.shortcuts.length > 0);
  return <div className="settings-reference-page settings-shortcuts">
    <PageHeading as="h2" title="Keyboard shortcuts" />
    <SearchInput aria-label="Search shortcuts" placeholder="Search shortcuts" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery("")} />
    {groups.map(group => <BodySection key={group.scope} title={group.scope}>
      <FormGroup label={`${group.scope} shortcuts`}>
        {group.shortcuts.map(shortcut => <div key={shortcut.what} className="shortcut-setting-row"><div className="min-w-0"><p>{shortcut.what.split(" — ")[0].replace(/^./u, letter => letter.toUpperCase())}</p><span>{shortcut.what.includes(" — ") ? shortcut.what.split(" — ").slice(1).join(" — ") : group.scope}</span></div><ShortcutKeys shortcut={shortcut} /></div>)}
      </FormGroup>
    </BodySection>)}
    {groups.length === 0 && <p role="status" className={dsText.body}>No shortcuts match your search.</p>}
    <p className={`${dsText.meta} settings-reference-keyboard-note`}>Shortcuts pause in text fields and while a dialog or drawer is open. Right-click or Menu / Shift+F10 opens a row menu; M uses the selected row without moving focus.</p>
  </div>;
}
