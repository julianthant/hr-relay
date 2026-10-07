import { shortcutActionForEvent, useShortcutPreferences } from "../../surfaces/settings/navigation/keyboard-preferences-model.js";
/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/RebuildDemo.tsx:441-534
 * (the whole window `keydown` effect).
 *
 * THE DASHBOARD'S ONE GLOBAL KEYDOWN LISTENER.
 *
 * Until this module existed the rebuild had NONE, while two operator-facing
 * surfaces asserted otherwise: `surfaces/shortcuts.tsx` legends every binding,
 * and the Workflow Panel toggle's own `title` names `w`. A key advertised in two
 * places and bound in none is the defect the detail-fidelity audit booked four
 * times over (R2 D13/D14, R3 finding 8, R5 finding 7, R8 finding 7), and this is
 * the one consumer all four deferred to.
 *
 * THE GUARDS COME FIRST, in the demo's own order, and each one is load-bearing:
 *
 *  1. a typing target (`input`, `textarea`, `contentEditable`) owns its own
 *     keystrokes — `j` inside the log filter must type a `j`;
 *  2. a modifier means the browser or the OS is being addressed, never the
 *     queue;
 *  3. **a dialog owns the keyboard while it is open, INCLUDING Escape**, which
 *     Radix answers itself. `useDsModalOpen()` is exported for exactly this
 *     (`ds/primitives-overlay.tsx`): Radix traps focus, but a `window` listener
 *     still fires, so without this `j`/`k` moved the selection behind an open
 *     confirm dialog and the operator came back to a different row.
 *
 * WHAT THIS BINDS AND WHAT IT DELIBERATELY DOES NOT. Every key here resolves to
 * a target that EXISTS in this build. Two of the demo's do not, and they were
 * corrected in the registry rather than bound to nothing (the audit's rule: two
 * surfaces asserting a binding that does not exist is the defect, so removing
 * the claim is the fix):
 *
 *  - `Enter` opens the demo's DRILL-IN view of a group's members. This build has
 *    no drill-in (R3 findings 23/24, deferred with a named trigger in
 *    `queue.tsx`), and here selecting a row already opens it — `j`/`k` move the
 *    open run — so an `Enter` binding would be a keystroke that does nothing.
 *  - `Escape`'s first arm backs out of that same drill-in. Its SECOND arm — at
 *    the top level, minimise the Workflow Panel — is real and is bound below.
 */
import { useEffect } from "react";
import { useDsModalOpen } from "../../ds/ui.js";
import type { PanelTab } from "../../surfaces/run-detail/log-panel-model.js";
import type { WorkflowPanelMode } from "../../surfaces/shell/shell-model.js";

export interface GlobalKeyBindings {
  /** Queue bindings have no target while another surface owns the main region. */
  readonly queueVisible?: boolean;
  readonly workflowIds?: readonly string[];
  readonly onWorkflow?: (id: string) => void;
  /** `r` — the run-start dialog is workflow-global, so this needs no scope */
  onStartRun: () => void;
  /** `w` — the panel's own three-mode cycle */
  onCyclePanelMode: () => void;
  /** the mode Escape reads: only a FLOATING window has anything to minimise */
  panelMode: WorkflowPanelMode;
  onMinimisePanel: () => void;
  /** `j`/`k` — the queue's drawn order, members included (`visibleRunIds`) */
  visibleRunIds: readonly string[];
  /** `n` — the same rows the NEEDS YOU band draws, in the same order */
  attentionRunIds: readonly string[];
  selectedRunId: string | undefined;
  onSelectRun: (runId: string) => void;
  /** `1`–`4` — the tabs the OPEN run advertises, in the panel's own order */
  panelTabs: readonly PanelTab[];
  onTab: (tab: PanelTab) => void;
}

/**
 * The selection's next place in a list, ported from the demo's own arithmetic
 * (`RebuildDemo.tsx:480-486`). Nothing selected is `index === -1`, and both
 * directions then land on the first row — which is what makes the first `j` of a
 * session do something rather than nothing.
 *
 * Exported so the binding is testable without a DOM: this is the only part of
 * the handler that computes an answer rather than routing one.
 */
export function stepSelection(
  ids: readonly string[],
  selected: string | undefined,
  direction: "next" | "previous",
): string | undefined {
  if (ids.length === 0) return undefined;
  const index = selected === undefined ? -1 : ids.indexOf(selected);
  const moved = direction === "next"
    ? ids[Math.min(index + 1, ids.length - 1)]
    : ids[Math.max(index - 1, 0)];
  return moved ?? ids[0];
}

/**
 * `n` — the next row that needs the operator, wrapping to the first.
 *
 * Ported from `RebuildDemo.tsx:487-500`'s non-drill arm. The demo additionally
 * excludes `containment === "rejected"`; that field is not on this wire (the
 * audit's `QueueBaseFields` ledger row), and a status-only attention set is
 * strictly WIDER — it can offer a row that does not need attention, never hide
 * one that does. Same reasoning as R3 finding 21's tint.
 */
export function nextAttention(
  visible: readonly string[],
  attention: readonly string[],
  selected: string | undefined,
): string | undefined {
  if (attention.length === 0) return undefined;
  const index = selected === undefined ? -1 : visible.indexOf(selected);
  return attention.find((id) => visible.indexOf(id) > index) ?? attention[0];
}

/** A focused scroll viewport (log, PDF page) keeps its native arrow-key panning. */
function scrollsVertically(element: HTMLElement): boolean {
  return element.scrollHeight > element.clientHeight && /^(auto|scroll)$/u.test(getComputedStyle(element).overflowY);
}

export function useGlobalKeys(bindings: GlobalKeyBindings): void {
  const preferences = useShortcutPreferences();
  const modalOpen = useDsModalOpen();
  const {
    queueVisible = true,
    onStartRun,
    onCyclePanelMode,
    panelMode,
    onMinimisePanel,
    visibleRunIds,
    attentionRunIds,
    selectedRunId,
    onSelectRun,
    panelTabs,
    onTab,
  } = bindings;

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!queueVisible || event.defaultPrevented || event.isComposing) return;
      const target = event.target;
      if (
        target instanceof HTMLElement
        && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable
          || target.closest('[role="dialog"], [role="menu"], [role="listbox"], [role="combobox"], [role="tablist"]') !== null)
      ) {
        return;
      }
      if (target instanceof HTMLElement && (event.key === "ArrowDown" || event.key === "ArrowUp") && scrollsVertically(target)) return;
      if (modalOpen || document.querySelector('[role="dialog"][data-state="open"], [role="menu"][data-state="open"]') !== null) return;
      const action = shortcutActionForEvent(event, preferences);
      if (!action && (event.metaKey || event.ctrlKey || event.altKey)) return;

      if (action === "start") {
        event.preventDefault();
        onStartRun();
        return;
      }

      if (action === "next") {
        const next = stepSelection(visibleRunIds, selectedRunId, "next");
        if (next === undefined) return;
        event.preventDefault();
        onSelectRun(next);
        return;
      }
      if (action === "previous") {
        const next = stepSelection(visibleRunIds, selectedRunId, "previous");
        if (next === undefined) return;
        event.preventDefault();
        onSelectRun(next);
        return;
      }
      if (action === "attention") {
        const next = nextAttention(visibleRunIds, attentionRunIds, selectedRunId);
        if (next === undefined) return;
        event.preventDefault();
        onSelectRun(next);
        return;
      }
      if (event.key === "Escape") {
        // The demo dismisses the INNERMOST thing — drill-in first, then the
        // panel. This build has only the second half (see the file header), and
        // an already-minimised panel has nothing to minimise, so the key falls
        // through to whatever else is listening rather than being swallowed.
        if (panelMode !== "floating") return;
        event.preventDefault();
        onMinimisePanel();
        return;
      }
      if (event.key === "w" && panelMode !== "sidebar") {
        event.preventDefault();
        onCyclePanelMode();
        return;
      }
      if (/^[1-4]$/.test(event.key)) {
        // The tabs the OPEN run advertises — never a fixed four. A run offering
        // two sections has no third tab, and pressing `3` on it must not land on
        // a section the panel cannot draw.
        const next = panelTabs[Number(event.key) - 1];
        if (next === undefined) return;
        event.preventDefault();
        onTab(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preferences,
    modalOpen,
    queueVisible,
    onStartRun,
    onCyclePanelMode,
    panelMode,
    onMinimisePanel,
    visibleRunIds,
    attentionRunIds,
    selectedRunId,
    onSelectRun,
    panelTabs,
    onTab,
  ]);
}
