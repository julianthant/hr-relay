import {
ArrowLeft,
ArrowRight
} from "lucide-react";
import { dsIcon,IconButton } from "../ds/ui.js";


/* ── history ─────────────────────────────────────────────────────────────── */

/**
 * The two history controls, as the Top Bar sees them. The shell owns the
 * history value itself; this is only what the pair of buttons needs to render
 * and to call.
 */
export interface NavControls {
  canBack: boolean;
  canForward: boolean;
  /** the place each direction lands on, named — undefined when there is none */
  backTo?: string;
  forwardTo?: string;
  onBack: () => void;
  onForward: () => void;
}


/**
 * BACK AND FORWARD, and they sit in the Top Bar rather than on the queue.
 *
 * A disabled direction stays in place rather than disappearing: a pair that
 * collapses to one button at the start of a session moves every control to its
 * right by 28px the first time you navigate, which is a layout that shifts
 * under the pointer.
 */
export function NavHistoryControls({ nav }: { nav: NavControls }) {
  return (
    <span className="flex shrink-0 items-center gap-[var(--ds-space-hair)]">
      <IconButton
        size="sm"
        label="Back"
        title={nav.backTo === undefined ? "Back — nowhere to go yet" : `Back to ${nav.backTo}`}
        disabled={!nav.canBack}
        onClick={nav.onBack}
        icon={<ArrowLeft aria-hidden className={dsIcon.md} />}
      />
      <IconButton
        size="sm"
        label="Forward"
        title={nav.forwardTo === undefined ? "Forward — nowhere to go yet" : `Forward to ${nav.forwardTo}`}
        disabled={!nav.canForward}
        onClick={nav.onForward}
        icon={<ArrowRight aria-hidden className={dsIcon.md} />}
      />
    </span>
  );
}
