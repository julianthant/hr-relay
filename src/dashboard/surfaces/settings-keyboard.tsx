import "./reference-settings.css";
import { BodySection, FormGroup, PageHeading, ResultRow, dsText } from "../ds/ui.js";
import { shortcutsByScope } from "./shortcuts-model.js";
import { ShortcutKeys } from "./shortcuts.js";

export function KeyboardSection() {
  return <div className="settings-reference-page">
    <PageHeading as="h2" title="Keyboard" description="Keyboard shortcuts, grouped by where they work." />
    {shortcutsByScope().map(group => <BodySection key={group.scope} title={group.scope}>
      <FormGroup label={`${group.scope} shortcuts`}>
        {group.shortcuts.map(shortcut => <ResultRow key={shortcut.what} label={shortcut.what}
          value={<ShortcutKeys shortcut={shortcut} />} />)}
      </FormGroup>
    </BodySection>)}
    <p className={`${dsText.meta} settings-reference-keyboard-note`}>
      Shortcuts pause in text fields and while a dialog or drawer is open. Right-click or Menu / Shift+F10 opens a row menu; M uses the selected row without moving focus.
    </p>
  </div>;
}
