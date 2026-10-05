import { type ReactNode } from "react";
import {
type SettingsFactsWire
} from "../../domain/dashboard/settings.js";
import { Banner } from "../ds/ui.js";
import { useSettingsFacts } from "./settings-facts-model.js";
import { LoadingRegion, SettingsRowsSkeleton } from "./loading.js";


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
export function FactsPane({
  facts,
  children,
  loading,
}: {
  facts: ReturnType<typeof useSettingsFacts>;
  children: (loaded: SettingsFactsWire) => ReactNode;
  loading?: ReactNode;
}) {
  if (facts.state === "loading") {
    return loading ?? <LoadingRegion label="Loading deployment facts"><SettingsRowsSkeleton rows={4} wide presentation="result" /></LoadingRegion>;
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
        </span>
      </Banner>
    );
  }
  return <>{children(facts.facts)}</>;
}
