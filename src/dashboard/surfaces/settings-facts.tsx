import { type ReactNode } from "react";
import {
type SettingsFactsWire
} from "../../domain/dashboard/settings.js";
import { Banner,dsText,Spinner } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { useSettingsFacts } from "./settings-facts-model.js";


/* ── the two served status sections (D274 item 6, ledger 3 SE40–SE42) ─────── */

/**
 * The async half of both sections, drawn rather than hidden (D275 item 4).
 *
 * A refusal is NOT an empty table. "No test host is configured" and "we could
 * not ask the server" are different sentences about the same blank space, and a
 * page whose job is to state facts may not let one stand in for the other — so
 * the failed arm names the failure, in an `alert`, instead of rendering an
 * honest-looking page of nothing.
 */
const FACTS_LOADING = "Reading what this deployment is configured with";


export function FactsPane({
  facts,
  children,
}: {
  facts: ReturnType<typeof useSettingsFacts>;
  children: (loaded: SettingsFactsWire) => ReactNode;
}) {
  if (facts.state === "loading") {
    return (
      <span
        className={cn(
          dsText.meta,
          "flex items-center gap-[var(--ds-space-snug)] p-[var(--ds-space-cozy)]",
          "text-[color:var(--ds-fg-muted)]",
        )}
      >
        {/* The spinner IS the `role="status"` here, so its name is what a
            screen reader reads — it carries the real sentence rather than
            "Loading" over the top of it, and the visible copy is hidden from
            the tree so the one fact is announced once. ONE expression feeds
            both halves, the way intake's review checkbox does. */}
        <Spinner label={FACTS_LOADING} />
        <span aria-hidden>{FACTS_LOADING}…</span>
      </span>
    );
  }
  if (facts.state === "failed") {
    return (
      // No inner `role="alert"`: a `danger` Banner already carries one
      // (`primitives-layout.tsx`), and nesting a second is the exact defect the
      // D273 items 9–10 refused-notice merge ratified out — the sentence is
      // announced twice and every `getByRole("alert")` here goes ambiguous.
      <Banner
        className="m-[var(--ds-space-cozy)]"
        tone="danger"
        title="These facts could not be read"
      >
        <span className="flex flex-col gap-[var(--ds-space-tight)]">
          <span>{facts.message}</span>
          <span>Nothing below is missing — nothing below was asked for.</span>
        </span>
      </Banner>
    );
  }
  return <>{children(facts.facts)}</>;
}
