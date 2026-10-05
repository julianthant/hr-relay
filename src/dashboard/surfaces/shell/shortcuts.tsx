/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/demo-shortcuts.tsx
 *
 * The dashboard's whole keyboard flow, in ONE registry.
 *
 * It lives in its own module because the surface that renders it may not own it. For a long
 * while nothing rendered it at all: the top bar dropped its keyboard glyph on the operator's
 * instruction and the Settings destination that instruction traded it for was never built, so
 * the whole legend was unreachable from anywhere in this tree — not merely a binding that was
 * missing from it. D274 item 5 built the destination: `surfaces/settings.tsx`'s Help → Keyboard
 * section is the one caller, and `ShortcutsPopover` — which had zero — is gone with it.
 *
 * **A shortcut that is not in this array is undocumented, and a binding that is
 * not here is unreachable from Help.** That is the point of the single home:
 * `DESIGN.md` binds the row context menu's keyboard route to this registry, and
 * a second hand-written legend somewhere else is exactly how a key comes to be
 * bound in one file and described in another. That argument still holds for
 * whichever surface eventually renders this registry.
 *
 * 1i drop from the demo registry: `c` (mark the selected member checked) — the
 * member-checked bookkeeping has no wire state in this slice and the binding
 * would be a lie in Help.
 *
 * TWO MORE ENTRIES WERE CORRECTED WHEN THE HANDLER LANDED (`app/global-keys.ts`,
 * the consumer four regions of the detail-fidelity audit deferred to). The rule
 * the audit applies is that two operator-facing surfaces asserting a binding
 * which does not exist is the defect, so a key with no target is removed here
 * rather than bound to nothing:
 *
 *  - `Enter` is GONE. The demo opens a group's DRILL-IN view with it; this build
 *    has no drill-in (deferred with a named trigger in `queue.tsx`), and here
 *    selecting a row already opens it, so the key would do nothing.
 *  - `Esc` no longer says "back out of a group" — that was the same drill-in.
 *    Its other demo arm is real and is bound: at the top level it minimises the
 *    Workflow Panel, which is why the entry moved to the `Anywhere` scope.
 */
import { cn } from "../../lib/utils.js";
import { Kbd, SectionLabel, dsText } from "../../ds/ui.js";
import {
  DEMO_SHORTCUTS,
  shortcutsByScope,
  type DemoShortcut,
} from "./shortcuts-model.js";

export type { DemoShortcut };

/* the registry lives in `shortcuts-model.ts` — see the note there */

/** the key cluster for one binding — `j k` as a pair, `1–4` as a range */
export function ShortcutKeys({ shortcut }: { shortcut: DemoShortcut }) {
  return (
    <span className="flex shrink-0 items-center gap-[var(--ds-space-tight)]">
      {shortcut.keys.map((key, index) => (
        <span key={key} className="inline-flex items-center gap-[var(--ds-space-tight)]">
          {index > 0 && shortcut.join && (
            <span aria-hidden className={cn(dsText.meta, "text-[color:var(--ds-fg-faint)]")}>
              {shortcut.join}
            </span>
          )}
          <Kbd>{key}</Kbd>
        </span>
      ))}
    </span>
  );
}

/**
 * The legend, as a definition list. ONE renderer, so the Popover in the Top Bar
 * and the Help page cannot describe the same key two different ways.
 *
 * `grouped` is the only difference between the two consumers, and it is a
 * density decision rather than a content one: a 380px popover reads better as
 * one uninterrupted list, a full page reads better with the scope named.
 */
export function DemoShortcutsLegend({
  grouped = false,
  className,
}: {
  grouped?: boolean;
  className?: string;
}) {
  if (!grouped) {
    return (
      <dl className={cn("flex flex-col gap-[var(--ds-space-snug)]", className)}>
        {DEMO_SHORTCUTS.map((shortcut) => (
          <ShortcutRow key={shortcut.what} shortcut={shortcut} />
        ))}
      </dl>
    );
  }

  return (
    <div className={cn("flex flex-col gap-[var(--ds-space-loose)]", className)}>
      {shortcutsByScope().map((group) => (
        <div key={group.scope} className="flex min-w-0 flex-col gap-[var(--ds-space-snug)]">
          <SectionLabel>{group.scope}</SectionLabel>
          <dl className="flex flex-col gap-[var(--ds-space-snug)]">
            {group.shortcuts.map((shortcut) => (
              <ShortcutRow key={shortcut.what} shortcut={shortcut} />
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

function ShortcutRow({ shortcut }: { shortcut: DemoShortcut }) {
  return (
    <div className="flex items-baseline gap-[var(--ds-space-base)]">
      <dt className="flex shrink-0 items-center gap-[var(--ds-space-tight)]">
        <ShortcutKeys shortcut={shortcut} />
      </dt>
      <dd className={cn(dsText.body, "min-w-0 text-[color:var(--ds-fg-secondary)]")}>{shortcut.what}</dd>
    </div>
  );
}
