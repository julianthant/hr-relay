import { shortcutActionForEvent, useShortcutPreferences } from "../../surfaces/settings/navigation/keyboard-preferences-model.js";
import { useEffect } from "react";
import { useDsModalOpen } from "../../ds/ui.js";

export interface GlobalKeyBindings {
  /** Queue bindings have no target while another surface owns the main region. */
  readonly queueVisible?: boolean;
  readonly workflowIds?: readonly string[];
  readonly onWorkflow?: (id: string) => void;
  /** `r` — the run-start dialog is workflow-global, so this needs no scope */
  onStartRun: () => void;
  /** `j`/`k` — the queue's drawn order, members included (`visibleQueueKeys`) */
  visibleQueueKeys: readonly string[];
  /** `n` — the same rows the NEEDS YOU band draws, in the same order */
  attentionQueueKeys: readonly string[];
  selectedQueueKey: string | undefined;
  onSelectQueueKey: (runId: string) => void;
}

/** The selection's next place in a list. Nothing selected is `index === -1`, and
 * both directions then land on the first row — which is what makes the first `j` */
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

/** `n` — the next row that needs the operator, wrapping to the first.
 * A status-only attention set is strictly WIDER than the demo's */
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
    visibleQueueKeys,
    attentionQueueKeys,
    selectedQueueKey,
    onSelectQueueKey,
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

      if (action === "next" || action === "previous") {
        const next = stepSelection(visibleQueueKeys, selectedQueueKey, action);
        if (next === undefined) return;
        event.preventDefault();
        onSelectQueueKey(next);
        return;
      }
      if (action === "attention") {
        const next = nextAttention(visibleQueueKeys, attentionQueueKeys, selectedQueueKey);
        if (next === undefined) return;
        event.preventDefault();
        onSelectQueueKey(next);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preferences,
    modalOpen,
    queueVisible,
    onStartRun,
    visibleQueueKeys,
    attentionQueueKeys,
    selectedQueueKey,
    onSelectQueueKey,
  ]);
}
