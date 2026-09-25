import {
Keyboard as KeyboardIcon
} from "lucide-react";
import { BulletList,dsIcon,Panel,PanelBody,PanelHeader,SectionLabel } from "../ds/ui.js";
import { plural } from "./format.js";
import { DEMO_SHORTCUTS } from "./shortcuts-model.js";
import { DemoShortcutsLegend } from "./shortcuts.js";


/**
 * The keyboard legend, at reading size (SE43).
 *
 * It renders the SAME registry the Top Bar popover was built against, through
 * the same component, so a key cannot be bound in one place and described in
 * another. The three rules below are not teaching — they are the conditions
 * under which these bindings do and do not fire, each one a fact
 * `app/global-keys.ts` enforces in its own header, and the one thing a legend
 * of keys cannot carry in a key column.
 */
export function KeyboardSection() {
  return (
    <Panel className="settings-page-panel">
      <PanelHeader
        title="Keyboard"
        headingLevel={2}
        icon={<KeyboardIcon aria-hidden className={dsIcon.lg} />}
        meta={plural(DEMO_SHORTCUTS.length, "binding")}
      />
      <PanelBody className="flex flex-col gap-[var(--ds-space-section)] p-[var(--ds-space-cozy)]">
        <DemoShortcutsLegend grouped className="max-w-[64ch]" />

        <div className="flex min-w-0 flex-col gap-[var(--ds-space-snug)]">
          <SectionLabel>When they fire</SectionLabel>
          <BulletList
            className="max-w-[86ch]"
            items={[
              "Never while the caret is in a text field — typing a name into search does not jump the queue.",
              "Never while a dialog or a drawer is open. That surface owns the keyboard, including Escape.",
              "Right-click, and the platform's own Menu / Shift+F10 key, open the same row menu that m does — m works from the SELECTION, so it does not need the row to be focused.",
            ]}
          />
        </div>
      </PanelBody>
    </Panel>
  );
}
